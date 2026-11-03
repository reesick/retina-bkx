// Mirrors docs/04_API.md exactly. Keep in sync with the server.

export type Eye = "OD" | "OS"; // OD = right eye, OS = left eye
export type View = "macula" | "disc" | "other";
export type Outcome = "ROUTINE" | "REFER" | "HUMAN_REVIEW" | "RETAKE";
export type Urgency = "routine_12m" | "soon" | "immediate" | null;
export type LesionType = "MA" | "HE" | "EX" | "SE"; // microaneurysm, haemorrhage, hard exudate, soft exudate
export type Grade = 0 | 1 | 2 | 3 | 4;
/** Five probabilities, grades 0..4. */
export type Probs5 = [number, number, number, number, number];

export interface Reason { code: string; text: string }
export interface RuleStep { rule: string; fired: boolean; detail: string }

export interface QualityCheck {
  code: string; label: string; value: number; threshold: number; pass: boolean; hard: boolean; detail: string;
}
export interface Quality {
  category: "adequate" | "usable" | "inadequate";
  score: number; // 0..1
  probs: { adequate: number; usable: number; inadequate: number } | null;
  reasons: string[]; // failed check codes, hard first
  checks: QualityCheck[];
}

export interface Landmark { x: number; y: number; conf: number }
export interface Landmarks {
  od: Landmark; fovea: Landmark;
  disc_diameter: number; // normalised units
  laterality: { predicted: Eye | "unknown"; confidence: number; selected: Eye; mismatch: boolean };
}

export interface ModelGrade { name: string; probs: Probs5; p_referable: number; temperature: number }
export interface Grading {
  models: ModelGrade[]; // [cnn_effb3, vit_dinov2]
  ensemble: { probs: Probs5; grade: Grade; p_referable: number };
}
export interface Uncertainty {
  entropy: number; entropy_threshold: number;
  disagreement: number; disagreement_threshold: number;
  ood_score: number; ood_threshold: number;
  flags: string[]; // HIGH_ENTROPY | DISAGREEMENT | OOD
}

export interface Lesion {
  id: string; type: LesionType;
  bbox: [number, number, number, number]; // x, y, w, h (normalised)
  centroid: [number, number];
  area_frac: number; // share of fundus area
  confidence: number; // mean probability inside the component
  dist_fovea_dd: number | null; // distance to fovea in disc diameters
}
export interface Lesions {
  summary: Record<LesionType, { count: number; area_frac: number }>;
  items: Lesion[]; // at most 200, largest first
}
export interface MacularRisk { flag: boolean; ex_within_1dd: number; label: string }

export interface Triage {
  outcome: Outcome; urgency: Urgency; reasons: Reason[]; rule_trace: RuleStep[]; policy_version: string;
}

export type OverlayKind = "cam" | "attention" | "lesions" | LesionType;

export interface ImageResult {
  id: string; encounter_id: string; eye: Eye; view: View;
  status: "queued" | "running" | "done" | "error"; error: string | null;
  created_at: string; sha256: string;
  urls: {
    original: string; canonical: string;
    overlays: { cam: string; attention: string; lesions: string; MA: string; HE: string; EX: string; SE: string };
  };
  canonical_size: number; // 768
  fov_deg: number; // camera field of view, default 45 (IDRiD 50)
  quality?: Quality; landmarks?: Landmarks; grading?: Grading; uncertainty?: Uncertainty;
  lesions?: Lesions; macular_risk?: MacularRisk; triage?: Triage;
  timings_ms?: Record<string, number>;
  model_versions?: Record<string, string>; result_hash?: string;
}

export interface VA { value: string | null; logmar: number | null } // "6/9", "20/40", "CF", null = not measured

export interface EncounterAI {
  outcome: Outcome; urgency: Urgency;
  eyes: Record<Eye, { outcome: Outcome | null; urgency: Urgency; missing: boolean }>;
  flags: Reason[]; rule_trace: RuleStep[]; policy_version: string;
}

export interface Encounter {
  id: string; patient_code: string; age: number | null; sex: "F" | "M" | "X" | null;
  diabetes_years: number | null; notes: string; created_at: string;
  va: { OD: VA; OS: VA; method: string | null; measured_at: string | null; operator: string | null };
  images: ImageResult[];
  ai: EncounterAI | null;
  status: "open" | "awaiting_review" | "signed";
  review: Review | null;
  referral: Referral | null;
  priority: number; // queue sort key, higher first
}
export interface Review {
  reviewer: string; decision: "approve" | "override"; final_outcome: Outcome; final_urgency: Urgency;
  reason: string; acknowledged_flags: string[]; at: string;
}
export type ReferralStatus = "issued" | "scheduled" | "attended" | "feedback" | "closed" | "not_completed";
export interface ReferralEvent { from: ReferralStatus | null; to: ReferralStatus; note: string; at: string }
export interface Referral {
  id: string; encounter_id: string; status: ReferralStatus; priority: Urgency;
  facility: string | null; issued_at: string; appointment_at: string | null; attended_at: string | null;
  feedback: string | null; next_followup_at: string | null; not_completed_reason: string | null;
  events: ReferralEvent[];
}
export interface EncounterSummary {
  id: string; patient_code: string; created_at: string; status: Encounter["status"];
  ai_outcome: Outcome | null; ai_urgency: Urgency; final_outcome: Outcome | null;
  thumb: string | null; n_images: number; flags: string[]; priority: number;
}

// ---------------------------------------------------------------- endpoint payloads

export interface Health {
  status: "ok"; models: Record<string, { loaded: boolean; sha: string }>; missing: string[]; version: string; offline: true;
}

export interface EncounterCreate {
  patient_code?: string; age?: number | null; sex?: "F" | "M" | "X" | null; diabetes_years?: number | null; notes?: string;
}
export type EncounterPatch = Partial<Pick<Encounter, "patient_code" | "age" | "sex" | "diabetes_years" | "notes">>;

export interface VAUpdate {
  OD: { value: string | null }; OS: { value: string | null };
  method?: string | null; measured_at?: string | null; operator?: string | null;
}

export interface ReplayResult { match: boolean; original_hash: string; replay_hash: string; ms: number }

export interface ReviewCreate {
  reviewer: string; decision: "approve" | "override"; final_outcome: Outcome; final_urgency?: Urgency;
  reason: string; acknowledged_flags: string[];
}

export interface ReferralUpdate {
  to: ReferralStatus; note?: string; facility?: string | null; appointment_at?: string | null; attended_at?: string | null;
  feedback?: string | null; next_followup_at?: string | null; not_completed_reason?: string | null;
}
export type ReferralWithPatient = Referral & { patient_code: string };
export interface ReferralList {
  items: ReferralWithPatient[];
  stats: { total: number; completed_rate: number; median_days_to_attend: number | null; overdue: number; with_feedback_rate: number };
}

export interface AuditEntry {
  seq: number; at: string; event: string; encounter_id: string | null; image_id: string | null; actor: string;
  payload: Record<string, unknown>; prev_hash: string; hash: string;
}
export interface AuditList { items: AuditEntry[] }
export interface AuditVerify { valid: boolean; checked: number; first_bad_seq: number | null }

export interface DemoCase {
  name: string; title: string; description: string; source: string; license: string; thumb: string; eye: Eye; view: View;
}

export interface TodayStats { screened_today: number; awaiting_review: number; referred_today: number; retake_today: number; total: number }

// ---------------------------------------------------------------- metrics.json (ml/eval/evaluate.py)

export type CI = [number, number];
export interface Reliability { bins: number[]; acc: number[]; conf: number[]; count: number[] }
export interface ReliabilityPair { before?: Reliability; after?: Reliability }
export interface GradeMetrics {
  n?: number; prevalence?: number;
  auroc: number | null; auroc_ci?: CI | null; sens: number; sens_ci?: CI | null; spec: number; spec_ci?: CI | null;
  ppv?: number | null; npv?: number | null; qwk?: number | null; ece_before?: number | null; ece_after?: number | null;
  brier?: number | null; per_grade_recall?: number[]; confusion?: number[][];
  /** Either a single (calibrated) diagram or a {before, after} pair, depending on the eval version. */
  reliability?: Reliability | ReliabilityPair; reliability_before?: Reliability; reliability_after?: Reliability;
  roc?: { fpr: number[]; tpr: number[] };
}
export interface TriageMetrics {
  n?: number; coverage: number; auto_sens: number | null; auto_spec: number | null; referral_rate: number;
  human_review_rate: number; retake_rate: number; routine_rate?: number;
  risk_coverage?: { coverage: number[]; risk: number[] };
  [k: string]: unknown;
}
export interface MetricsAvailable {
  available: true;
  generated_at: string; git?: string; policy_version: string;
  datasets: Record<string, { n: number; source: string }>;
  models: Record<string, Record<string, GradeMetrics>>;
  triage: Record<string, TriageMetrics>;
  quality?: Record<string, Record<string, unknown>>;
  lesions?: Record<string, { dice?: Partial<Record<LesionType, number>>; aupr?: Partial<Record<LesionType, number>> } & Record<string, unknown>>;
  landmarks?: Record<string, { od_err_dd_median?: number; fovea_err_dd_median?: number; od_within_1dd?: number; fovea_within_1dd?: number } & Record<string, unknown>>;
  explanations?: Record<string, Record<string, unknown> | number>;
  latency_ms?: { p50?: number; p95?: number; cpu?: string } & Record<string, unknown>;
  determinism?: { verified?: boolean } & Record<string, unknown>;
  app_eval?: AppEval;
  leakage_check?: LeakageCheck;
  site_calibration?: SiteCalibration;
  quantization?: Quantization;
  notes: string[];
}
export type Metrics = MetricsAvailable | { available: false };

// ---------------------------------------------------------------- app-level evaluation (optional keys)

export type EvalSet = "idrid" | "ddr" | "deepdrid_val" | "aptos_test";
export interface AppTriage {
  n?: number; n_gradable?: number; coverage?: number; auto_sens?: number | null; auto_spec?: number | null;
  routine_rate?: number; referral_rate?: number; human_review_rate?: number; retake_rate?: number;
  referable_routed_routine?: number; referable_total?: number; nonreferable_routine_rate?: number | null;
  ungradable_n?: number; ungradable_routine?: number; excluded_lesion_train_overlap?: number; landmarks?: string;
}
export type QualityBand = "adequate" | "usable" | "inadequate";
export type BandMetrics = AppTriage & { share?: number; auroc?: number | null };
export interface EncounterLevel {
  n_eyes?: number; n_patients?: number; referable_patients?: number;
  referable_routed_routine?: number; referable_total?: number; referable_not_routine_rate?: number | null;
  nonreferable_routine_rate?: number | null; outcomes?: Partial<Record<Outcome, number>>;
}
export interface EncounterView {
  eye_level?: EncounterLevel; patient_level_va_not_recorded?: EncounterLevel; patient_level_va_assumed_normal?: EncounterLevel;
}
export interface GateArm {
  referable_routed_routine?: number; referable_total?: number; routine_rate?: number; retake_rate?: number;
  human_review_rate?: number; referral_rate?: number; wrong_auto_decisions?: number;
}
export interface AppEval {
  method?: string;
  fidelity_gpu_vs_onnx?: { n?: number; outcome_agreement?: number; max_abs_diff_p_referable?: number };
  sets?: Partial<Record<EvalSet, AppTriage>>;
  quality_bands?: Partial<Record<EvalSet, Partial<Record<QualityBand, BandMetrics>>>>;
  macular_risk_vs_dme?: { n?: number; dme_positive?: number; sensitivity?: number | null; specificity?: number | null; ppv?: number | null; npv?: number | null; note?: string };
  deepdrid_encounters?: { single_view?: EncounterView; dual_view?: EncounterView; note?: string };
  quality_gate_ablation?: { n?: number; with_quality_gate?: GateArm; without_quality_gate?: GateArm };
}
export interface LeakageSet {
  overlapping_images?: number; n_after_removal?: number; referable_routed_routine?: number; referable_total?: number;
  human_review_rate?: number; coverage?: number; auto_sens?: number | null;
  full_set?: { referable_routed_routine?: number; referable_total?: number; human_review_rate?: number; coverage?: number };
}
export interface LeakageCheck { method?: string; scope?: string; idrid?: LeakageSet; ddr?: LeakageSet }
export interface SiteArm {
  auroc?: number | null; sens?: number | null; spec?: number | null; ppv?: number | null; npv?: number | null; ece?: number | null; t_refer?: number | null;
  triage?: { n?: number; human_review_rate?: number; routine_rate?: number; referable_routed_routine?: number; referable_total?: number; nonreferable_routine_rate?: number | null };
}
export interface SiteCalibration {
  profile?: { site?: string; temperatures?: Record<string, number>; t_refer?: number; provenance?: string | Record<string, unknown> };
  test?: { dataset?: string; generic?: SiteArm; site_calibrated?: SiteArm };
}
export interface Quantization {
  model?: string; method?: string; size_mb?: { fp32?: number; int8?: number }; cpu_ms_per_image?: { fp32?: number; int8?: number };
  idrid_auroc_vit?: { fp32?: number; int8?: number }; idrid_auroc_ensemble?: { fp32?: number; int8?: number };
  max_abs_diff_p_referable_ensemble?: number; decision_flips_at_t_refer?: number; n?: number; accepted?: boolean;
}
export interface ExplanationIoU { dataset?: string; top_5pct?: { cnn?: number; vit?: number; random?: number }; top_10pct?: { cnn?: number; vit?: number; random?: number }; note?: string }
export interface ExplanationStability { dataset?: string; spearman_original_vs_perturbed?: Record<string, { cnn?: number; vit?: number }>; note?: string }
export interface ExplanationRuntime { grader_cnn?: number; grader_vit?: number; note?: string }

// ---------------------------------------------------------------- /api/failures

export type FailureCategory = "missed_referable" | "over_referral" | "abstained_healthy" | "wrong_retake";
export interface FailureCase {
  file?: string; image: string; dataset: string; image_id: string; category: FailureCategory;
  dataset_grade: number | null; dataset_grade_label?: string; outcome: Outcome; urgency?: Urgency;
  p_referable: number | null; predicted_grade?: number | null; quality?: string;
  quality_reasons?: string[]; reasons?: (string | Reason)[]; fired_rules?: string[];
  uncertainty?: { entropy?: number; disagreement?: number; ood_score?: number };
  license?: string;
}
export interface Failures {
  available: boolean; cases?: FailureCase[]; idrid_counts?: Partial<Record<FailureCategory, number>>; note?: string;
}

// ---------------------------------------------------------------- policy.json

export interface Policy {
  version: string;
  t_refer: number; t_refer_low?: number; t_severe?: number;
  t_entropy: number; t_disagreement: number; t_ood: number;
  lesion_suspicious?: { HE_area_frac: number; EX_area_frac: number; HE_count: number };
  va_refer_logmar?: number; macular_radius_dd?: number; require_both_eyes?: boolean;
  temperatures?: Record<string, number>;
  provenance: Record<string, string>;
  [k: string]: unknown;
}

// ---------------------------------------------------------------- SSE

export type StepName =
  | "decode" | "quality" | "landmarks" | "grader_cnn" | "grader_vit" | "lesions" | "uncertainty" | "policy" | "overlays";

export type StepPartial = Quality | Landmarks | ModelGrade | Lesions | Uncertainty | Triage;

export interface StepEvent { step: StepName; status: "start" | "done"; ms?: number; partial?: StepPartial }

export type ProgressEvent =
  | { type: "step"; data: StepEvent }
  | { type: "done"; data: ImageResult }
  | { type: "error"; data: { message: string } };

export interface ApiError { detail: string }
