# 02 · Architecture: how it works end to end

## 1. The big picture

```
                         ┌───────────────── one Windows laptop, no internet ─────────────────┐
                         │                                                                    │
  Browser (React app) ───┼─ HTTP + SSE ─► FastAPI server (127.0.0.1:8765) ─► ONNX Runtime CPU │
  web/dist, served by    │                 │  service.py  (business logic)    5 models       │
  the same server        │                 │  worker.py   (1 analysis thread) │              │
                         │                 │  pipeline.py ────────────────────┘              │
                         │                 │  core/policy.py (decisions)                      │
                         │                 │  db.py → SQLite  server/storage/retinitry.db     │
                         │                 │  storage.py → image files server/storage/images/ │
                         │                 │  audit.py → hash chain   report.py → PDF         │
                         └────────────────────────────────────────────────────────────────────┘

  Offline, once (GPU):  ml/data/fetch.py → ml/data/splits.py → ml/train/* → ml/export/to_onnx.py
                        → ml/eval/evaluate.py + extras.py → server/models/{*.onnx, policy.json,
                          quality_rules.json, ood.npz, metrics.json, manifest.json}
```

Two halves never share runtime state:
- **Offline ML pipeline** (`ml/`, needs PyTorch + GPU). It produces the files in `server/models/`.
- **Runtime app** (`server/` + `web/`, CPU only). It reads those files.

The only code they share is `core/` (preprocessing, quality rules, triage policy). That guarantees training and inference
see identical pixels and identical decision rules.

## 2. What happens when a user screens a patient

1. **New screening page** (`web/src/pages/NewScreening.tsx`).
   - `POST /api/encounters` creates the encounter (patient code, age, sex, diabetes years).
   - `PUT /api/encounters/{id}/va` stores visual acuity per eye. A raw string like "6/9" is converted to logMAR by
     `core.policy.va_to_logmar`, and null means "not measured".
   - Then one `POST /api/encounters/{id}/images` per photo (multipart: file, eye OD/OS, view, FOV).
2. **Server stores and queues** (`service.add_image`). It validates the upload (image/*, ≤ 25 MB, eye/view/FOV ranges),
   saves the original bytes, records the SHA-256, writes an audit entry, and puts the image on the worker queue.
   The response returns immediately with `status: "queued"`.
3. **Worker runs the pipeline** (`worker.py` → `pipeline.Pipeline.run`). There is one image at a time, on a single thread, so CPU
   use stays predictable. Each step emits an event into an in-memory pub/sub that buffers every event, so a late subscriber
   still sees all steps.
4. **Theatre page** subscribes to `GET /api/images/{id}/events` (Server-Sent Events). The server holds each step visible for at least
   250 ms so the animation is readable; the real compute time travels in `ms`. Partial results are drawn as they arrive:
   - quality chips
   - landmark crosshairs
   - each model's grade bars
   - lesion contours
   - doubt gauges
   - the outcome
5. **On completion** the server:
   - saves the result JSON, overlays and canonical image;
   - computes `result_hash` (SHA-256 of canonical JSON without timings/ids);
   - recomputes the **encounter** decision with `core.policy.triage_encounter`;
   - sets `status = awaiting_review`;
   - computes a queue priority;
   - writes an audit entry.
6. **Case page** shows the 2D viewer, the 3D eye and the decision panel. A clinician ticks every flag, then either holds to approve
   or overrides with a reason (`POST /api/encounters/{id}/review`). Signing REFER creates a referral.
7. **Referrals page** moves the referral through its state machine (`PUT /api/referrals/{id}`). Illegal moves return 409.

## 3. The per-image pipeline (`server/app/pipeline.py`)

```
bytes ─► decode (OpenCV) ─► fundus mask ─► canonical square crops: 768 px and 1024 px   (core/fundus.py)
   │
   ├─ quality:    rule checks on the 768 crop (core/quality.py) + quality.onnx (384 px, 3 classes)
   │              → adequate / usable / inadequate + reason codes        [model cut-off 0.78, fitted]
   ├─ landmarks:  landmarks.onnx (512 px → 2 heat-maps 128²) → disc & fovea (x, y, conf),
   │              disc diameter ≈ disc–fovea distance / 2.5, laterality from disc side (rule measured on DeepDRiD)
   ├─ grader_cnn: grader_cnn.onnx (512 px) → logits, pooled features, CAM (5 maps 16²)
   ├─ grader_vit: grader_vit.onnx (448 px) → logits, features, CLS attention (32²)
   │              temperature scaling per model; ensemble = mean of calibrated probabilities
   ├─ lesions:    lesions.onnx (1024 px) → 4 probability maps → per-class thresholds → connected components
   │              → candidates (bbox, centroid, area, confidence, distance to fovea in disc diameters)
   │              macular risk = hard-exudate candidate within 1 DD of fovea
   ├─ uncertainty: entropy of ensemble, |P_ref(CNN) − P_ref(ViT)|, Mahalanobis distance of CNN features
   │              (PCA-64, fitted on training sample) → flags vs fitted thresholds
   ├─ policy:     core.policy.triage_image → outcome, urgency, reasons, rule trace
   └─ overlays:   CAM / attention as magma RGBA PNGs, lesion masks per type and combined, canonical JPEG
```

All branches always run. Quality never stops the disease branch; it only feeds the policy.
ONNX Runtime settings are fixed: CPU, 4 intra-op threads, 1 inter-op, sequential execution.

## 4. Decision logic (`core/policy.py`)

**Image level**, first match wins (thresholds from `server/models/policy.json`):

| Rule | Condition | Outcome |
|---|---|---|
| R1 | quality = inadequate | → R1a, otherwise RETAKE |
| R1a | inadequate, but P(referable) ≥ t_refer or suspicious lesions | HUMAN_REVIEW (evidence preserved) |
| R2 | OOD distance > t_ood (13.72) | HUMAN_REVIEW |
| R3 | entropy > t_entropy (0.607) or disagreement > t_disagreement (0.328) | HUMAN_REVIEW |
| R4 | P(referable) ≥ t_refer (0.497) | REFER; immediate if P(grade ≥ 3) ≥ 0.5 or grade ≥ 3, else soon |
| R5 | suspicious lesion candidates despite a low score (HE area ≥ 0.06%, EX area ≥ 0.05%, or ≥ 3 HE) | HUMAN_REVIEW |
| R6 | quality = usable and P(referable) ≥ 0.25 | HUMAN_REVIEW |
| R7 | otherwise | ROUTINE (12-month rescreen) |

**Encounter level** (`triage_encounter`):
- Within an eye: REFER > HUMAN_REVIEW > ROUTINE > RETAKE. One good routine image covers the eye.
- Across eyes: the most severe eye wins (REFER > HUMAN_REVIEW > RETAKE > ROUTINE).
- Guardrails then escalate:

| Guardrail | Condition | Effect |
|---|---|---|
| G1 | VA worse than 6/12 in either eye | REFER |
| G1 | VA not measured | ROUTINE becomes HUMAN_REVIEW, with a flag |
| E2 | missing eye | that eye counts as RETAKE |
| G2 | macular risk | HUMAN_REVIEW |
| G3 | laterality mismatch at confidence ≥ 0.8 | HUMAN_REVIEW |

Every rule appends to a trace that the UI shows under "Why this outcome".

## 5. Data model (SQLite, `server/app/db.py`)

| Table | Purpose |
|---|---|
| encounters | patient code + optional demographics, VA JSON, AI encounter decision JSON, status, final outcome |
| images | eye, view, FOV, SHA-256, file paths, status, full result JSON, result hash |
| lesions | one row per lesion candidate (for queries; the UI reads them from the result JSON) |
| reviews | clinician decision, final outcome/urgency, reason, acknowledged flags |
| referrals / referral_events | referral state and history |
| audit | `seq, at, event, encounter_id, image_id, actor, payload, prev_hash, hash`. `hash = sha256(prev_hash + canonical_json(entry))`, genesis = 64 zeros. `GET /api/audit/verify` recomputes the chain |

Files live under `server/storage/images/{image_id}/` (original, canonical.jpg, overlay_*.png). Delete `server/storage/` to reset
the app; models are untouched.

## 6. API surface (implemented in `server/app/main.py`; contract in `docs/04_API.md`)

| Area | Endpoints |
|---|---|
| Health and config | `GET /health`, `GET /metrics`, `GET /policy` |
| Encounters | `POST /encounters`, `GET /encounters`, `GET /encounters/{id}`, `PATCH /encounters/{id}`, `PUT /encounters/{id}/va`, `DELETE /encounters/{id}/images/{image_id}` |
| Images | `POST /encounters/{id}/images`, `GET /images/{id}`, `GET /images/{id}/file/{original\|canonical}`, `GET /images/{id}/overlay/{kind}`, `POST /images/{id}/replay`, `GET /images/{id}/events` (SSE) |
| Review | `GET /queue`, `POST /encounters/{id}/review` |
| Referrals | `GET /referrals`, `PUT /referrals/{id}` |
| Records | `GET /encounters/{id}/report.pdf`, `GET /audit`, `GET /audit/verify`, `GET /stats/today` |
| Demo | `GET /demo-cases`, `GET /demo-cases/{name}/thumb`, `POST /demo-cases/{name}` |
| Logging | `POST /client-log`, `GET /client-log` (front-end errors → `logs/client.log`) |

Errors are `{detail}` with status 400, 404, 409 or 503. A 503 means the models are missing: there is no fake fallback.

## 7. Front end (`web/`)

- **Stack:** React 18, Vite, TypeScript strict, React Router, TanStack Query (server state), zustand (UI state), framer-motion,
  three.js through @react-three/fiber and drei, Tailwind.
- **Pages:** Today, NewScreening, Theatre, Case (Viewer2D, CaseEye, DecisionPanel, SignOff), Queue, Referrals, Evidence, Eye Lab,
  Settings, Audit.
- **API layer:** `src/api/client.ts` handles fetch, `sse.ts` the progress stream, `hooks.ts` the queries/mutations, and `types.ts`
  mirrors 04_API.md. Mock mode (`VITE_MOCK=1`) swaps in `mock.ts` + `fixtures.ts` + `mockPolicy.ts`, all in the browser.
- **3D:** `three/Stage.tsx` is the single Canvas wrapper. It:
  - caps DPR;
  - generates a procedural environment (no HDRI download);
  - auto-falls back to low power;
  - recovers from WebGL context loss ("3D paused · Restore 3D").

  The eye is procedural (`EyeModel.tsx`). The fundus → globe projection is a fragment shader (`shaders.ts`, `projection.ts`).
  Optics are pure functions (`lib/optics.ts`, Le Grand schematic eye, vector Snell's law).
- **Robustness:**
  - `components/ErrorBoundary.tsx` wraps each route; the top bar and tab bar sit outside it.
  - `lib/log.ts` sends window errors, unhandled rejections, console errors and WebGL events to `/api/client-log`.
- **Copy rules:** the honest-wording rules live in `src/lib/copy.ts`. The footer disclaimer is on every page.

## 8. Determinism and offline guarantees

- **Same input, same output:** preprocessing is pure OpenCV/NumPy. ONNX runs on CPU with fixed threading, and floats are
  rounded to 4 decimals before hashing. `POST /images/{id}/replay` re-runs the pipeline and compares hashes; e2e and eval
  both verified a match.
- **Recorded versions:** each result stores model versions (first 12 hex of each ONNX file's SHA-256, from
  `server/models/manifest.json`) and the policy version.
- **No network at runtime:**
  - fonts are bundled (Inter, OFL);
  - there are no CDNs, remote textures or HDRIs;
  - the only network use in the codebase is the offline dataset harness and HF weight downloads during training.
