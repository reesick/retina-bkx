"""Inference pipeline: one fundus image -> quality, landmarks, grades, doubt, lesions, triage, overlays.

Interface used by the API layer:

    p = Pipeline(models_dir)
    p.health() -> {"models": {name: {"loaded": bool, "sha": str}}, "missing": [names], "ready": bool}
    p.run(image_bytes, eye, view, fov_deg, emit) -> dict

`emit(step, status, partial, ms)` is called for each step in STEPS order with status "start" then "done"
(partial/ms only on "done"). Output keys: canonical_jpeg (bytes), overlays ({kind: png bytes}),
canonical_size, quality, landmarks, grading, uncertainty, lesions, macular_risk, triage, timings_ms,
model_versions. Raises ModelsMissing if models are not installed, ValueError for non-image input.

Deterministic: pure OpenCV/NumPy preprocessing shared with training (core.fundus), ONNX Runtime on CPU
with fixed threading, floats rounded to 4 decimals.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core import policy as P  # noqa: E402
from core.fundus import crop_mask_like, crop_square, decode_image, fundus_mask, to_tensor_input  # noqa: E402
from core.quality import combine, compute_features, run_checks  # noqa: E402

Emit = Callable[[str, str, Optional[dict], Optional[float]], None]
STEPS = ["decode", "quality", "landmarks", "grader_cnn", "grader_vit", "lesions", "uncertainty", "policy", "overlays"]
ONNX = ["quality", "grader_cnn", "grader_vit", "lesions", "landmarks"]
REQUIRED = [f"{n}.onnx" for n in ONNX] + ["policy.json", "ood.npz", "manifest.json"]
LES = ["MA", "HE", "EX", "SE"]
LES_RGB = {"MA": (255, 55, 95), "HE": (255, 69, 58), "EX": (255, 214, 10), "SE": (229, 229, 234)}
CANON = 768
SEG = 1024
DISC_FOVEA_DD = 2.5     # disc-to-fovea distance is about 2.5 disc diameters
MIN_AREA = {"MA": 3, "HE": 12, "EX": 6, "SE": 30}


class ModelsMissing(RuntimeError):
    pass


def _r(x, nd=4):
    if isinstance(x, dict):
        return {k: _r(v, nd) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_r(v, nd) for v in x]
    if isinstance(x, (np.floating, float)):
        v = float(x)
        return round(v, nd) if np.isfinite(v) else None
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, np.bool_):
        return bool(x)
    return x


def _softmax(z: np.ndarray, t: float = 1.0) -> np.ndarray:
    z = z.astype(np.float64) / t
    z = z - z.max()
    e = np.exp(z)
    return e / e.sum()


def _png(rgba: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 6])
    return buf.tobytes()


def _heat_rgba(m: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """m: 2D map (any size, >= 0). Returns RGBA CANON x CANON magma overlay."""
    m = np.maximum(m.astype(np.float32), 0)
    m = cv2.resize(m, (CANON, CANON), interpolation=cv2.INTER_CUBIC)
    m = np.maximum(m, 0) * mask
    mx = float(m.max())
    v = m / mx if mx > 1e-8 else m
    col = cv2.applyColorMap((v * 255).astype(np.uint8), cv2.COLORMAP_MAGMA)
    rgb = cv2.cvtColor(col, cv2.COLOR_BGR2RGB)
    a = (np.clip(v, 0, 1) ** 0.8 * 0.78 * 255).astype(np.uint8)
    return np.dstack([rgb, a])


class Pipeline:
    def __init__(self, models_dir: Path, threads: int = 4):
        self.dir = Path(models_dir)
        self.threads = threads
        self.sessions: dict = {}
        self._lock = threading.Lock()
        self._loaded = False
        self.load_error: str | None = None

    # ------------------------------------------------------------ loading
    def _load(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            missing = [f for f in REQUIRED if not (self.dir / f).exists()]
            if missing:
                raise ModelsMissing(f"Missing model files in {self.dir}: {', '.join(missing)}")
            import onnxruntime as ort

            so = ort.SessionOptions()
            so.intra_op_num_threads = self.threads
            so.inter_op_num_threads = 1
            so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            so.log_severity_level = 3
            for n in ONNX:
                self.sessions[n] = ort.InferenceSession(str(self.dir / f"{n}.onnx"), so, providers=["CPUExecutionProvider"])
            self.manifest = json.loads((self.dir / "manifest.json").read_text())
            self.policy = {**P.DEFAULT_POLICY, **json.loads((self.dir / "policy.json").read_text())}
            qr = self.dir / "quality_rules.json"
            self.rules = {k: v for k, v in json.loads(qr.read_text()).items() if k != "provenance"} if qr.exists() else {}
            o = np.load(self.dir / "ood.npz")
            self.ood = {k: o[k].astype(np.float64) for k in o.files}
            self.les_thr = self.manifest.get("lesions", {}).get("thresholds", {k: 0.5 for k in LES})
            self.T = self.policy.get("temperatures", {"cnn": 1.0, "vit": 1.0})
            self.versions = {n: self.manifest.get(n, {}).get("sha", "") for n in ONNX}
            self.versions["policy"] = self.policy.get("version", "")
            self._loaded = True

    def health(self) -> dict:
        missing = [f for f in REQUIRED if not (self.dir / f).exists()]
        if not missing:
            try:
                self._load()
            except Exception as e:  # pragma: no cover
                self.load_error = repr(e)
        man = {}
        if (self.dir / "manifest.json").exists():
            man = json.loads((self.dir / "manifest.json").read_text())
        models = {n: {"loaded": n in self.sessions, "sha": man.get(n, {}).get("sha", "")} for n in ONNX}
        return {"models": models, "missing": missing, "ready": self._loaded and not missing,
                "policy_version": getattr(self, "policy", {}).get("version"), "error": self.load_error}

    def _run(self, name: str, x: np.ndarray) -> list[np.ndarray]:
        return self.sessions[name].run(None, {"image": x})

    # ------------------------------------------------------------ steps
    def _landmarks(self, sq768: np.ndarray, eye: str) -> dict:
        hm = self._run("landmarks", to_tensor_input(sq768, 512))[0][0]  # (2,128,128), sigmoid
        H = hm.shape[-1]
        pts = []
        for c in range(2):
            h = hm[c]
            y, x = divmod(int(h.argmax()), H)
            y0, y1, x0, x1 = max(0, y - 2), min(H, y + 3), max(0, x - 2), min(H, x + 3)
            w = h[y0:y1, x0:x1].astype(np.float64)
            yy, xx = np.mgrid[y0:y1, x0:x1]
            s = w.sum() + 1e-9
            pts.append({"x": float((xx * w).sum() / s + 0.5) / H, "y": float((yy * w).sum() / s + 0.5) / H,
                        "conf": float(h.max())})
        od, fv = pts
        dist = float(np.hypot(od["x"] - fv["x"], od["y"] - fv["y"]))
        both = min(od["conf"], fv["conf"])
        dd = dist / DISC_FOVEA_DD if both >= 0.3 and 0.15 < dist < 0.6 else 0.1
        dx = od["x"] - fv["x"]
        # Fundus photos are viewed as if looking into the eye: the disc (nasal) is on the image right for OD.
        rule = self.policy.get("laterality_disc_right", "OD")
        pred = "unknown"
        if both >= 0.3 and abs(dx) >= 0.05:
            pred = rule if dx > 0 else ("OS" if rule == "OD" else "OD")
        conf = float(np.clip(both, 0, 1) * np.clip(abs(dx) / 0.15, 0, 1)) if pred != "unknown" else 0.0
        return {"od": od, "fovea": fv, "disc_diameter": dd,
                "laterality": {"predicted": pred, "confidence": conf, "selected": eye,
                               "mismatch": bool(pred in ("OD", "OS") and conf >= 0.8 and pred != eye)}}

    def _grader(self, name: str, sq768: np.ndarray, size: int, T: float) -> tuple[dict, np.ndarray, np.ndarray]:
        logits, feats, emap = self._run(name, to_tensor_input(sq768, size))
        p = _softmax(logits[0], T)
        label = {"grader_cnn": "cnn_effb3", "grader_vit": "vit_dinov2"}[name]
        return ({"name": label, "probs": p.tolist(), "p_referable": float(p[2:].sum()), "temperature": T},
                feats[0].astype(np.float64), emap[0])

    def _ood(self, f: np.ndarray) -> float:
        o = self.ood
        z = (f - o["mean"]) @ o["components"].T - o["mu"]
        return float(np.sqrt(z @ o["prec"] @ z))

    def _lesions(self, sq1024: np.ndarray, mask1024: np.ndarray, lm: dict) -> tuple[dict, np.ndarray]:
        probs = self._run("lesions", to_tensor_input(sq1024, SEG))[0][0]  # (4,1024,1024)
        fundus_area = float(mask1024.sum()) + 1e-6
        fov = lm["fovea"]
        fov_ok = fov["conf"] >= self.rules.get("fovea_conf_min", 0.3)
        dd = lm["disc_diameter"]
        items, summary = [], {}
        binmaps = np.zeros((4, SEG, SEG), np.uint8)
        for c, n in enumerate(LES):
            b = ((probs[c] >= float(self.les_thr.get(n, 0.5))) & (mask1024 > 0)).astype(np.uint8)
            binmaps[c] = b
            k, lab, st, cen = cv2.connectedComponentsWithStats(b, 8)
            count, area = 0, 0.0
            for j in range(1, k):
                a = int(st[j, cv2.CC_STAT_AREA])
                if a < MIN_AREA[n]:
                    continue
                x, y, w, h = (int(st[j, i]) for i in range(4))
                region = probs[c, y:y + h, x:x + w][lab[y:y + h, x:x + w] == j]
                cx, cy = float(cen[j, 0]) / SEG, float(cen[j, 1]) / SEG
                dist = float(np.hypot(cx - fov["x"], cy - fov["y"]) / dd) if fov_ok else None
                items.append({"type": n, "bbox": [x / SEG, y / SEG, w / SEG, h / SEG], "centroid": [cx, cy],
                              "area_frac": a / fundus_area, "confidence": float(region.mean()), "dist_fovea_dd": dist,
                              "_a": a})
                count += 1
                area += a
            summary[n] = {"count": count, "area_frac": area / fundus_area}
        items.sort(key=lambda d: (-d["_a"], d["type"], d["centroid"][0], d["centroid"][1]))
        items = items[:200]
        for i, it in enumerate(items):
            it.pop("_a")
            it["id"] = f"L{i + 1:03d}"
        return {"summary": summary, "items": items}, binmaps

    # ------------------------------------------------------------ run
    def run(self, image_bytes: bytes, eye: str, view: str, fov_deg: float, emit: Emit) -> dict:
        self._load()
        timings: dict[str, float] = {}

        def step(name):
            emit(name, "start", None, None)
            return time.perf_counter()

        def done(name, t0, partial=None):
            ms = (time.perf_counter() - t0) * 1000
            timings[name] = round(ms, 1)
            emit(name, "done", _r(partial) if partial is not None else None, round(ms, 1))

        t = step("decode")
        rgb = decode_image(image_bytes)
        if min(rgb.shape[:2]) < 128:
            raise ValueError("image too small (minimum 128 px)")
        mask = fundus_mask(rgb)
        sq768, tr768 = crop_square(rgb, CANON, mask)
        sq1024, tr1024 = crop_square(rgb, SEG, mask)
        m768 = crop_mask_like(mask, tr768)
        m1024 = crop_mask_like(mask, tr1024)
        done("decode", t, {"width": rgb.shape[1], "height": rgb.shape[0]})

        t = step("quality")
        lm = self._landmarks(sq768, eye)
        qlog = self._run("quality", to_tensor_input(sq768, 384))[0][0]
        qprobs = _softmax(qlog).tolist()
        checks = run_checks(compute_features(sq768, m768), lm, self.rules)
        quality = {**combine(checks, qprobs), "checks": checks}
        done("quality", t, quality)
        t = step("landmarks")
        done("landmarks", t, lm)

        t = step("grader_cnn")
        g_cnn, f_cnn, cam = self._grader("grader_cnn", sq768, 512, float(self.T.get("cnn", 1.0)))
        done("grader_cnn", t, g_cnn)
        t = step("grader_vit")
        g_vit, _, attn = self._grader("grader_vit", sq768, 448, float(self.T.get("vit", 1.0)))
        done("grader_vit", t, g_vit)
        pe = (np.array(g_cnn["probs"]) + np.array(g_vit["probs"])) / 2
        grading = {"models": [g_cnn, g_vit],
                   "ensemble": {"probs": pe.tolist(), "grade": int(pe.argmax()), "p_referable": float(pe[2:].sum())}}

        t = step("lesions")
        lesions, binmaps = self._lesions(sq1024, m1024, lm)
        ex_near = sum(1 for it in lesions["items"] if it["type"] == "EX" and it["dist_fovea_dd"] is not None
                      and it["dist_fovea_dd"] <= self.policy["macular_radius_dd"])
        macular = {"flag": ex_near > 0, "ex_within_1dd": ex_near,
                   "label": "Macular finding for review. Not a DME diagnosis."}
        done("lesions", t, lesions)

        t = step("uncertainty")
        ent = float(-(pe * np.log(np.clip(pe, 1e-12, 1))).sum())
        dis = abs(g_cnn["p_referable"] - g_vit["p_referable"])
        ood = self._ood(f_cnn)
        flags = [c for c, hit in [("HIGH_ENTROPY", ent > self.policy["t_entropy"]),
                                  ("DISAGREEMENT", dis > self.policy["t_disagreement"]),
                                  ("OOD", ood > self.policy["t_ood"])] if hit]
        unc = {"entropy": ent, "entropy_threshold": self.policy["t_entropy"], "disagreement": dis,
               "disagreement_threshold": self.policy["t_disagreement"], "ood_score": ood,
               "ood_threshold": self.policy["t_ood"], "flags": flags}
        done("uncertainty", t, unc)

        t = step("policy")
        triage = P.triage_image(quality, grading, unc, lesions, self.policy)
        done("policy", t, triage)

        t = step("overlays")
        m = m768.astype(np.float32)
        pc = np.array(g_cnn["probs"])
        w = pc[2:] / max(pc[2:].sum(), 1e-8)
        cam_ref = np.tensordot(w, cam[2:], axes=1)
        overlays = {"cam": _png(_heat_rgba(cam_ref, m)), "attention": _png(_heat_rgba(attn, m))}
        comb = np.zeros((CANON, CANON, 4), np.uint8)
        for c, n in enumerate(LES):
            b = cv2.resize(binmaps[c], (CANON, CANON), interpolation=cv2.INTER_NEAREST) > 0
            one = np.zeros((CANON, CANON, 4), np.uint8)
            one[b] = (*LES_RGB[n], 235)
            overlays[n] = _png(one)
            comb[b] = (*LES_RGB[n], 235)
        overlays["lesions"] = _png(comb)
        ok, jpg = cv2.imencode(".jpg", cv2.cvtColor(sq768, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])
        done("overlays", t)

        return {
            "canonical_jpeg": jpg.tobytes(), "overlays": overlays, "canonical_size": CANON,
            "quality": _r(quality), "landmarks": _r(lm), "grading": _r(grading), "uncertainty": _r(unc),
            "lesions": _r(lesions), "macular_risk": _r(macular), "triage": _r(triage),
            "timings_ms": timings, "model_versions": dict(self.versions),
        }
