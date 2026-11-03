# Retinitry

Offline, explainable, uncertainty-aware screening triage for diabetic retinopathy. It runs on one laptop with no internet and no GPU.
Vishwakarandak '26 · Software Track · HEA-S08. **Research prototype. A triage aid, not a diagnosis. Not clinically validated.**

A health worker records visual acuity and uploads retinal photos of both eyes. Retinitry then:

- checks each photo's quality and explains any rejection;
- grades DR with two models (EfficientNet-B3 + DINOv2 ViT) and calibrates their confidence;
- measures its own doubt;
- traces lesion candidates and finds the optic disc and fovea;
- sends the case through a deterministic, readable rule set to **ROUTINE**, **REFER**, **NEEDS A HUMAN** or **RETAKE**.

A clinician then signs off or overrides. Referrals are tracked until closed, every action goes into a tamper-evident audit log,
and the evidence is drawn in 2D and on a 3D eye that shows which part of the retina was never photographed.

**New here? Read [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)** for what it is, how it was built, the features and why they exist, and what makes it different.

---

## Run it (Windows)

**Needs:** Windows 10/11, **Python 3.11** (`winget install Python.Python.3.11`), Git, about 3 GB free disk. No GPU, no Node.js.

```powershell
git clone https://github.com/reesick/retina-bkx.git retinitry
cd retinitry
.\START_RETINITRY.bat
```

You can also double-click `START_RETINITRY.bat` in Explorer.

**The first run takes 3–6 minutes.** It:
1. creates `.venv` and installs the runtime packages from `requirements-runtime.txt`;
2. rebuilds the five model files from `server/models/parts/`, checking every SHA-256;
3. starts the server and opens **http://127.0.0.1:8765**.

Later runs start in about 10 seconds. To stop, close the window or press Ctrl+C.

**macOS / Linux:** run `bash scripts/start.sh`. It does the same steps, but has not been tested on those systems.

### Try it
1. On **Today**, scroll to **Try a demo case** and click one. Six two-eye cases are bundled, one for each outcome plus the vision safeguard.
2. Or click **New screening**, enter vision for both eyes, and drop photos into the eye circles. A right/left pair is in
   `server/demo/` (`refer-soon-od.jpg` → right eye, `refer-soon-os.jpg` → left eye).
3. Open the case. You get the photo layers (attention, lesions, landmarks), the 3D eye, the rule trace, and sign-off by holding the circle.
4. **Evidence** shows the measured results. **Eye Lab** has anatomy, light-ray optics, DR stages and retinal coverage.

---

## Where things are

| What | Where |
|---|---|
| **Trained models** (5 ONNX files, 527 MB) | Shipped in git as 45 MB parts: `server/models/parts/*.part*` + `parts.json` (SHA-256 of every part and file). Rebuilt to `server/models/*.onnx` by `python scripts/models.py assemble`, which the start script runs |
| Fitted thresholds, calibration, OOD stats, metrics | `server/models/policy.json`, `quality_rules.json`, `ood.npz`, `metrics.json`, `manifest.json` |
| Previous (v1, APTOS-only) results for comparison | `server/models/v1_aptos_only/` |
| Demo cases (12 CC-BY images) | `server/demo/` + `ATTRIBUTION.md` |
| Prebuilt web app | `web/dist/` (committed; rebuild with `cd web; npm ci; npm run build` after UI changes) |
| Your cases, reviews, audit log | `server/storage/` (created on first run, never committed; delete it to reset) |
| Logs (server, front-end errors) | `logs/` (front-end errors in `logs/client.log`) |
| **Full handoff** (status, architecture, results, runbook, risks, next steps) | [`docs/handoff/00_START_HERE.md`](docs/handoff/00_START_HERE.md) |

## Measured results (from `server/models/metrics.json`)

> **Warning:** the IDRiD row predates a data fix (IDRiD test photos had overwritten training photos) and is invalid until `python -m ml.run_v3` finishes. See [docs/handoff/11_FINAL_STATE.md](docs/handoff/11_FINAL_STATE.md).

| Test set | n | AUROC | Sensitivity | Specificity | Referable eyes cleared as ROUTINE |
|---|---|---|---|---|---|
| IDRiD (fully external: never trained on or fitted) | 516 | 0.917 | 0.84 | 0.80 | 3 / 286 |
| DDR test (held out; DDR train used in training) | 3,759 | 0.975 | 0.79 | 0.98 | 66 / 1,690 |
| DeepDRiD val (held-out patients) | 400 | 0.975 | 0.96 | 0.88 | 1 / 180 |
| APTOS test (held out) | 550 | 0.985 | 0.92 | 0.94 | 0 / 223 |

Other results:
- **Quality gate:** rejects 10% of good photos; no ungradable DDR photo was ever cleared as ROUTINE.
- **Lesion Dice (IDRiD test):** EX 0.77, HE 0.65, SE 0.67, MA 0.43.
- **Landmarks:** optic disc within 1 disc diameter on 100% of IDRiD test images, fovea on 98%.
- **Speed and determinism:** about 4.5 s per image on a laptop CPU; the same image always gives the same result hash.

Known weaknesses are listed with numbers in [`docs/handoff/01_STATUS.md`](docs/handoff/01_STATUS.md). The main ones:
- On IDRiD the system is cautious: 70% of cases go to human review, and specificity is 0.80.
- Microaneurysm detection is weak.
- The 3D views were only tested in software rendering.

## For developers

| Task | Command |
|---|---|
| Full dev + training environment (CUDA PyTorch) | `powershell -ExecutionPolicy Bypass -File scripts\setup_env.ps1` |
| Retrain everything (resumable, about 4–5 h on an RTX 4050) | `powershell -ExecutionPolicy Bypass -File scripts\train.ps1` |
| Re-pack models after retraining, before committing | `python scripts\models.py pack` |
| Backend tests | `.venv\Scripts\python.exe -m pytest server/tests -q` |
| Front-end tests | `cd web; npm ci; npm run typecheck; npm run test` |
| End-to-end and browser QA (server running) | `.venv\Scripts\python.exe scripts\e2e.py` and `cd web; node qa/ui_qa.mjs` |
| UI without the server (mock data) | `cd web; npm run dev:mock` |

Layout:
- `core/`: shared deterministic preprocessing, quality rules and triage policy.
- `ml/`: data harness, training, evaluation, ONNX export.
- `server/`: FastAPI app, inference pipeline, models, demo cases.
- `web/`: React + three.js app.
- `docs/`: the plan and the handoff.

## Data and licences

- **APTOS 2019:** Kaggle competition rules. Used for training only and never redistributed. A commercial use would need retraining without it.
- **IDRiD and DDR:** CC-BY 4.0.
- **DeepDRiD:** CC-BY-SA 4.0.
- **DINOv2 weights:** Apache-2.0.
- **Inter font:** OFL.

Demo images come from IDRiD and DDR, with attribution in `server/demo/ATTRIBUTION.md`.
