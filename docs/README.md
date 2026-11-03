# Retinitry docs

Retinitry is an offline, deterministic research prototype for diabetic-retinopathy (DR) screening triage
(Vishwakarandak '26, Software Track, HEA-S08). It takes retinal photos, checks whether they are good enough,
grades DR with two models, measures its own doubt, shows its evidence in 2D and on a 3D eye, and hands the
final decision to a clinician.

| File | What it answers |
|---|---|
| **[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)** | **What the project is, how it was built, features and why, USPs** |
| **[handoff/00_START_HERE.md](handoff/00_START_HERE.md)** | **Current handoff: status, architecture, results, runbook, risks, next steps. Start here.** |
| [01_PRODUCT.md](01_PRODUCT.md) | What we build, for whom, which features are in, wording rules |
| [02_ARCHITECTURE.md](02_ARCHITECTURE.md) | System design, pipeline, triage policy, data model, determinism, offline |
| [03_ML.md](03_ML.md) | Datasets, splits, models, training recipes, calibration, evaluation, ONNX export |
| [04_API.md](04_API.md) | HTTP contract between server and web app (exact JSON) |
| [05_UI_UX.md](05_UI_UX.md) | Design system, every screen, motion, sound, the 3D eye |
| [06_BUILD.md](06_BUILD.md) | How the build is split across agents, run order, data harness, status |

Source documents (in `d:\retina\`): "What It Is and How It Works", "Research Verification & 4-Day Build Plan",
"Expanded Research Findings & Feature Recommendations", and the pitch deck. Where the expanded findings
conflict with the 4-day plan, the expanded findings win (parallel quality branch, visual-acuity safeguard,
image-sets, DeepDRiD, referral closure).
