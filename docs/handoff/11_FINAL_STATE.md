# 11 · Final state at hand-over (03 Nov 2026, late)

Work was stopped on purpose for the transfer. This page records exactly where everything stands.

## Works and was verified at hand-over
- One-click app: `START_RETINITRY.bat`. The models in `server/models/` match their shipped parts (SHA-256 verified).
- End-to-end with real models: `scripts/e2e.py`, 28/28 pass.
- 3D on the real GPU (RTX 4050, visible Chrome): every Eye Lab mode (Anatomy, Optics, DR Stages, Coverage) and
  the Today eye render with no console errors. The earlier blank Eye Lab came from the post-processing pipeline;
  it is now used only in Optics.
- Backend tests: 11 pass (agents enabled).

## Built but not finished
| Item | State |
|---|---|
| **LangGraph agents** (`server/agents/`) | **Encounter graph:** plan, second opinion (TTA loop), reconcile, retake coach, brief writer + grounding checker (rewrite loop), publish, sign-off interrupt, referral letter + checker, all on a SQLite checkpointer. **Ask Retinitry:** tool-calling programme agent. Wired into the service and API (`/api/encounters/{id}/agent`, `/api/ask`, `/api/agents/status`). Unit-level checks done: a grounded LLM brief passed the checker and the LLM gives repeatable output at temperature 0. **Not done:** a full live run of the graph on a case, UI panels for the agent output, and the validation that would enable the second-opinion upgrade (`policy.json` has no `second_opinion.enabled`, so the agent never changes an outcome) |
| Local LLM | Portable Ollama in `D:\retina\tools\ollama`, model `llama3.2:3b` in `D:\retina\.cache\ollama`. Start: `$env:OLLAMA_MODELS="D:\retina\.cache\ollama"; D:\retina\tools\ollama\ollama.exe serve`. Without it the app works and the agents use templates |
| v3 re-run (`python -m ml.run_v3`) | Stopped during stage 2 (out-of-fold landmarks, fold 1 of 4). The landmark model was retrained (`runs/landmarks`) but **not exported**: the app still ships the earlier landmark ONNX. Re-run the same command to resume; finished stages are skipped |

## IMPORTANT: the IDRiD numbers are invalid until v3 finishes
A file-name collision (`IDRiD_001` exists in both IDRiD's training and test sets) made the 103 IDRiD test photos
overwrite 103 training photos. The fix is in `ml/data/fetch.py` (test ids are now `IDRiD_T001`…), and
`data/processed/idrid` has been rebuilt with 516 unique images. But every IDRiD figure currently in `metrics.json`,
the README, the overview and the Evidence page was computed **before** the fix:
- the 0.917 AUROC;
- sensitivity 0.84 and specificity 0.80;
- 3 of 286 referable eyes cleared as ROUTINE;
- 70% sent to human review;
- the landmark accuracy.

Treat them as invalid. DDR, DeepDRiD and APTOS results are not affected. Finish `python -m ml.run_v3` to regenerate
everything, then re-run `python scripts/verify_claims.py` and update the docs.

## Running the remaining work (on a machine with an NVIDIA GPU)
```powershell
cd D:\retina\retinitry
.venv\Scripts\python.exe -m ml.run_v3        # about 2.5 h, resumable
.venv\Scripts\python.exe scripts\models.py pack
.venv\Scripts\python.exe scripts\verify_claims.py   # will fail until the docs are updated to the new IDRiD numbers
```
