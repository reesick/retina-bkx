"""Print v1 (APTOS-only) vs current metrics side by side.   python -m ml.eval.compare"""
import json

from ml.common import MODELS_OUT


def main():
    m = json.load(open(MODELS_OUT / "metrics.json"))
    v1 = json.load(open(MODELS_OUT / "v1_aptos_only" / "metrics.json"))
    print(f"{'dataset':13s} {'AUROC v1->v2':>14s} {'sens v1->v2':>13s} {'spec v1->v2':>13s} {'missed referable (ROUTINE) v1 -> v2':>38s}")
    for d in ["aptos_test", "idrid", "ddr", "deepdrid_val"]:
        a, b = v1["models"]["ensemble"][d], m["models"]["ensemble"][d]
        t1, t2 = v1["triage"][d], m["triage"][d]
        print(f"{d:13s} {a['auroc']:.3f}->{b['auroc']:.3f}   {a['sens']:.2f}->{b['sens']:.2f}     {a['spec']:.2f}->{b['spec']:.2f}"
              f"     {t1['referable_routed_routine']:>4d}/{t1['referable_total']} -> {t2['referable_routed_routine']}/{t2['referable_total']}"
              f"   | v2 routine {t2['routine_rate']:.2f} refer {t2['referral_rate']:.2f} review {t2['human_review_rate']:.2f} retake {t2['retake_rate']:.2f}")
    for k in ["deepdrid_val"]:
        q1, q2 = v1["quality"][k], m["quality"][k]
        print(f"quality {k}: good photos rejected {q1['good_rejected_rate']:.2f} -> {q2['good_rejected_rate']:.2f}; "
              f"poor flagged {q1['poor_flagged_rate']:.2f} -> {q2['poor_flagged_rate']:.2f}")
    print("DDR ungradable never routine:", m["quality"]["ddr_ungradable"])


if __name__ == "__main__":
    main()
