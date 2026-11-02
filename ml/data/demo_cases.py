"""Pick bundled demo cases (CC-BY datasets only) that show each outcome, by running the real pipeline.

Writes server/demo/<name>.jpg, server/demo/cases.json and server/demo/ATTRIBUTION.md.
APTOS images are never bundled (competition terms). Selection is deterministic (sorted ids).

    python -m ml.data.demo_cases
"""
from __future__ import annotations

import json

import cv2
import numpy as np
import pandas as pd

from ml.common import MODELS_OUT, PROC, ROOT, read_rgb
from server.app.pipeline import Pipeline

DEMO = ROOT / "server" / "demo"
GRADES = ["no DR", "mild NPDR", "moderate NPDR", "severe NPDR", "proliferative DR"]


def jpg(rgb) -> bytes:
    return cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 93])[1].tobytes()


def main():
    DEMO.mkdir(parents=True, exist_ok=True)
    pl = Pipeline(MODELS_OUT)
    noop = lambda *a, **k: None
    idr = pd.read_csv(PROC / "idrid" / "labels.csv").sort_values("id")
    cands = []
    for _, r in idr[idr.split == "test"].iterrows():
        cands.append(("IDRiD", "CC-BY-4.0", f"IDRiD {r['id']}", read_rgb(PROC / "idrid" / "img" / f"{r['id']}.jpg"), int(r.grade), 50))
    ddr = PROC / "ddr" / "labels.csv"
    if ddr.exists():
        d = pd.read_csv(ddr).sort_values("id")
        for g in [0, 2, 3, 4, 5]:
            for _, r in d[d.grade == g].head(6).iterrows():
                cands.append(("DDR", "CC-BY-4.0", f"DDR {r['id']}", read_rgb(PROC / "ddr" / "img" / f"{r['id']}.jpg"), int(r.grade), 45))
    want = {"ROUTINE": None, "REFER_immediate": None, "REFER_soon": None, "HUMAN_REVIEW": None}
    for src, lic, ref, img, grade, fov in cands:
        if all(want.values()):
            break
        out = pl.run(jpg(img), "OD", "macula", fov, noop)
        t = out["triage"]
        key = t["outcome"] if t["outcome"] != "REFER" else f"REFER_{t['urgency']}"
        if key in want and want[key] is None and grade <= 4:
            if key == "ROUTINE" and grade > 1:
                continue
            if key.startswith("REFER") and grade < 2:
                continue
            lat = out["landmarks"]["laterality"]["predicted"]
            want[key] = (src, lic, ref, img, grade, fov, lat if lat in ("OD", "OS") else "OD")
    # RETAKE: deterministic severe degradation of a routine image (derived from a CC-BY image)
    base = want["ROUTINE"] or want["REFER_soon"]
    if base:
        blurred = cv2.GaussianBlur(base[3], (0, 0), 9)
        dark = (255 * (blurred / 255.0) ** 3.2 * 0.45).astype(np.uint8)
        want["RETAKE"] = (base[0], base[1], base[2] + " (blurred + darkened copy)", dark, base[4], base[5], base[6])
    cases, attrib = [], ["# Demo case attribution", ""]
    titles = {"ROUTINE": "Clear photo, no referral trigger", "REFER_immediate": "Severe signs, immediate referral",
              "REFER_soon": "Moderate signs, referral", "HUMAN_REVIEW": "The AI is unsure", "RETAKE": "Unusable photo"}
    for key, v in want.items():
        if v is None:
            continue
        src, lic, ref, img, grade, fov, eye = v
        name = key.lower().replace("_", "-")
        (DEMO / f"{name}.jpg").write_bytes(jpg(img))
        desc = f"{ref}. Dataset label: grade {grade} ({GRADES[grade]})."
        cases.append({"name": name, "title": titles[key], "description": desc, "source": src, "license": lic,
                      "file": f"{name}.jpg", "eye": eye, "view": "macula", "fov_deg": fov})
        attrib.append(f"- `{name}.jpg`: {ref}, {src}, licence {lic}.")
    attrib += ["", "IDRiD: Porwal et al., Data 3(3):25 (2018), CC-BY 4.0. DDR: Li et al., Information Sciences 501 (2019), CC-BY 4.0.",
               "Images are re-cropped to a square. The RETAKE case is a deliberately degraded copy. Eye side is set from the optic-disc position."]
    (DEMO / "cases.json").write_text(json.dumps(cases, indent=2))
    (DEMO / "ATTRIBUTION.md").write_text("\n".join(attrib) + "\n")
    print("[demo] cases:", [c["name"] for c in cases])


if __name__ == "__main__":
    main()
