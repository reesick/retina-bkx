# Retinitry handoff: start here

This folder is the complete handoff for Retinitry as of **03 Nov 2026** (git `07540dc` plus this folder).
It is written for someone who has never seen the project. It says plainly what works, what is weak and what is missing.
Every number in it comes from `server/models/metrics.json` or from a test run, nothing is estimated.

## What Retinitry is, in one paragraph

An offline research prototype for diabetic-retinopathy (DR) screening triage (hackathon brief HEA-S08, Vishwakarandak '26).
A health worker enters a patient code and visual acuity and uploads retinal photos of both eyes. The system checks each photo's
quality, grades DR with two neural networks (a CNN and a vision transformer), measures how unsure it is, traces lesion
candidates, finds the optic disc and fovea, and routes the encounter to one of four outcomes: **ROUTINE**, **REFER**
(soon / immediate), **HUMAN_REVIEW** or **RETAKE**. A clinician signs off or overrides. Referrals are tracked to closure and
every action goes into a tamper-evident audit log. Evidence is shown in 2D and projected onto a procedural 3D eye that shows
which part of the retina was never photographed. Everything runs on one Windows laptop with no internet.
**It is not a medical device and has not been clinically validated.**

## Read in this order

| File | What it answers |
|---|---|
| [01_STATUS.md](01_STATUS.md) | What is done, partly done or not done; known bugs and weaknesses. **Read this first.** |
| [02_ARCHITECTURE.md](02_ARCHITECTURE.md) | How the whole system works end to end, with the request and data flow |
| [03_MODELS_AND_RESULTS.md](03_MODELS_AND_RESULTS.md) | Datasets, splits, the five models, every measured result, and where they fail |
| [04_RUNBOOK.md](04_RUNBOOK.md) | Set up, run, retrain, evaluate, test and troubleshoot, with exact commands |
| [05_CODE_MAP.md](05_CODE_MAP.md) | Every source file and what it does |
| [06_DECISIONS_AND_RISKS.md](06_DECISIONS_AND_RISKS.md) | Why things were built this way; licensing, clinical, privacy and technical risks |
| [07_NEXT_STEPS.md](07_NEXT_STEPS.md) | Prioritised backlog for whoever continues |
| [08_DEMO_SCRIPT.md](08_DEMO_SCRIPT.md) | A 3–5 minute demo that shows every feature with the bundled cases |

The design documents written before the build are one level up in `docs/` (`01_PRODUCT` … `07_UI_QA`). Where those and this
folder disagree, **this folder is current**.

## Status at a glance

| Area | State |
|---|---|
| HEA-S08 required deliverables (dataset pipeline, CNN baseline, saliency, calibrated confidence, quality rejection, clinician review, evaluation report) | All done and verified |
| ML: 5 models trained, exported to ONNX, evaluated on 4 test sets | Done |
| Backend API + database + audit + PDF | Done; 11 backend tests and a 28-check end-to-end script pass |
| Web app (all screens, 3D eye, Eye Lab) | Built. An automated browser QA run reports 0 failures, **but it runs in software WebGL**; it has not been measured on a real GPU |
| Safety behaviour | 3 of 286 referable IDRiD eyes and 66 of 1,690 referable DDR eyes were cleared as ROUTINE (see 03) |
| Biggest weaknesses | Specificity on IDRiD 0.80 and 70% of IDRiD cases sent to human review; grade-0 recall on IDRiD 0.43; microaneurysm segmentation weak (Dice 0.24 on DDR); quality model AUROC 0.80 on real labels |
| Biggest handoff trap | **The trained model files (`server/models/*.onnx`, ~527 MB) are NOT in git.** A fresh clone cannot run until you copy them from this laptop or retrain (about 4–5 h on an RTX 4050). See 04_RUNBOOK §2 |

## Where things are on this machine

| Thing | Path |
|---|---|
| Repo | `d:\retina\retinitry` (GitHub: `reesick/retina-bkx`, branch `main`) |
| Original brief documents (Word, PowerPoint) | `d:\retina\*.docx`, `d:\retina\*.pptx` |
| UI taste reference app | `d:\retina\stronger` |
| Trained ONNX models + fitted JSON | `d:\retina\retinitry\server\models\` |
| Training checkpoints (PyTorch) | `d:\retina\retinitry\runs\` (1.0 GB, not in git) |
| Processed datasets | `d:\retina\retinitry\data\processed\` (2.1 GB, not in git) |
| Python environment | `d:\retina\retinitry\.venv` (4.8 GB) |
| Logs (training, server, front-end errors, QA) | `d:\retina\retinitry\logs\` |
| Caches (HF, torch, uv) | `d:\retina\.cache\` |
