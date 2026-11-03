"""Out-of-fold landmark predictions for all 516 IDRiD images (fixes the landmark leak in evaluation).

K folds over the labelled IDRiD images; for each fold a landmark model is trained on the other folds and predicts the
held-out fold. Evaluation then uses, for every IDRiD image, landmarks from a model that never saw that image.
The deployed landmark model (runs/landmarks) is unchanged.

    python -m ml.train.landmarks_oof            # resumable: finished folds are skipped
Output: runs/landmarks_oof/preds.csv  (id, od_x, od_y, od_conf, fv_x, fv_y, fv_conf) in 0..1 canonical coords
"""
from __future__ import annotations

import time

import cv2
import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

from ml.common import PROC, RUNS, ensure_imagenet_tensor, read_rgb, seed_all, worker_init
from ml.train.landmarks import SIZE, LandmarkNet, LmDS, decode

K, EPOCHS = 4, 35
OUT = RUNS / "landmarks_oof"


def main():
    seed_all()
    OUT.mkdir(parents=True, exist_ok=True)
    dev = torch.device("cuda")
    df = pd.read_csv(PROC / "idrid" / "labels.csv").dropna(subset=["od_x", "fovea_x"]).sort_values("id").reset_index(drop=True)
    fold = np.arange(len(df)) % K
    rng = np.random.default_rng(42)
    rng.shuffle(fold)
    allp = OUT / "preds.csv"
    for k in range(K):
        fp = OUT / f"fold{k}.csv"
        if fp.exists():
            print(f"[lm-oof] fold {k} done, skipping", flush=True)
            continue
        tr, te = df[fold != k], df[fold == k]
        dl = DataLoader(LmDS(tr, True), batch_size=8, shuffle=True, num_workers=3, drop_last=True,
                        worker_init_fn=worker_init, persistent_workers=True, generator=torch.Generator().manual_seed(k))
        m = LandmarkNet().to(dev)
        opt = torch.optim.AdamW(m.parameters(), lr=5e-4, weight_decay=1e-4)
        sch = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=5e-4, total_steps=EPOCHS * len(dl), pct_start=0.05)
        t0 = time.time()
        for ep in range(EPOCHS):
            m.train()
            for x, hm, _ in dl:
                x, hm = x.to(dev), hm.to(dev)
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    lg = m(x)
                loss = F.binary_cross_entropy_with_logits(lg.float(), hm, pos_weight=torch.tensor(30.0, device=dev))
                opt.zero_grad(set_to_none=True)
                loss.backward()
                opt.step()
                sch.step()
            if ep % 10 == 9:
                print(f"[lm-oof] fold {k} ep {ep} loss {loss.item():.4f} ({time.time() - t0:.0f}s)", flush=True)
        m.eval()
        rows = []
        with torch.no_grad():
            for _, r in te.iterrows():
                img = cv2.resize(read_rgb(PROC / "idrid" / "img" / f"{r['id']}.jpg"), (SIZE, SIZE), interpolation=cv2.INTER_AREA)
                d = decode(torch.sigmoid(m(ensure_imagenet_tensor(img)[None].to(dev))).cpu().numpy()[0])
                rows.append({"id": r["id"], "od_x": d[0][0], "od_y": d[0][1], "od_conf": d[0][2],
                             "fv_x": d[1][0], "fv_y": d[1][1], "fv_conf": d[1][2]})
        pd.DataFrame(rows).to_csv(fp, index=False)
        print(f"[lm-oof] fold {k} saved {len(rows)} predictions", flush=True)
        del m
        torch.cuda.empty_cache()
    pd.concat([pd.read_csv(OUT / f"fold{k}.csv") for k in range(K)]).to_csv(allp, index=False)
    print(f"[lm-oof] wrote {allp}", flush=True)


if __name__ == "__main__":
    main()
