"""Grounding checker: every number and clinical claim in agent-written text must come from the case data.

Used as a graph node: if a draft fails, the failures are fed back to the writer for a rewrite (bounded), and after
the last attempt the deterministic template is used instead. The checker itself is deterministic.
"""
from __future__ import annotations

import re

# phrases an agent must never write (diagnosis, certainty, treatment advice, DME claims)
FORBIDDEN = [
    (r"\bdiagnos(is|ed|e|es)\b", "uses 'diagnosis' (Retinitry does not diagnose)"),
    (r"\byou have\b", "tells the patient what they 'have'"),
    (r"\bDME (is )?(detected|present|confirmed)\b|\bmacular (o|e)?edema (is )?(detected|present|confirmed)\b", "claims DME"),
    (r"\b(definitely|certainly|guaranteed|100%)\b", "claims certainty"),
    (r"\b(laser|injection|anti-VEGF|surgery|vitrectomy)\b", "gives treatment advice"),
    (r"\b(no need to (see|visit)|nothing to worry)\b", "gives false reassurance"),
]
NUM = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(\s*%)?")


def allowed_numbers(facts: dict) -> set[float]:
    """All numbers that appear in the facts, in the forms a writer may use (raw, 2 dp, 1 dp, %, rounded)."""
    vals: set[float] = set()

    def walk(x):
        if isinstance(x, bool):
            return
        if isinstance(x, (int, float)):
            v = float(x)
            for r in (v, round(v, 2), round(v, 1), round(v), round(v * 100), round(v * 100, 1)):
                vals.add(float(r))
        elif isinstance(x, str):
            for m in NUM.finditer(x):
                vals.add(float(m.group(1)))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, (list, tuple)):
            for v in x:
                walk(v)

    walk(facts)
    vals.update({0.0, 1.0, 2.0})  # "both eyes", "one eye", grade boundaries are common and harmless
    return vals


def check(text: str, facts: dict, must_include: list[str] | None = None) -> dict:
    """Returns {"ok", "problems": [...], "numbers_checked": n}."""
    problems = []
    allowed = allowed_numbers(facts)
    n = 0
    for m in NUM.finditer(text):
        v = float(m.group(1))
        n += 1
        if not any(abs(v - a) <= 0.005 + 1e-9 for a in allowed):
            problems.append(f"number {m.group(0).strip()} is not in the case data")
    for pat, why in FORBIDDEN:
        if re.search(pat, text, flags=re.I):
            problems.append(f"forbidden wording: {why}")
    for word in must_include or []:
        if word.lower() not in text.lower():
            problems.append(f"must mention '{word}'")
    if len(text.strip()) < 40:
        problems.append("too short")
    return {"ok": not problems, "problems": problems, "numbers_checked": n}
