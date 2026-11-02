"""Test fixtures: a deterministic FakePipeline (tests only) and app/client factories."""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from core import policy as P  # noqa: E402
from core.fundus import decode_image  # noqa: E402
from server.app.main import create_app  # noqa: E402
from server.app.pipeline import STEPS  # noqa: E402

PROBS = {"REFER": [0.02, 0.03, 0.85, 0.07, 0.03], "ROUTINE": [0.85, 0.10, 0.03, 0.01, 0.01]}


def fundus_jpeg(seed: int = 0, size: int = 400) -> bytes:
    """A synthetic fundus-like image: dark frame, orange disc, bright optic disc."""
    img = np.zeros((size, size, 3), np.uint8)
    cv2.circle(img, (size // 2, size // 2), int(size * 0.45), (40, 80, 190), -1)  # BGR orange-red
    cv2.circle(img, (int(size * (0.3 + 0.4 * (seed % 2))), size // 2), size // 14, (170, 220, 250), -1)
    rng = np.random.default_rng(seed)
    noise = rng.integers(0, 12, img.shape, dtype=np.uint8)
    img = cv2.add(img, noise)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return buf.tobytes()


def _png(rgba: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    return buf.tobytes()


def _r(x):
    if isinstance(x, dict):
        return {k: _r(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_r(v) for v in x]
    if isinstance(x, float):
        return round(x, 4)
    return x


class FakePipeline:
    """Emits every STEP and returns a fully shaped, deterministic output.

    OD images look referable (grade 2), OS images look routine. Triage comes from core.policy.triage_image.
    `gate` (threading.Event) lets a test hold the run until it has subscribed to the SSE stream.
    """

    def __init__(self, gate: threading.Event | None = None, step_sleep: float = 0.0):
        self.gate = gate
        self.step_sleep = step_sleep
        self.runs = 0

    def health(self) -> dict:
        names = ["quality", "grader_cnn", "grader_vit", "lesions", "landmarks"]
        return {"models": {n: {"loaded": True, "sha": f"fake{n[:4]}"} for n in names}, "missing": [], "ready": True,
                "policy_version": "default-unfitted", "error": None}

    def run(self, image_bytes: bytes, eye: str, view: str, fov_deg: float, emit) -> dict:
        if self.gate is not None:
            self.gate.wait(10)
        self.runs += 1
        timings = {}

        def step(name, partial=None):
            emit(name, "start", None, None)
            if self.step_sleep:
                time.sleep(self.step_sleep)
            timings[name] = 1.0
            emit(name, "done", partial, 1.0)

        rgb = decode_image(image_bytes)  # raises ValueError for non-images, like the real pipeline
        step("decode", {"width": rgb.shape[1], "height": rgb.shape[0]})
        kind = "REFER" if eye == "OD" else "ROUTINE"
        checks = [{"code": "FOCUS", "label": "Focus", "value": 150.0, "threshold": 60.0, "pass": True, "hard": False,
                   "detail": "Edge sharpness (variance of the Laplacian)"},
                  {"code": "TOO_DARK", "label": "Brightness", "value": 90.0, "threshold": 25.0, "pass": True,
                   "hard": False, "detail": "Mean brightness inside the retina"}]
        quality = {"category": "adequate", "score": 0.95, "probs": {"adequate": 0.9, "usable": 0.08, "inadequate": 0.02},
                   "reasons": [], "checks": checks}
        step("quality", quality)
        lm = {"od": {"x": 0.7 if eye == "OD" else 0.3, "y": 0.5, "conf": 0.9}, "fovea": {"x": 0.5, "y": 0.5, "conf": 0.85},
              "disc_diameter": 0.08, "laterality": {"predicted": eye, "confidence": 0.9, "selected": eye, "mismatch": False}}
        step("landmarks", lm)
        probs = PROBS[kind]
        pref = sum(probs[2:])
        g_cnn = {"name": "cnn_effb3", "probs": probs, "p_referable": pref, "temperature": 1.2}
        g_vit = {"name": "vit_dinov2", "probs": probs, "p_referable": pref, "temperature": 1.1}
        step("grader_cnn", g_cnn)
        step("grader_vit", g_vit)
        grading = {"models": [g_cnn, g_vit], "ensemble": {"probs": probs, "grade": int(np.argmax(probs)), "p_referable": pref}}
        items = [{"id": "L001", "type": "MA", "bbox": [0.4, 0.4, 0.01, 0.01], "centroid": [0.405, 0.405],
                  "area_frac": 0.0001, "confidence": 0.7, "dist_fovea_dd": 1.5}]
        if kind == "REFER":
            items.append({"id": "L002", "type": "HE", "bbox": [0.6, 0.3, 0.03, 0.03], "centroid": [0.615, 0.315],
                          "area_frac": 0.002, "confidence": 0.8, "dist_fovea_dd": None})
        summary = {t: {"count": sum(i["type"] == t for i in items),
                       "area_frac": sum(i["area_frac"] for i in items if i["type"] == t)} for t in ("MA", "HE", "EX", "SE")}
        lesions = {"summary": summary, "items": items}
        step("lesions", lesions)
        pe = np.array(probs)
        unc = {"entropy": float(-(pe * np.log(pe)).sum()), "entropy_threshold": 1.0, "disagreement": 0.0,
               "disagreement_threshold": 0.35, "ood_score": 5.0, "ood_threshold": 1e9, "flags": []}
        step("uncertainty", _r(unc))
        triage = P.triage_image(quality, grading, unc, lesions, P.DEFAULT_POLICY)
        step("policy", _r(triage))
        overlays = {}
        for k in ("cam", "attention", "lesions", "MA", "HE", "EX", "SE"):
            a = np.zeros((64, 64, 4), np.uint8)
            a[20:40, 20:40] = (255, 69, 58, 200)
            overlays[k] = _png(a)
        canon = cv2.resize(rgb, (768, 768), interpolation=cv2.INTER_AREA)
        ok, jpg = cv2.imencode(".jpg", cv2.cvtColor(canon, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])
        step("overlays")
        return {"canonical_jpeg": jpg.tobytes(), "overlays": overlays, "canonical_size": 768,
                "quality": _r(quality), "landmarks": _r(lm), "grading": _r(grading), "uncertainty": _r(unc),
                "lesions": _r(lesions), "macular_risk": {"flag": False, "ex_within_1dd": 0,
                                                         "label": "Macular finding for review. Not a DME diagnosis."},
                "triage": _r(triage), "timings_ms": timings,
                "model_versions": {"quality": "fakequal0001", "grader_cnn": "fakecnn00001", "grader_vit": "fakevit00001",
                                   "lesions": "fakeles00001", "landmarks": "fakelan00001", "policy": "default-unfitted"}}


@pytest.fixture
def make_client(tmp_path):
    clients = []

    def _make(pipeline=None, demo_dir=None, models_dir=None, step_min_ms=30, name="data"):
        app = create_app(pipeline=pipeline if pipeline is not None else FakePipeline(),
                         data_dir=tmp_path / name, models_dir=models_dir or (tmp_path / "models"),
                         demo_dir=demo_dir or (tmp_path / "demo"), web_dist=tmp_path / "nodist",
                         step_min_ms=step_min_ms)
        c = TestClient(app)
        c.__enter__()
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


def wait_image(client, image_id, timeout=15.0) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        d = client.get(f"/api/images/{image_id}").json()
        if d["status"] in ("done", "error"):
            return d
        time.sleep(0.05)
    raise AssertionError(f"image {image_id} did not finish")


def parse_sse(text: str) -> list[tuple[str, dict]]:
    import json

    out = []
    for block in text.replace("\r\n", "\n").split("\n\n"):
        ev, data = None, None
        for line in block.split("\n"):
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if ev:
            out.append((ev, data))
    return out
