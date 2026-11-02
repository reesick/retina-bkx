# 06 · Build orchestration

## Who did what

The lead agent (the "brain") read the four source documents, made every product, safety, ML and architecture
decision, wrote the docs in this folder, the shared deterministic core (`core/`), the data harness, every training /
evaluation / export script and the inference pipeline (`server/app/pipeline.py`), ran training on the local GPU,
and integrated and verified the result. Repetitive, well-specified coding went to sub-agents that worked only from
these docs:

| Agent | Brief | Owns | Verified by |
|---|---|---|---|
| UI/UX + frontend | `05_UI_UX.md`, `04_API.md`, STRONGER screenshots | `web/` | `npm run typecheck`, `npm run test` (optics + projection), `npm run build`, headless-browser screen checks in mock mode |
| Backend | `04_API.md`, `02_ARCHITECTURE.md`, `core/policy.py` | `server/app/` (except `pipeline.py`), `server/tests/`, `scripts/start.*` | `pytest server/tests` (full flow, SSE, review rules, referral state machine, audit tamper detection, PDF, replay) |

Interfaces between the streams were fixed in writing before any code: the HTTP/SSE contract (`04_API.md`), the
pipeline interface (top of `server/app/pipeline.py`), and the ONNX input/output signatures (`03_ML.md`).

## Machine this was built on

Windows, Ryzen 7 7435HS, 16 GB RAM, RTX 4050 Laptop (6 GB), ~19 GB free on D:, ~3 GB on C:. Consequences:
- Everything (venv, caches, temp files, data) lives on D:. `uv` with `UV_CACHE_DIR=d:\retina\.cache\uv`.
- Raw downloads are converted to compact canonical crops and deleted immediately.
- `pagefile.sys` lives on D: and grows under memory pressure, so heavy jobs run one at a time with 3 DataLoader workers.
- Batch sizes fit 6 GB with mixed precision (B3 @ 512: 12, ViT-B @ 448: 8, U-Net @ 512 crops: 6).

## Run order (all resumable)

```powershell
cd d:\retina\retinitry
powershell -ExecutionPolicy Bypass -File scripts\setup_env.ps1      # venv + CUDA torch + deps
.venv\Scripts\python.exe -m ml.data.fetch                           # APTOS, IDRiD, DDR, DeepDRiD (re-run to resume)
.venv\Scripts\python.exe -m ml.data.fetch --status                  # what is done
.venv\Scripts\python.exe -m ml.run_all                              # splits → train all → export → evaluate → extras → demo
cd web; npm ci; npm run build; cd ..                                # web/dist
powershell -ExecutionPolicy Bypass -File scripts\start.ps1          # http://127.0.0.1:8765
```

If a download stalls, re-run the same fetch command: finished shards / files are recorded in `data/manifest.json`
and skipped. `ml.run_all` waits for the data it needs and skips any stage whose output already exists; use
`--only stage1,stage2 --force` to redo stages. Logs are in `logs/`.

## What is not in git

`.venv/`, `data/`, `runs/` (checkpoints), `*.onnx`, `web/node_modules/`, `web/dist/`, `server/storage/`. The fitted
JSON files in `server/models/` (policy, quality rules, metrics, manifest) and the CC-BY demo images are committed.
To ship an offline bundle, copy the repo plus `server/models/*.onnx`, `.venv` and `web/dist`.
