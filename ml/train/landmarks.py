"""Optic-disc and fovea landmark heat-map model on IDRiD (413 train / 103 test).

Input 512x512 canonical crop -> 2 heat-maps at 128x128 (Gaussian targets, sigma 2.5 cells).
Horizontal flips are used so the model sees both left- and right-eye geometry.

    python -m ml.train.landmarks
"""
from __future__ import annotations

import argparse
import time

import cv2
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from ml.common import PROC, RUNS, ensure_imagenet_tensor, read_rgb, save_json, seed_all, worker_init

SIZE, HM, SIGMA = 512, 128, 2.5


class LandmarkNet(nn.Module):
    """ResNet-34 U-Net, output resized to 128x128 heat-maps (sigmoid applied outside)."""

    def __init__(self, pretrained=True):
        super().__init__()
        import segmentation_models_pytorch as smp

        self.net = smp.Unet("resnet34", encoder_weights="imagenet" if pretrained else None, classes=2,
                            encoder_depth=5, decoder_channels=(256, 128, 64, 32, 16))

    def forward(self, x):
        y = self.net(x)
        return F.interpolate(y, size=(HM, HM), mode="bilinear", align_corners=False)


def gauss(cx, cy):
    yy, xx = np.mgrid[:HM, :HM]
    return np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * SIGMA ** 2)).astype(np.float32)


class LmDS(Dataset):
    def __init__(self, df, train):
        self.df = df.reset_index(drop=True)
        self.train = train

    def __len__(self):
        return len(self.df)

    def __getitem__(self, i):
        r = self.df.iloc[i]
        img = read_rgb(PROC / "idrid" / "img" / f"{r['id']}.jpg")
        s = SIZE / img.shape[0]
        img = cv2.resize(img, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
        pts = np.array([[r.od_x * s, r.od_y * s], [r.fovea_x * s, r.fovea_y * s]], np.float32)
        if self.train:
            if np.random.rand() < 0.5:
                img = img[:, ::-1].copy()
                pts[:, 0] = SIZE - 1 - pts[:, 0]
            ang = np.random.uniform(-20, 20)
            sc = np.random.uniform(0.9, 1.1)
            M = cv2.getRotationMatrix2D((SIZE / 2, SIZE / 2), ang, sc)
            M[:, 2] += np.random.uniform(-25, 25, 2)
            img = cv2.warpAffine(img, M, (SIZE, SIZE), borderValue=0)
            pts = np.c_[pts, np.ones(2)] @ M.T
            a = np.random.uniform(0.75, 1.25)
            b = np.random.uniform(-20, 20)
            img = np.clip(img.astype(np.float32) * a + b, 0, 255).astype(np.uint8)
        hm = np.stack([gauss(*(p * HM / SIZE)) for p in pts])
        return ensure_imagenet_tensor(img), torch.from_numpy(hm), torch.from_numpy(pts.astype(np.float32))


def decode(hm: np.ndarray) -> list[tuple[float, float, float]]:
    """Heat-maps (2,HM,HM) after sigmoid -> [(x, y, conf)] in 0..1 coords, sub-cell refined."""
    out = []
    for c in range(hm.shape[0]):
        h = hm[c]
        idx = int(h.argmax())
        y, x = divmod(idx, HM)
        y0, y1, x0, x1 = max(0, y - 2), min(HM, y + 3), max(0, x - 2), min(HM, x + 3)
        w = h[y0:y1, x0:x1]
        yy, xx = np.mgrid[y0:y1, x0:x1]
        sw = w.sum() + 1e-9
        out.append((float((xx * w).sum() / sw + 0.5) / HM, float((yy * w).sum() / sw + 0.5) / HM, float(h.max())))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=60)
    args = ap.parse_args()
    seed_all()
    device = torch.device("cuda")
    df = pd.read_csv(PROC / "idrid" / "labels.csv").dropna(subset=["od_x", "fovea_x"])
    tr_all = df[df.split == "train"].sort_values("id")
    va_ids = tr_all["id"].sample(frac=0.15, random_state=42)
    tr, te = tr_all[~tr_all["id"].isin(va_ids)], tr_all[tr_all["id"].isin(va_ids)]  # te = selection split (not IDRiD test)
    dl = DataLoader(LmDS(tr, True), batch_size=8, shuffle=True, num_workers=3, drop_last=True,
                    worker_init_fn=worker_init, persistent_workers=True, generator=torch.Generator().manual_seed(42))
    dl_te = DataLoader(LmDS(te, False), batch_size=16, num_workers=3)
    model = LandmarkNet().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=5e-4, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=5e-4, total_steps=args.epochs * len(dl), pct_start=0.05)
    out = RUNS / "landmarks"
    out.mkdir(parents=True, exist_ok=True)
    best, hist = 1e9, []
    for ep in range(args.epochs):
        model.train()
        t0, tot = time.time(), 0.0
        for x, hm, _ in dl:
            x, hm = x.to(device), hm.to(device)
            lg = model(x)
            loss = F.binary_cross_entropy_with_logits(lg, hm, pos_weight=torch.tensor(30.0, device=device))
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item()
        if ep % 5 == 4 or ep == args.epochs - 1:
            model.eval()
            errs = []
            with torch.no_grad():
                for x, _, pts in dl_te:
                    hm = torch.sigmoid(model(x.to(device))).cpu().numpy()
                    for b in range(len(hm)):
                        d = decode(hm[b])
                        p = pts[b].numpy() / SIZE
                        errs.append([np.hypot(d[k][0] - p[k][0], d[k][1] - p[k][1]) for k in range(2)])
            errs = np.array(errs)
            med = np.median(errs, 0)
            hist.append({"epoch": ep, "od_med": float(med[0]), "fovea_med": float(med[1])})
            print(f"[landmarks] ep {ep} loss {tot / len(dl):.4f} val median err od {med[0]:.4f} fovea {med[1]:.4f} "
                  f"({time.time() - t0:.0f}s)", flush=True)
            if med.sum() < best:
                best = med.sum()
                torch.save({"state_dict": model.state_dict(), "val": hist[-1]}, out / "best.pt")
            save_json(out / "history.json", hist)


if __name__ == "__main__":
    main()
