"""Train a DR grader (5-class softmax) on the APTOS train split.

    python -m ml.train.grader --arch cnn     # EfficientNet-B3 @ 512
    python -m ml.train.grader --arch vit     # DINOv2 ViT-B/14 @ 448, last 4 blocks + head fine-tuned

Model selection on APTOS val: AUROC of P(referable) + QWK. Checkpoint -> runs/grader_<arch>/best.pt
"""
from __future__ import annotations

import argparse
import math
import time

import albumentations as A
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import roc_auc_score
from torch.utils.data import DataLoader, Dataset

from ml.common import RUNS, SPLITS, ensure_imagenet_tensor, qwk, read_rgb, save_json, seed_all, softmax, worker_init

CFG = {
    "cnn": {"timm": "efficientnet_b3.ra2_in1k", "size": 512, "bs": 12, "epochs": 16, "lr": 3e-4, "head_lr": 1e-3},
    "vit": {"timm": "vit_base_patch14_dinov2.lvd142m", "size": 448, "bs": 8, "epochs": 10, "lr": 4e-5, "head_lr": 1e-3,
            "train_blocks": 4},
}


def build_model(arch: str, pretrained: bool = True) -> nn.Module:
    import timm

    c = CFG[arch]
    if arch == "cnn":
        m = timm.create_model(c["timm"], pretrained=pretrained, num_classes=5, drop_rate=0.3)
    else:
        m = timm.create_model(c["timm"], pretrained=pretrained, num_classes=5, img_size=c["size"], drop_rate=0.1)
        for p in m.parameters():
            p.requires_grad = False
        for blk in m.blocks[-c["train_blocks"]:]:
            for p in blk.parameters():
                p.requires_grad = True
        for mod in (m.norm, m.head):
            for p in mod.parameters():
                p.requires_grad = True
        if getattr(m, "fc_norm", None) is not None and not isinstance(m.fc_norm, nn.Identity):
            for p in m.fc_norm.parameters():
                p.requires_grad = True
    return m


def train_aug(size: int) -> A.Compose:
    return A.Compose([
        A.RandomResizedCrop(size=(size, size), scale=(0.85, 1.0), ratio=(0.95, 1.05)),
        A.HorizontalFlip(), A.VerticalFlip(),
        A.Affine(rotate=(-180, 180), p=0.7, border_mode=0),
        A.RandomBrightnessContrast(0.2, 0.2, p=0.7),
        A.RandomGamma((80, 120), p=0.3),
        A.HueSaturationValue(5, 10, 5, p=0.3),
        A.OneOf([A.GaussianBlur(blur_limit=(3, 5)), A.GaussNoise(std_range=(0.01, 0.04))], p=0.25),
    ])


class GradeDS(Dataset):
    def __init__(self, df: pd.DataFrame, size: int, aug: A.Compose | None):
        self.paths = df["path"].tolist()
        self.y = df["grade"].astype(int).to_numpy()
        self.size, self.aug = size, aug

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, i):
        import cv2

        img = read_rgb(self.paths[i])
        if self.aug is not None:
            img = self.aug(image=img)["image"]
        if img.shape[0] != self.size:
            img = cv2.resize(img, (self.size, self.size), interpolation=cv2.INTER_AREA)
        return ensure_imagenet_tensor(img), int(self.y[i])


@torch.no_grad()
def predict(model: nn.Module, loader: DataLoader, device) -> np.ndarray:
    model.eval()
    out = []
    for x, _ in loader:
        with torch.autocast("cuda", dtype=torch.float16):
            out.append(model(x.to(device, non_blocking=True)).float().cpu().numpy())
    return np.concatenate(out)


def val_metrics(logits: np.ndarray, y: np.ndarray) -> dict:
    p = softmax(logits)
    pref = p[:, 2:].sum(1)
    yref = (y >= 2).astype(int)
    return {"auroc": float(roc_auc_score(yref, pref)), "qwk": qwk(y, p.argmax(1)),
            "acc": float((p.argmax(1) == y).mean()), "nll": float(-np.log(p[np.arange(len(y)), y] + 1e-12).mean())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arch", choices=["cnn", "vit"], required=True)
    ap.add_argument("--epochs", type=int)
    args = ap.parse_args()
    c = dict(CFG[args.arch])
    if args.epochs:
        c["epochs"] = args.epochs
    seed_all()
    device = torch.device("cuda")
    df = pd.read_csv(SPLITS / "aptos.csv")
    tr, va = df[df.split == "train"], df[df.split == "val"]
    counts = np.bincount(tr["grade"], minlength=5).astype(np.float32)
    weights = torch.tensor((counts.sum() / (5 * counts)) ** 0.5, device=device)
    dl_tr = DataLoader(GradeDS(tr, c["size"], train_aug(c["size"])), batch_size=c["bs"], shuffle=True, num_workers=3,
                       pin_memory=True, drop_last=True, worker_init_fn=worker_init, persistent_workers=True,
                       generator=torch.Generator().manual_seed(42))
    dl_va = DataLoader(GradeDS(va, c["size"], None), batch_size=c["bs"] * 2, num_workers=3, pin_memory=True)
    model = build_model(args.arch).to(device)
    head_params = [p for n, p in model.named_parameters() if p.requires_grad and ("classifier" in n or "head" in n)]
    body_params = [p for n, p in model.named_parameters() if p.requires_grad and not ("classifier" in n or "head" in n)]
    opt = torch.optim.AdamW([{"params": body_params, "lr": c["lr"]}, {"params": head_params, "lr": c["head_lr"]}],
                            weight_decay=0.02)
    steps = c["epochs"] * len(dl_tr)
    warm = len(dl_tr)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / steps))))
    scaler = torch.amp.GradScaler()
    loss_fn = nn.CrossEntropyLoss(weight=weights)
    out = RUNS / f"grader_{args.arch}"
    out.mkdir(parents=True, exist_ok=True)
    best, hist = -1.0, []
    for ep in range(c["epochs"]):
        model.train()
        t0, tot, n = time.time(), 0.0, 0
        for x, y in dl_tr:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            with torch.autocast("cuda", dtype=torch.float16):
                loss = loss_fn(model(x), y)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            tot += loss.item() * len(y); n += len(y)
        m = val_metrics(predict(model, dl_va, device), va["grade"].to_numpy())
        score = m["auroc"] + 0.5 * m["qwk"]
        m.update({"epoch": ep, "train_loss": tot / n, "sec": round(time.time() - t0, 1)})
        hist.append(m)
        print(f"[{args.arch}] ep {ep} loss {tot / n:.4f} val auroc {m['auroc']:.4f} qwk {m['qwk']:.4f} "
              f"acc {m['acc']:.3f} ({m['sec']}s)", flush=True)
        if score > best:
            best = score
            torch.save({"state_dict": model.state_dict(), "arch": args.arch, "cfg": c, "val": m}, out / "best.pt")
        save_json(out / "history.json", hist)
    print(f"[{args.arch}] best score {best:.4f}")


if __name__ == "__main__":
    main()
