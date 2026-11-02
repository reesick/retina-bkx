"""Extra evaluations merged into server/models/metrics.json:

  lesions      Dice per lesion type on IDRiD seg test (27) and DDR seg test (225)
  landmarks    OD / fovea error on IDRiD localisation test (103), in disc diameters
  laterality   predicted left/right from disc position vs DeepDRiD file names (l/r)
  explanations pointing game (CAM / attention peak inside expert lesion masks vs area baseline),
               deletion test (occluding top-CAM regions vs random regions), model-randomisation check
  latency_ms   full CPU pipeline (server/app/pipeline.py) on 12 images, plus a determinism check

    python -m ml.eval.extras
"""
from __future__ import annotations

import hashlib
import json
import time

import cv2
import numpy as np
import pandas as pd
import torch
from scipy.stats import spearmanr

from core.fundus import fundus_mask
from ml.common import MODELS_OUT, PROC, RUNS, SPLITS, ensure_imagenet_tensor, load_json, read_rgb, save_json, seed_all

DEV = torch.device("cuda")
LES = ["MA", "HE", "EX", "SE"]


def _x(img, size):
    if img.shape[0] != size:
        img = cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)
    return ensure_imagenet_tensor(img)[None].to(DEV)


def unpack(m):
    return np.stack([(m >> b) & 1 for b in range(4)])


@torch.no_grad()
def eval_lesions() -> dict:
    from ml.train.lesions import build_model

    ck = torch.load(RUNS / "lesions" / "best.pt", map_location="cpu")
    m = build_model(pretrained=False)
    m.load_state_dict(ck["state_dict"])
    m = m.to(DEV).eval()
    thr = ck["thresholds"]
    df = pd.read_csv(PROC / "seg" / "labels.csv")
    out = {}
    for name, sub in [("idrid_test", df[(df.source == "idrid") & (df.split == "test")]),
                      ("ddr_test", df[(df.source == "ddr") & (df.split == "test")])]:
        if not len(sub):
            continue
        inter = np.zeros(4); den = np.zeros(4); present = np.zeros(4)
        for rid in sub["id"]:
            img = read_rgb(PROC / "seg" / "img" / f"{rid}.jpg")
            g = unpack(cv2.imread(str(PROC / "seg" / "mask" / f"{rid}.png"), cv2.IMREAD_UNCHANGED)) > 0
            with torch.autocast("cuda", dtype=torch.float16):
                p = torch.sigmoid(m(_x(img, 1024)).float())[0].cpu().numpy()
            for c, n in enumerate(LES):
                b = p[c] >= thr[n]
                inter[c] += (b & g[c]).sum(); den[c] += b.sum() + g[c].sum(); present[c] += g[c].any()
        out[name] = {"n": int(len(sub)),
                     "dice": {n: (float(2 * inter[c] / den[c]) if den[c] else None) for c, n in enumerate(LES)},
                     "images_with_lesion": {n: int(present[c]) for c, n in enumerate(LES)}}
        print("[extras] lesions", name, out[name]["dice"], flush=True)
    out["thresholds"] = thr
    out["thresholds_source"] = "per-class Dice-optimal on DDR validation"
    return out


@torch.no_grad()
def eval_landmarks() -> tuple[dict, object]:
    from ml.train.landmarks import LandmarkNet, decode

    m = LandmarkNet(pretrained=False)
    m.load_state_dict(torch.load(RUNS / "landmarks" / "best.pt", map_location="cpu")["state_dict"])
    m = m.to(DEV).eval()
    df = pd.read_csv(PROC / "idrid" / "labels.csv").dropna(subset=["od_x", "fovea_x"])
    te = df[df.split == "test"]
    eo, ef = [], []
    for _, r in te.iterrows():
        img = read_rgb(PROC / "idrid" / "img" / f"{r['id']}.jpg")
        S = img.shape[0]
        d = decode(torch.sigmoid(m(_x(img, 512))).cpu().numpy()[0])
        od, fv = np.array([r.od_x, r.od_y]) / S, np.array([r.fovea_x, r.fovea_y]) / S
        dd = np.linalg.norm(od - fv) / 2.5
        eo.append(np.linalg.norm(np.array(d[0][:2]) - od) / dd)
        ef.append(np.linalg.norm(np.array(d[1][:2]) - fv) / dd)
    eo, ef = np.array(eo), np.array(ef)
    res = {"idrid_test": {"n": int(len(te)), "od_err_dd_median": float(np.median(eo)),
                          "fovea_err_dd_median": float(np.median(ef)), "od_within_1dd": float((eo <= 1).mean()),
                          "fovea_within_1dd": float((ef <= 1).mean()), "od_within_0_5dd": float((eo <= 0.5).mean()),
                          "fovea_within_0_5dd": float((ef <= 0.5).mean()),
                          "note": "1 DD estimated as true disc-fovea distance / 2.5"}}
    print("[extras] landmarks", res["idrid_test"], flush=True)
    return res, m


@torch.no_grad()
def eval_laterality(lm_model) -> dict | None:
    from ml.train.landmarks import decode

    p = PROC / "deepdrid" / "labels.csv"
    if not p.exists():
        return None
    df = pd.read_csv(p)
    rows = []
    for rid in df["id"]:
        s = str(rid).lower()
        eye = "OS" if "_l" in s else ("OD" if "_r" in s else None)
        if eye is None:
            continue
        img = read_rgb(PROC / "deepdrid" / "img" / f"{rid}.jpg")
        d = decode(torch.sigmoid(lm_model(_x(img, 512))).cpu().numpy()[0])
        dx = d[0][0] - d[1][0]
        conf = min(d[0][2], d[1][2])
        rows.append((eye, dx, conf))
    if not rows:
        return None
    eye = np.array([r[0] for r in rows]); dx = np.array([r[1] for r in rows]); conf = np.array([r[2] for r in rows])
    ok = (conf >= 0.3) & (np.abs(dx) >= 0.05)
    pred_disc_right_od = np.where(dx > 0, "OD", "OS")
    acc_a = float((pred_disc_right_od[ok] == eye[ok]).mean()) if ok.any() else None
    res = {"deepdrid": {"n": int(len(rows)), "decided": int(ok.sum()),
                        "accuracy_if_disc_right_is_OD": acc_a,
                        "rule": "OD" if (acc_a or 0) >= 0.5 else "OS",
                        "note": "eye label taken from DeepDRiD file names (_l/_r); measured, not assumed"}}
    print("[extras] laterality", res, flush=True)
    return res


@torch.no_grad()
def eval_explanations() -> dict:
    from ml.export.to_onnx import CnnWrap, VitWrap
    from ml.train.grader import build_model

    cnn = build_model("cnn", pretrained=False)
    cnn.load_state_dict(torch.load(RUNS / "grader_cnn" / "best.pt", map_location="cpu")["state_dict"])
    vit = build_model("vit", pretrained=False)
    vit.load_state_dict(torch.load(RUNS / "grader_vit" / "best.pt", map_location="cpu")["state_dict"])
    C, V = CnnWrap(cnn).to(DEV).eval(), VitWrap(vit).to(DEV).eval()
    T = load_json(MODELS_OUT / "policy.json", {}).get("temperatures", {"cnn": 1.0, "vit": 1.0})

    def cam_ref(img):
        lg, _, cam = C(_x(img, 512))
        p = torch.softmax(lg / T["cnn"], 1)[0]
        w = p[2:] / p[2:].sum().clamp_min(1e-8)
        return (cam[0, 2:] * w[:, None, None]).sum(0).clamp_min(0).cpu().numpy(), float(p[2:].sum())

    res: dict = {}
    # pointing game on IDRiD seg test (expert masks)
    df = pd.read_csv(PROC / "seg" / "labels.csv")
    sub = df[(df.source == "idrid") & (df.split == "test")]
    hits_c, hits_v, base = [], [], []
    for rid in sub["id"]:
        img = read_rgb(PROC / "seg" / "img" / f"{rid}.jpg")
        g = cv2.imread(str(PROC / "seg" / "mask" / f"{rid}.png"), cv2.IMREAD_UNCHANGED) > 0
        g = cv2.dilate(g.astype(np.uint8), np.ones((31, 31), np.uint8)) > 0
        fm = cv2.resize(fundus_mask(img), (1024, 1024), interpolation=cv2.INTER_NEAREST) > 0
        cm, _ = cam_ref(img)
        _, _, at = V(_x(img, 448))
        for mp, hits in [(cm, hits_c), (at[0].cpu().numpy(), hits_v)]:
            up = cv2.resize(mp.astype(np.float32), (1024, 1024), interpolation=cv2.INTER_CUBIC) * fm
            y, x = np.unravel_index(int(up.argmax()), up.shape)
            hits.append(bool(g[y, x]))
        base.append(float((g & fm).sum() / max(fm.sum(), 1)))
    res["pointing_game"] = {"dataset": f"IDRiD segmentation test (n={len(sub)}), masks dilated 15 px",
                            "cnn_cam": float(np.mean(hits_c)), "vit_attention": float(np.mean(hits_v)),
                            "random_baseline": float(np.mean(base))}
    print("[extras] pointing", res["pointing_game"], flush=True)

    # deletion test on APTOS test referable images
    a = pd.read_csv(SPLITS / "aptos.csv")
    ref = a[(a.split == "test") & (a.grade >= 2)].head(80)
    rng = np.random.default_rng(0)
    d_top, d_rand = [], []
    for p in ref["path"]:
        img = cv2.resize(read_rgb(p), (512, 512), interpolation=cv2.INTER_AREA)
        cm, p0 = cam_ref(img)
        cm16 = cv2.resize(cm, (16, 16), interpolation=cv2.INTER_AREA)
        k = int(0.10 * 256)
        top = np.argsort(cm16.ravel())[::-1][:k]
        fm16 = cv2.resize(fundus_mask(img), (16, 16), interpolation=cv2.INTER_AREA).ravel() > 0
        pool = np.where(fm16)[0]
        rnd = rng.choice(pool, size=min(k, len(pool)), replace=False)
        blur = cv2.GaussianBlur(img, (0, 0), 12)
        outs = []
        for cells in (top, rnd):
            m = np.zeros(256, np.uint8); m[cells] = 1
            m = cv2.resize(m.reshape(16, 16), (512, 512), interpolation=cv2.INTER_NEAREST)[..., None]
            outs.append(cam_ref(img * (1 - m) + blur * m)[1])
        d_top.append(p0 - outs[0]); d_rand.append(p0 - outs[1])
    res["deletion"] = {"dataset": f"APTOS test referable images (n={len(ref)})", "area": "10% of 16x16 CAM cells",
                       "mean_drop_top_cam": float(np.mean(d_top)), "mean_drop_random": float(np.mean(d_rand)),
                       "share_top_drop_larger": float(np.mean(np.array(d_top) > np.array(d_rand)))}
    print("[extras] deletion", res["deletion"], flush=True)

    # model randomisation (Adebayo et al.): re-initialise head + last stage, CAM should change
    rnd_model = build_model("cnn", pretrained=False)
    rnd_model.load_state_dict(cnn.state_dict())
    torch.manual_seed(0)
    for mod in [rnd_model.classifier, rnd_model.conv_head, rnd_model.blocks[-1]]:
        for prm in mod.modules():
            if hasattr(prm, "reset_parameters"):
                prm.reset_parameters()
    R = CnnWrap(rnd_model).to(DEV).eval()
    cors = []
    for p in ref["path"].head(40):
        img = cv2.resize(read_rgb(p), (512, 512), interpolation=cv2.INTER_AREA)
        c1, _ = cam_ref(img)
        lg, _, cam = R(_x(img, 512))
        pr = torch.softmax(lg, 1)[0]
        w = pr[2:] / pr[2:].sum().clamp_min(1e-8)
        c2 = (cam[0, 2:] * w[:, None, None]).sum(0).clamp_min(0).cpu().numpy()
        cors.append(spearmanr(c1.ravel(), c2.ravel()).correlation)
    res["randomisation"] = {"dataset": "APTOS test referable images (n=40)",
                            "randomised": "classifier, conv_head, last block",
                            "spearman_cam_trained_vs_random_mean": float(np.nanmean(cors)),
                            "interpretation": "low correlation means the map depends on learned weights (passes sanity check)"}
    print("[extras] randomisation", res["randomisation"], flush=True)
    return res


def eval_latency() -> dict:
    import platform

    from server.app.pipeline import Pipeline

    pl = Pipeline(MODELS_OUT)
    a = pd.read_csv(PROC / "idrid" / "labels.csv")
    paths = [PROC / "idrid" / "img" / f"{i}.jpg" for i in a["id"].head(12)]
    ms, hashes = [], []
    noop = lambda *a, **k: None
    for i, p in enumerate(paths):
        data = open(p, "rb").read()
        t0 = time.perf_counter()
        out = pl.run(data, "OD", "macula", 50, noop)
        ms.append((time.perf_counter() - t0) * 1000)
        if i == 0:
            keys = ["quality", "landmarks", "grading", "uncertainty", "lesions", "macular_risk", "triage"]
            h1 = hashlib.sha256(json.dumps({k: out[k] for k in keys}, sort_keys=True).encode()).hexdigest()
            out2 = pl.run(data, "OD", "macula", 50, noop)
            h2 = hashlib.sha256(json.dumps({k: out2[k] for k in keys}, sort_keys=True).encode()).hexdigest()
            hashes = [h1, h2]
    res = {"p50": float(np.median(ms[1:])), "p95": float(np.percentile(ms[1:], 95)), "n": len(ms) - 1,
           "cpu": platform.processor() or platform.machine(), "threads": pl.threads, "runtime": "ONNX Runtime CPU"}
    det = {"verified": hashes[0] == hashes[1], "hash_run1": hashes[0][:16], "hash_run2": hashes[1][:16],
           "method": "same image analysed twice by the CPU pipeline; result JSON hashed"}
    print("[extras] latency", res, det, flush=True)
    return {"latency_ms": res, "determinism": det}


def main():
    seed_all()
    path = MODELS_OUT / "metrics.json"
    met = load_json(path, {"available": False})
    met["lesions"] = eval_lesions()
    lm, lm_model = eval_landmarks()
    met["landmarks"] = lm
    lat = eval_laterality(lm_model)
    if lat:
        met["laterality"] = lat
        pol = load_json(MODELS_OUT / "policy.json", None)
        if pol is not None and lat["deepdrid"]["accuracy_if_disc_right_is_OD"] is not None:
            pol["laterality_disc_right"] = lat["deepdrid"]["rule"]
            pol["provenance"]["laterality_disc_right"] = (
                f"measured on DeepDRiD (n={lat['deepdrid']['decided']} decided): disc on image right -> "
                f"{lat['deepdrid']['rule']}")
            save_json(MODELS_OUT / "policy.json", pol)
    met["explanations"] = eval_explanations()
    save_json(path, met)
    met.update(eval_latency())
    save_json(path, met)
    (RUNS / "extras.done").write_text("ok")
    print("[extras] done")


if __name__ == "__main__":
    main()
