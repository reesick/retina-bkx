"""Per-site (per-camera) recalibration, demonstrated on IDRiD.

A clinic with a new camera labels a small local sample once. Here: IDRiD train (413 images) plays that role, and IDRiD
test (103 images, never used) measures the effect. Fitted: per-model temperatures and the referral operating point
(sensitivity >= 0.95 on the site sample). Everything else (models, other thresholds) is unchanged.

Writes server/models/sites/idrid.json and metrics.json["site_calibration"].
The app uses a site profile when started with RETINITRY_SITE=idrid.

    python -m ml.eval.site_calibration     (needs runs/preds/idrid.npz and runs/app_eval/idrid.jsonl)
"""
import json

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from core import policy as P
from ml.common import MODELS_OUT, PROC, RUNS, binary_ece, softmax
from ml.eval import evaluate as EV


def main():
    pol = {**P.DEFAULT_POLICY, **json.loads((MODELS_OUT / "policy.json").read_text())}
    lab = pd.read_csv(PROC / "idrid" / "labels.csv")
    df = EV.datasets()["idrid"].merge(lab[["id", "split"]], on="id")
    d = np.load(RUNS / "preds" / "idrid.npz")
    y = df["grade"].to_numpy()
    tr, te = (df.split == "train").to_numpy(), (df.split == "test").to_numpy()
    Ts = {"cnn": EV.fit_temperature(d["logits_cnn"][tr], y[tr]), "vit": EV.fit_temperature(d["logits_vit"][tr], y[tr])}

    def ens(T, idx):
        return (softmax(d["logits_cnn"][idx], T["cnn"]) + softmax(d["logits_vit"][idx], T["vit"])) / 2

    pe_tr = ens(Ts, tr)[:, 2:].sum(1)
    yr_tr = (y[tr] >= 2).astype(int)
    cands = np.unique(np.round(pe_tr, 4))[::-1]
    t_site = float(next(t for t in cands if ((pe_tr >= t) & (yr_tr == 1)).sum() / yr_tr.sum() >= 0.95))
    profile = {"site": "idrid", "temperatures": Ts, "t_refer": t_site,
               "provenance": {"fitted_on": f"IDRiD train split (n={int(tr.sum())}) as the site's local labelled sample",
                              "t_refer": "highest threshold with site-sample sensitivity >= 0.95",
                              "temperatures": "site-sample NLL"}}
    (MODELS_OUT / "sites").mkdir(exist_ok=True)
    (MODELS_OUT / "sites" / "idrid.json").write_text(json.dumps(profile, indent=2))

    yr = (y[te] >= 2).astype(int)
    out = {"profile": profile, "test": {"dataset": f"IDRiD test split (n={int(te.sum())}), never used for fitting"}}
    for name, T, t in [("generic", pol["temperatures"], pol["t_refer"]), ("site_calibrated", Ts, t_site)]:
        pr = ens(T, te)[:, 2:].sum(1)
        s, sp, ppv, npv = EV.sens_spec(yr, (pr >= t).astype(int))
        out["test"][name] = {"auroc": float(roc_auc_score(yr, pr)), "sens": s, "spec": sp, "ppv": ppv, "npv": npv,
                             "ece": binary_ece(pr, yr)[0], "t_refer": t}
    # triage on the same 103 images with the real policy (app_eval records give quality/uncertainty/lesions)
    recs = {}
    p = RUNS / "app_eval" / "idrid.jsonl"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            recs[r["id"]] = r
        te_ids = df.loc[te, "id"].tolist()
        for name, T, t in [("generic", pol["temperatures"], pol["t_refer"]), ("site_calibrated", Ts, t_site)]:
            pe = ens(T, te)
            outs = []
            for k, rid in enumerate(te_ids):
                r = recs.get(rid)
                if not r:
                    continue
                g = {"ensemble": {"probs": pe[k].tolist(), "grade": int(pe[k].argmax()), "p_referable": float(pe[k, 2:].sum())}}
                pc = softmax(d["logits_cnn"][te][k:k + 1], T["cnn"])[0]
                pv = softmax(d["logits_vit"][te][k:k + 1], T["vit"])[0]
                u = {"entropy": float(-(pe[k] * np.log(np.clip(pe[k], 1e-12, 1))).sum()),
                     "disagreement": float(abs(pc[2:].sum() - pv[2:].sum())), "ood_score": r["uncertainty"]["ood_score"]}
                outs.append((int(r["grade"]), P.triage_image(r["quality"], g, u, r["lesions"], {**pol, "t_refer": t})["outcome"]))
            yy = np.array([a for a, _ in outs]); oo = np.array([b for _, b in outs])
            ref = yy >= 2
            out["test"][name]["triage"] = {"n": int(len(oo)), "human_review_rate": float((oo == "HUMAN_REVIEW").mean()),
                                           "routine_rate": float((oo == "ROUTINE").mean()),
                                           "referable_routed_routine": int(((oo == "ROUTINE") & ref).sum()),
                                           "referable_total": int(ref.sum()),
                                           "nonreferable_routine_rate": float((oo[~ref] == "ROUTINE").mean())}
    print("[site]", json.dumps(out["test"], indent=1, default=float), flush=True)
    m = json.loads((MODELS_OUT / "metrics.json").read_text())
    m["site_calibration"] = out
    (MODELS_OUT / "metrics.json").write_text(json.dumps(m, indent=2, default=float))


if __name__ == "__main__":
    main()
