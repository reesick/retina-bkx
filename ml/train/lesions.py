"""Lesion segmentation U-Net (MA, HE, EX, SE) on IDRiD train + DDR train, selected on DDR val.

Images and packed bit-masks are 1024x1024 (data/processed/seg). Training uses 512 crops biased
towards lesions; validation runs on full 1024 images. Per-class thresholds that maximise Dice on
DDR val are saved for inference.

    python -m ml.train.lesions
"""
from __future__ import annotations

import argparse
import math
import time

import albumentations as A
import cv2
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from ml.common import PROC, RUNS, ensure_imagenet_tensor, read_rgb, save_json, seed_all, worker_init

LESIONS = ["MA", "HE", "EX", "SE"]
CROP = 512


def build_model(pretrained: bool = True) -> nn.Module:
    import segmentation_models_pytorch as smp

    return smp.Unet("efficientnet-b3", encoder_weights="imagenet" if pretrained else None, classes=4,
                    decoder_attention_type="scse")


def unpack(m: np.ndarray) -> np.ndarray:
    return np.stack([(m >> b) & 1 for b in range(4)], axis=0).astype(np.float32)


class SegDS(Dataset):
    def __init__(self, df: pd.DataFrame, train: bool, repeats: int = 1):
        self.ids = df["id"].tolist() * repeats
        self.train = train
        self.aug = A.Compose([
            A.HorizontalFlip(), A.VerticalFlip(), A.RandomRotate90(),
            A.RandomBrightnessContrast(0.2, 0.2, p=0.6), A.HueSaturationValue(5, 10, 5, p=0.3),
        ])

    def __len__(self):
        return len(self.ids)

    def __getitem__(self, i):
        rid = self.ids[i]
        img = read_rgb(PROC / "seg" / "img" / f"{rid}.jpg")
        m = cv2.imread(str(PROC / "seg" / "mask" / f"{rid}.png"), cv2.IMREAD_UNCHANGED)
        if self.train:
            ys, xs = np.nonzero(m)
            if len(xs) and np.random.rand() < 0.8:
                k = np.random.randint(len(xs))
                cx, cy = xs[k] + np.random.randint(-200, 200), ys[k] + np.random.randint(-200, 200)
            else:
                cx, cy = np.random.randint(CROP // 2, 1024 - CROP // 2, size=2)
            x0 = int(np.clip(cx - CROP // 2, 0, 1024 - CROP))
            y0 = int(np.clip(cy - CROP // 2, 0, 1024 - CROP))
            img, m = img[y0:y0 + CROP, x0:x0 + CROP], m[y0:y0 + CROP, x0:x0 + CROP]
            r = self.aug(image=img, mask=m)
            img, m = r["image"], r["mask"]
        return ensure_imagenet_tensor(img), torch.from_numpy(unpack(m))


def dice_loss(logits, target, eps=1.0):
    p = torch.sigmoid(logits)
    inter = (p * target).sum((0, 2, 3))
    den = p.sum((0, 2, 3)) + target.sum((0, 2, 3))
    return (1 - (2 * inter + eps) / (den + eps)).mean()


@torch.no_grad()
def predict_full(model, x, device):
    with torch.autocast("cuda", dtype=torch.float16):
        return torch.sigmoid(model(x.to(device))).float().cpu().numpy()


def dice_at(probs: list[np.ndarray], gts: list[np.ndarray], c: int, t: float) -> float:
    inter = den = 0.0
    for p, g in zip(probs, gts):
        b = p[c] >= t
        inter += float((b & (g[c] > 0)).sum())
        den += float(b.sum() + (g[c] > 0).sum())
    return 2 * inter / den if den > 0 else float("nan")


def evaluate(model, df, device, thresholds=None):
    model.eval()
    probs, gts = [], []
    for rid in df["id"]:
        img = read_rgb(PROC / "seg" / "img" / f"{rid}.jpg")
        m = cv2.imread(str(PROC / "seg" / "mask" / f"{rid}.png"), cv2.IMREAD_UNCHANGED)
        p = predict_full(model, ensure_imagenet_tensor(img)[None], device)[0]
        probs.append((p * 255).astype(np.uint8).astype(np.float32) / 255.0)  # compact
        gts.append(unpack(m).astype(np.uint8))
    res = {}
    for c, name in enumerate(LESIONS):
        if thresholds is None:
            cands = [(dice_at(probs, gts, c, t), t) for t in np.arange(0.1, 0.91, 0.05)]
            cands = [x for x in cands if not math.isnan(x[0])]
            d, t = max(cands) if cands else (float("nan"), 0.5)
        else:
            t = thresholds[name]
            d = dice_at(probs, gts, c, t)
        res[name] = {"dice": float(d), "threshold": float(t)}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=40)
    args = ap.parse_args()
    seed_all()
    device = torch.device("cuda")
    df = pd.read_csv(PROC / "seg" / "labels.csv")
    tr = df[df.split == "train"]
    va = df[(df.split == "val") & (df.source == "ddr")]
    dl = DataLoader(SegDS(tr, True, repeats=2), batch_size=6, shuffle=True, num_workers=3, drop_last=True,
                    pin_memory=True, worker_init_fn=worker_init, persistent_workers=True,
                    generator=torch.Generator().manual_seed(42))
    model = build_model().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=4e-4, weight_decay=1e-4)
    steps = args.epochs * len(dl)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=4e-4, total_steps=steps, pct_start=0.05)
    scaler = torch.amp.GradScaler()
    pos_w = torch.tensor([20.0, 5.0, 5.0, 5.0], device=device).view(1, 4, 1, 1)
    out = RUNS / "lesions"
    out.mkdir(parents=True, exist_ok=True)
    best, hist = -1.0, []
    for ep in range(args.epochs):
        model.train()
        t0, tot = time.time(), 0.0
        for x, y in dl:
            x, y = x.to(device), y.to(device)
            with torch.autocast("cuda", dtype=torch.float16):
                lg = model(x)
            lg = lg.float()
            loss = F.binary_cross_entropy_with_logits(lg, y, pos_weight=pos_w) + dice_loss(lg, y)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            tot += loss.item()
        msg = f"[lesions] ep {ep} loss {tot / len(dl):.4f} ({time.time() - t0:.0f}s)"
        if ep % 4 == 3 or ep == args.epochs - 1:
            r = evaluate(model, va, device)
            score = float(np.nanmean([r[k]["dice"] for k in ["HE", "EX", "SE", "MA"]]))
            msg += " val " + " ".join(f"{k}:{v['dice']:.3f}" for k, v in r.items())
            hist.append({"epoch": ep, **{k: v["dice"] for k, v in r.items()}})
            if score > best:
                best = score
                torch.save({"state_dict": model.state_dict(), "thresholds": {k: v["threshold"] for k, v in r.items()},
                            "val": r}, out / "best.pt")
            save_json(out / "history.json", hist)
        print(msg, flush=True)


if __name__ == "__main__":
    main()
