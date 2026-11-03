"""Second-opinion agent tool: re-examine an uncertain photo under deterministic test-time transformations.

Round 1: 4 views (original, horizontal flip, vertical flip, 180° rotation). If the views disagree with each other,
round 2 adds 4 more (90° and 270° rotations, two centre crops). For each view both graders run and the ensemble
P(referable) is computed with the deployed temperatures.

The verdict compares the views with the referral operating point t_refer:
  consistent_referable      every view >= t_refer + margin
  consistent_not_referable  every view <= t_refer - margin
  doubt_confirmed           otherwise (the uncertainty is real: a person should look)
Only `consistent_referable` may change an outcome (HUMAN_REVIEW -> REFER, the safe direction), and only when
policy.json enables it with a margin fitted on validation data (ml/eval/second_opinion_eval.py).

Works with any server Pipeline: ONNX on CPU in the app, or the GPU-backed pipeline in evaluation.
"""
from __future__ import annotations

import cv2
import numpy as np

from core.fundus import crop_square, decode_image, fundus_mask

ROUND1 = ["original", "hflip", "vflip", "rot180"]
ROUND2 = ["rot90", "rot270", "crop92", "crop85"]


def _view(sq: np.ndarray, name: str) -> np.ndarray:
    if name == "original":
        return sq
    if name == "hflip":
        return np.ascontiguousarray(sq[:, ::-1])
    if name == "vflip":
        return np.ascontiguousarray(sq[::-1])
    if name == "rot180":
        return np.ascontiguousarray(sq[::-1, ::-1])
    if name == "rot90":
        return np.ascontiguousarray(np.rot90(sq, 1))
    if name == "rot270":
        return np.ascontiguousarray(np.rot90(sq, 3))
    if name.startswith("crop"):
        f = int(name[4:]) / 100.0
        h = sq.shape[0]
        c = int(round(h * f))
        o = (h - c) // 2
        return cv2.resize(sq[o:o + c, o:o + c], (h, h), interpolation=cv2.INTER_CUBIC)
    raise ValueError(name)


def canonical(pl, image_bytes: bytes) -> np.ndarray:
    rgb = decode_image(image_bytes)
    sq, _ = crop_square(rgb, 768, fundus_mask(rgb))
    return sq


def score_views(pl, sq: np.ndarray, views: list[str]) -> list[dict]:
    pl._load()
    T = pl.T
    out = []
    for v in views:
        img = _view(sq, v)
        g1, _, _ = pl._grader("grader_cnn", img, 512, float(T.get("cnn", 1.0)))
        g2, _, _ = pl._grader("grader_vit", img, 448, float(T.get("vit", 1.0)))
        pe = (np.array(g1["probs"]) + np.array(g2["probs"])) / 2
        out.append({"view": v, "p_referable": round(float(pe[2:].sum()), 4), "grade": int(pe.argmax()),
                    "p_cnn": round(g1["p_referable"], 4), "p_vit": round(g2["p_referable"], 4)})
    return out


def verdict(views: list[dict], t_refer: float, margin: float) -> dict:
    p = np.array([v["p_referable"] for v in views])
    lo, hi = float(p.min()), float(p.max())
    if lo >= t_refer + margin:
        v = "consistent_referable"
    elif hi <= t_refer - margin:
        v = "consistent_not_referable"
    else:
        v = "doubt_confirmed"
    return {"verdict": v, "n_views": len(views), "mean": round(float(p.mean()), 4), "min": round(lo, 4),
            "max": round(hi, 4), "spread": round(hi - lo, 4), "t_refer": t_refer, "margin": margin}


def run_round(pl, sq: np.ndarray, round_no: int, previous: list[dict], t_refer: float, margin: float) -> dict:
    views = previous + score_views(pl, sq, ROUND1 if round_no == 1 else ROUND2)
    return {"round": round_no, "views": views, **verdict(views, t_refer, margin)}
