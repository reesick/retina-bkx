# 07 · Next steps (prioritised)

P0 = do before showing it to anyone outside the team. P1 = clear improvements. P2 = later.

## P0
| # | Task | Why | Pointers |
|---|---|---|---|
| 1 | Done: models ship in git as parts (`scripts/models.py`). Remaining: keep a second copy of `runs/` checkpoints if retraining from them matters | | |
| 2 | Test the UI on the real laptop GPU: Today eye hover/click, Eye Lab all modes for 5 minutes, case page 3D (Inside, Cross-section, Layers), and the theatre with 4 images. Check `logs\client.log` afterwards | QA ran in software WebGL only | `web/qa/ui_qa.mjs` can run headed by setting `headless: false` |
| 3 | Ophthalmologist review of: referable definition, VA rule, urgency mapping, outcome wording, a sample of 30 cases | Clinical credibility | `core/policy.py`, `web/src/lib/copy.ts` |
| 4 | Runtime deps are pinned (`requirements-runtime.txt`); pin `requirements.txt` (training) too | Reproducible training installs | `requirements.txt` |

## P1 (model quality)
| # | Task | Expected effect |
|---|---|---|
| 5 | Try a weighted ensemble or CNN-only on the external set; the ViT is weaker on IDRiD (0.887 vs 0.935) | Higher IDRiD AUROC, faster inference (drop the 329 MB ViT) |
| 6 | Fix the IDRiD grade-0 over-calling (recall 0.43): add camera-style augmentation (colour, vignetting, JPEG), or per-camera calibration on a small labelled sample | Fewer needless human reviews |
| 7 | Retrain the quality model with more real labels (EyeQ subset) and add a proper field-definition check using the disc/fovea positions | Quality AUROC above 0.80; fewer "usable" cases |
| 8 | MA segmentation: higher resolution tiles (e.g. 1536 px), focal loss, lesion-level metrics | MA Dice above 0.24 on DDR |
| 9 | Separate urgency: a dedicated grade ≥ 3 head or ordinal regression | Reliable immediate vs soon |
| 10 | Patient-level evaluation (E9) and dual-view experiment (E7) on DeepDRiD | The research claims listed in the expanded findings |
| 11 | Explanation stability test (brightness/contrast perturbation) | Completes the explanation test set |
| 12 | INT8 quantisation of CNN/lesion models; measure accuracy change | ~2× faster |

## P1 (engineering)
| # | Task |
|---|---|
| 13 | Done: `requirements-runtime.txt`. Next: a one-file installer that bundles portable Python so the recipient needs nothing pre-installed |
| 14 | Add a test that runs the same inputs through `core/policy.py` and `web/src/api/mockPolicy.ts` |
| 15 | Extend the UI harness to the new-screening flow (upload two files, watch the theatre, sign off) |
| 16 | One-file offline installer (PyInstaller or a portable Python + `server/models` + `web/dist`) |
| 17 | Run and fix `scripts/start.sh` on Linux |

## P2 (product)
| # | Task |
|---|---|
| 18 | Login, roles (health worker / reviewer / admin), encryption at rest, retention policy (DPDP) |
| 19 | Multi-reviewer queue and sync to a district server (PostgreSQL) |
| 20 | FHIR DiagnosticReport export; ABDM/ABHA linkage |
| 21 | Smartphone fundus camera support and per-camera calibration |
| 22 | Glaucoma / AMD heads |
