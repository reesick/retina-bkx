# 01 · Status: what is done, what is weak, what is missing

Legend:
- **Verified** means an automated test or a measured number backs it.
- **Built** means the code exists and was seen working in screenshots or manual use, but no automated test checks the behaviour.
- **Partial** means some of it exists.
- **Not done** means it was not built.

## 1. HEA-S08 required deliverables

| Requirement | State | Evidence |
|---|---|---|
| Public retinal dataset pipeline | Verified | `ml/data/fetch.py` (resumable; APTOS, IDRiD, DDR, DeepDRiD), `ml/data/splits.py` |
| CNN baseline | Verified | EfficientNet-B3; IDRiD AUROC 0.935 alone |
| Saliency / Grad-CAM overlays | Verified | CAM baked into the ONNX graph; ViT attention; pointing-game and deletion tests in metrics.json |
| Calibrated confidence | Verified | Temperature scaling per model (T = 1.44 CNN, 1.33 ViT); ECE reported before/after |
| Poor-quality image rejection | Verified | Rule checks + quality model; DeepDRiD real labels: AUROC 0.80, 10% of good photos rejected |
| Clinician review screen | Verified | Approve / override with reason, flags must be acknowledged; backend tests + e2e |
| Evaluation report with sensitivity/specificity and subgroups | Verified (subgroups by dataset/camera only) | Evidence page + metrics.json. Age/sex subgroups impossible: public data lacks them (stated in the report) |

## 2. Features beyond the brief

### Done
| Feature | State | Notes |
|---|---|---|
| Two graders + ensemble (EfficientNet-B3 + DINOv2 ViT-B/14) | Verified | |
| Abstention: entropy, model disagreement, out-of-distribution distance | Verified | Thresholds fitted on validation; provenance shown in Settings |
| Four-outcome deterministic policy with rule trace | Verified | `core/policy.py`; trace shown in the case page |
| Parallel quality + disease branches (bad photo with visible disease is escalated, not discarded) | Verified | Rule R1a; no ungradable DDR photo ever ended ROUTINE |
| Visual acuity per eye; worse than 6/12 refers; "not measured" is flagged, never treated as normal | Verified | Demo case `vision-safeguard`, e2e check |
| Macular-risk indicator (hard exudates within 1 disc diameter of fovea), labelled "not a DME diagnosis" | Verified | |
| Patient → eye → view data model; both eyes required; missing eye flagged | Verified | |
| Laterality check from optic-disc position | Verified | 98.3% correct on DeepDRiD (1,163 decided images) |
| Lesion candidates MA / HE / EX / SE | Verified | Weak for MA, see 03 |
| Optic disc + fovea landmarks | Verified | 100% / 98% within 1 disc diameter on IDRiD test |
| Referral closure workflow (issued → scheduled → attended → feedback → closed / not completed) | Verified | State machine enforced (409 on illegal moves); dashboard stats |
| Hash-chained audit log with verification | Verified | Tamper test in backend tests |
| PDF screening report | Verified | |
| Determinism: same image → same result hash; Replay button | Verified | Measured twice in eval + e2e |
| Offline: no runtime network calls, fonts bundled, no CDN/HDRI | Verified | |
| Explanation tests: pointing game, deletion, weight randomisation | Verified | metrics.json → `explanations` |
| Front-end error logging to `logs/client.log`, error boundaries, WebGL context-loss recovery | Verified | UI QA harness scenarios |
| Automated browser QA harness | Verified | `web/qa/ui_qa.mjs` → 0 failures on last run |

### Built, not automatically verified
| Feature | Why it is only "built" |
|---|---|
| 3D procedural eye (layers, exploded view, cross-section, fly-through) | Seen in screenshots; no test asserts geometry or interactions beyond "no crash" |
| Fundus/heat-map/lesion projection onto the 3D retina + "not imaged" grey region | Projection maths has a unit test (`projection.test.ts`); the visual placement was checked by eye only |
| Click a lesion in 2D or 3D to select it in both | Manual only |
| Eye Lab: anatomy hover labels, optics ray tracer, DR-stage illustration, coverage comparison | Ray tracer is unit-tested (focus within 0.2 mm); the scenes are visual only |
| Analysis "theatre" animation, sounds, hold-to-sign, odometer, glass tab bar | Visual only |
| 60 fps target | **Not measured on a real GPU.** QA runs in software WebGL (SwiftShader) |
| Mock mode (`npm run dev:mock`) | Builds; its TypeScript copy of the policy (`web/src/api/mockPolicy.ts`) can drift from `core/policy.py` |

### Partial
| Item | What exists | What is missing |
|---|---|---|
| Image-set (multi-view) support | Data model, upload of macula/disc/other views, per-eye combination | No model uses two views together; no dual-view experiment (E7) |
| Patient-level evaluation | Encounter policy combines eyes | No patient-level sensitivity/specificity reported (E9) |
| Quality reason codes | 7 rule checks + model; per-check gauges in UI | Field-position check is crude (fundus area only); no real "field definition" or "artifact" model |
| Calibration across cameras | Temperature scaling on multi-source validation | IDRiD ECE still 0.09 after scaling (camera shift) |
| Linux start script | `scripts/start.sh` written | Never run on Linux |

### Not done
| Item | Reason |
|---|---|
| RETFound comparison | Gated access and non-commercial licence; marked optional in the plan |
| Explanation stability test (small brightness changes) | Time |
| Retake success rate | Needs real retake data |
| INT8 quantisation | Latency (about 4.5 s/image) was already within the 5 s target |
| Multi-user accounts, roles, login | Out of scope for the prototype; there is a free-text reviewer name only |
| Encryption at rest, DPDP Act compliance, data retention | Out of scope; see 06 risks |
| Docker bundle, PostgreSQL, sync, FHIR / ABDM export | Scale-up stages in the plan, not this build |
| Ophthalmologist review of referral wording and thresholds | Nobody available; **must happen before any real use** |

## 3. Known weaknesses (measured)

1. **Over-referral on the fully external set (IDRiD).** Specificity 0.80 at the operating point, and 70% of IDRiD encounters go to
   HUMAN_REVIEW. On grade-0 IDRiD images the ensemble's recall is only 0.43 (it often calls healthy IDRiD eyes grade 1–2).
   This is the price of the sensitivity-first operating point (validation sensitivity ≥ 0.95) and of camera shift.
2. **Missed referable eyes still exist.** 3/286 on IDRiD, 66/1,690 on DDR test, 1/180 on DeepDRiD val, 0/223 on APTOS test were
   auto-cleared as ROUTINE.
3. **Severe NPDR (grade 3) is poorly separated** (per-grade recall 0.34–0.66). Referral still happens because grade ≥ 2 is pooled,
   but urgency (soon vs immediate) is unreliable.
4. **Microaneurysms**: Dice 0.43 on IDRiD and 0.24 on DDR. MA overlays will miss many and show false ones.
5. **Quality model**: AUROC 0.80 on real DeepDRiD labels; only 49% of poor photos are rejected outright (80% are flagged as
   usable-with-limitations or inadequate). A large "usable" band (109 of 400) pushes cases to human review.
6. **The ViT model is 329 MB** and dominates load time and memory.
7. **Training is not bit-reproducible** (cuDNN autotuning enabled for speed). Inference is bit-reproducible.

## 4. Known bugs / rough edges (open)

| Item | Impact | Where |
|---|---|---|
| Real-GPU behaviour of the 3D views after the QA fixes not re-tested by the user | Possible remaining crash/lag on real hardware | `web/src/three/*` |
| The UI-fix sub-agent was interrupted before it wrote its final report; its changes were verified only by typecheck, unit tests, build and the QA harness (0 failures) plus screenshots | Small regressions in screens the harness does not cover are possible | `web/src/**` |
| `logs/client.log` contains entries from QA runs (induced crashes) | Noise when debugging | delete the file to reset |
| Demo encounters pair images from different people to show a two-eye screening | Fine for a demo; not a real patient | `server/demo/ATTRIBUTION.md` says so |
| Policy version string is a UTC timestamp (`fit-20261102-2332`) though the fit ran 03 Nov IST | Cosmetic | `ml/eval/evaluate.py` |
| `requirements.txt` mixes training and inference needs (installs torch, timm etc. even to only run the app) | Heavy install for a runtime-only machine | see 07 |
| Server is single-process; one analysis worker thread; SQLite | Fine for one laptop; not for many users | `server/app/worker.py` |

## 5. Test inventory (last run 03 Nov 2026)

| Suite | Command | Result |
|---|---|---|
| Backend API | `.venv\Scripts\python.exe -m pytest server/tests -q` | 11 passed |
| Front-end unit (optics, projection) | `cd web; npm run test` | 14 passed |
| Type check / build | `cd web; npm run typecheck; npm run build` | clean |
| End-to-end against real models | `.venv\Scripts\python.exe scripts\e2e.py` (server running) | 28/28 checks pass |
| Browser QA (crash, clickability, contrast, leaks, error boundary) | `cd web; node qa/ui_qa.mjs` (server running) | 0 failures |
| Export parity + pipeline determinism (random weights) | `.venv\Scripts\python.exe -m ml.export.selftest` | OK |
