"""Check that every number quoted in README.md and docs/handoff matches server/models/metrics.json.

    python scripts/verify_claims.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
m = json.loads((ROOT / "server/models/metrics.json").read_text())
pol = json.loads((ROOT / "server/models/policy.json").read_text())
qr = json.loads((ROOT / "server/models/quality_rules.json").read_text())
E, T = m["models"]["ensemble"], m["triage"]
fails = []


def chk(name, actual, claimed, tol=0.006):
    ok = abs(actual - claimed) <= tol
    print(f"{'ok  ' if ok else 'FAIL'} {name}: metrics={actual:.4f} claimed={claimed}")
    if not ok:
        fails.append(name)


claims = {
    "idrid": dict(auroc=0.917, sens=0.84, spec=0.80, missed=(3, 286), n=516),
    "ddr": dict(auroc=0.975, sens=0.79, spec=0.98, missed=(66, 1690), n=3759),
    "deepdrid_val": dict(auroc=0.975, sens=0.96, spec=0.88, missed=(1, 180), n=400),
    "aptos_test": dict(auroc=0.985, sens=0.92, spec=0.94, missed=(0, 223), n=550),
}
for d, c in claims.items():
    chk(f"{d} AUROC", E[d]["auroc"], c["auroc"], 0.0006)
    chk(f"{d} sensitivity", E[d]["sens"], c["sens"])
    chk(f"{d} specificity", E[d]["spec"], c["spec"])
    got = (T[d]["referable_routed_routine"], T[d]["referable_total"])
    print(f"{'ok  ' if got == c['missed'] else 'FAIL'} {d} missed referable: metrics={got} claimed={c['missed']}")
    if got != c["missed"]:
        fails.append(f"{d} missed")
    if E[d]["n"] != c["n"]:
        fails.append(f"{d} n"); print(f"FAIL {d} n {E[d]['n']} vs {c['n']}")
chk("IDRiD human review rate", T["idrid"]["human_review_rate"], 0.70, 0.01)
chk("IDRiD grade-0 recall", E["idrid"]["per_grade_recall"][0], 0.43)
chk("CNN IDRiD AUROC", m["models"]["cnn_effb3"]["idrid"]["auroc"], 0.935, 0.0006)
chk("ViT IDRiD AUROC", m["models"]["vit_dinov2"]["idrid"]["auroc"], 0.887, 0.0006)
q = m["quality"]["deepdrid_val"]
chk("quality good rejected", q["good_rejected_rate"], 0.10, 0.01)
chk("quality AUROC", q["auroc_inadequate"], 0.80, 0.006)
chk("DDR ungradable not routine", m["quality"]["ddr_ungradable"]["not_routine_rate"], 1.0, 0)
for k, v in {"EX": 0.77, "HE": 0.65, "SE": 0.67, "MA": 0.43}.items():
    chk(f"IDRiD Dice {k}", m["lesions"]["idrid_test"]["dice"][k], v)
chk("DDR Dice MA", m["lesions"]["ddr_test"]["dice"]["MA"], 0.24)
chk("disc within 1 DD", m["landmarks"]["idrid_test"]["od_within_1dd"], 1.0, 0)
chk("fovea within 1 DD", m["landmarks"]["idrid_test"]["fovea_within_1dd"], 0.98)
chk("laterality accuracy", m["laterality"]["deepdrid"]["accuracy_if_disc_right_is_OD"], 0.983, 0.001)
chk("pointing CNN", m["explanations"]["pointing_game"]["cnn_cam"], 0.67)
chk("pointing ViT", m["explanations"]["pointing_game"]["vit_attention"], 0.81)
chk("latency p50 s", m["latency_ms"]["p50"] / 1000, 4.47, 0.02)
print(f"{'ok  ' if m['determinism']['verified'] else 'FAIL'} determinism verified")
chk("t_refer", pol["t_refer"], 0.497, 0.001)
chk("quality model cut-off", qr["model_inadequate_threshold"], 0.778, 0.001)
if not m["determinism"]["verified"]:
    fails.append("determinism")
print("\nRESULT:", "ALL CLAIMS MATCH" if not fails else f"{len(fails)} MISMATCH: {fails}")
sys.exit(1 if fails else 0)
