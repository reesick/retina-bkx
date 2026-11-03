"""Clinician brief and referral letter: facts, deterministic templates, and LLM prompts.

The facts dict is the ONLY information a writer may use; the grounding checker verifies the draft against it.
"""
from __future__ import annotations

import json

GRADE = ["no apparent DR", "mild NPDR", "moderate NPDR", "severe NPDR", "proliferative DR"]
OUTCOME = {"ROUTINE": "routine follow-up", "REFER": "referral", "HUMAN_REVIEW": "human review", "RETAKE": "retake"}


def case_facts(enc: dict, second: dict | None = None, coaching: dict | None = None) -> dict:
    ai = enc.get("ai") or {}
    eyes = {}
    for img in enc.get("images", []):
        if img.get("status") != "done":
            continue
        g = img["grading"]["ensemble"]
        tri = img["triage"]
        les = img["lesions"]["summary"]
        e = eyes.setdefault(img["eye"], [])
        so = (second or {}).get(img["id"])
        e.append({
            "view": img["view"], "quality": img["quality"]["category"], "quality_problems": img["quality"]["reasons"],
            "estimated_grade": g["grade"], "estimated_grade_name": GRADE[g["grade"]],
            "p_referable": round(g["p_referable"], 2), "outcome": tri["outcome"], "urgency": tri.get("urgency"),
            "reasons": [r["text"] for r in tri["reasons"]],
            "lesion_candidates": {k: v["count"] for k, v in les.items() if v["count"]},
            "macular_finding": bool(img["macular_risk"]["flag"]),
            "model_disagreement": round(img["uncertainty"]["disagreement"], 2),
            "second_opinion": None if not so else {"verdict": so["verdict"].replace("_", " "), "views": so["n_views"],
                                                   "p_referable_range": [round(so["min"], 2), round(so["max"], 2)]},
        })
    va = enc.get("va") or {}
    return {
        "patient_code": enc.get("patient_code"), "age": enc.get("age"), "diabetes_years": enc.get("diabetes_years"),
        "visual_acuity": {k: (va.get(k) or {}).get("value") or "not measured" for k in ("OD", "OS")},
        "encounter_outcome": ai.get("outcome"), "encounter_urgency": ai.get("urgency"),
        "flags": [f["text"] for f in ai.get("flags", [])], "eyes": eyes,
        "retake_needed": sorted((coaching or {}).keys()) != [],
    }


def template_brief(f: dict) -> str:
    out = OUTCOME.get(f["encounter_outcome"], f["encounter_outcome"] or "pending")
    urg = {"immediate": " (immediate)", "soon": " (within 3–6 months)"}.get(f.get("encounter_urgency"), "")
    lines = [f"AI recommendation: {out}{urg}. A clinician makes the final decision."]
    for eye, imgs in sorted(f["eyes"].items()):
        for i in imgs:
            les = ", ".join(f"{v} {k}" for k, v in i["lesion_candidates"].items()) or "no lesion candidates"
            s = (f"{eye} ({i['view']}): quality {i['quality']}; estimated {i['estimated_grade_name']} "
                 f"(P(referable) {i['p_referable']:.2f}); {les}; outcome {OUTCOME.get(i['outcome'], i['outcome'])}.")
            if i["macular_finding"]:
                s += " Hard-exudate candidates near the fovea (macular finding for review)."
            if i["second_opinion"]:
                so = i["second_opinion"]
                s += f" Second opinion over {so['views']} views: {so['verdict']}."
            lines.append(s)
    lines.append(f"Visual acuity: right {f['visual_acuity']['OD']}, left {f['visual_acuity']['OS']}.")
    if f["flags"]:
        lines.append("Needs your attention: " + "; ".join(f["flags"]))
    return "\n".join(lines)


BRIEF_SYSTEM = (
    "You write short case briefs for an ophthalmologist reviewing an AI screening result for diabetic retinopathy. "
    "Rules: use ONLY the facts given in JSON; copy every number exactly as written in the facts; do not add numbers; "
    "never say 'diagnosis', never claim DME is present, never suggest treatment, never say the patient is fine; "
    "say 'model-estimated' for grades and 'lesion candidates' for lesions; 4 to 6 sentences; plain text, no lists. "
    "Start with the AI recommendation, then what supports or contradicts it per eye, then what the reviewer should check."
)


def brief_prompt(f: dict, feedback: list[str] | None) -> str:
    p = "Facts (JSON):\n" + json.dumps(f, ensure_ascii=False, indent=1)
    if feedback:
        p += "\n\nYour previous draft was rejected by the fact checker for these reasons. Rewrite and fix all of them:\n- " + "\n- ".join(feedback)
    return p + "\n\nWrite the brief now."


def template_letter(f: dict, review: dict, facility: str | None) -> str:
    urg = {"immediate": "Urgency: immediate.", "soon": "Urgency: within 3–6 months."}.get(review.get("final_urgency"), "")
    eyes = []
    for eye, imgs in sorted(f["eyes"].items()):
        best = max(imgs, key=lambda i: i["p_referable"])
        les = ", ".join(f"{v} {k}" for k, v in best["lesion_candidates"].items()) or "no lesion candidates"
        eyes.append(f"{'Right' if eye == 'OD' else 'Left'} eye: model-estimated {best['estimated_grade_name']}; {les}"
                    + ("; macular finding for review" if best["macular_finding"] else "") + ".")
    return "\n".join([
        f"To: {facility or 'Ophthalmology department'}",
        f"Re: patient {f['patient_code']}, referral after diabetic retinopathy screening",
        "",
        "This patient was screened with a research triage aid and reviewed by a clinician, who decided to refer. " + urg,
        *eyes,
        f"Visual acuity: right {f['visual_acuity']['OD']}, left {f['visual_acuity']['OS']}.",
        f"Reviewer: {review.get('reviewer')}." + (f" Note: {review['reason']}" if review.get("reason") else ""),
        "",
        "Findings are model outputs on colour fundus photographs and are not a diagnosis. Please assess clinically.",
    ])


LETTER_SYSTEM = (
    "You draft a short, polite referral letter from a primary health centre to an ophthalmology clinic after diabetic "
    "retinopathy screening. Use ONLY the facts in JSON; copy numbers exactly; no new numbers; never call it a diagnosis; "
    "no treatment advice; mention that findings are model outputs reviewed by the named clinician; under 150 words; "
    "plain text with a 'To:' line and a 'Re:' line."
)


def letter_prompt(f: dict, review: dict, facility: str | None, feedback: list[str] | None) -> str:
    facts = {**f, "reviewer": review.get("reviewer"), "reviewer_note": review.get("reason"),
             "final_outcome": review.get("final_outcome"), "final_urgency": review.get("final_urgency"),
             "to": facility or "Ophthalmology department"}
    p = "Facts (JSON):\n" + json.dumps(facts, ensure_ascii=False, indent=1)
    if feedback:
        p += "\n\nThe fact checker rejected your previous draft:\n- " + "\n- ".join(feedback) + "\nRewrite and fix all of them."
    return p + "\n\nWrite the letter now."
