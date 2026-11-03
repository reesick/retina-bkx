"""App-faithful evaluation: runs the real server pipeline (server/app/pipeline.py + core/policy.py) on every test
image, with the network calls served by the same checkpoints on the GPU (fp32) instead of ONNX on the CPU.

Fixes and adds:
  * eval == app: quality rules WITH landmark checks, macular risk, laterality, lesion rules (finding C)
  * IDRiD landmarks come from out-of-fold models (runs/landmarks_oof) -> no landmark leak (finding B)
  * images that the lesion model trained on are excluded from triage numbers (finding A)
  * per-quality-band breakdown
  * E2: quality gate on vs off on deterministically degraded photos
  * E7 / E9: DeepDRiD encounter level: single vs dual view, eye level and patient level (core.policy.triage_encounter)
  * E10 (partial): macular-risk indicator vs IDRiD DME labels
  * fidelity check: GPU path vs the ONNX path on a sample (outcome agreement)
Writes metrics.json["app_eval"]. Per-image results cached in runs/app_eval/*.jsonl (resumable).

    python -m ml.eval.app_eval
"""
from __future__ import annotations

import json
import time
import zlib
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
import torch

import server.app.pipeline as PL
from core import policy as P
from ml.common import MODELS_OUT, PROC, RUNS, read_rgb, seed_all
from ml.eval import evaluate as EV

DEV = torch.device("cuda")
OUT = RUNS / "app_eval"
CUR = {"id": None, "oof": None}


# ---------------------------------------------------------------- GPU backend for the pipeline
def load_gpu_models():
    from ml.export.to_onnx import CnnWrap, SigWrap, VitWrap
    from ml.train.grader import build_model
    from ml.train.landmarks import LandmarkNet
    from ml.train.lesions import build_model as build_les
    from ml.train.quality import build_model as build_q

    def ld(m, p):
        m.load_state_dict(torch.load(p, map_location="cpu")["state_dict"])
        return m

    return {
        "grader_cnn": CnnWrap(ld(build_model("cnn", pretrained=False), RUNS / "grader_cnn/best.pt")),
        "grader_vit": VitWrap(ld(build_model("vit", pretrained=False), RUNS / "grader_vit/best.pt")),
        "lesions": SigWrap(ld(build_les(pretrained=False), RUNS / "lesions/best.pt")),
        "landmarks": SigWrap(ld(LandmarkNet(pretrained=False), RUNS / "landmarks/best.pt")),
        "quality": ld(build_q(pretrained=False), RUNS / "quality/best.pt"),
    }


def synth_heatmaps(oof):
    """Heat-maps that decode (pipeline._landmarks) back to the out-of-fold points and confidences."""
    H = 128
    yy, xx = np.mgrid[:H, :H]
    hm = np.zeros((1, 2, H, H), np.float32)
    for c, (x, y, conf) in enumerate([(oof["od_x"], oof["od_y"], oof["od_conf"]), (oof["fv_x"], oof["fv_y"], oof["fv_conf"])]):
        cx, cy = x * H - 0.5, y * H - 0.5
        hm[0, c] = conf * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * 2.5 ** 2))
    return hm


def make_pipeline(models):
    pl = PL.Pipeline(MODELS_OUT)
    pl._load()
    for m in models.values():
        m.to(DEV).eval().float()

    @torch.no_grad()
    def gpu_run(name, x):
        if name == "landmarks" and CUR["oof"] is not None:
            return [synth_heatmaps(CUR["oof"])]
        out = models[name](torch.from_numpy(x).to(DEV))
        out = out if isinstance(out, (tuple, list)) else [out]
        return [o.float().cpu().numpy() for o in out]

    pl._run = gpu_run
    PL._png = lambda rgba: b""          # overlays are not needed for evaluation
    return pl


def jpg(rgb):
    return cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()


def run_image(pl, rgb, eye="OD", fov=45):
    o = pl.run(jpg(rgb), eye, "macula", fov, lambda *a: None)
    return {k: o[k] for k in ["quality", "landmarks", "grading", "uncertainty", "lesions", "macular_risk", "triage"]}


def compact(r):
    les = r["lesions"]
    return {"quality": {k: r["quality"][k] for k in ["category", "reasons", "probs", "score"]},
            "landmarks": r["landmarks"], "grading": r["grading"], "uncertainty": r["uncertainty"],
            "lesions": {"summary": les["summary"]}, "macular_risk": r["macular_risk"], "triage": r["triage"]}


def run_set(pl, name, items, oof=None, degrade_level=0):
    """items: list of dicts with id, path, grade (+ extra). Cached per image in OUT/name.jsonl."""
    OUT.mkdir(parents=True, exist_ok=True)
    cache = OUT / f"{name}.jsonl"
    done = {}
    if cache.exists():
        for line in cache.read_text(encoding="utf-8").splitlines():
            if line.strip():
                d = json.loads(line)
                done[d["id"]] = d
    t0 = time.time()
    with open(cache, "a", encoding="utf-8") as f:
        for k, it in enumerate(items):
            if it["id"] in done:
                continue
            rgb = read_rgb(it["path"])
            if degrade_level:
                from ml.train.quality import degrade

                rgb = degrade(rgb, degrade_level, np.random.default_rng(zlib.crc32(it["id"].encode())))
            CUR["oof"] = oof.get(it["id"]) if oof else None
            try:
                r = compact(run_image(pl, rgb, it.get("eye", "OD"), it.get("fov", 45)))
            except ValueError as e:
                r = {"error": str(e)}
            rec = {**{k: v for k, v in it.items() if k != "path"}, **r}
            f.write(json.dumps(rec) + "\n")
            done[it["id"]] = rec
            if k % 250 == 0:
                print(f"[app_eval] {name} {k}/{len(items)} ({time.time() - t0:.0f}s)", flush=True)
    CUR["oof"] = None
    return [done[i["id"]] for i in items if i["id"] in done]


# ---------------------------------------------------------------- metrics
def triage_stats(recs):
    recs = [r for r in recs if "triage" in r]
    y = np.array([r["grade"] for r in recs])
    o = np.array([r["triage"]["outcome"] for r in recs])
    grad = (y >= 0) & (y <= 4)
    ref = grad & (y >= 2)
    auto = grad & np.isin(o, ["ROUTINE", "REFER"])
    s, sp, _, _ = EV.sens_spec(ref[auto].astype(int), (o[auto] == "REFER").astype(int)) if auto.any() else (None,) * 4
    return {"n": int(len(o)), "n_gradable": int(grad.sum()), "coverage": float(auto.sum() / max(grad.sum(), 1)),
            "auto_sens": s, "auto_spec": sp,
            "routine_rate": float((o == "ROUTINE").mean()), "referral_rate": float((o == "REFER").mean()),
            "human_review_rate": float((o == "HUMAN_REVIEW").mean()), "retake_rate": float((o == "RETAKE").mean()),
            "referable_routed_routine": int(((o == "ROUTINE") & ref).sum()), "referable_total": int(ref.sum()),
            "nonreferable_routine_rate": float(((o == "ROUTINE") & grad & (y <= 1)).sum() / max((grad & (y <= 1)).sum(), 1)),
            "ungradable_n": int((~grad).sum()),
            "ungradable_routine": int(((o == "ROUTINE") & ~grad).sum())}


def by_quality_band(recs):
    out = {}
    for band in ["adequate", "usable", "inadequate"]:
        rs = [r for r in recs if r.get("quality", {}).get("category") == band]
        if not rs:
            continue
        st = triage_stats(rs)
        y = np.array([r["grade"] for r in rs])
        g = (y >= 0) & (y <= 4)
        pref = np.array([r["grading"]["ensemble"]["p_referable"] for r in rs])
        auc = None
        if g.sum() > 10 and 0 < (y[g] >= 2).sum() < g.sum():
            from sklearn.metrics import roc_auc_score

            auc = float(roc_auc_score((y[g] >= 2).astype(int), pref[g]))
        out[band] = {"share": len(rs) / len(recs), "auroc": auc, **st}
    return out


def lesion_train_overlap(df_paths, source):
    from ml.eval.leakage_check import overlaps

    seg = pd.read_csv(PROC / "seg" / "labels.csv")
    return overlaps(df_paths, seg[(seg.split == "train") & (seg.source == source)]["id"])


def gate_ablation(recs, pol):
    """E2: same degraded images, triage with the quality gate vs with quality forced 'adequate'."""
    on, off, y = [], [], []
    for r in recs:
        if "triage" not in r or not (0 <= r["grade"] <= 4):
            continue
        y.append(r["grade"])
        on.append(r["triage"]["outcome"])
        les = {"summary": r["lesions"]["summary"]}
        off.append(P.triage_image({"category": "adequate", "reasons": []}, r["grading"], r["uncertainty"], les, pol)["outcome"])
    y, on, off = np.array(y), np.array(on), np.array(off)
    ref = y >= 2

    def s(o):
        return {"referable_routed_routine": int(((o == "ROUTINE") & ref).sum()), "referable_total": int(ref.sum()),
                "routine_rate": float((o == "ROUTINE").mean()), "retake_rate": float((o == "RETAKE").mean()),
                "human_review_rate": float((o == "HUMAN_REVIEW").mean()), "referral_rate": float((o == "REFER").mean()),
                "wrong_auto_decisions": int((((o == "ROUTINE") & ref) | ((o == "REFER") & ~ref)).sum())}

    return {"n": int(len(y)), "with_quality_gate": s(on), "without_quality_gate": s(off)}


def deepdrid_encounters(recs, pol):
    """E7 (single vs dual view) and E9 (patient level) on DeepDRiD val. Eye and view come from file names (p_l1 ...)."""
    rows = []
    for r in recs:
        if "triage" not in r:
            continue
        pid, tag = r["id"].split("_")
        rows.append({**r, "pid": pid, "eye": "OS" if tag[0] == "l" else "OD", "view": int(tag[1])})
    df = pd.DataFrame(rows)
    res = {}
    for mode, views in [("single_view", [1]), ("dual_view", [1, 2])]:
        eye_y, eye_o, pat = [], [], []
        for pid, g in df.groupby("pid"):
            imgs = []
            for _, r in g[g.view.isin(views)].iterrows():
                imgs.append({"eye": r.eye, "triage": r.triage, "macular_risk": r.macular_risk,
                             "laterality": {**r.landmarks["laterality"], "selected": r.eye}})
            for eye, ge in g[g.view.isin(views)].groupby("eye"):
                outs = [t["outcome"] for t in ge.triage]
                o = "REFER" if "REFER" in outs else "HUMAN_REVIEW" if "HUMAN_REVIEW" in outs else "ROUTINE" if "ROUTINE" in outs else "RETAKE"
                eye_y.append(int(ge.grade.max())); eye_o.append(o)
            for va_mode, va in [("va_not_recorded", None), ("va_assumed_normal", {"OD": {"value": "6/6"}, "OS": {"value": "6/6"}})]:
                e = P.triage_encounter(imgs, va, pol)
                pat.append({"va": va_mode, "y": int(g.grade.max()), "o": e["outcome"]})
        ey, eo = np.array(eye_y), np.array(eye_o)
        er = ey >= 2
        rr = {"eye_level": {"n_eyes": int(len(ey)), "referable_routed_routine": int(((eo == "ROUTINE") & er).sum()),
                            "referable_total": int(er.sum()),
                            "referable_not_routine_rate": float((eo[er] != "ROUTINE").mean()) if er.any() else None,
                            "nonreferable_routine_rate": float((eo[~er] == "ROUTINE").mean()) if (~er).any() else None,
                            "outcomes": {k: int((eo == k).sum()) for k in ["ROUTINE", "REFER", "HUMAN_REVIEW", "RETAKE"]}}}
        for va_mode in ["va_not_recorded", "va_assumed_normal"]:
            ps = [p for p in pat if p["va"] == va_mode]
            py, po = np.array([p["y"] for p in ps]), np.array([p["o"] for p in ps])
            pr = py >= 2
            rr[f"patient_level_{va_mode}"] = {
                "n_patients": int(len(py)), "referable_patients": int(pr.sum()),
                "referable_routed_routine": int(((po == "ROUTINE") & pr).sum()),
                "nonreferable_routine_rate": float((po[~pr] == "ROUTINE").mean()) if (~pr).any() else None,
                "outcomes": {k: int((po == k).sum()) for k in ["ROUTINE", "REFER", "HUMAN_REVIEW", "RETAKE"]}}
        res[mode] = rr
    res["note"] = ("DeepDRiD has no visual-acuity data: 'va_not_recorded' runs the real rule (missing VA -> human review); "
                   "'va_assumed_normal' shows the image-only effect. Eye side and view come from file names.")
    return res


def macular_vs_dme(recs, overlap_ids):
    lab = pd.read_csv(PROC / "idrid" / "labels.csv").set_index("id")
    y, f = [], []
    for r in recs:
        if "macular_risk" not in r or r["id"] in overlap_ids:
            continue
        y.append(int(lab.loc[r["id"], "dme"]) >= 1)
        f.append(bool(r["macular_risk"]["flag"]))
    y, f = np.array(y), np.array(f)
    s, sp, ppv, npv = EV.sens_spec(y.astype(int), f.astype(int))
    return {"n": int(len(y)), "dme_positive": int(y.sum()), "sensitivity": s, "specificity": sp, "ppv": ppv, "npv": npv,
            "note": "IDRiD 'risk of macular edema' grade >= 1 vs the hard-exudate-near-fovea cue. Out-of-fold landmarks; "
                    "images used to train the lesion model excluded. Investigational cue, not a DME diagnosis."}


def fidelity(models, items, k=25):
    """Same images through the ONNX (CPU) path and the GPU path: outcome agreement and max P(referable) difference."""
    gpu = make_pipeline(models)
    cpu = PL.Pipeline(MODELS_OUT)
    agree, dmax = 0, 0.0
    for it in items[:k]:
        rgb = read_rgb(it["path"])
        a, b = run_image(cpu, rgb), run_image(gpu, rgb)
        agree += a["triage"]["outcome"] == b["triage"]["outcome"]
        dmax = max(dmax, abs(a["grading"]["ensemble"]["p_referable"] - b["grading"]["ensemble"]["p_referable"]))
    return {"n": k, "outcome_agreement": agree / k, "max_abs_diff_p_referable": dmax}


# ---------------------------------------------------------------- main
def main():
    seed_all()
    pol = {**P.DEFAULT_POLICY, **json.loads((MODELS_OUT / "policy.json").read_text())}
    D = EV.datasets()
    models = load_gpu_models()
    oofp = RUNS / "landmarks_oof" / "preds.csv"
    oof = {r["id"]: r for r in pd.read_csv(oofp).to_dict("records")} if oofp.exists() else {}
    if not oof:
        print("[app_eval] WARNING: no out-of-fold landmarks; IDRiD landmarks will come from the deployed model", flush=True)

    def items(name, fov):
        df = D[name]
        return [{"id": r["id"], "path": r["path"], "grade": int(r["grade"]), "fov": fov} for _, r in df.iterrows()]

    sets = {"idrid": items("idrid", 50), "ddr": items("ddr", 45), "deepdrid_val": items("deepdrid_val", 45),
            "aptos_test": items("aptos_test", 45)}
    fid = fidelity(models, sets["idrid"])
    print("[app_eval] fidelity", fid, flush=True)
    pl = make_pipeline(models)
    res = {"fidelity_gpu_vs_onnx": fid, "sets": {}, "quality_bands": {},
           "method": "real server pipeline + core.policy on every image; GPU fp32 checkpoints identical to the exported ONNX"}
    for name, its in sets.items():
        recs = run_set(pl, name, its, oof=oof if name == "idrid" else None)
        excl = set()
        if name in ("idrid", "ddr"):
            hit = lesion_train_overlap([i["path"] for i in its], "idrid" if name == "idrid" else "ddr")
            excl = {its[k]["id"] for k in np.where(hit)[0]}
        clean = [r for r in recs if r["id"] not in excl]
        res["sets"][name] = {**triage_stats(clean), "excluded_lesion_train_overlap": len(excl),
                             "landmarks": "out-of-fold" if (name == "idrid" and oof) else "deployed model"}
        res["quality_bands"][name] = by_quality_band(clean)
        if name == "idrid":
            res["macular_risk_vs_dme"] = macular_vs_dme(recs, excl)
        if name == "deepdrid_val":
            res["deepdrid_encounters"] = deepdrid_encounters(recs, pol)
        print(f"[app_eval] {name}: {res['sets'][name]}", flush=True)
    # E2 on degraded copies (severe) of IDRiD + a fixed DDR sample
    ddr_s = [i for i in sets["ddr"] if 0 <= i["grade"] <= 4][::5][:600]
    deg = run_set(pl, "degraded", [{**i, "id": "deg_" + i["id"]} for i in sets["idrid"] + ddr_s], degrade_level=2)
    res["quality_gate_ablation"] = gate_ablation(deg, pol)
    print("[app_eval] gate ablation", res["quality_gate_ablation"], flush=True)
    m = json.loads((MODELS_OUT / "metrics.json").read_text())
    m["app_eval"] = res
    (MODELS_OUT / "metrics.json").write_text(json.dumps(m, indent=2, default=float))
    print("[app_eval] wrote metrics.json -> app_eval", flush=True)


if __name__ == "__main__":
    main()
