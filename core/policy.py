"""Deterministic triage policy.

Pure functions, no I/O, no randomness. Every decision returns a rule trace so the UI can show
exactly which rule fired and with which numbers. Thresholds come from models/policy.json, which
ml/eval/thresholds.py writes from validation data (never hand-tuned for the demo).
"""
from __future__ import annotations

import math
import re
from typing import Any

ROUTINE, REFER, HUMAN_REVIEW, RETAKE = "ROUTINE", "REFER", "HUMAN_REVIEW", "RETAKE"
SEVERITY = {ROUTINE: 0, RETAKE: 1, HUMAN_REVIEW: 2, REFER: 3}

DEFAULT_POLICY: dict[str, Any] = {
    "version": "default-unfitted",
    "t_refer": 0.5,           # P(referable) operating point
    "t_refer_low": 0.25,      # below this a 'usable' image may still be routine
    "t_severe": 0.5,          # P(grade>=3) for 'immediate' urgency
    "t_entropy": 1.0,         # predictive entropy (nats) above which the AI abstains
    "t_disagreement": 0.35,   # |P_ref(cnn) - P_ref(vit)| above which the AI abstains
    "t_ood": 1e9,             # Mahalanobis distance threshold (99th pct of validation)
    "lesion_suspicious": {"HE_area_frac": 0.0015, "EX_area_frac": 0.0015, "HE_count": 3},
    "va_refer_logmar": math.log10(12 / 6),  # worse than 6/12
    "macular_radius_dd": 1.0,
    "require_both_eyes": True,
    "provenance": {"note": "defaults; replace by running ml/eval/thresholds.py"},
}


def _step(trace: list, rule: str, fired: bool, detail: str) -> bool:
    trace.append({"rule": rule, "fired": bool(fired), "detail": detail})
    return fired


def _r(x: float) -> str:
    return f"{x:.3f}"


# --------------------------------------------------------------------- image level
def lesion_suspicious(lesions: dict | None, policy: dict) -> tuple[bool, str]:
    if not lesions:
        return False, "no lesion output"
    s = lesions.get("summary", {})
    cfg = policy["lesion_suspicious"]
    he = s.get("HE", {})
    ex = s.get("EX", {})
    he_frac, ex_frac, he_n = he.get("area_frac", 0.0), ex.get("area_frac", 0.0), he.get("count", 0)
    hit = he_frac >= cfg["HE_area_frac"] or ex_frac >= cfg["EX_area_frac"] or he_n >= cfg["HE_count"]
    return hit, (f"HE area {he_frac:.4f} (≥{cfg['HE_area_frac']}), HE count {he_n} (≥{cfg['HE_count']}), "
                 f"EX area {ex_frac:.4f} (≥{cfg['EX_area_frac']})")


def triage_image(quality: dict, grading: dict, uncertainty: dict, lesions: dict | None, policy: dict) -> dict:
    """Decide one image. quality.category in {adequate, usable, inadequate}."""
    p = {**DEFAULT_POLICY, **policy}
    trace: list[dict] = []
    reasons: list[dict] = []
    ens = grading["ensemble"]
    p_ref = float(ens["p_referable"])
    probs = ens["probs"]
    p_severe = float(probs[3] + probs[4])
    cat = quality["category"]
    susp, susp_detail = lesion_suspicious(lesions, p)

    def out(outcome, urgency=None):
        return {"outcome": outcome, "urgency": urgency, "reasons": reasons, "rule_trace": trace,
                "policy_version": p["version"]}

    # R1: inadequate image. Never routine. Keep visible evidence.
    if _step(trace, "R1 image inadequate", cat == "inadequate", f"quality = {cat}"):
        evidence = p_ref >= p["t_refer"] or susp
        if _step(trace, "R1a suspicious evidence on inadequate image", evidence,
                 f"P(referable) {_r(p_ref)} vs {_r(p['t_refer'])}; {susp_detail}"):
            reasons.append({"code": "SUSPICIOUS_ON_INADEQUATE",
                            "text": "Image is inadequate but shows possible referable signs. A person must look."})
            return out(HUMAN_REVIEW)
        for code in quality.get("reasons", []):
            reasons.append({"code": code, "text": f"Quality check failed: {code}"})
        reasons.append({"code": "INSUFFICIENT_EVIDENCE", "text": "Not enough visible retina to reassure. Retake the photo."})
        return out(RETAKE)

    # R2: out of distribution
    ood, t_ood = float(uncertainty.get("ood_score", 0.0)), float(p["t_ood"])
    if _step(trace, "R2 unlike training images (OOD)", ood > t_ood, f"OOD {ood:.2f} vs {t_ood:.2f}"):
        reasons.append({"code": "OOD", "text": "This image looks unlike the images the models learned from."})
        return out(HUMAN_REVIEW)

    # R3: model doubt
    ent, dis = float(uncertainty["entropy"]), float(uncertainty["disagreement"])
    doubt = ent > p["t_entropy"] or dis > p["t_disagreement"]
    if _step(trace, "R3 models unsure or disagree", doubt,
             f"entropy {_r(ent)} vs {_r(p['t_entropy'])}; disagreement {_r(dis)} vs {_r(p['t_disagreement'])}"):
        if ent > p["t_entropy"]:
            reasons.append({"code": "HIGH_ENTROPY", "text": "The grade distribution is spread out."})
        if dis > p["t_disagreement"]:
            reasons.append({"code": "DISAGREEMENT", "text": "The two graders disagree."})
        return out(HUMAN_REVIEW)

    # R4: referable
    if _step(trace, "R4 likely referable (grade ≥ 2)", p_ref >= p["t_refer"],
             f"P(referable) {_r(p_ref)} vs operating point {_r(p['t_refer'])}"):
        immediate = p_severe >= p["t_severe"] or int(ens["grade"]) >= 3
        _step(trace, "R4a severe or proliferative", immediate, f"P(grade ≥ 3) {_r(p_severe)} vs {_r(p['t_severe'])}")
        reasons.append({"code": "REFERABLE_DR", "text": f"Estimated grade {ens['grade']}; P(referable) {p_ref:.2f}."})
        return out(REFER, "immediate" if immediate else "soon")

    # R5: lesion evidence conflicts with a low score
    if _step(trace, "R5 lesion candidates conflict with low score", susp, susp_detail):
        reasons.append({"code": "EVIDENCE_CONFLICT",
                        "text": "Lesion candidates are visible although the graders score low."})
        return out(HUMAN_REVIEW)

    # R6: borderline score on a limited image
    if _step(trace, "R6 borderline on usable image", cat == "usable" and p_ref >= p["t_refer_low"],
             f"quality {cat}; P(referable) {_r(p_ref)} vs {_r(p['t_refer_low'])}"):
        reasons.append({"code": "BORDERLINE_LIMITED", "text": "Borderline score on an image with limitations."})
        return out(HUMAN_REVIEW)

    _step(trace, "R7 routine candidate", True, "no rule above fired")
    reasons.append({"code": "NO_REFERRAL_TRIGGER", "text": "No referral trigger in this image."})
    return out(ROUTINE, "routine_12m")


# --------------------------------------------------------------------- visual acuity
_SNELLEN = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*$")
_LOW = {"CF": 1.9, "HM": 2.3, "PL": 2.7, "NPL": 3.0}


def va_to_logmar(value: str | None) -> float | None:
    """'6/9', '20/40', '0.3' (logMAR), 'CF', 'HM', 'PL', 'NPL' -> logMAR. None if not measured."""
    if value is None:
        return None
    v = str(value).strip().upper()
    if not v or v in {"NM", "NOT MEASURED", "NONE"}:
        return None
    if v in _LOW:
        return _LOW[v]
    m = _SNELLEN.match(v)
    if m:
        num, den = float(m.group(1)), float(m.group(2))
        if num <= 0 or den <= 0:
            return None
        return math.log10(den / num)
    try:
        return float(v)
    except ValueError:
        return None


# --------------------------------------------------------------------- encounter level
def triage_encounter(images: list[dict], va: dict | None, policy: dict) -> dict:
    """Combine image-level decisions and clinical guardrails into one encounter outcome.

    images: [{"eye": "OD"|"OS", "triage": {...}, "macular_risk": {...}, "laterality": {...}}]
    va: {"OD": {"value": "6/9"}, "OS": {...}}  (missing / None means not measured)
    """
    p = {**DEFAULT_POLICY, **policy}
    trace: list[dict] = []
    flags: list[dict] = []
    eyes: dict[str, dict] = {}
    for eye in ("OD", "OS"):
        imgs = [i for i in images if i.get("eye") == eye and i.get("triage")]
        if not imgs:
            eyes[eye] = {"outcome": RETAKE if p["require_both_eyes"] else None, "missing": True}
            continue
        outs = [i["triage"]["outcome"] for i in imgs]
        if REFER in outs:
            o = REFER
        elif HUMAN_REVIEW in outs:
            o = HUMAN_REVIEW
        elif ROUTINE in outs:
            o = ROUTINE
        else:
            o = RETAKE
        urg = [i["triage"].get("urgency") for i in imgs if i["triage"]["outcome"] == REFER]
        eyes[eye] = {"outcome": o, "urgency": "immediate" if "immediate" in urg else (urg[0] if urg else None),
                     "missing": False}
        trace.append({"rule": f"E1 {eye} image-set", "fired": True, "detail": f"image outcomes {outs} -> {o}"})

    present = [e for e in eyes.values() if e["outcome"]]
    outcome = max((e["outcome"] for e in present), key=lambda o: SEVERITY[o]) if present else RETAKE
    urgency = None
    if outcome == REFER:
        urgency = "immediate" if any(e.get("urgency") == "immediate" for e in present) else "soon"
    for eye, e in eyes.items():
        if e["missing"]:
            flags.append({"code": f"EYE_MISSING_{eye}", "text": f"No usable image-set for {eye}."})
            trace.append({"rule": f"E2 {eye} missing", "fired": True,
                          "detail": "both eyes required" if p["require_both_eyes"] else "eye optional"})

    def escalate(to: str, code: str, text: str, rule: str, detail: str):
        nonlocal outcome, urgency
        flags.append({"code": code, "text": text})
        before = outcome
        if SEVERITY[to] > SEVERITY[outcome]:
            outcome = to
            if to == REFER and urgency is None:
                urgency = "soon"
        trace.append({"rule": rule, "fired": True, "detail": f"{detail}; {before} -> {outcome}"})

    # G1 visual acuity
    va = va or {}
    for eye in ("OD", "OS"):
        lm = va_to_logmar((va.get(eye) or {}).get("value"))
        if lm is None:
            escalate(HUMAN_REVIEW if outcome == ROUTINE else outcome, f"VA_NOT_MEASURED_{eye}",
                     f"Visual acuity not recorded for {eye}. Missing is not normal.",
                     f"G1 VA {eye} missing", "routine needs both VA values")
        elif lm > p["va_refer_logmar"] + 1e-6:
            escalate(REFER, f"VA_REDUCED_{eye}", f"{eye} vision worse than 6/12 (logMAR {lm:.2f}). Refer even without DR signs.",
                     f"G1 VA {eye} worse than 6/12", f"logMAR {lm:.2f} > {p['va_refer_logmar']:.2f}")
        else:
            trace.append({"rule": f"G1 VA {eye}", "fired": False, "detail": f"logMAR {lm:.2f}"})

    # G2 macular-risk indicator (investigational)
    if any((i.get("macular_risk") or {}).get("flag") for i in images):
        escalate(HUMAN_REVIEW, "MACULAR_RISK", "Hard-exudate candidates near the fovea. Macular finding for review, not a DME diagnosis.",
                 "G2 macular-risk indicator", "exudate candidate within 1 disc diameter of fovea")

    # G3 laterality mismatch
    for i in images:
        lat = i.get("laterality") or {}
        if lat.get("predicted") in ("OD", "OS") and lat.get("confidence", 0) >= 0.8 and lat["predicted"] != i.get("eye"):
            escalate(HUMAN_REVIEW, "LATERALITY_MISMATCH",
                     f"Image labelled {i.get('eye')} looks like {lat['predicted']} from the optic-disc position.",
                     "G3 laterality check", f"disc position suggests {lat['predicted']}")
            break

    return {"outcome": outcome, "urgency": urgency, "eyes": eyes, "flags": flags, "rule_trace": trace,
            "policy_version": p["version"]}
