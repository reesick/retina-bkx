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

UI without the server: `cd web; npm run dev:mock`. End-to-end check against a running server: `.venv\Scripts\python.exe scripts\e2e.py`.

## Measured results (v2, from `server/models/metrics.json`)

Ensemble of EfficientNet-B3 + DINOv2 ViT-B/14, referable DR = grade ≥ 2, operating point fitted on validation.

| Test set | n | AUROC | Sensitivity | Specificity | Referable cases auto-cleared as ROUTINE |
|---|---|---|---|---|---|
| IDRiD (fully external, never trained on or fitted) | 516 | 0.917 | 0.84 | 0.80 | 3 / 286 |
| DDR test (held out; DDR train used in training) | 3,759 | 0.975 | 0.79 | 0.98 | 66 / 1,690 |
| DeepDRiD val (held-out patients) | 400 | 0.975 | 0.96 | 0.88 | 1 / 180 |
| APTOS test (held out) | 550 | 0.985 | 0.92 | 0.94 | 0 / 223 |

The v1 graders were trained on APTOS alone. They let 641 / 1,690 referable DDR cases through as ROUTINE, because the APTOS-fitted threshold did not
transfer across cameras. v2 trains on three sources. The v1 numbers are kept in `server/models/v1_aptos_only/`, and `python -m ml.eval.compare` prints both side by side.
The price is more human review: on IDRiD, 70% of cases go to a clinician.

Other measurements:
- **Quality gate:** rejects 10% of good DeepDRiD photos and flags 80% of poor ones. None of the 346 ungradable DDR images was cleared as ROUTINE.
- **Lesion Dice on IDRiD test:** EX 0.77, HE 0.65, SE 0.67, MA 0.43.
- **Landmarks:** optic disc within 1 disc diameter on 100% of IDRiD test images, fovea on 98%.
- **Left/right eye:** read from disc position, 98% correct on DeepDRiD.
- **Explanation tests:** pointing game 0.67 (CNN) and 0.81 (ViT) vs a 0.23 random baseline; the deletion test and the weight-randomisation check both pass.
- **Speed and determinism:** about 3–4.5 s per image on a laptop CPU, and replaying the same image gives an identical result hash.

Research prototype on public datasets. These are not clinical validation results.

## Layout

`core/` shared deterministic preprocessing, quality rules and triage policy · `ml/` data harness, training,
evaluation, ONNX export · `server/` FastAPI app, inference pipeline, models, demo cases · `web/` React + three.js app ·
`docs/` the plan.

Data licences: IDRiD and DDR CC-BY 4.0, DeepDRiD CC-BY-SA 4.0, APTOS 2019 under Kaggle competition rules (used for
training only, never redistributed). DINOv2 weights Apache-2.0. Inter font OFL.
