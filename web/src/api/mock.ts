// In-browser mock of the whole API (VITE_MOCK=1). MOCK DATA ONLY: in-memory, resets on reload.
import { ApiError, type Method } from "./client";
import type {
  AuditEntry, AuditList, AuditVerify, DemoCase, Encounter, EncounterCreate, EncounterSummary, Eye, FailureCase, FailureCategory, Failures, Grade, Health, ImageResult,
  LesionType, Outcome, ProgressEvent, Referral, ReferralList, ReferralStatus, ReferralUpdate, ReplayResult, ReviewCreate,
  StepEvent, StepName, TodayStats, VAUpdate, View,
} from "./types";
import { analyse, DEMO_DEFS, MOCK_POLICY, MODEL_VERSIONS, mockMetrics, type Analysis, type Scenario } from "./fixtures";
import { triageEncounter, severity } from "./mockPolicy";
import { drawFundus, drawHeat, drawLesionMask, toJpeg, toPng, type FundusSpec } from "../lib/fundusArt";
import { sha256 } from "../lib/sha256";
import { hashSeed, rng } from "../lib/rng";
import { vaToLogmar } from "../lib/va";
import { referralMoveAllowed } from "../lib/format";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const clone = <T,>(x: T): T => structuredClone(x);

interface ImgMeta {
  analysis: Analysis;
  art: { canonical: string; overlays: ImageResult["urls"]["overlays"]; thumb: string } | null;
  userCanvas: HTMLCanvasElement | null;
  sha: string;
}

const db = {
  encounters: new Map<string, Encounter>(),
  meta: new Map<string, ImgMeta>(),
  referrals: new Map<string, Referral>(),
  audit: [] as AuditEntry[],
  seeded: false,
  replays: 0,
};

let idc = 0;
// Deterministic ids so seeded mock cases keep the same URL across reloads.
const newId = (prefix: string) => `${prefix}_${sha256(`${prefix}-${++idc}`).slice(0, 8)}`;

// ------------------------------------------------------------------ audit chain
function audit(event: string, actor: string, payload: Record<string, unknown>, encounter_id: string | null = null, image_id: string | null = null, at = now()) {
  const prev = db.audit.length ? db.audit[db.audit.length - 1].hash : "0".repeat(64);
  const seq = db.audit.length + 1;
  const body = { seq, at, event, encounter_id, image_id, actor, payload, prev_hash: prev };
  db.audit.push({ ...body, hash: sha256(JSON.stringify(body)) });
}

// ------------------------------------------------------------------ art
function artSpec(a: Analysis): FundusSpec {
  return { ...a.art, dd: a.art.dd, lesions: a.art.lesions };
}
function ensureArt(id: string): ImgMeta["art"] {
  const m = db.meta.get(id);
  if (!m) return null;
  if (m.art) return m.art;
  const spec = artSpec(m.analysis);
  const fundus = m.userCanvas ?? drawFundus(spec, 640);
  const overlays = {
    cam: toPng(drawHeat(spec, "cam")),
    attention: toPng(drawHeat(spec, "attention")),
    lesions: toPng(drawLesionMask(spec, "all")),
    MA: toPng(drawLesionMask(spec, "MA")),
    HE: toPng(drawLesionMask(spec, "HE")),
    EX: toPng(drawLesionMask(spec, "EX")),
    SE: toPng(drawLesionMask(spec, "SE")),
  };
  const t = document.createElement("canvas");
  t.width = t.height = 160;
  t.getContext("2d")!.drawImage(fundus, 0, 0, 160, 160);
  m.art = { canonical: toJpeg(fundus), overlays, thumb: toJpeg(t, 0.8) };
  return m.art;
}
const thumbs = new Map<string, string>();
function thumbFor(id: string): string | null {
  const m = db.meta.get(id);
  if (!m) return null;
  if (m.art) return m.art.thumb;
  if (thumbs.has(id)) return thumbs.get(id)!;
  const c = m.userCanvas ? (() => {
    const t = document.createElement("canvas");
    t.width = t.height = 160;
    t.getContext("2d")!.drawImage(m.userCanvas!, 0, 0, 160, 160);
    return t;
  })() : drawFundus(artSpec(m.analysis), 160);
  const u = toJpeg(c, 0.8);
  thumbs.set(id, u);
  return u;
}

function withUrls(img: ImageResult): ImageResult {
  const art = ensureArt(img.id);
  if (!art) return img;
  return { ...img, urls: { original: art.canonical, canonical: art.canonical, overlays: art.overlays } };
}
const emptyUrls = (id: string): ImageResult["urls"] => ({
  original: `/api/images/${id}/file/original`, canonical: `/api/images/${id}/file/canonical`,
  overlays: { cam: "", attention: "", lesions: "", MA: "", HE: "", EX: "", SE: "" },
});

// ------------------------------------------------------------------ encounter logic
function recompute(e: Encounter) {
  const done = e.images.filter((i) => i.status === "done");
  e.ai = done.length ? triageEncounter(done, { OD: e.va.OD, OS: e.va.OS }, MOCK_POLICY) : null;
  if (e.status !== "signed") e.status = e.ai && e.images.every((i) => i.status === "done" || i.status === "error") ? "awaiting_review" : "open";
  const o = e.ai?.outcome;
  e.priority = o ? severity[o] * 25 + (e.ai?.urgency === "immediate" ? 20 : 0) + e.ai!.flags.length * 2 : 0;
}

function finishImage(e: Encounter, img: ImageResult) {
  const m = db.meta.get(img.id)!;
  const a = m.analysis;
  Object.assign(img, {
    status: "done", error: null, quality: a.quality, landmarks: a.landmarks, grading: a.grading, uncertainty: a.uncertainty,
    lesions: a.lesions, macular_risk: a.macular_risk, triage: a.triage, timings_ms: a.timings_ms, model_versions: a.model_versions,
    result_hash: a.result_hash,
  } satisfies Partial<ImageResult>);
  recompute(e);
}

function makeImage(e: Encounter, eye: Eye, view: View, sc: Scenario, seed: number, fov: number, created: string, userCanvas: HTMLCanvasElement | null = null, sha?: string): ImageResult {
  const id = newId("img");
  const analysis = analyse(seed, sc, eye, view, fov);
  const s = sha ?? sha256(`fundus-${seed}`);
  db.meta.set(id, { analysis, art: null, userCanvas, sha: s });
  const img: ImageResult = {
    id, encounter_id: e.id, eye, view, status: "queued", error: null, created_at: created, sha256: s,
    urls: emptyUrls(id), canonical_size: 768, fov_deg: fov,
  };
  e.images.push(img);
  return img;
}

function blankEncounter(b: EncounterCreate, created = now()): Encounter {
  const d = new Date(created);
  const code = b.patient_code?.trim() ||
    `RT-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${sha256(created + idc).slice(0, 4).toUpperCase()}`;
  return {
    id: newId("enc"), patient_code: code, age: b.age ?? null, sex: b.sex ?? null, diabetes_years: b.diabetes_years ?? null,
    notes: b.notes ?? "", created_at: created,
    va: { OD: { value: null, logmar: null }, OS: { value: null, logmar: null }, method: null, measured_at: null, operator: null },
    images: [], ai: null, status: "open", review: null, referral: null, priority: 0,
  };
}

function setVA(e: Encounter, od: string | null, os: string | null, method: string | null = "Snellen", operator: string | null = "S. Iyer", at = e.created_at) {
  e.va = { OD: { value: od, logmar: vaToLogmar(od) }, OS: { value: os, logmar: vaToLogmar(os) }, method, measured_at: at, operator };
}

function issueReferral(e: Encounter, urgency: Referral["priority"], at = now()): Referral {
  const r: Referral = {
    id: newId("ref"), encounter_id: e.id, status: "issued", priority: urgency, facility: null, issued_at: at, appointment_at: null,
    attended_at: null, feedback: null, next_followup_at: null, not_completed_reason: null,
    events: [{ from: null, to: "issued", note: "Referral issued at sign-off", at }],
  };
  db.referrals.set(r.id, r);
  e.referral = r;
  return r;
}

function sign(e: Encounter, b: ReviewCreate, at = now()) {
  e.review = { reviewer: b.reviewer, decision: b.decision, final_outcome: b.final_outcome, final_urgency: b.final_urgency ?? null, reason: b.reason, acknowledged_flags: b.acknowledged_flags, at };
  e.status = "signed";
  audit("review.signed", b.reviewer, { decision: b.decision, final_outcome: b.final_outcome, ai_outcome: e.ai?.outcome, reason: b.reason }, e.id, null, at);
  if (b.final_outcome === "REFER") {
    const r = issueReferral(e, b.final_urgency ?? "soon", at);
    audit("referral.issued", b.reviewer, { referral_id: r.id, priority: r.priority }, e.id, null, at);
  }
}

function summary(e: Encounter): EncounterSummary {
  const first = e.images[0];
  return {
    id: e.id, patient_code: e.patient_code, created_at: e.created_at, status: e.status,
    ai_outcome: e.ai?.outcome ?? null, ai_urgency: e.ai?.urgency ?? null, final_outcome: e.review?.final_outcome ?? null,
    thumb: first ? thumbFor(first.id) : null, n_images: e.images.length, flags: e.ai?.flags.map((f) => f.code) ?? [], priority: e.priority,
  };
}

// ------------------------------------------------------------------ seed
interface SeedDef { min: number; va: [string | null, string | null]; od: Scenario; os: Scenario | null; age: number; sex: "F" | "M"; dy: number; sign?: "approve" | Outcome; ref?: ReferralStatus; refDaysAgo?: number }

function seed() {
  if (db.seeded) return;
  db.seeded = true;
  const defs: SeedDef[] = [
    { min: 12, va: ["6/9", "6/12"], od: { grade: 2 }, os: { grade: 1 }, age: 58, sex: "M", dy: 11 },
    { min: 27, va: [null, "6/6"], od: { grade: 0 }, os: { grade: 0 }, age: 46, sex: "F", dy: 4 },
    { min: 41, va: ["6/6", "6/9"], od: { grade: 0, quality: "inadequate", issue: "dark" }, os: { grade: 0 }, age: 63, sex: "F", dy: 9 },
    { min: 58, va: ["6/18", "6/9"], od: { grade: 3 }, os: { grade: 2 }, age: 61, sex: "M", dy: 15 },
    { min: 75, va: ["6/9", "6/9"], od: { grade: 1, disagree: true }, os: { grade: 0 }, age: 52, sex: "F", dy: 6 },
    { min: 96, va: ["6/12", "6/9"], od: { grade: 0 }, os: { grade: 2, macular: true }, age: 67, sex: "M", dy: 20 },
    { min: 130, va: ["6/6", "6/6"], od: { grade: 0 }, os: { grade: 0 }, age: 39, sex: "M", dy: 2, sign: "approve" },
    { min: 180, va: ["6/9", "6/6"], od: { grade: 0, quality: "usable", issue: "blur" }, os: { grade: 0 }, age: 55, sex: "F", dy: 7, sign: "approve" },
    { min: 60 * 26, va: ["6/24", "6/18"], od: { grade: 4 }, os: { grade: 3 }, age: 59, sex: "M", dy: 18, sign: "approve", ref: "scheduled", refDaysAgo: 1 },
    { min: 60 * 24 * 6, va: ["6/12", "6/9"], od: { grade: 2 }, os: { grade: 2 }, age: 64, sex: "F", dy: 12, sign: "approve", ref: "attended", refDaysAgo: 6 },
    { min: 60 * 24 * 12, va: ["6/9", "6/9"], od: { grade: 2 }, os: { grade: 1 }, age: 50, sex: "M", dy: 8, sign: "approve", ref: "feedback", refDaysAgo: 12 },
    { min: 60 * 24 * 21, va: ["6/36", "6/12"], od: { grade: 3 }, os: { grade: 1 }, age: 70, sex: "F", dy: 25, sign: "approve", ref: "closed", refDaysAgo: 21 },
    { min: 60 * 24 * 40, va: ["6/9", "6/12"], od: { grade: 2 }, os: { grade: 0 }, age: 57, sex: "M", dy: 10, sign: "approve", ref: "issued", refDaysAgo: 40 },
    { min: 60 * 24 * 18, va: ["6/12", "6/12"], od: { grade: 1, disagree: true }, os: { grade: 2 }, age: 48, sex: "F", dy: 5, sign: "REFER", ref: "not_completed", refDaysAgo: 18 },
    { min: 60 * 24 * 9, va: ["6/9", "6/9"], od: { grade: 2 }, os: { grade: 2 }, age: 62, sex: "M", dy: 14, sign: "approve", ref: "scheduled", refDaysAgo: 9 },
  ];
  const r = rng(42);
  defs.sort((a, b) => b.min - a.min).forEach((d, i) => {
    const created = ago(d.min);
    const e = blankEncounter({ age: d.age, sex: d.sex, diabetes_years: d.dy }, created);
    db.encounters.set(e.id, e);
    audit("encounter.created", "S. Iyer", { patient_code: e.patient_code }, e.id, null, created);
    setVA(e, d.va[0], d.va[1], "Snellen", "S. Iyer", created);
    for (const [eye, sc] of [["OD", d.od], ["OS", d.os]] as [Eye, Scenario | null][]) {
      if (!sc) continue;
      const img = makeImage(e, eye, "macula", sc, 5000 + i * 17 + (eye === "OD" ? 0 : 7), 45, created);
      audit("image.uploaded", "S. Iyer", { eye, view: "macula", sha256: img.sha256 }, e.id, img.id, created);
      finishImage(e, img);
      audit("image.analysed", "system", { outcome: img.triage!.outcome, result_hash: img.result_hash }, e.id, img.id, created);
    }
    if (d.sign) {
      const at = new Date(new Date(created).getTime() + 3600000 * (0.5 + r())).toISOString();
      const ai = e.ai!;
      const final = d.sign === "approve" ? ai.outcome : d.sign;
      sign(e, {
        reviewer: "Dr. A. Rao", decision: d.sign === "approve" ? "approve" : "override", final_outcome: final,
        final_urgency: final === "REFER" ? (ai.urgency ?? "soon") : final === "ROUTINE" ? "routine_12m" : null,
        reason: d.sign === "approve" ? "" : "Additional clinical info", acknowledged_flags: ai.flags.map((f) => f.code),
      }, at);
      const ref = e.referral;
      if (ref && d.ref && d.ref !== "issued") {
        const path: ReferralStatus[] = d.ref === "not_completed" ? ["not_completed"] : ["scheduled", "attended", "feedback", "closed"].slice(0, ["scheduled", "attended", "feedback", "closed"].indexOf(d.ref) + 1) as ReferralStatus[];
        let t = new Date(at).getTime();
        for (const to of path) {
          t += 86400000 * (to === "attended" ? 4 : 1.5);
          const tIso = new Date(Math.min(t, Date.now() - 60000)).toISOString();
          const from = ref.status;
          ref.status = to;
          if (to === "scheduled") { ref.facility = "District Eye Hospital, Retina clinic"; ref.appointment_at = new Date(t + 86400000 * (d.refDaysAgo! > 5 ? 3 : 6)).toISOString(); }
          if (to === "attended") ref.attended_at = tIso;
          if (to === "feedback") { ref.feedback = "Moderate NPDR confirmed. Review in 6 months; glycaemic control advised."; ref.next_followup_at = new Date(t + 86400000 * 180).toISOString(); }
          if (to === "not_completed") ref.not_completed_reason = "Patient could not travel; will retry next camp.";
          ref.events.push({ from, to, note: to === "not_completed" ? ref.not_completed_reason! : "", at: tIso });
          audit("referral.moved", "S. Iyer", { referral_id: ref.id, from, to }, e.id, null, tIso);
        }
      }
    }
  });
}

// ------------------------------------------------------------------ SSE runs
const STEPS: StepName[] = ["decode", "quality", "landmarks", "grader_cnn", "grader_vit", "lesions", "uncertainty", "policy", "overlays"];
interface Run { listeners: Set<(e: ProgressEvent) => void>; started: boolean; done: boolean; history: ProgressEvent[] }
const runs = new Map<string, Run>();

function findImage(id: string): { e: Encounter; img: ImageResult } | null {
  for (const e of db.encounters.values()) {
    const img = e.images.find((i) => i.id === id);
    if (img) return { e, img };
  }
  return null;
}

function getRun(id: string): Run {
  let r = runs.get(id);
  if (!r) { r = { listeners: new Set(), started: false, done: false, history: [] }; runs.set(id, r); }
  return r;
}

async function startRun(id: string) {
  const run = getRun(id);
  if (run.started) return;
  run.started = true;
  const f = findImage(id);
  if (!f) return;
  const { e, img } = f;
  const a = db.meta.get(id)!.analysis;
  img.status = "running";
  const emit = (ev: ProgressEvent) => { run.history.push(ev); run.listeners.forEach((l) => l(ev)); };
  const partial: Partial<Record<StepName, StepEvent["partial"]>> = {
    quality: a.quality, landmarks: a.landmarks, grader_cnn: a.grading.models[0], grader_vit: a.grading.models[1],
    lesions: a.lesions, uncertainty: a.uncertainty, policy: a.triage,
  };
  const r = rng(hashSeed(id));
  for (const s of STEPS) {
    emit({ type: "step", data: { step: s, status: "start" } });
    await sleep(s === "overlays" ? 220 : 300 + r() * 200);
    if (s === "overlays") ensureArt(id);
    emit({ type: "step", data: { step: s, status: "done", ms: a.timings_ms[s], partial: partial[s] } });
    await sleep(60);
  }
  finishImage(e, img);
  audit("image.analysed", "system", { outcome: img.triage!.outcome, result_hash: img.result_hash }, e.id, img.id);
  run.done = true;
  emit({ type: "done", data: withUrls(clone(img)) });
}

export function mockEvents(imageId: string, onEvent: (e: ProgressEvent) => void): () => void {
  seed();
  const f = findImage(imageId);
  if (!f) {
    setTimeout(() => onEvent({ type: "error", data: { message: "Image not found." } }), 0);
    return () => {};
  }
  if (f.img.status === "done") {
    const t = setTimeout(() => onEvent({ type: "done", data: withUrls(clone(f.img)) }), 30);
    return () => clearTimeout(t);
  }
  const run = getRun(imageId);
  run.listeners.add(onEvent);
  // late subscribers catch up immediately (the server sends the current state)
  for (const ev of run.history) onEvent(ev);
  void startRun(imageId);
  return () => run.listeners.delete(onEvent);
}

// ------------------------------------------------------------------ uploads
async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement | null> {
  try {
    const bmp = await createImageBitmap(file);
    const S = 640;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, S, S);
    // centre-crop to a square (the server's canonicalisation is more careful: it finds the fundus circle)
    const k = S / Math.min(bmp.width, bmp.height);
    g.drawImage(bmp, (S - bmp.width * k) / 2, (S - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
    return c;
  } catch {
    return null;
  }
}

const UPLOAD_SCENARIOS: Scenario[] = [
  { grade: 2 }, { grade: 0 }, { grade: 3 }, { grade: 1, disagree: true }, { grade: 0, quality: "inadequate", issue: "dark" },
  { grade: 2, macular: true }, { grade: 0, spread: true }, { grade: 4 },
];

// ------------------------------------------------------------------ failure gallery (MOCK)
let failuresCache: Failures | null = null;
function mockFailures(): Failures {
  if (failuresCache) return failuresCache;
  const defs: { cat: FailureCategory; grade: Grade; outcome: Outcome; p: number; pg: Grade; q: string; reason: string; rules: string[]; sc: Scenario }[] = [
    { cat: "missed_referable", grade: 2, outcome: "ROUTINE", p: 0.21, pg: 1, q: "adequate", reason: "Estimated grade 1 · P(referable) 0.21", rules: ["R0_quality_ok", "R6_routine"], sc: { grade: 1 } },
    { cat: "missed_referable", grade: 3, outcome: "ROUTINE", p: 0.28, pg: 1, q: "usable", reason: "Few lesion candidates found", rules: ["R0_quality_ok", "R6_routine"], sc: { grade: 1, quality: "usable", issue: "blur" } },
    { cat: "over_referral", grade: 0, outcome: "REFER", p: 0.71, pg: 2, q: "adequate", reason: "Estimated grade 2 · P(referable) 0.71", rules: ["R2_refer_threshold"], sc: { grade: 2 } },
    { cat: "over_referral", grade: 1, outcome: "REFER", p: 0.55, pg: 2, q: "adequate", reason: "Haemorrhage area above the lesion rule", rules: ["R1a_lesion_area", "R2_refer_threshold"], sc: { grade: 2 } },
    { cat: "abstained_healthy", grade: 0, outcome: "HUMAN_REVIEW", p: 0.33, pg: 0, q: "usable", reason: "The two graders disagree", rules: ["R4_disagreement"], sc: { grade: 0, disagree: true } },
    { cat: "abstained_healthy", grade: 0, outcome: "HUMAN_REVIEW", p: 0.19, pg: 0, q: "adequate", reason: "Image looks unlike the training photos", rules: ["R4_ood"], sc: { grade: 0, spread: true } },
    { cat: "wrong_retake", grade: 0, outcome: "RETAKE", p: 0.08, pg: 0, q: "inadequate", reason: "Too dark to see the retina", rules: ["R0_quality_hard_fail"], sc: { grade: 0, quality: "inadequate", issue: "dark" } },
  ];
  const cases: FailureCase[] = defs.map((d, i) => {
    const a = analyse(9100 + i * 31, d.sc, i % 2 ? "OS" : "OD", "macula", 45);
    return {
      file: `mock_${i}.jpg`, image: toJpeg(drawFundus(a.art, 320), 0.82), dataset: "idrid", image_id: `MOCK_${String(i + 1).padStart(3, "0")}`,
      category: d.cat, dataset_grade: d.grade, dataset_grade_label: ["No DR", "Mild NPDR", "Moderate NPDR", "Severe NPDR", "PDR"][d.grade],
      outcome: d.outcome, urgency: d.outcome === "REFER" ? "soon" : d.outcome === "ROUTINE" ? "routine_12m" : null, p_referable: d.p, predicted_grade: d.pg,
      quality: d.q, quality_reasons: d.q === "inadequate" ? ["DARK"] : d.q === "usable" ? ["BLUR"] : [], reasons: [d.reason], fired_rules: d.rules,
      uncertainty: { entropy: 0.6 + i * 0.05, disagreement: d.cat === "abstained_healthy" ? 0.31 : 0.08, ood_score: d.rules.includes("R4_ood") ? 1.4 : 0.6 },
      license: "MOCK image (generated)",
    };
  });
  failuresCache = {
    available: true, cases, idrid_counts: { missed_referable: 2, over_referral: 31, abstained_healthy: 64, wrong_retake: 9 },
    note: "MOCK: generated pictures and invented counts for UI development.",
  };
  return failuresCache;
}

// ------------------------------------------------------------------ router
function need<T>(x: T | undefined | null, what = "Not found"): T {
  if (x === undefined || x === null) throw new ApiError(404, what);
  return x;
}

function referralStats(items: Referral[]): ReferralList["stats"] {
  const total = items.length;
  const completed = items.filter((r) => ["attended", "feedback", "closed"].includes(r.status)).length;
  const days = items.filter((r) => r.attended_at).map((r) => (new Date(r.attended_at!).getTime() - new Date(r.issued_at).getTime()) / 86400000).sort((a, b) => a - b);
  const median = days.length ? (days.length % 2 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2) : null;
  const t = Date.now();
  const overdue = items.filter((r) =>
    (r.appointment_at && new Date(r.appointment_at).getTime() < t && !r.attended_at && r.status !== "not_completed" && r.status !== "closed") ||
    (r.status === "issued" && !r.appointment_at && t - new Date(r.issued_at).getTime() > 30 * 86400000)).length;
  const fb = items.filter((r) => r.feedback).length;
  return { total, completed_rate: total ? completed / total : 0, median_days_to_attend: median, overdue, with_feedback_rate: total ? fb / total : 0 };
}

export async function handle<T>(method: Method, fullPath: string, body?: unknown): Promise<T> {
  seed();
  await sleep(90 + Math.random() * 160);
  const [path, query = ""] = fullPath.split("?");
  const q = new URLSearchParams(query);
  const seg = path.split("/").filter(Boolean);
  const out = (x: unknown) => clone(x) as T;
  const enc = (id: string) => need(db.encounters.get(id), "Encounter not found");
  const full = (e: Encounter): Encounter => ({ ...clone(e), images: e.images.map((i) => withUrls(clone(i))) });

  // GET /health
  if (method === "GET" && path === "/health") {
    const h: Health = {
      status: "ok", version: "0.1.0-mock", offline: true, missing: [],
      models: Object.fromEntries(Object.entries(MODEL_VERSIONS).filter(([k]) => k !== "policy").map(([k, v]) => [k, { loaded: true, sha: v }])),
    };
    return out(h);
  }
  if (method === "GET" && path === "/stats/today") {
    const today = new Date().toDateString();
    const list = [...db.encounters.values()];
    const isToday = (s: string) => new Date(s).toDateString() === today;
    const s: TodayStats = {
      screened_today: list.filter((e) => isToday(e.created_at)).length,
      awaiting_review: list.filter((e) => e.status === "awaiting_review").length,
      referred_today: [...db.referrals.values()].filter((r) => isToday(r.issued_at)).length,
      retake_today: list.filter((e) => isToday(e.created_at) && e.ai?.outcome === "RETAKE").length,
      total: list.length,
    };
    return out(s);
  }
  if (seg[0] === "encounters") {
    if (seg.length === 1 && method === "POST") {
      const e = blankEncounter((body ?? {}) as EncounterCreate);
      db.encounters.set(e.id, e);
      audit("encounter.created", "S. Iyer", { patient_code: e.patient_code }, e.id);
      return out(full(e));
    }
    if (seg.length === 1 && method === "GET") {
      let list = [...db.encounters.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const st = q.get("status"), oc = q.get("outcome"), qq = q.get("q");
      if (st) list = list.filter((e) => e.status === st);
      if (oc) list = list.filter((e) => e.ai?.outcome === oc);
      if (qq) list = list.filter((e) => e.patient_code.toLowerCase().includes(qq.toLowerCase()));
      return out(list.slice(0, Number(q.get("limit") ?? 50)).map(summary));
    }
    const e = enc(seg[1]);
    if (seg.length === 2 && method === "GET") return out(full(e));
    if (seg.length === 2 && method === "PATCH") {
      Object.assign(e, body as object);
      audit("encounter.updated", "S. Iyer", body as Record<string, unknown>, e.id);
      return out(full(e));
    }
    if (seg[2] === "va" && method === "PUT") {
      const b = body as VAUpdate;
      for (const eye of ["OD", "OS"] as Eye[]) {
        const v = b[eye]?.value ?? null;
        if (v !== null && vaToLogmar(v) === null) throw new ApiError(400, `Unrecognised VA value for ${eye}: ${v}`);
      }
      setVA(e, b.OD?.value ?? null, b.OS?.value ?? null, b.method ?? e.va.method ?? "Snellen", b.operator ?? e.va.operator ?? null, b.measured_at ?? now());
      const before = e.ai?.outcome;
      recompute(e);
      audit("va.updated", b.operator ?? "S. Iyer", { OD: b.OD?.value ?? null, OS: b.OS?.value ?? null, outcome_before: before, outcome_after: e.ai?.outcome }, e.id);
      return out(full(e));
    }
    if (seg[2] === "images" && seg.length === 3 && method === "POST") {
      if (e.status === "signed") throw new ApiError(409, "Encounter already signed");
      const fd = body as FormData;
      const file = fd.get("file");
      const eye = fd.get("eye") as Eye | null;
      const view = (fd.get("view") as View | null) ?? "macula";
      const fov = Number(fd.get("fov_deg") ?? 45) || 45;
      if (!(file instanceof Blob)) throw new ApiError(400, "file is required");
      if (eye !== "OD" && eye !== "OS") throw new ApiError(400, "eye must be OD or OS");
      const buf = new Uint8Array(await file.arrayBuffer());
      let sha: string;
      try {
        sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
      } catch {
        sha = sha256(String(buf.length) + (file instanceof File ? file.name : ""));
      }
      const seedN = parseInt(sha.slice(0, 7), 16);
      const sc = UPLOAD_SCENARIOS[seedN % UPLOAD_SCENARIOS.length];
      // synthetic samples (mock only) are redrawn from the analysis so pixels and overlays agree
      const synthetic = file instanceof File && file.name.startsWith("synthetic-sample");
      const cv = file.size > 0 && !synthetic ? await fileToCanvas(file) : null;
      const img = makeImage(e, eye, view, sc, seedN, fov, now(), cv, sha);
      recompute(e);
      audit("image.uploaded", "S. Iyer", { eye, view, sha256: sha }, e.id, img.id);
      // the worker starts the analysis if nobody subscribes to the stream
      setTimeout(() => void startRun(img.id), 20000);
      return out(clone(img));
    }
    if (seg[2] === "images" && seg.length === 4 && method === "DELETE") {
      e.images = e.images.filter((i) => i.id !== seg[3]);
      recompute(e);
      audit("image.deleted", "S. Iyer", { image_id: seg[3] }, e.id, seg[3]);
      return out(full(e));
    }
    if (seg[2] === "review" && method === "POST") {
      const b = body as ReviewCreate;
      if (e.status === "signed") throw new ApiError(409, "Already signed");
      if (!e.ai) throw new ApiError(400, "No AI outcome yet");
      if (!b.reviewer?.trim()) throw new ApiError(400, "Reviewer name required");
      if (b.decision === "override" && !b.reason?.trim()) throw new ApiError(400, "Override requires a reason");
      const missing = e.ai.flags.map((f) => f.code).filter((c) => !b.acknowledged_flags.includes(c));
      if (missing.length) throw new ApiError(400, `Flags not acknowledged: ${missing.join(", ")}`);
      sign(e, b);
      return out(full(e));
    }
    if (seg[2] === "report.pdf") throw new ApiError(501, "PDF reports are produced by the local server (not available in mock mode).");
  }
  if (seg[0] === "images") {
    const f = need(findImage(seg[1]), "Image not found");
    if (seg.length === 2 && method === "GET") return out(withUrls(clone(f.img)));
    if (seg[2] === "replay" && method === "POST") {
      if (f.img.status !== "done") throw new ApiError(409, "Image not analysed yet");
      await sleep(800 + Math.random() * 500);
      db.replays++;
      const res: ReplayResult = { match: true, original_hash: f.img.result_hash!, replay_hash: f.img.result_hash!, ms: 820 + Math.round(Math.random() * 400) };
      audit("image.replayed", "S. Iyer", { match: true, result_hash: res.replay_hash }, f.e.id, f.img.id);
      return out(res);
    }
  }
  if (method === "GET" && path === "/queue") {
    const list = [...db.encounters.values()].filter((e) => e.status === "awaiting_review").sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at));
    return out(list.map(summary));
  }
  if (seg[0] === "referrals") {
    if (seg.length === 1 && method === "GET") {
      const all = [...db.referrals.values()].sort((a, b) => b.issued_at.localeCompare(a.issued_at));
      const st = q.get("status");
      const items = (st ? all.filter((r) => r.status === st) : all).map((r) => ({ ...r, patient_code: db.encounters.get(r.encounter_id)?.patient_code ?? "?" }));
      return out({ items, stats: referralStats(all) } satisfies ReferralList);
    }
    if (seg.length === 2 && method === "PUT") {
      const r = need(db.referrals.get(seg[1]), "Referral not found");
      const b = body as ReferralUpdate;
      if (!referralMoveAllowed(r.status, b.to)) throw new ApiError(409, `Illegal move ${r.status} → ${b.to}`);
      if (b.to === "not_completed" && !b.not_completed_reason?.trim()) throw new ApiError(400, "A reason is required");
      const from = r.status;
      const t = now();
      r.status = b.to;
      for (const k of ["facility", "appointment_at", "attended_at", "feedback", "next_followup_at", "not_completed_reason"] as const) {
        if (b[k] !== undefined) r[k] = b[k] ?? null;
      }
      if (b.to === "attended" && !r.attended_at) r.attended_at = t;
      r.events.push({ from, to: b.to, note: b.note ?? "", at: t });
      const e = db.encounters.get(r.encounter_id);
      if (e) e.referral = r;
      audit("referral.moved", "S. Iyer", { referral_id: r.id, from, to: b.to }, r.encounter_id);
      return out(r);
    }
  }
  if (method === "GET" && path === "/audit") {
    let items = [...db.audit];
    const eid = q.get("encounter_id");
    if (eid) items = items.filter((a) => a.encounter_id === eid);
    items = items.reverse().slice(0, Number(q.get("limit") ?? 200));
    return out({ items } satisfies AuditList);
  }
  if (method === "GET" && path === "/audit/verify") {
    await sleep(500);
    let prev = "0".repeat(64);
    let bad: number | null = null;
    for (const a of db.audit) {
      const { hash, ...rest } = a;
      if (a.prev_hash !== prev || sha256(JSON.stringify(rest)) !== hash) { bad = a.seq; break; }
      prev = hash;
    }
    return out({ valid: bad === null, checked: db.audit.length, first_bad_seq: bad } satisfies AuditVerify);
  }
  if (method === "GET" && path === "/metrics") return out(mockMetrics());
  if (method === "GET" && path === "/failures") return out(mockFailures());
  if (method === "GET" && path === "/policy") return out(MOCK_POLICY);
  if (seg[0] === "demo-cases") {
    if (seg.length === 1 && method === "GET") {
      const list: DemoCase[] = DEMO_DEFS.map(({ scenario: _s, seed: sd, ...d }) => {
        const a = analyse(sd, DEMO_DEFS.find((x) => x.seed === sd)!.scenario, d.eye, d.view);
        const key = `demo_${d.name}`;
        if (!thumbs.has(key)) thumbs.set(key, toJpeg(drawFundus({ ...a.art }, 160), 0.8));
        return { ...d, thumb: thumbs.get(key)! };
      });
      return out(list);
    }
    if (seg.length === 2 && method === "POST") {
      const d = need(DEMO_DEFS.find((x) => x.name === decodeURIComponent(seg[1])), "Demo case not found");
      const e = blankEncounter({ notes: `Demo case: ${d.title}` });
      db.encounters.set(e.id, e);
      audit("encounter.created", "S. Iyer", { patient_code: e.patient_code, demo: d.name }, e.id);
      const img = makeImage(e, d.eye, d.view, d.scenario, d.seed, 45, now());
      recompute(e);
      audit("image.uploaded", "S. Iyer", { eye: d.eye, view: d.view, sha256: img.sha256, demo: d.name }, e.id, img.id);
      setTimeout(() => void startRun(img.id), 20000);
      return out(full(e));
    }
  }
  throw new ApiError(404, `Mock: no handler for ${method} ${path}`);
}

export type { LesionType, Outcome };
