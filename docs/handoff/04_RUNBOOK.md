# 04 · Runbook: exact commands

All commands are PowerShell, run from `d:\retina\retinitry` unless stated otherwise.

## 1. Run the app (this laptop, everything already in place)

```powershell
cd d:\retina\retinitry
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

This starts the server on http://127.0.0.1:8765 (it builds `web/dist` first if missing) and opens the browser. Stop with Ctrl+C.

To run the server only: `.venv\Scripts\python.exe -m uvicorn server.app.main:app --host 127.0.0.1 --port 8765`.

To develop the UI with hot reload, run `cd web; npm run dev` and open http://localhost:5173 (`/api` is proxied to 8765).
To run with no server at all, use `npm run dev:mock`.

To reset the app's data (cases, reviews, audit), stop the server and delete `server\storage\`. Models are not affected.

## 2. Set up on a NEW machine (read carefully)

The model files are **not in git**. There are two options.

**Option A: copy (recommended, about 5 min)**
1. `git clone https://github.com/reesick/retina-bkx.git retinitry`
2. Copy from this laptop into the new repo:
   - `server\models\*.onnx` (5 files, ~527 MB)
   - `server\models\ood.npz`
   - The JSON files in `server\models\` are in git.
3. Install Python 3.11, then run `powershell -ExecutionPolicy Bypass -File scripts\setup_env.ps1`. It creates `.venv` with
   CUDA torch and all deps; for runtime only, see 07 about splitting requirements.
4. Install Node 22, then run `cd web; npm ci; npm run build`.
5. `scripts\start.ps1`.

**Option B: retrain (about 4–5 h on an RTX 4050 6 GB, ~10 GB of disk for data and caches)**
1. Steps 1, 3 and 4 above.
2. Run `powershell -ExecutionPolicy Bypass -File scripts\train.ps1`.
3. Results will differ slightly from the numbers in 03, because training is not bit-reproducible.

## 3. Tests

```powershell
.venv\Scripts\python.exe -m pytest server/tests -q          # backend: 11 tests, uses a fake pipeline
cd web; npm run typecheck; npm run test; cd ..               # front end: types + 14 unit tests
.venv\Scripts\python.exe -m ml.export.selftest               # ONNX parity + pipeline determinism
# with the server running:
.venv\Scripts\python.exe scripts\e2e.py                       # 28 end-to-end checks with real models
cd web; node qa/ui_qa.mjs; cd ..                              # browser QA, report in logs\ui_qa.json + logs\ui_qa\*.png
```

`scripts\e2e.py` creates demo encounters and signs one off, so run it on a disposable `server\storage`.

## 4. ML pipeline, stage by stage

| Stage | Command | Output | Time |
|---|---|---|---|
| Datasets | `.venv\Scripts\python.exe -m ml.data.fetch` (status: `--status`) | `data\processed\*`, `data\manifest.json` | 1–3 h first time (DDR is ~13k single-file downloads) |
| Splits | `.venv\Scripts\python.exe -m ml.data.splits` | `data\splits\aptos.csv`, `grading.csv` | seconds |
| Landmarks | `... -m ml.train.landmarks` | `runs\landmarks\` | ~20 min |
| Quality | `... -m ml.train.quality` | `runs\quality\`, `quality_rules.json` | ~15 min |
| CNN grader | `... -m ml.train.grader --arch cnn --init runs\v1_aptos_only\grader_cnn\best.pt` | `runs\grader_cnn\` | ~30 min |
| ViT grader | `... -m ml.train.grader --arch vit --init runs\v1_aptos_only\grader_vit\best.pt` | `runs\grader_vit\` | ~35 min |
| Lesions | `... -m ml.train.lesions` | `runs\lesions\` | ~45 min |
| Export | `... -m ml.export.to_onnx` | `server\models\*.onnx`, `manifest.json` | 1 min |
| Evaluate | `... -m ml.eval.evaluate` | `policy.json`, `ood.npz`, `metrics.json` | ~1 h (prediction cache in `runs\preds\`) |
| Extras | `... -m ml.eval.extras` | lesions, landmarks, laterality, explanations, latency in metrics.json | ~5 min |
| Demo cases | `... -m ml.data.demo_cases` | `server\demo\*` | 10–20 min |
| Compare v1/v2 | `... -m ml.eval.compare` | console table | seconds |

The whole chain is `.venv\Scripts\python.exe -m ml.run_all`. Its options:
- `--only stage1,stage2` runs only the named stages.
- `--force` redoes them.

Without `--init` the graders train from ImageNet/DINOv2 weights on the multi-source split. With `--aptos-only` they train on APTOS
only (v1 behaviour).

**Resume behaviour**
- Every epoch writes `runs\<model>\last.pt`, so a re-run continues from it.
- A finished model writes `done.txt`. Delete that file to retrain.
- The ML-stage markers are `runs\*_v2.done`.
- A lock file `logs\run_all.lock` stops two runs from fighting over the GPU.
- After evaluation changes, delete `runs\preds\` or the cached predictions will be reused.

## 5. Logs

| File | What |
|---|---|
| `logs\stage_<name>.log` | Each ML stage (appends; each run starts with a `===== … start` line) |
| `logs\train_run_all.log` | Combined training run |
| `logs\server.out.log`, `server.err.log` | Server, when started by scripts that redirect it |
| `logs\client.log` | Front-end errors, crashes, WebGL resets (JSON lines; also `GET /api/client-log`) |
| `logs\ui_qa.json`, `logs\ui_qa\*.png` | Last browser QA run |

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Upload returns 503 "models missing" | `server\models\*.onnx` absent: copy them or retrain (§2) |
| "3D paused" overlay | The GPU reset the WebGL context (common when the GPU is busy, e.g. training). Click **Restore 3D**; close GPU-heavy apps |
| UI blank or "Something went wrong" | Read the newest entries in `logs\client.log`; click **Try again** |
| Training out of memory on a 6 GB GPU | Batch sizes are set for 6 GB (`ml\train\grader.py` CFG). Close other GPU apps; lower `bs` |
| Disk fills during downloads | Windows' pagefile on D: grows under memory pressure; keep ≥ 15 GB free. Raw downloads are deleted after conversion |
| HF downloads stall or 429/499 | Re-run the same fetch command; it resumes. Setting `HF_TOKEN` raises the rate limit |
| `Activate.ps1` blocked | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned` |
| Port 8765 busy | A server is already running: `Get-CimInstance Win32_Process -Filter "Name='python.exe'"`, then stop the uvicorn one |
