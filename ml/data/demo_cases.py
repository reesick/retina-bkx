"""Pick bundled demo encounters (CC-BY datasets only) by running the real CPU pipeline.

Each demo case is a full encounter: both eyes (OD + OS) and visual acuity, so the encounter-level policy
(guardrails, missing eye, VA) is exercised the way a real screening would be. Every chosen case is verified:
its encounter outcome must equal the intended outcome, otherwise the next candidate is tried.

Writes server/demo/*.jpg, server/demo/cases.json and server/demo/ATTRIBUTION.md.
APTOS images are never bundled (competition terms). Selection is deterministic (sorted ids).

    python -m ml.data.demo_cases
"""
from __future__ import annotations

import json

import cv2
import numpy as np
import pandas as pd

from core import policy as P
from ml.common import MODELS_OUT, PROC, ROOT, read_rgb
from server.app.pipeline import Pipeline

DEMO = ROOT / "server" / "demo"
GRADES = ["no DR", "mild NPDR", "moderate NPDR", "severe NPDR", "proliferative DR", "ungradable"]
NOOP = lambda *a, **k: None  # noqa: E731


def jpg(rgb) -> bytes:
    return cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 93])[1].tobytes()


class Cands:
    def __init__(self, pl: Pipeline):
        self.pl = pl
        self.cache: dict[str, dict] = {}
        idr = pd.read_csv(PROC / "idrid" / "labels.csv").sort_values("id")
        self.items = [dict(src="IDRiD", ref=r["id"], path=PROC / "idrid" / "img" / f"{r['id']}.jpg", grade=int(r.grade), fov=50)
                      for _, r in idr.iterrows()]
        p = PROC / "ddr" / "labels.csv"
        if p.exists():
            d = pd.read_csv(p).sort_values("id")
            self.items += [dict(src="DDR", ref=r["id"], path=PROC / "ddr" / "img" / f"{r['id']}.jpg", grade=int(r.grade), fov=45)
                           for _, r in d.groupby("grade", group_keys=False).head(25).iterrows()]

    def run(self, it, rgb=None, eye_hint="OD"):
        key = it["ref"] + ("_mod" if rgb is not None else "")
        if key not in self.cache:
            img = rgb if rgb is not None else read_rgb(it["path"])
            out = self.pl.run(jpg(img), eye_hint, "macula", it["fov"], NOOP)
            lat = out["landmarks"]["laterality"]
            eye = lat["predicted"] if lat["predicted"] in ("OD", "OS") and lat["confidence"] >= 0.5 else None
            if eye and eye != eye_hint:   # re-run with the detected eye so no laterality mismatch is raised
                out = self.pl.run(jpg(img), eye, "macula", it["fov"], NOOP)
            self.cache[key] = {"out": out, "eye": eye, "img": img}
        return self.cache[key]

    def find(self, want_outcome, want_urgency=None, grades=None, avoid=(), eye=None):
        for it in self.items:
            if it["ref"] in avoid or (grades and it["grade"] not in grades):
                continue
            r = self.run(it)
            t = r["out"]["triage"]
            if t["outcome"] == want_outcome and (want_urgency is None or t["urgency"] == want_urgency) \
                    and r["eye"] and (eye is None or r["eye"] == eye) \
                    and not (want_outcome == P.ROUTINE and r["out"]["macular_risk"]["flag"]):
                return it, r
        return None, None


def encounter(images, va):
    return P.triage_encounter([{"eye": e, "triage": o["triage"], "macular_risk": o["macular_risk"],
                                "laterality": o["landmarks"]["laterality"]} for e, o in images],
                              {k: {"value": v} for k, v in va.items()},
                              json.loads((MODELS_OUT / "policy.json").read_text()))


def degrade_until_retake(c: Cands, base_it):
    img0 = read_rgb(base_it["path"])
    for sigma, gamma, gain in [(9, 3.2, 0.45), (14, 3.8, 0.3), (20, 4.5, 0.2), (28, 5.0, 0.12)]:
        b = cv2.GaussianBlur(img0, (0, 0), sigma)
        dark = (255 * (b / 255.0) ** gamma * gain).astype(np.uint8)
        c.cache.pop(base_it["ref"] + "_mod", None)
        r = c.run(base_it, rgb=dark, eye_hint=c.run(base_it)["eye"] or "OD")
        if r["out"]["triage"]["outcome"] == P.RETAKE:
            return dark, r
    return None, None


def main():
    DEMO.mkdir(parents=True, exist_ok=True)
    for f in DEMO.glob("*.jpg"):
        f.unlink()
    pl = Pipeline(MODELS_OUT)
    c = Cands(pl)
    cases, used, attrib = [], set(), ["# Demo case attribution", ""]
    normal_va = {"OD": "6/6", "OS": "6/9"}

    def pair_routine(eye_needed, avoid):
        it, r = c.find(P.ROUTINE, grades=[0], avoid=avoid, eye=eye_needed)
        return it, r

    def add(name, title, desc, imgs, va):
        files = []
        for k, (it, r, img, eye) in enumerate(imgs):
            fn = f"{name}-{eye.lower()}.jpg"
            (DEMO / fn).write_bytes(jpg(img))
            files.append({"file": fn, "eye": eye, "view": "macula", "fov_deg": it["fov"]})
            note = " (blurred + darkened copy)" if r is not None and img is not None and it["ref"] + "_mod" in c.cache \
                and c.cache[it["ref"] + "_mod"]["img"] is img else ""
            attrib.append(f"- `{fn}`: {it['src']} {it['ref']}{note}, dataset grade {it['grade']} ({GRADES[it['grade']]}), CC-BY 4.0.")
            used.add(it["ref"])
        enc = encounter([(f["eye"], r["out"]) for f, (_, r, _, _) in zip(files, imgs)], va)
        cases.append({"name": name, "title": title, "description": desc, "source": "/".join(sorted({i[0]['src'] for i in imgs})),
                      "license": "CC-BY-4.0", "file": files[0]["file"], "eye": files[0]["eye"], "view": "macula",
                      "fov_deg": files[0]["fov_deg"], "images": files, "va": {**va, "method": "Snellen"},
                      "expected": {"outcome": enc["outcome"], "urgency": enc["urgency"]}})
        print(f"[demo] {name}: encounter {enc['outcome']} {enc['urgency'] or ''} flags {[f['code'] for f in enc['flags']]}", flush=True)

    def partner(main_eye):
        other = "OS" if main_eye == "OD" else "OD"
        it, r = pair_routine(other, used)
        return (it, r, r["img"], other) if it else None

    # 1 ROUTINE: both eyes routine, normal VA
    it, r = pair_routine("OD", used)
    if it:
        used.add(it["ref"])
        p2 = partner("OD")
        if p2:
            add("routine", "Both eyes clear, normal vision",
                "Routine pathway: adequate photos of both eyes, no referral trigger, vision 6/6 and 6/9.",
                [(it, r, r["img"], "OD"), p2], normal_va)
    # 2 REFER immediate
    for urg, name, title, grades in [("immediate", "refer-immediate", "Severe signs in one eye", [3, 4]),
                                     ("soon", "refer-soon", "Moderate signs in one eye", [2])]:
        it, r = c.find(P.REFER, urg, grades=grades, avoid=used)
        if it:
            used.add(it["ref"])
            p2 = partner(r["eye"])
            if p2:
                add(name, title, f"Referral ({urg}). Dataset grade {it['grade']} ({GRADES[it['grade']]}) in {r['eye']}; other eye clear.",
                    [(it, r, r["img"], r["eye"]), p2], normal_va)
    # 3 HUMAN_REVIEW: the AI abstains on one eye
    it, r = c.find(P.HUMAN_REVIEW, avoid=used)
    if it:
        used.add(it["ref"])
        p2 = partner(r["eye"])
        reasons = ", ".join(x["code"] for x in r["out"]["triage"]["reasons"])
        if p2:
            add("human-review", "The AI is unsure", f"The AI abstains on {r['eye']} ({reasons}); a clinician decides.",
                [(it, r, r["img"], r["eye"]), p2], normal_va)
    # 4 RETAKE: one eye's photo unusable, other eye routine
    base, rb = pair_routine("OD", used)
    if base:
        used.add(base["ref"])
        dark, rr = degrade_until_retake(c, base)
        if dark is not None:
            p2 = partner(rr["eye"] or "OD")
            if p2:
                add("retake", "Unusable photo of one eye",
                    "One photo is too blurred and dark to reassure; retake it. The other eye is clear.",
                    [(base, rr, dark, rr["eye"] or "OD"), p2], normal_va)
    # 5 Visual-acuity safeguard: images routine, VA 6/18 -> refer regardless of the model
    it, r = pair_routine("OD", used)
    if it:
        used.add(it["ref"])
        p2 = partner("OD")
        if p2:
            add("vision-safeguard", "Clear photos, reduced vision",
                "Both photos look routine, but right-eye vision is 6/18 (worse than 6/12): refer regardless of the model.",
                [(it, r, r["img"], "OD"), p2], {"OD": "6/18", "OS": "6/9"})

    (DEMO / "cases.json").write_text(json.dumps(cases, indent=2))
    attrib += ["", "IDRiD: Porwal et al., Data 3(3):25 (2018), CC-BY 4.0. DDR: Li et al., Information Sciences 501 (2019), CC-BY 4.0.",
               "Images are re-cropped to a square. Eye side comes from the optic-disc position (measured rule, 98% on DeepDRiD).",
               "Demo encounters pair images from different people to show a two-eye screening; they are illustrations, not real patients."]
    (DEMO / "ATTRIBUTION.md").write_text("\n".join(attrib) + "\n")
    print("[demo] cases:", [(x["name"], x["expected"]["outcome"]) for x in cases])


if __name__ == "__main__":
    main()
