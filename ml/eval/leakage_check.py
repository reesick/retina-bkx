"""Leakage audit: find grading-test images that the lesion model saw in training (same picture, different file name)
and recompute the triage simulation without them. Writes metrics.json["leakage_check"].

    python -m ml.eval.leakage_check
"""
import json

import cv2
import numpy as np
import pandas as pd

from core import policy as P
from ml.common import MODELS_OUT, PROC, RUNS
from ml.eval import evaluate as EV


def sig(p):
    im = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
    im = cv2.resize(im, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    return ((im - im.mean()) / (im.std() + 1e-6)).ravel()


def overlaps(grade_paths, seg_ids):
    G = np.stack([sig(p) for p in grade_paths])
    hit = np.zeros(len(grade_paths), bool)
    for rid in seg_ids:
        d = np.sqrt(((G - sig(PROC / "seg" / "img" / f"{rid}.jpg")) ** 2).mean(1))
        j = int(d.argmin())
        if d[j] < 0.15:
            hit[j] = True
    return hit


def main():
    D = EV.datasets()
    pol = json.loads((MODELS_OUT / "policy.json").read_text())
    rules = {k: v for k, v in json.loads((MODELS_OUT / "quality_rules.json").read_text()).items() if k != "provenance"}
    EV.T_IN = float(rules.get("model_inadequate_threshold", 0.5))
    T = pol["temperatures"]
    o = np.load(MODELS_OUT / "ood.npz")
    seg = pd.read_csv(PROC / "seg" / "labels.csv")
    train_seg = seg[seg.split == "train"]
    out = {"method": "32x32 normalised-grey image match (RMSE < 0.15) between grading-test images and lesion-model training images",
           "scope": "affects only the triage simulation (lesion rules R1a/R5); grader AUROC/sensitivity/specificity are unaffected"}
    m = json.loads((MODELS_OUT / "metrics.json").read_text())
    for name, src in [("idrid", "idrid"), ("ddr", "ddr")]:
        df = D[name]
        hit = overlaps(df["path"].tolist(), train_seg[train_seg.source == src]["id"])
        d = dict(np.load(RUNS / "preds" / f"{name}.npz", allow_pickle=True))
        keep = ~hit
        dk = {k: (v[keep] if hasattr(v, "__len__") and len(v) == len(hit) else v) for k, v in d.items()}
        pc, pv, pe = EV.ens_probs(dk, T)
        z = (dk["feat_cnn"] - o["mean"]) @ o["components"].T - o["mu"]
        ood = np.sqrt(np.einsum("ij,jk,ik->i", z, o["prec"], z))
        y = df["grade"].to_numpy()[keep]
        yy = np.where((y < 0) | (y > 4), 5, y)
        tm = EV.triage_metrics(EV.simulate(dk, pe, pc, pv, ood, pol, rules), yy, pe)
        full = m["triage"][name]
        out[name] = {"overlapping_images": int(hit.sum()), "n_after_removal": int(keep.sum()),
                     "referable_routed_routine": tm["referable_routed_routine"], "referable_total": tm["referable_total"],
                     "human_review_rate": tm["human_review_rate"], "coverage": tm["coverage"], "auto_sens": tm["auto_sens"],
                     "full_set": {"referable_routed_routine": full["referable_routed_routine"], "referable_total": full["referable_total"],
                                  "human_review_rate": full["human_review_rate"], "coverage": full["coverage"]}}
        print(f"[leakage] {name}: {hit.sum()} overlapping removed -> missed {tm['referable_routed_routine']}/{tm['referable_total']} "
              f"(full set {full['referable_routed_routine']}/{full['referable_total']}), human review {tm['human_review_rate']:.3f} "
              f"(full {full['human_review_rate']:.3f}), coverage {tm['coverage']:.3f} (full {full['coverage']:.3f})")
    m["leakage_check"] = out
    (MODELS_OUT / "metrics.json").write_text(json.dumps(m, indent=2, default=float))


if __name__ == "__main__":
    main()
