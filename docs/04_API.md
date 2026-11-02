# 04 · API contract

Base URL `http://127.0.0.1:8765/api`. JSON everywhere except uploads (multipart), overlays (PNG), report (PDF) and
progress (SSE). Coordinates are **normalised to the canonical square** (0..1, origin top-left) unless stated.
Timestamps are ISO-8601 UTC strings. IDs are short strings (`enc_7f3a…`, `img_91bc…`).

The web app must work against this contract exactly. `web/src/api/fixtures.ts` holds example payloads that match
these shapes for development without a server (`VITE_MOCK=1`).

## Types

```ts
type Eye = "OD" | "OS";                        // OD = right eye, OS = left eye
type View = "macula" | "disc" | "other";
type Outcome = "ROUTINE" | "REFER" | "HUMAN_REVIEW" | "RETAKE";
type Urgency = "routine_12m" | "soon" | "immediate" | null;
type LesionType = "MA" | "HE" | "EX" | "SE";   // microaneurysm, haemorrhage, hard exudate, soft exudate

interface Reason { code: string; text: string }
interface RuleStep { rule: string; fired: boolean; detail: string }

interface QualityCheck {
  code: string; label: string; value: number; threshold: number; pass: boolean; hard: boolean; detail: string;
}
interface Quality {
  category: "adequate" | "usable" | "inadequate";
  score: number;                                   // 0..1
  probs: { adequate: number; usable: number; inadequate: number } | null;
  reasons: string[];                               // failed check codes, hard first
  checks: QualityCheck[];
}

interface Landmark { x: number; y: number; conf: number }
interface Landmarks {
  od: Landmark; fovea: Landmark;
  disc_diameter: number;                           // normalised units
  laterality: { predicted: Eye | "unknown"; confidence: number; selected: Eye; mismatch: boolean };
}

interface ModelGrade { name: string; probs: number[5]; p_referable: number; temperature: number }
interface Grading {
  models: ModelGrade[];                            // [cnn_effb3, vit_dinov2]
  ensemble: { probs: number[5]; grade: 0|1|2|3|4; p_referable: number };
}
interface Uncertainty {
  entropy: number; entropy_threshold: number;
  disagreement: number; disagreement_threshold: number;
  ood_score: number; ood_threshold: number;
  flags: string[];                                 // HIGH_ENTROPY | DISAGREEMENT | OOD
}

interface Lesion {
  id: string; type: LesionType;
  bbox: [number, number, number, number];         // x, y, w, h (normalised)
  centroid: [number, number];
  area_frac: number;                               // share of fundus area
  confidence: number;                              // mean probability inside the component
  dist_fovea_dd: number | null;                    // distance to fovea in disc diameters
}
interface Lesions {
  summary: Record<LesionType, { count: number; area_frac: number }>;
  items: Lesion[];                                 // at most 200, largest first
}
interface MacularRisk { flag: boolean; ex_within_1dd: number; label: string }

interface Triage {
  outcome: Outcome; urgency: Urgency; reasons: Reason[]; rule_trace: RuleStep[]; policy_version: string;
}

interface ImageResult {
  id: string; encounter_id: string; eye: Eye; view: View;
  status: "queued" | "running" | "done" | "error"; error: string | null;
  created_at: string; sha256: string;
  urls: {
    original: string; canonical: string;           // /api/images/{id}/file/original | canonical
    overlays: { cam: string; attention: string; lesions: string; MA: string; HE: string; EX: string; SE: string };
  };
  canonical_size: number;                          // 768
  fov_deg: number;                                 // camera field of view, default 45 (IDRiD 50)
  quality?: Quality; landmarks?: Landmarks; grading?: Grading; uncertainty?: Uncertainty;
  lesions?: Lesions; macular_risk?: MacularRisk; triage?: Triage;
  timings_ms?: Record<string, number>;
  model_versions?: Record<string, string>; result_hash?: string;
}

interface VA { value: string | null; logmar: number | null }   // "6/9", "20/40", "CF", null = not measured
interface Encounter {
  id: string; patient_code: string; age: number | null; sex: "F" | "M" | "X" | null;
  diabetes_years: number | null; notes: string; created_at: string;
  va: { OD: VA; OS: VA; method: string | null; measured_at: string | null; operator: string | null };
  images: ImageResult[];
  ai: {                                            // core.policy.triage_encounter, null until an image is done
    outcome: Outcome; urgency: Urgency;
    eyes: Record<Eye, { outcome: Outcome | null; urgency: Urgency; missing: boolean }>;
    flags: Reason[]; rule_trace: RuleStep[]; policy_version: string;
  } | null;
  status: "open" | "awaiting_review" | "signed";
  review: Review | null;
  referral: Referral | null;
  priority: number;                                // queue sort key, higher first
}
interface Review {
  reviewer: string; decision: "approve" | "override"; final_outcome: Outcome; final_urgency: Urgency;
  reason: string; acknowledged_flags: string[]; at: string;
}
type ReferralStatus = "issued" | "scheduled" | "attended" | "feedback" | "closed" | "not_completed";
interface Referral {
  id: string; encounter_id: string; status: ReferralStatus; priority: Urgency;
  facility: string | null; issued_at: string; appointment_at: string | null; attended_at: string | null;
  feedback: string | null; next_followup_at: string | null; not_completed_reason: string | null;
  events: { from: ReferralStatus | null; to: ReferralStatus; note: string; at: string }[];
}
interface EncounterSummary {
  id: string; patient_code: string; created_at: string; status: Encounter["status"];
  ai_outcome: Outcome | null; ai_urgency: Urgency; final_outcome: Outcome | null;
  thumb: string | null; n_images: number; flags: string[]; priority: number;
}
```

## Endpoints

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | | `{status:"ok", models:{name:{loaded:bool, sha:string}}, missing:string[], version:string, offline:true}` |
| POST | `/encounters` | `{patient_code?, age?, sex?, diabetes_years?, notes?}` | `Encounter` (patient_code auto `RT-YYMMDD-XXXX` if empty) |
| GET | `/encounters` | `?status=&outcome=&q=&limit=50` | `EncounterSummary[]` newest first |
| GET | `/encounters/{id}` | | `Encounter` |
| PATCH | `/encounters/{id}` | partial of patient fields | `Encounter` |
| PUT | `/encounters/{id}/va` | `{OD:{value}, OS:{value}, method?, measured_at?, operator?}` | `Encounter` (re-runs encounter policy) |
| DELETE | `/encounters/{id}/images/{image_id}` | | `Encounter` |
| POST | `/encounters/{id}/images` | multipart: `file`, `eye`, `view`, `fov_deg?` | `ImageResult` with `status:"queued"`; analysis starts in a worker thread |
| GET | `/images/{id}` | | `ImageResult` |
| GET | `/images/{id}/events` | | SSE stream (below) |
| GET | `/images/{id}/file/{original\|canonical}` | | JPEG |
| GET | `/images/{id}/overlay/{cam\|attention\|lesions\|MA\|HE\|EX\|SE}` | | RGBA PNG, canonical size |
| POST | `/images/{id}/replay` | | `{match:boolean, original_hash, replay_hash, ms}` |
| GET | `/queue` | | `EncounterSummary[]` with status `awaiting_review`, sorted by `priority` desc |
| POST | `/encounters/{id}/review` | `{reviewer, decision, final_outcome, final_urgency?, reason, acknowledged_flags[]}` | `Encounter`. `override` requires non-empty reason. All encounter flags must be acknowledged. If final outcome is REFER a referral is created with status `issued`. |
| PUT | `/referrals/{id}` | `{to:ReferralStatus, note?, facility?, appointment_at?, attended_at?, feedback?, next_followup_at?, not_completed_reason?}` | `Referral`. Allowed moves: issued→scheduled→attended→feedback→closed; any open state→not_completed (reason required) |
| GET | `/referrals` | `?status=` | `{items: (Referral & {patient_code})[], stats:{total, completed_rate, median_days_to_attend, overdue, with_feedback_rate}}` (overdue = appointment date passed and not attended, or issued > 30 days with no appointment) |
| GET | `/encounters/{id}/report.pdf` | | PDF |
| GET | `/audit` | `?encounter_id=&limit=200` | `{items:{seq,at,event,encounter_id,image_id,actor,payload,prev_hash,hash}[]}` |
| GET | `/audit/verify` | | `{valid:boolean, checked:number, first_bad_seq:number|null}` |
| GET | `/metrics` | | contents of `server/models/metrics.json` (shape in 03_ML.md) or `{available:false}` |
| GET | `/policy` | | contents of `server/models/policy.json` (thresholds + provenance) |
| GET | `/demo-cases` | | `{name, title, description, source, license, thumb, eye, view}[]` |
| POST | `/demo-cases/{name}` | | `Encounter` created with that image uploaded and analysing |
| GET | `/stats/today` | | `{screened_today, awaiting_review, referred_today, retake_today, total}` |

Errors: `{detail: string}` with 400 (bad input), 404, 409 (illegal referral move), 503 (models missing).

## SSE progress: `GET /images/{id}/events`

`text/event-stream`. Each message is `event: <name>\ndata: <json>\n\n`.

| event | data | When |
|---|---|---|
| `step` | `{step, status:"start"\|"done", ms?, partial?}` | for each step in order: `decode`, `quality`, `landmarks`, `grader_cnn`, `grader_vit`, `lesions`, `uncertainty`, `policy`, `overlays` |
| `done` | full `ImageResult` | finished |
| `error` | `{message}` | failed |

`partial` carries the piece just computed so the UI can animate it immediately: `quality` → `Quality`;
`landmarks` → `Landmarks`; `grader_cnn` / `grader_vit` → `ModelGrade`; `lesions` → `Lesions`; `uncertainty` →
`Uncertainty`; `policy` → `Triage`. If the image is already done when the stream opens, the server sends `done`
immediately. The server keeps each step visible for at least 250 ms so the theatre animation is readable; the
real compute time is reported in `ms`.

## metrics.json (served by `/metrics`)

```jsonc
{
  "available": true,
  "generated_at": "...", "git": "...", "policy_version": "...",
  "datasets": { "aptos_test": {"n": 550, "source": "APTOS 2019 (internal held-out)"},
                "idrid": {"n": 516, "source": "IDRiD (external)"}, "ddr": {"n": 4105, "source": "DDR test (external)"} },
  "models": {
    "cnn_effb3": { "<dataset>": { "auroc": 0.0, "auroc_ci": [0,0], "sens": 0.0, "sens_ci": [0,0], "spec": 0.0, "spec_ci": [0,0],
                    "ppv": 0.0, "npv": 0.0, "qwk": 0.0, "ece_before": 0.0, "ece_after": 0.0, "brier": 0.0,
                    "per_grade_recall": [0,0,0,0,0], "confusion": [[...5x5...]],
                    "reliability": {"bins": [...], "acc": [...], "conf": [...], "count": [...]},
                    "roc": {"fpr": [...], "tpr": [...]} } },
    "vit_dinov2": { ... }, "ensemble": { ... }
  },
  "triage": { "<dataset>": { "coverage": 0.0, "auto_sens": 0.0, "auto_spec": 0.0, "referral_rate": 0.0, "human_review_rate": 0.0,
               "retake_rate": 0.0, "risk_coverage": {"coverage": [...], "risk": [...]} } },
  "quality": { "deepdrid_val": {"n": 0, "acc": 0.0, "auroc_inadequate": 0.0, "confusion": [[...]]},
               "ddr_ungradable": {"n": 0, "rejected_rate": 0.0}, "synthetic": {...} },
  "lesions": { "idrid_test": {"dice": {"MA":0,"HE":0,"EX":0,"SE":0}, "aupr": {...}}, "ddr_test": {...} },
  "landmarks": { "idrid_test": {"od_err_dd_median": 0.0, "fovea_err_dd_median": 0.0, "od_within_1dd": 0.0, "fovea_within_1dd": 0.0} },
  "explanations": { "pointing_game": {...}, "deletion_auc": {...}, "randomisation_ssim": {...} },
  "latency_ms": { "p50": 0, "p95": 0, "cpu": "..." },
  "notes": [ "..." ]
}
```
