"""Interpretable image-quality checks on the canonical square crop.

Each check returns a value, the threshold it was compared with, and pass/fail, so the UI
can explain a rejection. Thresholds live in models/quality_rules.json (fitted by
ml/train/quality.py on real quality labels); the defaults below are conservative fallbacks.
"""
from __future__ import annotations

import cv2
import numpy as np

from .fundus import circle_mask

DEFAULT_RULES = {
    "focus_min": 18.0,        # variance of Laplacian on green channel (512px)
    "focus_hard_min": 6.0,
    "dark_mean_min": 35.0,    # mean luminance inside fundus
    "dark_hard_min": 15.0,
    "bright_sat_max": 0.06,   # fraction of saturated pixels
    "uneven_max": 0.55,       # coefficient of variation of 8 sector means
    "field_min": 0.55,        # fundus area / square area (full disc = 0.785)
    "field_hard_min": 0.30,
    "redness_min": 1.05,      # mean R / mean G inside fundus (fundus photos are red)
    "vessel_min": 0.035,      # fraction of vessel-like pixels
    "disc_conf_min": 0.35,
    "fovea_conf_min": 0.30,
}

LABELS = {
    "FOCUS": "Focus",
    "TOO_DARK": "Illumination (dark)",
    "GLARE": "Illumination (glare)",
    "UNEVEN": "Even illumination",
    "FIELD_INCOMPLETE": "Field definition",
    "NOT_FUNDUS": "Looks like a fundus photo",
    "VESSELS_UNCLEAR": "Vessels visible",
    "DISC_NOT_VISIBLE": "Optic disc visible",
    "MACULA_NOT_VISIBLE": "Macula visible",
}


def _check(code, value, threshold, ok, hard, detail):
    return {"code": code, "label": LABELS[code], "value": round(float(value), 4),
            "threshold": round(float(threshold), 4), "pass": bool(ok), "hard": bool(hard and not ok), "detail": detail}


def vessel_fraction(green: np.ndarray, mask: np.ndarray) -> float:
    g = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(green)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    bh = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, k)
    inner = cv2.erode(mask, np.ones((15, 15), np.uint8))
    vals = bh[inner > 0]
    if vals.size == 0:
        return 0.0
    return float((vals > 12).mean())


def compute_features(sq: np.ndarray, mask: np.ndarray) -> dict:
    """sq: canonical square RGB (any size). mask: fundus mask of the same size."""
    s = 512
    img = cv2.resize(sq, (s, s), interpolation=cv2.INTER_AREA)
    m = cv2.resize(mask.astype(np.uint8), (s, s), interpolation=cv2.INTER_NEAREST)
    inner = cv2.erode(m, np.ones((9, 9), np.uint8))
    green = img[..., 1]
    lap = cv2.Laplacian(cv2.GaussianBlur(green, (3, 3), 0), cv2.CV_64F)
    focus = float(lap[inner > 0].var()) if inner.any() else 0.0
    lum = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32)
    inside = lum[m > 0]
    mean_l = float(inside.mean()) if inside.size else 0.0
    sat = float((inside >= 250).mean()) if inside.size else 0.0
    yy, xx = np.mgrid[:s, :s]
    ang = (np.arctan2(yy - s / 2, xx - s / 2) + np.pi) / (2 * np.pi) * 8
    sect = [float(lum[(m > 0) & (ang.astype(int) % 8 == k)].mean()) if ((m > 0) & (ang.astype(int) % 8 == k)).any() else 0.0
            for k in range(8)]
    uneven = float(np.std(sect) / (np.mean(sect) + 1e-6))
    field = float(m.mean())
    r = img[..., 0][m > 0].astype(np.float32)
    g = img[..., 1][m > 0].astype(np.float32)
    redness = float(r.mean() / (g.mean() + 1e-6)) if r.size else 0.0
    vf = vessel_fraction(green, m)
    return {"focus": focus, "mean_lum": mean_l, "saturated": sat, "uneven": uneven,
            "field": field, "redness": redness, "vessels": vf}


def run_checks(features: dict, landmarks: dict | None, rules: dict | None = None) -> list[dict]:
    r = {**DEFAULT_RULES, **(rules or {})}
    f = features
    out = [
        _check("NOT_FUNDUS", f["redness"], r["redness_min"], f["redness"] >= r["redness_min"] and f["field"] >= r["field_hard_min"],
               True, "Colour and shape of the image compared with typical fundus photos"),
        _check("FOCUS", f["focus"], r["focus_min"], f["focus"] >= r["focus_min"], f["focus"] < r["focus_hard_min"],
               "Edge sharpness (variance of the Laplacian)"),
        _check("TOO_DARK", f["mean_lum"], r["dark_mean_min"], f["mean_lum"] >= r["dark_mean_min"],
               f["mean_lum"] < r["dark_hard_min"], "Mean brightness inside the retina"),
        _check("GLARE", f["saturated"], r["bright_sat_max"], f["saturated"] <= r["bright_sat_max"], False,
               "Share of over-exposed pixels"),
        _check("UNEVEN", f["uneven"], r["uneven_max"], f["uneven"] <= r["uneven_max"], False,
               "Brightness variation between sectors"),
        _check("FIELD_INCOMPLETE", f["field"], r["field_min"], f["field"] >= r["field_min"],
               f["field"] < r["field_hard_min"], "Share of the frame covered by retina"),
        _check("VESSELS_UNCLEAR", f["vessels"], r["vessel_min"], f["vessels"] >= r["vessel_min"], False,
               "Share of vessel-like pixels"),
    ]
    if landmarks:
        od = landmarks.get("od", {}).get("conf", 0.0)
        fv = landmarks.get("fovea", {}).get("conf", 0.0)
        out.append(_check("DISC_NOT_VISIBLE", od, r["disc_conf_min"], od >= r["disc_conf_min"], False,
                          "Confidence of the optic-disc landmark"))
        out.append(_check("MACULA_NOT_VISIBLE", fv, r["fovea_conf_min"], fv >= r["fovea_conf_min"], False,
                          "Confidence of the fovea landmark"))
    # NOT_FUNDUS is always hard when it fails
    return out


def combine(checks: list[dict], model_probs: list[float] | None) -> dict:
    """Rules + learned model -> adequate / usable / inadequate.

    model_probs: [p_adequate, p_usable, p_inadequate] or None.
    """
    hard = [c["code"] for c in checks if c["hard"]]
    soft = [c["code"] for c in checks if not c["pass"] and not c["hard"]]
    reasons = hard + soft
    if hard:
        cat = "inadequate"
    elif model_probs is not None and model_probs[2] >= 0.5:
        cat = "inadequate"
        reasons = reasons + ["MODEL_INADEQUATE"] if "MODEL_INADEQUATE" not in reasons else reasons
    elif soft or (model_probs is not None and int(np.argmax(model_probs)) >= 1):
        cat = "usable"
    else:
        cat = "adequate"
    score = float(model_probs[0] + 0.5 * model_probs[1]) if model_probs is not None else (1.0 if cat == "adequate" else 0.5)
    return {"category": cat, "score": round(score, 4), "reasons": reasons,
            "probs": None if model_probs is None else {"adequate": round(float(model_probs[0]), 4),
                                                       "usable": round(float(model_probs[1]), 4),
                                                       "inadequate": round(float(model_probs[2]), 4)}}
