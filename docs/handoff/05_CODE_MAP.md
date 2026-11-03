# 05 · Code map: every source file

Line counts are approximate (03 Nov 2026).

## core/ (shared by training and runtime, pure and deterministic)
| File | Lines | What it does |
|---|---|---|
| `fundus.py` | 119 | Decode bytes, fundus mask, crop to centred square, coordinate transforms, mask cropping, ImageNet normalisation |
| `quality.py` | 141 | Image features (focus, brightness, glare, unevenness, field, redness, vessels), rule checks with reason codes, combination with the quality model |
| `policy.py` | 232 | Image-level triage rules R1–R7, VA parsing to logMAR, encounter-level combination and guardrails, rule trace |

## ml/ (offline, needs PyTorch + GPU)
| File | What it does |
|---|---|
| `common.py` | Paths, seeding, metrics (QWK, ECE, bootstrap CI), resumable checkpoint helpers |
| `run_all.py` | Orchestrator: stages, waits for data, skip/resume markers, lock file, live logs |
| `data/fetch.py` | Resumable downloads + conversion for APTOS, IDRiD, DDR (test, train/val, segmentation), DeepDRiD; manifest |
| `data/splits.py` | `aptos.csv` and the multi-source `grading.csv` |
| `data/demo_cases.py` | Picks and verifies the six two-eye demo encounters by running the real pipeline |
| `train/grader.py` | CNN / ViT grader training (multi-source fine-tune with `--init`) |
| `train/lesions.py` | Lesion U-Net, lesion-biased crops, per-class Dice thresholds |
| `train/landmarks.py` | Disc/fovea heat-map model + decoder |
| `train/quality.py` | Synthetic degradations, quality model, rule threshold fitting, model cut-off fitting on held-out real labels |
| `export/to_onnx.py` | Wrappers that bake CAM / attention / sigmoid into the graphs; export + parity check + manifest |
| `export/selftest.py` | Export with random weights and run the server pipeline twice (shape + determinism smoke test) |
| `eval/evaluate.py` | Predictions (cached), temperature scaling, OOD, thresholds → policy.json; full metrics + triage simulation → metrics.json |
| `eval/extras.py` | Lesion Dice, landmark error, laterality rule, explanation tests, latency + determinism |
| `eval/compare.py` | v1 vs v2 comparison table |

## server/app/ (runtime, CPU only)
| File | Lines | What it does |
|---|---|---|
| `main.py` | ~390 | FastAPI app factory, every route, SSE, static web serving with SPA fallback, client-log endpoint |
| `service.py` | ~740 | Business logic: encounters, images, VA, encounter policy, queue priority, review rules, referrals state machine, stats, demo cases |
| `pipeline.py` | ~320 | The per-image inference pipeline over ONNX Runtime |
| `worker.py` | ~110 | Single background analysis thread + per-image event buffer (pub/sub) |
| `db.py` | ~130 | SQLAlchemy models and session (SQLite, WAL) |
| `schemas.py` | ~340 | Pydantic request/response models mirroring docs/04_API.md |
| `audit.py` | ~65 | Hash-chained audit append and verify |
| `report.py` | ~220 | ReportLab PDF screening report |
| `storage.py` | ~65 | File layout for originals, canonical images and overlays |
| `ids.py` | ~45 | Short ids, patient codes, ISO timestamps |
| `server/tests/` | ~570 | Pytest suite with a fake pipeline (full flow, SSE, review rules, referrals, audit tamper, PDF, replay) |
| `server/models/` | | Model files and fitted JSON (ONNX not in git) |
| `server/demo/` | | Six demo encounters (12 CC-BY images), `cases.json`, `ATTRIBUTION.md` |

## web/src/ (React app)
| Folder / file | What it does |
|---|---|
| `main.tsx`, `App.tsx` | Root, router, error boundary per route, top bar and tab bar, global logging init |
| `api/` | `types.ts` (API types), `client.ts`, `sse.ts`, `hooks.ts`; mock mode: `mock.ts`, `fixtures.ts`, `mockPolicy.ts` |
| `components/` | Design system: GlassTabBar, TopBar, Odometer, Ring, Gauge, GradeBars, HoldButton, Segmented, Switch, Sheet, Toasts, Skeleton, WheelPicker, ScrollStrip, EmptyState, ErrorBoundary, DemoButton … |
| `pages/Today.tsx` | Hero counts, living eye, begin screening, stats tiles, recent strip, demo strip |
| `pages/NewScreening.tsx` | Patient + VA wheel pickers, two eye drop zones with view selectors |
| `pages/Theatre.tsx` | SSE-driven analysis animation and outcome reveal |
| `pages/case/` | CasePage, Viewer2D (zoom, loupe, layers, split), DecisionPanel (outcome, trace, confidence, doubt, quality, safeguards, lesions, receipt), SignOff |
| `pages/Queue.tsx`, `Referrals.tsx`, `Evidence.tsx`, `EyeLab.tsx`, `Settings.tsx`, `Audit.tsx`, `NotFound.tsx` | The other screens |
| `three/` | Stage (single Canvas + context-loss recovery), EyeModel, shaders, projection (+ test), CaseEye, LivingEye, LabScenes, OpticsView, CameraRig, ScanCanvas |
| `lib/` | optics (+ test), sound (Web Audio), log (client logging), store (zustand), format, copy (wording rules), va, sha256, fundusArt (mock images), rng, route, session |
| `web/qa/ui_qa.mjs` | Browser QA harness (puppeteer-core) |

## scripts/
| File | What it does |
|---|---|
| `setup_env.ps1` | Create `.venv` with CUDA torch + requirements (caches on D:) |
| `start.ps1` / `start.sh` | Build web if needed, start server, open browser (`start.sh` untested) |
| `train.ps1` | Resumable fetch + full ML chain |
| `e2e.py` | End-to-end checks against a running server |
