# Retinitry (retina-bkx)

Explainable, uncertainty-aware screening triage for diabetic retinopathy that runs offline on one laptop.
Vishwakarandak '26 · Software Track · HEA-S08. **Research prototype. Triage aid, not a diagnosis.**

A health worker records visual acuity and uploads retinal photos for both eyes. Retinitry checks each photo's quality
and says why it fails. Two graders (EfficientNet-B3 and DINOv2) estimate the DR grade with calibrated confidence. The
system measures its own doubt, traces lesion candidates and finds the optic disc and fovea. A deterministic policy with
a readable rule trace then routes the case to **Routine**, **Refer**, **Needs a human** or **Retake**. A clinician
signs off or overrides with a hold-to-sign gesture. Referrals are tracked until closed, and every action goes into a
hash-chained audit log. The evidence is drawn in 2D and projected onto a procedural 3D eye, where the retina the
camera never saw is shown grey.

- Plan and design: [`docs/`](docs/README.md), starting with [product](docs/01_PRODUCT.md), [architecture](docs/02_ARCHITECTURE.md),
  [ML](docs/03_ML.md), [API](docs/04_API.md), [UI/UX](docs/05_UI_UX.md) and [build](docs/06_BUILD.md).
- Measured results: `server/models/metrics.json` (shown on the Evidence page). No other numbers are claimed.

## Run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup_env.ps1   # once: Python env on D:
.venv\Scripts\python.exe -m ml.data.fetch                        # once: datasets (resumable)
.venv\Scripts\python.exe -m ml.run_all                           # once: train, export, evaluate (resumable)
powershell -ExecutionPolicy Bypass -File scripts\start.ps1       # builds the web app if needed, opens http://127.0.0.1:8765
```

UI without the server: `cd web; npm run dev:mock`.

## Layout

`core/` shared deterministic preprocessing, quality rules and triage policy · `ml/` data harness, training,
evaluation, ONNX export · `server/` FastAPI app, inference pipeline, models, demo cases · `web/` React + three.js app ·
`docs/` the plan.

Data licences: IDRiD and DDR CC-BY 4.0, DeepDRiD CC-BY-SA 4.0, APTOS 2019 under Kaggle competition rules (used for
training only, never redistributed). DINOv2 weights Apache-2.0. Inter font OFL.
