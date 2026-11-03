"""Explanation tests not covered by extras.py:
  * IoU between the top-k% heat-map region and expert lesion masks (IDRiD segmentation test), vs a random baseline
  * stability: Spearman correlation of the heat-map under small brightness/contrast/gamma changes (APTOS test referable)
  * runtime of each explanation method on CPU (the methods are inside the ONNX graphs, so cost = extra graph outputs)
Writes metrics.json["explanations"]["iou" | "stability" | "runtime_ms"].

    python -m ml.eval.explain_more
"""
import json
import time

import cv2
import numpy as np
import pandas as pd
import torch
from scipy.stats import spearmanr

from core.fundus import fundus_mask, to_tensor_input
from ml.common import MODELS_OUT, PROC, RUNS, SPLITS, ensure_imagenet_tensor, read_rgb, seed_all

DEV = torch.device("cuda")


def maps(C, V, img, T):
    x512 = ensure_imagenet_tensor(cv2.resize(img, (512, 512), interpolation=cv2.INTER_AREA))[None].to(DEV)
    x448 = ensure_imagenet_tensor(cv2.resize(img, (448, 448), interpolation=cv2.INTER_AREA))[None].to(DEV)
    with torch.no_grad():
        lg, _, cam = C(x512)
        p = torch.softmax(lg / T["cnn"], 1)[0]
        w = p[2:] / p[2:].sum().clamp_min(1e-8)
        c = (cam[0, 2:] * w[:, None, None]).sum(0).clamp_min(0).cpu().numpy()
        _, _, at = V(x448)
    return c, at[0].cpu().numpy()


def topk_iou(m, gt, fm, frac):
    up = cv2.resize(m.astype(np.float32), gt.shape[::-1], interpolation=cv2.INTER_CUBIC)
    vals = up[fm]
    if vals.size == 0:
        return None
    thr = np.quantile(vals, 1 - frac)
    sel = (up >= thr) & fm
    inter, union = (sel & gt).sum(), (sel | gt).sum()
    return float(inter / union) if union else None


def main():
    seed_all()
    from ml.eval.app_eval import load_gpu_models

    mods = load_gpu_models()
    C, V = mods["grader_cnn"].to(DEV).eval(), mods["grader_vit"].to(DEV).eval()
    pol = json.loads((MODELS_OUT / "policy.json").read_text())
    T = pol["temperatures"]
    m = json.loads((MODELS_OUT / "metrics.json").read_text())
    ex = m.setdefault("explanations", {})

    # IoU vs expert masks
    seg = pd.read_csv(PROC / "seg" / "labels.csv")
    sub = seg[(seg.source == "idrid") & (seg.split == "test")]
    rng = np.random.default_rng(0)
    res = {f: {"cnn": [], "vit": [], "random": []} for f in (0.05, 0.10)}
    for rid in sub["id"]:
        img = read_rgb(PROC / "seg" / "img" / f"{rid}.jpg")
        mk = cv2.imread(str(PROC / "seg" / "mask" / f"{rid}.png"), cv2.IMREAD_UNCHANGED) > 0
        fm = cv2.resize(fundus_mask(img), mk.shape[::-1], interpolation=cv2.INTER_NEAREST) > 0
        c, a = maps(C, V, img, T)
        for f in res:
            res[f]["cnn"].append(topk_iou(c, mk, fm, f))
            res[f]["vit"].append(topk_iou(a, mk, fm, f))
            res[f]["random"].append(topk_iou(rng.random((16, 16)), mk, fm, f))
    ex["iou"] = {"dataset": f"IDRiD segmentation test (n={len(sub)}), all lesion types",
                 **{f"top_{int(f * 100)}pct": {k: float(np.nanmean([v for v in vs if v is not None])) for k, vs in d.items()}
                    for f, d in res.items()},
                 "note": "IoU of the top-k% most-attended fundus pixels with the union of expert lesion masks; random = random map"}
    print("[explain] iou", ex["iou"], flush=True)

    # stability under small photometric changes
    a = pd.read_csv(SPLITS / "aptos.csv")
    paths = a[(a.split == "test") & (a.grade >= 2)]["path"].head(60).tolist()
    perts = {"brightness+10%": lambda x: np.clip(x * 1.1, 0, 255), "brightness-10%": lambda x: x * 0.9,
             "contrast+15%": lambda x: np.clip((x - x.mean()) * 1.15 + x.mean(), 0, 255),
             "gamma0.9": lambda x: 255 * (x / 255) ** 0.9}
    st = {k: {"cnn": [], "vit": [], "p_ref_change": []} for k in perts}
    for p in paths:
        img = read_rgb(p)
        c0, a0 = maps(C, V, img, T)
        for k, f in perts.items():
            im2 = f(img.astype(np.float32)).astype(np.uint8)
            c1, a1 = maps(C, V, im2, T)
            st[k]["cnn"].append(spearmanr(c0.ravel(), c1.ravel()).correlation)
            st[k]["vit"].append(spearmanr(a0.ravel(), a1.ravel()).correlation)
    ex["stability"] = {"dataset": f"APTOS test referable images (n={len(paths)})",
                       "spearman_original_vs_perturbed": {k: {mm: float(np.nanmean(v[mm])) for mm in ("cnn", "vit")} for k, v in st.items()},
                       "note": "1.0 = identical map; > 0.8 is generally considered stable"}
    print("[explain] stability", ex["stability"], flush=True)

    # CPU runtime: graph with vs without the explanation outputs is not separable, so report full grader runtime per method
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    rt = {}
    img = read_rgb(paths[0])
    for name, size in [("grader_cnn", 512), ("grader_vit", 448)]:
        s = ort.InferenceSession(str(MODELS_OUT / f"{name}.onnx"), so, providers=["CPUExecutionProvider"])
        x = to_tensor_input(img, size)
        s.run(None, {"image": x})
        t0 = time.perf_counter()
        for _ in range(5):
            s.run(None, {"image": x})
        rt[name] = round((time.perf_counter() - t0) / 5 * 1000, 1)
    ex["runtime_ms"] = {**rt, "note": "CPU, 4 threads; CAM / attention are extra outputs of the same forward pass (no second pass, no gradients)"}
    print("[explain] runtime", ex["runtime_ms"], flush=True)
    (MODELS_OUT / "metrics.json").write_text(json.dumps(m, indent=2, default=float))


if __name__ == "__main__":
    main()
