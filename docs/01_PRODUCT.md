# 01 · Product

## Problem

About 101 M Indians have diabetes, roughly 17% of diabetics aged 50+ have DR, only about 10% have ever had a
retinal exam, and there are about 1,700 retina specialists. Grading fundus photos is the bottleneck. Existing AI
tools (LumineticsCore, EyeArt, Medios, MadhuNetrAI) compete on accuracy after years of trials. Retinitry does not
claim better accuracy. It builds the trust layer around a grader: explained rejections, calibrated confidence,
abstention, three separate evidence layers, a coverage map on a 3D eye, clinical safeguards, clinician sign-off,
referral closure and an audit trail. Everything runs offline on one laptop.

HEA-S08 asks for: a public retinal dataset pipeline, a CNN baseline, saliency overlays, calibrated confidence,
poor-quality rejection, a clinician review screen and an evaluation report. Those are the floor.

## Users

| User | Needs |
|---|---|
| Health worker at a PHC | A clear next action (retake / routine / refer / needs review), why a photo failed, fast capture |
| Reviewing ophthalmologist | Only the cases that need them, with evidence laid out, one-gesture sign-off or override |
| Programme lead | Referral completion, overdue cases, audit log, measured model performance |
| Patient / trainee | Understand the result on a 3D eye; learn anatomy and optics in the Eye Lab |

## Outcomes

Every encounter ends in exactly one of four outcomes, plus an urgency for referrals:

| Outcome | Meaning | Colour |
|---|---|---|
| `ROUTINE` | Adequate images, no referral trigger, low doubt. Rescreen in 12 months (clinician confirms) | green `#30D158` |
| `REFER` | Likely grade ≥ 2 or a clinical safeguard fired. Urgency `soon` (3–6 months, grade 2) or `immediate` (grade 3–4) | orange `#FF9F0A`, immediate = red `#FF453A` |
| `HUMAN_REVIEW` | The AI abstains: high uncertainty, model disagreement, out-of-distribution, or suspicious evidence on a poor image | gold `#FFD60A` |
| `RETAKE` | Not enough evidence to reassure: image inadequate with no visible disease, or an eye is missing | blue `#64D2FF` |

## Feature list (all in scope for this build)

P0 (must work end to end):

1. Encounter = patient code + both eyes + views (macula-centred, disc-centred, other). Visual acuity per eye with
   method, date, operator, and an explicit "not measured" state.
2. Quality branch: interpretable checks (focus, illumination, field definition, disc visible, macula visible,
   vessels visible, artefact) with reason codes, plus a learned quality model → adequate / usable / inadequate.
3. Disease branch runs in parallel and always runs: two graders (EfficientNet-B3 CNN, DINOv2 ViT-B/14), temperature
   scaled, ensembled → P(grade 0..4), P(referable = grade ≥ 2).
4. Reliability: predictive entropy, model disagreement, OOD distance (Mahalanobis on CNN features), thresholds
   chosen on validation data with recorded provenance.
5. Evidence: CAM heat-map (CNN), attention map (ViT), lesion candidates (MA, HE, EX, SE) from a U-Net, optic disc
   and fovea landmarks, laterality from disc position (mismatch with the user-selected eye is flagged).
6. Deterministic triage policy (`core/policy.py`) with a human-readable rule trace. Inadequate images can never
   be ROUTINE. Suspicious evidence on inadequate images escalates to HUMAN_REVIEW instead of being discarded.
7. Clinical guardrails: VA worse than 6/12 in either eye → refer flag regardless of the model; missing VA →
   flag the reviewer must acknowledge; macular-risk indicator (hard exudates within 1 disc diameter of the fovea),
   always labelled "macular finding for review, not a DME diagnosis".
8. Clinician review: approve with a hold-to-sign gesture, or override with a reason. Final outcome stored
   separately from the AI outcome.
9. Audit log, hash-chained (each entry stores the SHA-256 of the previous one), verifiable from the UI.
10. PDF screening report.
11. Evaluation report and Evidence dashboard: internal (APTOS) vs external (IDRiD, DDR) sensitivity/specificity
    with 95% bootstrap CIs, AUROC, QWK, ECE before/after calibration, risk–coverage, per-grade, imageability,
    quality evaluation on real labels (DeepDRiD, DDR ungradable), explanation tests.
12. 3D eye: procedural anatomical eye, layers, exploded view, cross-section, fundus + overlays projected onto the
    retina, un-imaged retina grey and labelled, click a lesion in 2D or 3D to select it in both.

P1 (in this build, demo-grade):

13. Referral closure: issued → scheduled → attended → feedback received → follow-up due, with reasons when not
    completed; dashboard of completion rate, median days, overdue.
14. Eye Lab: ray optics through the Le Grand schematic eye with axial-length and accommodation sliders.
15. Determinism receipt: each result carries model hashes, input hash and a result hash; "Replay" re-runs and
    proves the same hash.
16. Bundled demo cases from CC-BY datasets (IDRiD, DDR) with attribution.

Out of scope: diagnosis, OCT, glaucoma/AMD, cloud sync, accounts, RETFound (gated, non-commercial).

## Wording rules (enforced in UI copy)

| Say | Never say |
|---|---|
| "Research prototype. Triage aid, not a diagnosis." (footer on every screen) | "AI doctor", "diagnoses" |
| "Regions influencing the model score" (CAM / attention) | "The AI found the disease here" |
| "Model-predicted lesion candidates" | "Lesions detected" as fact |
| "Macular finding for review. Not a DME diagnosis." | "DME detected / ruled out" |
| "External public-dataset evaluation" | "Clinically validated" |
| "Designed for multi-camera compatibility; generalisability under evaluation" | "Camera-agnostic" |
| "Approximate projection onto a generic eye" (3D) | "Your eye" / patient-specific |
| "Clinician makes the final decision" | "Automatically decides" |

No performance number appears in the UI unless it is read from `models/metrics.json`, which is produced by
`ml/eval`.
