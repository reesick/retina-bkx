# 10 · Clinical review packet (for an ophthalmologist)

**Purpose.** Retinitry encodes clinical choices that no ophthalmologist has reviewed yet. This packet lists each one,
with the current value, where it comes from, and a question to answer. It should take about 30–45 minutes.
Please mark each row **Agree / Change to … / Not sure**. Any change is a one-line edit (file given) followed by re-running
the evaluation.

Retinitry is a research prototype for DR screening triage on colour fundus photos, offline on a laptop. It recommends
ROUTINE / REFER (soon or immediate) / HUMAN REVIEW / RETAKE, and a clinician signs off every case.

## A. Referral definitions

| # | Current choice | Source | Question | File |
|---|---|---|---|---|
| A1 | "Referable" = ICDR grade ≥ 2 (moderate NPDR or worse) | ADA 2026 Standards; AIOS/VRSI 2021 consensus | Agree for a PHC screening context? | `core/policy.py` (R4), evaluation scripts |
| A2 | Urgency **immediate** if P(grade ≥ 3) ≥ 0.5 or estimated grade ≥ 3; otherwise **soon (3–6 months)** | AIOS/VRSI consensus pathways | Agree with the mapping and the wording "3–6 months"? Note the model separates grade 3 poorly (recall 0.34–0.66) | `core/policy.py` `t_severe` |
| A3 | Routine = rescreen in about 12 months, clinician confirms | AIOS/VRSI | Agree? | UI copy `web/src/lib/copy.ts` |
| A4 | Operating point chosen for validation sensitivity ≥ 0.95. On IDRiD this gives sensitivity 0.84 / specificity 0.80, and 70% of cases go to human review | Design choice: sensitivity first | Is this trade-off acceptable, or should specificity be traded back? | `ml/eval/evaluate.py` `SENS_TARGET` |

## B. Clinical safeguards (independent of the AI)

| # | Current choice | Source | Question | File |
|---|---|---|---|---|
| B1 | Visual acuity worse than **6/12** in either eye → REFER regardless of photos | India operational DR guidelines 2020 | Agree with 6/12? Should pinhole or best-corrected acuity be required? | `core/policy.py` `va_refer_logmar` |
| B2 | VA "not measured" → case cannot be ROUTINE; reviewer must acknowledge | Same | Agree? | `core/policy.py` G1 |
| B3 | Low-vision codes mapped to logMAR: CF 1.9, HM 2.3, PL 2.7, NPL 3.0 | Common conventions | Agree? | `core/policy.py` `_LOW` |
| B4 | **Macular-risk cue**: a hard-exudate candidate within 1 disc diameter of the fovea → HUMAN REVIEW, labelled "Macular finding for review. Not a DME diagnosis." | Expanded research findings; IDRiD DME criteria use exudates near the macula | Agree with 1 DD? With the wording? Should it refer rather than review? | `core/policy.py` `macular_radius_dd` |
| B5 | Both eyes required; a missing eye counts as RETAKE | Programme practice | Agree, or allow a single-eye encounter (e.g. an eye with no view of the fundus)? | `core/policy.py` `require_both_eyes` |
| B6 | Left/right mismatch (from optic-disc side, confidence ≥ 0.8) → HUMAN REVIEW | Data-integrity check | Agree? | `core/policy.py` G3 |

## C. Image quality

| # | Current choice | Question |
|---|---|---|
| C1 | A photo is **inadequate** if focus, brightness or field coverage fail hard limits, it doesn't look like a fundus photo, or the quality model's P(inadequate) ≥ 0.78 | Are these the right reasons to ask for a retake? |
| C2 | An inadequate photo is **never ROUTINE**. If it still shows referable signs it goes to HUMAN REVIEW, otherwise RETAKE | Agree (follows NHS DES 2026 guidance)? |
| C3 | A "usable with limitations" photo with P(referable) ≥ 0.25 goes to HUMAN REVIEW | Agree with 0.25? |

## D. Wording on screen

Please check these exact phrases (from `web/src/lib/copy.ts` and the pages):
- "Research prototype · triage aid, not a diagnosis · runs offline"
- "Regions influencing the model score" (heat-maps)
- "Model-predicted lesion candidates"
- "Macular finding for review. Not a DME diagnosis."
- "Approximate projection onto a generic eye. Not a scan of this patient."
- Outcome words: "ROUTINE.", "REFER.", "NEEDS A HUMAN.", "RETAKE."

## E. Case review (most useful)

Open the app (`START_RETINITRY.bat`) and review:
1. The six bundled demo cases (Today → Try a demo case).
2. The failure gallery on the Evidence page: real IDRiD cases where Retinitry was wrong.

For each case, record whether you agree with the outcome and the urgency, and whether the evidence shown would help you.
A simple sheet:

| Case | Retinitry outcome | Your outcome | Urgency agree? | Evidence helpful? (1–5) | Comment |
|---|---|---|---|---|---|

## F. Out of scope (please confirm)

Retinitry does not assess DME from OCT, glaucoma, cataract or AMD, and it is not intended for diagnosis or treatment decisions.
