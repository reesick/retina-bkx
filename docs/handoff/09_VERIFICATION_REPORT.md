# 09 · Verification report (03 Nov 2026)

Everything below was **run**, not read off the docs. Server used: a fresh isolated data folder
(`RETINITRY_DATA=D:\rt_audit_data`), real models.

## 1. What was run and the result

| Check | Command | Result |
|---|---|---|
| Repo matches GitHub, nothing uncommitted | `git fetch; git status` | `main` = `origin/main`, clean |
| Model files match the shipped parts (SHA-256) | `python scripts/models.py verify` | all 5 verified |
| Backend tests | `pytest server/tests -q` | 11 passed |
| ONNX export parity + pipeline determinism | `python -m ml.export.selftest` | wrapper Δ = 0, deterministic, OK |
| Front-end types + unit tests | `npm run typecheck`, `npm run test` | clean, 14 passed |
| Built web app is newer than every source file | file timestamps | yes (dist 22:43, newest source 22:35) |
| End-to-end with real models | `python scripts/e2e.py` | 28/28 pass |
| Browser QA (crashes, blocked clicks, contrast, leaks, error boundary, GPU context loss) | `node web/qa/ui_qa.mjs` | 0 failures; ≤ 1 live 3D canvas per page; 0 real context losses |
| Every number quoted in README / handoff equals metrics.json | `python scripts/verify_claims.py` | all claims match |
| Safety features on the live server | `python scripts/verify_features.py` | 27/27 pass (below) |
| Fresh clone → one-click start (done earlier the same day) | clone + `START_RETINITRY.bat` | installed, rebuilt models, 28/28 e2e |

`verify_features.py` checked live:
- **Guardrails:** swapping left and right raises the laterality-mismatch flag; a missing eye and missing VA are flagged and never
  routine.
- **Quality gate:** the unusable photo comes out inadequate with 6 reason codes; all 9 quality checks report value and threshold;
  an inadequate image is never ROUTINE; the rule trace is present.
- **Evidence and outputs:**
  - all 7 overlays are served as PNG;
  - two graders plus the ensemble, with calibration temperatures;
  - uncertainty values with thresholds;
  - landmarks with the disc diameter;
  - lesion candidates;
  - the macular wording "Not a DME diagnosis";
  - model versions and the result hash;
  - urgency on referrals.
- **Server-side records:** referral stats, threshold provenance, the client-log endpoint.
- **Offline:** the built web app references no external hosts. The only URL found was a documentation link inside a
  react-three-fiber error message, which is never fetched.

## 2. Problems found by this audit (now disclosed)

| # | Finding | Effect | Status |
|---|---|---|---|
| A | **Image overlap between lesion training and grading tests.** IDRiD's sub-datasets reuse photos under different file names: 45 of the 54 IDRiD lesion-training images are also among IDRiD's 516 grading images. In DDR, 63 grading-test images also appear in DDR lesion training | Grader AUROC, sensitivity and specificity are **not** affected (graders never saw IDRiD; lesion masks are not grader inputs). Only the triage simulation, which uses lesion rules, could be affected | Measured with `python -m ml.eval.leakage_check` (stored in `metrics.json → leakage_check`). With the overlapping images removed: IDRiD 1/241 referable eyes cleared as ROUTINE (full set 3/286), human review 69.4% (69.6%); DDR 64/1,653 (66/1,690), human review 42.4% (42.5%). **The leak does not inflate the results** |
| B | **The landmark model was trained on 413 of the 516 IDRiD grading images** | The landmark model feeds disc/macula-visible checks, laterality and macular risk in the live app | The evaluation's triage simulation does **not** use landmarks (see C), so the reported numbers are not affected; live-app behaviour on IDRiD images is slightly optimistic for those checks |
| C | **The evaluation simulation is not identical to the live app.** `ml/eval/evaluate.py` runs the quality rules without landmark checks (no DISC_NOT_VISIBLE / MACULA_NOT_VISIBLE) and evaluates single images (no VA, missing-eye, macular-risk or laterality guardrails) | The live app can route somewhat more cases to HUMAN_REVIEW than the reported rates | Disclosed. Fix in 07: compute landmarks in the evaluation and add an encounter-level evaluation |
| D | **Temperature scaling barely helps on external cameras.** ECE: IDRiD 0.099 → 0.090, DDR 0.081 → 0.082 (slightly worse), DeepDRiD 0.066 → 0.053 | Displayed probabilities on new cameras are only roughly calibrated | Disclosed; per-camera calibration in 07 |

## 3. Original requirements not done (re-checked against the source documents)

| Requirement (source) | Status |
|---|---|
| Per-quality-band breakdown of results (4-day plan, Day 4) | Not done |
| E2: performance with vs without the quality gate on degraded images (4-day plan) | Not done |
| Failure-case gallery (4-day plan, Day 4) | Not done (Evidence has a demo-case gallery, not a curated failure gallery) |
| Grad-CAM vs lesion-mask IoU (4-day plan E4) | Partial: pointing game done, IoU not computed |
| INT8 quantisation (4-day plan) | Not done (latency is already 4.5 s) |
| Explanation stability and runtime (expanded findings) | Not done |
| E7 dual-view, E9 patient-level, E10 guardrail impact, repeat-image success rate (expanded findings) | Not done |
| RETFound comparison (optional), Messidor-2 (future work) | Not done |
| Ophthalmologist review of referral rule and wording (both plans) | Not done; must happen before any real use |

Everything else in the HEA-S08 brief, the 4-day plan's "never cut" list (quality gate, abstention, external test on IDRiD,
clinician override) and the expanded findings' P0 list is present and was verified above.
