"""Calibration, OOD, threshold selection and the full evaluation report.

Steps (each cached in runs/preds):
 1. Predict both graders (+ CNN features, CAM) on APTOS train/val/test, IDRiD (all 516), DDR test.
 2. Temperature scaling per grader on APTOS val (NLL).
 3. OOD: PCA(64) + Mahalanobis on CNN features of APTOS train; threshold = 99th percentile on APTOS val.
 4. Operating point t_refer on APTOS val: highest threshold with sensitivity >= 0.90.
    Abstention: t_disagreement = 95th pct on val; t_entropy = smallest value such that accepted val cases
    reach sensitivity >= 0.95 with abstention <= 20%.
 5. Quality model + rules on every evaluation image; lesion model on val (suspicious-evidence thresholds) and
    on the evaluation sets; full image-level triage simulation with core.policy.
 6. Metrics with bootstrap CIs -> server/models/metrics.json; thresholds -> server/models/policy.json.

    python -m ml.eval.evaluate
"""
from __future__ import annotations

import datetime as dt
import subprocess
import time

import cv2
import numpy as np
import pandas as pd
import torch
from scipy.optimize import minimize_scalar
from sklearn.decomposition import PCA
from sklearn.metrics import confusion_matrix, roc_auc_score, roc_curve

from core import policy as P
from core.fundus import fundus_mask
from core.quality import combine, compute_features, run_checks
from ml.common import (MODELS_OUT, PROC, RUNS, SPLITS, binary_ece, bootstrap_ci, ece, ensure_imagenet_tensor, entropy,
                       load_json, qwk, read_rgb, save_json, seed_all, softmax)

DEV = torch.device("cuda")
PRED = RUNS / "preds"
LES = ["MA", "HE", "EX", "SE"]


# ------------------------------------------------------------------ datasets
def datasets() -> dict[str, pd.DataFrame]:
    a = pd.read_csv(SPLITS / "aptos.csv")
    out = {f"aptos_{s}": a[a.split == s][["id", "grade", "path"]].reset_index(drop=True) for s in ["train", "val", "test"]}
    i = pd.read_csv(PROC / "idrid" / "labels.csv")
    i["path"] = [str(PROC / "idrid" / "img" / f"{x}.jpg") for x in i["id"]]
    out["idrid"] = i[["id", "grade", "path"]]
    if (PROC / "ddr" / "labels.csv").exists():
        d = pd.read_csv(PROC / "ddr" / "labels.csv")
        d["path"] = [str(PROC / "ddr" / "img" / f"{x}.jpg") for x in d["id"]]
        out["ddr"] = d[["id", "grade", "path"]]  # grade 5 = ungradable
    if (PROC / "deepdrid" / "labels.csv").exists():
        q = pd.read_csv(PROC / "deepdrid" / "labels.csv")
        q["path"] = [str(PROC / "deepdrid" / "img" / f"{x}.jpg") for x in q["id"]]
        q = q[q.split == "val"].reset_index(drop=True)
        q["grade"] = pd.to_numeric(q["grade"], errors="coerce").fillna(-1).astype(int)
        out["deepdrid_val"] = q[["id", "grade", "path", "overall_quality"]]
    return out


# ------------------------------------------------------------------ model runners
def load_models():
    from ml.export.to_onnx import CnnWrap, VitWrap
    from ml.train.grader import build_model
    from ml.train.lesions import build_model as build_les
    from ml.train.quality import build_model as build_q

    cnn = build_model("cnn", pretrained=False)
    cnn.load_state_dict(torch.load(RUNS / "grader_cnn" / "best.pt", map_location="cpu")["state_dict"])
    vit = build_model("vit", pretrained=False)
    vit.load_state_dict(torch.load(RUNS / "grader_vit" / "best.pt", map_location="cpu")["state_dict"])
    q = build_q(pretrained=False)
    q.load_state_dict(torch.load(RUNS / "quality" / "best.pt", map_location="cpu")["state_dict"])
    lck = torch.load(RUNS / "lesions" / "best.pt", map_location="cpu")
    les = build_les(pretrained=False)
    les.load_state_dict(lck["state_dict"])
    return {"cnn": CnnWrap(cnn).to(DEV).eval(), "vit": VitWrap(vit).to(DEV).eval(), "quality": q.to(DEV).eval(),
            "lesions": les.to(DEV).eval(), "les_thr": lck["thresholds"]}


def _x(img, size):
    if img.shape[0] != size:
        img = cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)
    return ensure_imagenet_tensor(img)[None].to(DEV)


@torch.no_grad()
def predict_set(name: str, df: pd.DataFrame, M: dict, with_lesions: bool) -> dict:
    cache = PRED / f"{name}.npz"
    if cache.exists():
        d = dict(np.load(cache, allow_pickle=True))
        if not with_lesions or "les_area" in d:
            return d
    PRED.mkdir(parents=True, exist_ok=True)
    lc, lv, fc, qp, qf, la, ln = [], [], [], [], [], [], []
    t0 = time.time()
    for k, p in enumerate(df["path"]):
        img = read_rgb(p)
        with torch.autocast("cuda", dtype=torch.float16):
            l1, f1, _ = M["cnn"](_x(img, 512))
            l2, _, _ = M["vit"](_x(img, 448))
            q = M["quality"](_x(img, 384))
        lc.append(l1.float().cpu().numpy()[0]); lv.append(l2.float().cpu().numpy()[0])
        fc.append(f1.float().cpu().numpy()[0]); qp.append(torch.softmax(q.float(), 1).cpu().numpy()[0])
        qf.append(compute_features(img, fundus_mask(img)))
        if with_lesions:
            with torch.autocast("cuda", dtype=torch.float16):
                pr = torch.sigmoid(M["lesions"](_x(img, 1024)).float())[0].cpu().numpy()
            mask = cv2.resize(fundus_mask(img), (1024, 1024), interpolation=cv2.INTER_NEAREST) > 0
            area = mask.sum() + 1e-6
            areas, counts = [], []
            for c, n in enumerate(LES):
                b = ((pr[c] >= M["les_thr"][n]) & mask).astype(np.uint8)
                areas.append(b.sum() / area)
                ncc, _, st, _ = cv2.connectedComponentsWithStats(b, 8)
                counts.append(int((st[1:, cv2.CC_STAT_AREA] >= 4).sum()) if ncc > 1 else 0)
            la.append(areas); ln.append(counts)
        if k % 200 == 0:
            print(f"[eval] {name} {k}/{len(df)} ({time.time() - t0:.0f}s)", flush=True)
    d = {"logits_cnn": np.array(lc), "logits_vit": np.array(lv), "feat_cnn": np.array(fc, np.float32),
         "quality_probs": np.array(qp), "quality_feats": np.array(pd.DataFrame(qf).to_dict("records"), dtype=object)}
    if with_lesions:
        d["les_area"], d["les_count"] = np.array(la), np.array(ln)
    np.savez(cache, **d)
    return d


# ------------------------------------------------------------------ fitting
def fit_temperature(logits: np.ndarray, y: np.ndarray) -> float:
    def nll(t):
        p = softmax(logits, t)
        return -np.log(p[np.arange(len(y)), y] + 1e-12).mean()

    return float(minimize_scalar(nll, bounds=(0.3, 5.0), method="bounded").x)


class OOD:
    def __init__(self, feats: np.ndarray, k: int = 64):
        self.pca = PCA(k, random_state=42).fit(feats)
        z = self.pca.transform(feats)
        self.mu = z.mean(0)
        cov = np.cov(z, rowvar=False) + 1e-3 * np.eye(k)
        self.prec = np.linalg.inv(cov)

    def score(self, feats: np.ndarray) -> np.ndarray:
        z = self.pca.transform(feats) - self.mu
        return np.sqrt(np.einsum("ij,jk,ik->i", z, self.prec, z))

    def save(self, path):
        np.savez(path, mean=self.pca.mean_.astype(np.float32), components=self.pca.components_.astype(np.float32),
                 mu=self.mu.astype(np.float32), prec=self.prec.astype(np.float32))


def ens_probs(d: dict, T: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    pc = softmax(d["logits_cnn"], T["cnn"])
    pv = softmax(d["logits_vit"], T["vit"])
    return pc, pv, (pc + pv) / 2


def sens_spec(y, yhat):
    tp = ((y == 1) & (yhat == 1)).sum(); fn = ((y == 1) & (yhat == 0)).sum()
    tn = ((y == 0) & (yhat == 0)).sum(); fp = ((y == 0) & (yhat == 1)).sum()
    sens = tp / (tp + fn) if tp + fn else np.nan
    spec = tn / (tn + fp) if tn + fp else np.nan
    ppv = tp / (tp + fp) if tp + fp else np.nan
    npv = tn / (tn + fn) if tn + fn else np.nan
    return float(sens), float(spec), float(ppv), float(npv)


def grade_metrics(probs: np.ndarray, probs_uncal: np.ndarray, y: np.ndarray, t_ref: float) -> dict:
    pref = probs[:, 2:].sum(1)
    yr = (y >= 2).astype(int)
    yhat = (pref >= t_ref).astype(int)
    sens, spec, ppv, npv = sens_spec(yr, yhat)
    fpr, tpr, _ = roc_curve(yr, pref)
    keep = np.linspace(0, len(fpr) - 1, min(len(fpr), 100)).astype(int)
    e_after, rel = binary_ece(pref, yr)
    e_before, _ = binary_ece(probs_uncal[:, 2:].sum(1), yr)
    cm = confusion_matrix(y, probs.argmax(1), labels=list(range(5)))
    per = (np.diag(cm) / np.maximum(cm.sum(1), 1)).tolist()
    auc_fn = lambda a, b: roc_auc_score(a, b) if len(np.unique(a)) == 2 else None
    return {
        "n": int(len(y)), "prevalence": float(yr.mean()),
        "auroc": float(roc_auc_score(yr, pref)), "auroc_ci": bootstrap_ci(auc_fn, yr, pref, n=500),
        "sens": sens, "sens_ci": bootstrap_ci(lambda a, b: sens_spec(a, b)[0], yr, yhat),
        "spec": spec, "spec_ci": bootstrap_ci(lambda a, b: sens_spec(a, b)[1], yr, yhat),
        "ppv": ppv, "npv": npv, "qwk": qwk(y, probs.argmax(1)),
        "ece_before": e_before, "ece_after": e_after,
        "brier": float(((pref - yr) ** 2).mean()),
        "per_grade_recall": [float(x) for x in per], "confusion": cm.tolist(),
        "reliability": rel, "roc": {"fpr": fpr[keep].tolist(), "tpr": tpr[keep].tolist()},
    }


# ------------------------------------------------------------------ triage simulation
def simulate(d: dict, probs: np.ndarray, pc: np.ndarray, pv: np.ndarray, ood: np.ndarray, pol: dict, rules: dict) -> list[dict]:
    outs = []
    for i in range(len(probs)):
        f = d["quality_feats"][i]
        checks = run_checks(f, None, rules)
        q = combine(checks, d["quality_probs"][i].tolist())
        les = None
        if "les_area" in d:
            les = {"summary": {n: {"area_frac": float(d["les_area"][i][c]), "count": int(d["les_count"][i][c])}
                               for c, n in enumerate(LES)}}
        g = {"ensemble": {"probs": probs[i].tolist(), "grade": int(probs[i].argmax()), "p_referable": float(probs[i, 2:].sum())}}
        u = {"entropy": float(entropy(probs[i:i + 1])[0]), "disagreement": float(abs(pc[i, 2:].sum() - pv[i, 2:].sum())),
             "ood_score": float(ood[i])}
        outs.append({**P.triage_image(q, g, u, les, pol), "quality": q["category"]})
    return outs


def triage_metrics(outs: list[dict], y: np.ndarray, probs: np.ndarray) -> dict:
    o = np.array([x["outcome"] for x in outs])
    gradable = y <= 4
    yr = (y >= 2) & gradable
    auto = np.isin(o, [P.ROUTINE, P.REFER]) & gradable
    cov = float(auto.sum() / max(gradable.sum(), 1))
    s, sp, _, _ = sens_spec(yr[auto].astype(int), (o[auto] == P.REFER).astype(int)) if auto.any() else (np.nan,) * 4
    # risk-coverage by ranking on ensemble uncertainty
    ent = entropy(probs)
    pref = probs[:, 2:].sum(1)
    order = np.argsort(ent[gradable])
    err = ((pref[gradable] >= 0.5) != yr[gradable])[order]
    covs = np.linspace(0.05, 1, 20)
    risk = [float(err[: max(1, int(c * len(err)))].mean()) for c in covs]
    # safety: referable cases that ended ROUTINE
    missed = int(((o == P.ROUTINE) & yr).sum())
    return {"n": int(len(o)), "coverage": cov, "auto_sens": s, "auto_spec": sp,
            "referral_rate": float((o == P.REFER).mean()), "human_review_rate": float((o == P.HUMAN_REVIEW).mean()),
            "retake_rate": float((o == P.RETAKE).mean()), "routine_rate": float((o == P.ROUTINE).mean()),
            "referable_routed_routine": missed, "referable_total": int(yr.sum()),
            "risk_coverage": {"coverage": covs.tolist(), "risk": risk},
            "ungradable_n": int((~gradable).sum()),
            "ungradable_not_routine_rate": float((o[~gradable] != P.ROUTINE).mean()) if (~gradable).any() else None,
            "ungradable_retake_rate": float((o[~gradable] == P.RETAKE).mean()) if (~gradable).any() else None}


# ------------------------------------------------------------------ main
def main():
    seed_all()
    D = datasets()
    M = load_models()
    preds = {}
    for n, df in D.items():
        preds[n] = predict_set(n, df, M, with_lesions=(n != "aptos_train"))
    yv = D["aptos_val"]["grade"].to_numpy()
    T = {"cnn": fit_temperature(preds["aptos_val"]["logits_cnn"], yv),
         "vit": fit_temperature(preds["aptos_val"]["logits_vit"], yv)}
    print("[eval] temperatures", T)
    ood = OOD(preds["aptos_train"]["feat_cnn"])
    ood.save(MODELS_OUT / "ood.npz")
    s_val = ood.score(preds["aptos_val"]["feat_cnn"])
    t_ood = float(np.percentile(s_val, 99))

    pc, pv, pe = ens_probs(preds["aptos_val"], T)
    pref = pe[:, 2:].sum(1)
    yr = (yv >= 2).astype(int)
    cands = np.unique(np.round(pref, 4))[::-1]
    t_ref = float(next(t for t in cands if ((pref >= t) & (yr == 1)).sum() / yr.sum() >= 0.90))
    dis = np.abs(pc[:, 2:].sum(1) - pv[:, 2:].sum(1))
    t_dis = float(np.percentile(dis, 95))
    ent = entropy(pe)
    t_ent = float(np.percentile(ent, 80))
    for t in np.sort(ent)[::-1]:
        acc = (ent <= t) & (dis <= t_dis)
        if acc.mean() < 0.80:
            break
        s, _, _, _ = sens_spec(yr[acc], (pref[acc] >= t_ref).astype(int))
        if s >= 0.95:
            t_ent = float(t)
    la = preds["aptos_val"]["les_area"]
    lc = preds["aptos_val"]["les_count"]
    nonref = yv <= 1
    les_cfg = {"HE_area_frac": float(max(np.percentile(la[nonref, 1], 97), 1e-4)),
               "EX_area_frac": float(max(np.percentile(la[nonref, 2], 97), 1e-4)),
               "HE_count": int(max(np.percentile(lc[nonref, 1], 97), 1) + 1)}
    pol = {**P.DEFAULT_POLICY, "version": dt.datetime.utcnow().strftime("fit-%Y%m%d-%H%M"),
           "t_refer": t_ref, "t_entropy": t_ent, "t_disagreement": t_dis, "t_ood": t_ood,
           "lesion_suspicious": les_cfg, "temperatures": T,
           "provenance": {
               "fitted_on": f"APTOS 2019 validation split (n={len(yv)}, image-level split, seed 42)",
               "t_refer": "highest P(referable) threshold with validation sensitivity >= 0.90",
               "t_entropy": "smallest entropy cut-off where accepted validation cases reach sensitivity >= 0.95 with abstention <= 20%",
               "t_disagreement": "95th percentile of |P_ref(CNN) - P_ref(ViT)| on validation",
               "t_ood": "99th percentile of Mahalanobis distance (PCA-64 of CNN features) on validation",
               "lesion_suspicious": "97th percentile of lesion-candidate area/count among validation grade 0-1 images",
               "temperatures": "temperature scaling per grader, minimising validation NLL",
               "never_used": "IDRiD and DDR are not used for any fitting or threshold"}}
    save_json(MODELS_OUT / "policy.json", pol)
    print("[eval] policy", {k: pol[k] for k in ["t_refer", "t_entropy", "t_disagreement", "t_ood"]}, les_cfg)

    rules = load_json(MODELS_OUT / "quality_rules.json", {})
    metrics = {"available": True, "generated_at": dt.datetime.utcnow().isoformat() + "Z",
               "git": subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip(),
               "policy_version": pol["version"], "datasets": {}, "models": {"cnn_effb3": {}, "vit_dinov2": {}, "ensemble": {}},
               "triage": {}, "quality": {}, "notes": []}
    names = {"aptos_test": "APTOS 2019 held-out test (internal)", "aptos_val": "APTOS 2019 validation (fitting set)",
             "idrid": "IDRiD, all 516 graded images (external)", "ddr": "DDR test (external)",
             "deepdrid_val": "DeepDRiD validation (external, real quality labels)"}
    for n in ["aptos_val", "aptos_test", "idrid", "ddr", "deepdrid_val"]:
        if n not in preds:
            continue
        d = preds[n]
        y = D[n]["grade"].to_numpy()
        pc, pv, pe = ens_probs(d, T)
        o = ood.score(d["feat_cnn"])
        g = (y >= 0) & (y <= 4)
        metrics["datasets"][n] = {"n": int(g.sum()), "source": names[n]}
        uc = softmax(d["logits_cnn"]); uv = softmax(d["logits_vit"])
        metrics["models"]["cnn_effb3"][n] = grade_metrics(pc[g], uc[g], y[g], t_ref)
        metrics["models"]["vit_dinov2"][n] = grade_metrics(pv[g], uv[g], y[g], t_ref)
        metrics["models"]["ensemble"][n] = grade_metrics(pe[g], (uc[g] + uv[g]) / 2, y[g], t_ref)
        yy = np.where((y < 0) | (y > 4), 5, y)
        metrics["triage"][n] = triage_metrics(simulate(d, pe, pc, pv, o, pol, rules), yy, pe)
        metrics["triage"][n]["ood_flag_rate"] = float((o > t_ood).mean())
        print(f"[eval] {n}: ensemble AUROC {metrics['models']['ensemble'][n]['auroc']:.3f} "
              f"sens {metrics['models']['ensemble'][n]['sens']:.3f} spec {metrics['models']['ensemble'][n]['spec']:.3f} "
              f"coverage {metrics['triage'][n]['coverage']:.3f}", flush=True)
    if "deepdrid_val" in preds:
        d, q = preds["deepdrid_val"], D["deepdrid_val"]["overall_quality"].to_numpy()
        cats = np.array([combine(run_checks(f, None, rules), p.tolist())["category"]
                         for f, p in zip(d["quality_feats"], d["quality_probs"])])
        ok = np.isin(q, [0, 1])
        bad = q[ok] == 0
        pin = d["quality_probs"][ok][:, 2]
        metrics["quality"]["deepdrid_val"] = {
            "n": int(ok.sum()), "n_poor": int(bad.sum()),
            "auroc_inadequate": float(roc_auc_score(bad, pin)) if 0 < bad.sum() < len(bad) else None,
            "poor_flagged_rate": float(np.isin(cats[ok][bad], ["inadequate", "usable"]).mean()) if bad.any() else None,
            "poor_inadequate_rate": float((cats[ok][bad] == "inadequate").mean()) if bad.any() else None,
            "good_adequate_rate": float((cats[ok][~bad] == "adequate").mean()),
            "good_rejected_rate": float((cats[ok][~bad] == "inadequate").mean()),
            "categories": {c: int((cats[ok] == c).sum()) for c in ["adequate", "usable", "inadequate"]}}
    if "ddr" in preds:
        y = D["ddr"]["grade"].to_numpy()
        tri = metrics["triage"]["ddr"]
        metrics["quality"]["ddr_ungradable"] = {"n": int((y == 5).sum()),
                                                "not_routine_rate": tri["ungradable_not_routine_rate"],
                                                "retake_rate": tri["ungradable_retake_rate"]}
    metrics["notes"] = [
        "Research prototype on public datasets; not clinical validation.",
        "APTOS split is image-level (no patient IDs available); IDRiD, DDR and DeepDRiD are external and never used for fitting.",
        "Referable = grade >= 2 (research definition).",
        "Public datasets lack age/sex for most images, so patient subgroup analysis was not possible; results are broken down by dataset (camera/site) instead.",
        "PPV/NPV depend on prevalence and do not transfer to PHC populations.",
        "DDR grade 5 (ungradable) images are excluded from grading metrics and used to test the quality gate.",
    ]
    old = load_json(MODELS_OUT / "metrics.json", {})
    for k in ["lesions", "landmarks", "explanations", "latency_ms"]:
        if k in old:
            metrics[k] = old[k]
    save_json(MODELS_OUT / "metrics.json", metrics)
    print("[eval] wrote metrics.json and policy.json")


if __name__ == "__main__":
    main()
