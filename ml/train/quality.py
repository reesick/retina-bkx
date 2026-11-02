"""Quality model M1 (EfficientNet-B0 @ 384, 3 classes: adequate / usable / inadequate) and
fitted thresholds for the interpretable rules in core/quality.py.

Training data:
  * DeepDRiD train: real quality labels (Overall quality 1 -> adequate, 0 -> inadequate).
  * APTOS train + IDRiD train: synthetic degradations, on the fly
    (none -> adequate, mild -> usable, severe -> inadequate).
Model selection: synthetic degradations of APTOS val (fixed seed). DeepDRiD val and DDR grade-5
('ungradable') stay untouched for evaluation.

    python -m ml.train.quality
"""
from __future__ import annotations

import argparse
import math
import time

import cv2
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

from core.fundus import fundus_mask
from core.quality import compute_features
from ml.common import MODELS_OUT, PROC, RUNS, SPLITS, ensure_imagenet_tensor, read_rgb, save_json, seed_all, worker_init

SIZE = 384


def build_model(pretrained=True):
    import timm

    return timm.create_model("efficientnet_b0.ra_in1k", pretrained=pretrained, num_classes=3, drop_rate=0.2)


# ------------------------------------------------------------------ degradations
def degrade(img: np.ndarray, level: int, rng: np.random.Generator) -> np.ndarray:
    """level 0 none, 1 mild, 2 severe. img: canonical square RGB uint8."""
    if level == 0:
        return img
    s = img.shape[0] / 768.0
    kinds = rng.choice(["blur", "motion", "dark", "glare", "shift", "haze", "noise"], size=1 + (level == 2 and rng.random() < 0.4),
                       replace=False)
    out = img.astype(np.float32)
    mask = (img.max(2) > 12).astype(np.float32)[..., None]
    for k in kinds:
        if k == "blur":
            sig = (rng.uniform(1.5, 3.0) if level == 1 else rng.uniform(5.0, 12.0)) * s
            out = cv2.GaussianBlur(out, (0, 0), sig)
        elif k == "motion":
            L = int((rng.uniform(7, 15) if level == 1 else rng.uniform(25, 50)) * s) | 1
            ker = np.zeros((L, L), np.float32)
            ker[L // 2] = 1.0 / L
            M = cv2.getRotationMatrix2D((L / 2, L / 2), rng.uniform(0, 180), 1)
            ker = cv2.warpAffine(ker, M, (L, L))
            out = cv2.filter2D(out, -1, ker / max(ker.sum(), 1e-6))
        elif k == "dark":
            g = rng.uniform(1.6, 2.2) if level == 1 else rng.uniform(3.0, 5.0)
            out = 255.0 * (out / 255.0) ** g * (rng.uniform(0.7, 0.9) if level == 1 else rng.uniform(0.25, 0.5))
        elif k == "glare":
            h = img.shape[0]
            cx, cy = rng.uniform(0.2, 0.8, 2) * h
            r = (rng.uniform(0.1, 0.18) if level == 1 else rng.uniform(0.25, 0.45)) * h
            yy, xx = np.mgrid[:h, :h]
            blob = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r * r))[..., None]
            out = out + blob * (rng.uniform(80, 140) if level == 1 else rng.uniform(170, 255))
        elif k == "shift":
            h = img.shape[0]
            f = rng.uniform(0.08, 0.18) if level == 1 else rng.uniform(0.3, 0.5)
            a = rng.uniform(0, 2 * math.pi)
            M = np.float32([[1, 0, math.cos(a) * f * h], [0, 1, math.sin(a) * f * h]])
            out = cv2.warpAffine(out, M, (h, h))
            mask = cv2.warpAffine(mask[..., 0], M, (h, h))[..., None]
        elif k == "haze":
            a = rng.uniform(0.25, 0.4) if level == 1 else rng.uniform(0.55, 0.8)
            out = out * (1 - a) + cv2.GaussianBlur(out, (0, 0), 20 * s) * 0.3 + a * 150
        elif k == "noise":
            out = out + rng.normal(0, 8 if level == 1 else 28, out.shape)
    out = np.clip(out, 0, 255) * mask
    return out.astype(np.uint8)


class QDS(Dataset):
    """rows: (path, label or -1 for synthetic, fixed_level or -1)"""

    def __init__(self, rows, train: bool, seed: int = 0):
        self.rows, self.train, self.seed = rows, train, seed

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        path, label, fixed = self.rows[i]
        img = read_rgb(path)
        img = cv2.resize(img, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
        rng = np.random.default_rng(None if self.train else self.seed + i)
        if label < 0:
            level = fixed if fixed >= 0 else int(rng.choice(3, p=[0.4, 0.3, 0.3]))
            img = degrade(img, level, rng)
            label = level
        if self.train:
            if rng.random() < 0.5:
                img = img[:, ::-1]
            if rng.random() < 0.5:
                img = img[::-1]
        return ensure_imagenet_tensor(np.ascontiguousarray(img)), label


def fit_rules() -> dict:
    """Set soft thresholds at the 2nd/98th percentile of adequate images; hard ones further out."""
    a = pd.read_csv(SPLITS / "aptos.csv")
    good = [p for p in a[a.split == "train"]["path"].sample(300, random_state=1)]
    dd = PROC / "deepdrid" / "labels.csv"
    if dd.exists():
        d = pd.read_csv(dd)
        d = d[(d.split == "train") & (d.overall_quality == 1)]
        good += [str(PROC / "deepdrid" / "img" / f"{i}.jpg") for i in d["id"].sample(min(300, len(d)), random_state=1)]
    feats = []
    for p in good:
        img = read_rgb(p)
        feats.append(compute_features(img, fundus_mask(img)))
    f = pd.DataFrame(feats)
    q = lambda c, x: float(np.percentile(f[c], x))
    rules = {
        "focus_min": q("focus", 2), "focus_hard_min": q("focus", 2) * 0.35,
        "dark_mean_min": q("mean_lum", 2), "dark_hard_min": q("mean_lum", 2) * 0.45,
        "bright_sat_max": max(q("saturated", 98), 0.01), "uneven_max": q("uneven", 98),
        "field_min": min(q("field", 2), 0.6), "field_hard_min": min(q("field", 2), 0.6) * 0.55,
        "redness_min": min(q("redness", 1), 1.05), "vessel_min": q("vessels", 2),
        "disc_conf_min": 0.35, "fovea_conf_min": 0.30,
        "provenance": {"n_adequate": len(f), "sources": "APTOS train + DeepDRiD train (overall quality = 1)",
                       "rule": "soft = 2nd/98th percentile of adequate images; hard = fixed fraction of soft"},
    }
    save_json(MODELS_OUT / "quality_rules.json", rules)
    print("[quality] rules", {k: round(v, 4) for k, v in rules.items() if isinstance(v, float)})
    return rules


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--rules-only", action="store_true")
    args = ap.parse_args()
    seed_all()
    fit_rules()
    if args.rules_only:
        return
    device = torch.device("cuda")
    a = pd.read_csv(SPLITS / "aptos.csv")
    rows = [(p, -1, -1) for p in a[a.split == "train"]["path"]]
    idr = pd.read_csv(PROC / "idrid" / "labels.csv")
    rows += [(str(PROC / "idrid" / "img" / f"{i}.jpg"), -1, -1) for i in idr[idr.split == "train"]["id"]]
    dd = PROC / "deepdrid" / "labels.csv"
    if dd.exists():
        d = pd.read_csv(dd)
        d = d[(d.split == "train") & d.overall_quality.isin([0, 1])]
        real = [(str(PROC / "deepdrid" / "img" / f"{i}.jpg"), 0 if q == 1 else 2, -1) for i, q in zip(d["id"], d["overall_quality"])]
        rows += real * 2
        print(f"[quality] DeepDRiD real rows: {len(real)} (x2)")
    val_rows = [(p, -1, lvl) for k, p in enumerate(a[a.split == "val"]["path"]) for lvl in [k % 3]]
    dl = DataLoader(QDS(rows, True), batch_size=32, shuffle=True, num_workers=3, drop_last=True,
                    worker_init_fn=worker_init, persistent_workers=True, generator=torch.Generator().manual_seed(42))
    dl_va = DataLoader(QDS(val_rows, False, seed=123), batch_size=64, num_workers=3)
    model = build_model().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1e-3, total_steps=args.epochs * len(dl), pct_start=0.1)
    scaler = torch.amp.GradScaler()
    out = RUNS / "quality"
    out.mkdir(parents=True, exist_ok=True)
    best, hist = -1, []
    for ep in range(args.epochs):
        model.train()
        t0, tot = time.time(), 0.0
        for x, y in dl:
            x, y = x.to(device), y.to(device)
            with torch.autocast("cuda", dtype=torch.float16):
                loss = nn.functional.cross_entropy(model(x), y, label_smoothing=0.05)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            tot += loss.item()
        model.eval()
        P, Y = [], []
        with torch.no_grad():
            for x, y in dl_va:
                with torch.autocast("cuda", dtype=torch.float16):
                    P.append(model(x.to(device)).float().argmax(1).cpu().numpy())
                Y.append(y.numpy())
        P, Y = np.concatenate(P), np.concatenate(Y)
        acc = float((P == Y).mean())
        bin_acc = float(((P == 2) == (Y == 2)).mean())
        hist.append({"epoch": ep, "val_acc3": acc, "val_acc_inadequate": bin_acc})
        print(f"[quality] ep {ep} loss {tot / len(dl):.4f} val acc3 {acc:.3f} inadequate-vs-rest {bin_acc:.3f} "
              f"({time.time() - t0:.0f}s)", flush=True)
        if acc > best:
            best = acc
            torch.save({"state_dict": model.state_dict(), "val": hist[-1]}, out / "best.pt")
        save_json(out / "history.json", hist)


if __name__ == "__main__":
    main()
