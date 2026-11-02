# 02 · Architecture

## System

```
 Browser (React + R3F, served by the same local server, no CDN)
   │  HTTP + SSE on http://127.0.0.1:8765
   ▼
 FastAPI server (server/app)
   ├─ api/            encounters, images, review, referrals, audit, metrics, reports, demo cases
   ├─ pipeline.py     orchestrates the branches below, emits progress events
   ├─ models.py       ONNX Runtime sessions (CPU, fixed thread count), loaded once
   ├─ db.py           SQLite via SQLAlchemy (server/storage/retinitry.db)
   ├─ audit.py        hash-chained audit log
   └─ report.py       PDF via ReportLab
 core/ (shared with ml/)
   ├─ fundus.py       crop/pad/resize, normalisation  ← identical in training and inference
   ├─ quality.py      interpretable quality checks + combination with the quality model
   └─ policy.py       deterministic triage (image level + encounter level) with rule trace
 server/models/       *.onnx + policy.json + quality_rules.json + ood.npz + metrics.json + manifest.json
```

## Per-image pipeline

```
upload bytes ──► sha256 ──► decode ──► fundus mask ──► canonical square 768 (core.fundus.crop_square)
                                                          │
          ┌───────────────────────────┬───────────────────┼───────────────────────┬──────────────────────┐
          ▼                           ▼                   ▼                       ▼                      ▼
   [Quality branch]            [Landmarks M4]      [Grader A: EffNet-B3]   [Grader B: DINOv2]     [Lesions M3 U-Net]
   rules (core.quality)        OD + fovea heatmap   512px → logits, CAM,    448px → logits,        1024px → 4 sigmoid maps
   + quality model M1 (384px)  → coords, conf,      pooled features         CLS attention          → candidates (CCs),
   → category + reason codes   laterality, DD px                                                    areas, dist to fovea
          │                           │                   └────────┬──────────────┘                      │
          │                           │                temperature scaling, ensemble mean               │
          │                           │                entropy, |ΔP_ref|, Mahalanobis OOD (A features)  │
          └─────────────┬─────────────┴────────────────────────────┴──────────────────────────────────────┘
                        ▼
              core.policy.triage_image  ──►  outcome + urgency + reasons + rule trace
                        ▼
              store result JSON + overlays (PNG) + audit entry
```

All branches always run. The quality result never stops the disease branch (expanded findings §2), it only feeds
the policy. Landmarks feed quality (disc/macula visible), laterality, the macular-risk indicator and the 3D projection.

## Encounter policy

`core.policy.triage_encounter` combines image outcomes per eye (REFER > HUMAN_REVIEW > ROUTINE > RETAKE within an
eye, because one good routine image covers the eye), then takes the most severe eye (REFER > HUMAN_REVIEW > RETAKE >
ROUTINE), then applies guardrails:

| Guardrail | Effect |
|---|---|
| G1 VA worse than 6/12 (logMAR > 0.301) in either eye | escalate to REFER (urgency soon) |
| G1 VA not measured | ROUTINE becomes HUMAN_REVIEW; flag shown |
| E2 eye missing (policy `require_both_eyes`) | that eye counts as RETAKE |
| G2 macular-risk indicator | ROUTINE becomes HUMAN_REVIEW; labelled "not a DME diagnosis" |
| G3 laterality mismatch (disc position vs selected eye, confidence ≥ 0.8) | ROUTINE becomes HUMAN_REVIEW |

Image rules R1–R7 are in `core/policy.py` and documented in the rule trace returned with every result.

## Data model (SQLite)

| Table | Columns |
|---|---|
| encounters | id, patient_code, age, sex, diabetes_years, notes, created_at, va_json, ai_outcome_json, status (`open`/`awaiting_review`/`signed`), final_outcome, final_urgency |
| images | id, encounter_id, eye (OD/OS), view (macula/disc/other), camera, fov_deg, sha256, path_original, path_canonical, status (queued/running/done/error), error, result_json, result_hash, created_at |
| lesions | id, image_id, type (MA/HE/EX/SE), bbox_json, centroid_json, area_frac, confidence, dist_fovea_dd |
| reviews | id, encounter_id, reviewer, decision (approve/override), final_outcome, final_urgency, reason, acknowledged_flags_json, at |
| referrals | id, encounter_id, status (issued/scheduled/attended/feedback/closed/not_completed), priority, facility, issued_at, appointment_at, attended_at, feedback, next_followup_at, not_completed_reason, updated_at |
| referral_events | id, referral_id, from_status, to_status, note, at |
| audit | seq (pk), at, event, encounter_id, image_id, actor, payload_json, prev_hash, hash |

`hash = sha256(prev_hash + canonical_json(at, event, ids, actor, payload))`. `GET /api/audit/verify` recomputes the chain.

## Determinism

1. Same bytes in → same result JSON out. Preprocessing is pure OpenCV/NumPy; ONNX Runtime runs on CPU with
   `intra_op_num_threads=4`, `inter_op_num_threads=1`, sequential execution, graph optimisation level fixed.
2. Floats in result JSON are rounded to 4 decimals before hashing; `result_hash = sha256(canonical_json(result
   without timings and ids))`.
3. Every result records `model_versions` (first 12 hex of each ONNX file's sha256), `policy_version`, input sha256.
4. Training is seeded (`torch.manual_seed`, `numpy`, `random`, `cudnn.deterministic=True` where practical); data
   splits are written to CSV once and reused.
5. `POST /api/images/{id}/replay` re-runs the pipeline and returns whether the hash matches.

## Offline-first

1. No network calls at runtime. The web app is built to static files and served by FastAPI. Fonts (Inter) are
   bundled. No CDN, no remote HDRI, no analytics, no external map tiles. three.js/drei helpers that fetch remote
   assets (`Environment` presets, default troika fonts) are not used.
2. All models ship as ONNX in `server/models`. If a model file is missing, `/api/health` lists it and uploads
   return HTTP 503 with a clear message. The UI shows a banner. There is no fake fallback.
3. One command starts everything: `scripts/start.ps1` (Windows) / `scripts/start.sh`.

## Repo layout

```
retinitry/
  core/                 shared deterministic code
  ml/
    data/fetch.py       resumable dataset harness (HF mirrors + DeepDRiD git sparse checkout)
    data/splits.py      fixed seeded splits → data/splits/*.csv
    train/              quality.py, grader_cnn.py, grader_vit.py, lesions.py, landmarks.py
    eval/               calibrate.py, ood.py, thresholds.py, evaluate.py, explain_tests.py
    export/             to_onnx.py (+ wrappers that bake CAM / attention into the graph)
  server/app/           FastAPI app
  server/models/        exported models and fitted JSON
  server/demo/          CC-BY demo images (IDRiD, DDR) + ATTRIBUTION.md
  web/                  React + Vite + TS app
  docs/                 this folder
  scripts/              setup_env.ps1, start.ps1, fetch_data.ps1
```
