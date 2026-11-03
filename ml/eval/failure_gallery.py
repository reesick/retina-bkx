"""Failure gallery: real CC-BY cases (IDRiD, DDR) where Retinitry's single-image decision was wrong or abstained.

Reads runs/app_eval/{idrid,ddr}.jsonl (app-faithful results) and writes:
  server/demo/failures/<id>.jpg   (512 px)
  server/demo/failures/failures.json
Categories (deterministic: sorted by confidence of the error):
  missed_referable  - dataset grade >= 2, Retinitry said ROUTINE            (the dangerous error)
  over_referral     - dataset grade 0, Retinitry said REFER                  (the costly error)
  abstained_healthy - dataset grade 0, Retinitry said HUMAN_REVIEW           (why review load is high)
  wrong_retake      - gradable photo (grade label present) sent to RETAKE

    python -m ml.eval.failure_gallery
"""
import json

import cv2
import pandas as pd

from ml.common import PROC, ROOT, RUNS, read_rgb

OUT = ROOT / "server" / "demo" / "failures"
GR = ["no DR", "mild NPDR", "moderate NPDR", "severe NPDR", "proliferative DR"]


def load(name):
    p = RUNS / "app_eval" / f"{name}.jsonl"
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.exists() else []


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.jpg"):
        f.unlink()
    items = []
    for ds, folder in [("idrid", "idrid"), ("ddr", "ddr")]:
        for r in load(ds):
            if "triage" not in r or not (0 <= r["grade"] <= 4):
                continue
            o, g, p = r["triage"]["outcome"], r["grade"], r["grading"]["ensemble"]["p_referable"]
            cat = ("missed_referable" if (o == "ROUTINE" and g >= 2) else "over_referral" if (o == "REFER" and g == 0)
                   else "abstained_healthy" if (o == "HUMAN_REVIEW" and g == 0) else "wrong_retake" if o == "RETAKE" else None)
            if cat:
                items.append({**r, "dataset": ds, "folder": folder, "category": cat, "p_ref": p})
    per = {"missed_referable": 6, "over_referral": 4, "abstained_healthy": 3, "wrong_retake": 2}
    chosen = []
    for cat, k in per.items():
        xs = [i for i in items if i["category"] == cat]
        key = (lambda i: i["p_ref"]) if cat == "missed_referable" else (lambda i: -i["p_ref"])
        xs.sort(key=lambda i: (key(i), i["id"]))
        # prefer IDRiD (fully external) first
        xs = [i for i in xs if i["dataset"] == "idrid"] + [i for i in xs if i["dataset"] != "idrid"]
        chosen += xs[:k]
    out = []
    for i in chosen:
        img = read_rgb(PROC / i["folder"] / "img" / f"{i['id']}.jpg")
        img = cv2.resize(img, (512, 512), interpolation=cv2.INTER_AREA)
        fn = f"{i['dataset']}_{i['id']}.jpg"
        cv2.imwrite(str(OUT / fn), cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
        t = i["triage"]
        out.append({
            "file": fn, "dataset": "IDRiD (external)" if i["dataset"] == "idrid" else "DDR (held-out)", "image_id": i["id"],
            "category": i["category"], "dataset_grade": i["grade"], "dataset_grade_label": GR[i["grade"]],
            "outcome": t["outcome"], "urgency": t.get("urgency"), "p_referable": round(i["p_ref"], 3),
            "predicted_grade": i["grading"]["ensemble"]["grade"], "quality": i["quality"]["category"],
            "quality_reasons": i["quality"]["reasons"], "reasons": [x["text"] for x in t["reasons"]],
            "fired_rules": [s["rule"] for s in t["rule_trace"] if s["fired"]],
            "uncertainty": {k: round(i["uncertainty"][k], 3) for k in ("entropy", "disagreement", "ood_score")},
            "license": "CC-BY-4.0",
        })
    counts = {c: sum(1 for i in items if i["category"] == c and i["dataset"] == "idrid") for c in per}
    (OUT / "failures.json").write_text(json.dumps({"cases": out, "idrid_counts": counts,
        "note": "Single-image decisions from the app-faithful evaluation. Dataset grades are the published labels."}, indent=2))
    print("[gallery]", len(out), "cases; IDRiD counts", counts)


if __name__ == "__main__":
    main()
