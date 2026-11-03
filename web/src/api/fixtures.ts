// MOCK DATA for VITE_MOCK=1. Shapes match docs/04_API.md exactly. Numbers here are invented and only ever shown
// while the "MOCK DATA" pill is visible.
import type {
  DemoCase, Eye, Grade, Grading, Landmarks, Lesion, LesionType, Lesions, MacularRisk, MetricsAvailable, ModelGrade,
  Policy, Probs5, Quality, QualityCheck, Reliability, Triage, Uncertainty, View,
} from "./types";
import { rng } from "../lib/rng";
import { sha256 } from "../lib/sha256";
import { triageImage } from "./mockPolicy";

export const MOCK_POLICY: Policy = {
  version: "fit-mock-20250101-0000",
  t_refer: 0.384, t_refer_low: 0.25, t_severe: 0.5,
  t_entropy: 1.052, t_disagreement: 0.268, t_ood: 41.8,
  lesion_suspicious: { HE_area_frac: 0.0021, EX_area_frac: 0.0018, HE_count: 4 },
  va_refer_logmar: Math.log10(2), macular_radius_dd: 1.0, require_both_eyes: true,
  temperatures: { cnn: 1.31, vit: 1.12 },
  provenance: {
    fitted_on: "APTOS 2019 validation split (n=549, image-level split, seed 42)",
    t_refer: "highest P(referable) threshold with validation sensitivity >= 0.90",
    t_entropy: "smallest entropy cut-off where accepted validation cases reach sensitivity >= 0.95 with abstention <= 20%",
    t_disagreement: "95th percentile of |P_ref(CNN) - P_ref(ViT)| on validation",
    t_ood: "99th percentile of Mahalanobis distance (PCA-64 of CNN features) on validation",
    lesion_suspicious: "97th percentile of lesion-candidate area/count among validation grade 0-1 images",
    temperatures: "temperature scaling per grader, minimising validation NLL",
    never_used: "IDRiD and DDR are not used for any fitting or threshold",
  },
};

export const MODEL_VERSIONS: Record<string, string> = {
  quality: sha256("quality.onnx").slice(0, 16),
  grader_cnn: sha256("grader_cnn.onnx").slice(0, 16),
  grader_vit: sha256("grader_vit.onnx").slice(0, 16),
  lesions: sha256("lesions.onnx").slice(0, 16),
  landmarks: sha256("landmarks.onnx").slice(0, 16),
  policy: MOCK_POLICY.version,
};

// ------------------------------------------------------------------ scenarios

export interface Scenario {
  grade: Grade;
  quality?: "adequate" | "usable" | "inadequate";
  issue?: "dark" | "blur" | "field" | "artefact";
  spread?: boolean; // high entropy
  disagree?: boolean;
  ood?: boolean;
  macular?: boolean;
  mismatch?: boolean;
  conflict?: boolean; // visible lesions with a low score
}

export interface ArtParams {
  seed: number; eye: Eye; fovea: { x: number; y: number }; disc: { x: number; y: number }; dd: number;
  lesions: Lesion[]; light?: number; blur?: number; artefact?: boolean; fieldShift?: { x: number; y: number };
}

export interface Analysis {
  quality: Quality; landmarks: Landmarks; grading: Grading; uncertainty: Uncertainty; lesions: Lesions;
  macular_risk: MacularRisk; triage: Triage; timings_ms: Record<string, number>; model_versions: Record<string, string>;
  result_hash: string; art: ArtParams;
}

const PEAK: Record<Grade, Probs5> = {
  0: [0.88, 0.08, 0.03, 0.007, 0.003],
  1: [0.2, 0.66, 0.11, 0.02, 0.01],
  2: [0.03, 0.09, 0.74, 0.11, 0.03],
  3: [0.01, 0.03, 0.17, 0.66, 0.13],
  4: [0.005, 0.015, 0.06, 0.22, 0.7],
};

function jitter(p: Probs5, r: () => number, amt: number): Probs5 {
  const q = p.map((x) => Math.max(1e-4, x * (1 + (r() - 0.5) * amt))) as number[];
  const s = q.reduce((a, b) => a + b, 0);
  return q.map((x) => x / s) as Probs5;
}
const pref = (p: Probs5) => p[2] + p[3] + p[4];
const entropy = (p: Probs5) => -p.reduce((a, x) => a + (x > 0 ? x * Math.log(x) : 0), 0);
const argmax = (p: Probs5) => p.indexOf(Math.max(...p)) as Grade;

function lesionsFor(seed: number, sc: Scenario, fovea: { x: number; y: number }, disc: { x: number; y: number }, dd: number): Lesion[] {
  const r = rng(seed * 7 + 3);
  const counts: Record<Grade, Record<LesionType, number>> = {
    0: { MA: 0, HE: 0, EX: 0, SE: 0 },
    1: { MA: 4, HE: 0, EX: 0, SE: 0 },
    2: { MA: 10, HE: 5, EX: 4, SE: 1 },
    3: { MA: 16, HE: 14, EX: 8, SE: 3 },
    4: { MA: 20, HE: 18, EX: 12, SE: 5 },
  };
  const c = { ...counts[sc.conflict ? 2 : sc.grade] };
  if (sc.grade === 0 && r() < 0.5 && !sc.conflict) c.MA = 1;
  const size: Record<LesionType, [number, number]> = { MA: [0.007, 0.012], HE: [0.016, 0.042], EX: [0.009, 0.026], SE: [0.03, 0.052] };
  const items: Lesion[] = [];
  let k = 0;
  const place = (type: LesionType, near?: { x: number; y: number; rad: number }) => {
    for (let tries = 0; tries < 40; tries++) {
      let x: number, y: number;
      if (near) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * near.rad;
        x = near.x + Math.cos(a) * d; y = near.y + Math.sin(a) * d;
      } else {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.4;
        // cluster around the arcades / posterior pole
        x = 0.5 + Math.cos(a) * d; y = 0.5 + Math.sin(a) * d * 0.9;
      }
      if (Math.hypot(x - disc.x, y - disc.y) < dd * 0.9) continue;
      if (Math.hypot(x - 0.5, y - 0.5) > 0.43) continue;
      const [lo, hi] = size[type];
      const w = lo + r() * (hi - lo), h = w * (0.7 + r() * 0.5);
      const id = `les_${(seed % 100000).toString().padStart(5, "0")}${(k++).toString().padStart(3, "0")}`;
      items.push({
        id, type, bbox: [x - w / 2, y - h / 2, w, h], centroid: [x, y],
        area_frac: (Math.PI * (w / 2) * (h / 2) * (type === "EX" ? 0.45 : 0.75)) / (Math.PI * 0.47 * 0.47),
        confidence: 0.45 + r() * 0.5,
        dist_fovea_dd: Math.hypot(x - fovea.x, y - fovea.y) / dd,
      });
      return;
    }
  };
  (Object.keys(c) as LesionType[]).forEach((t) => {
    for (let i = 0; i < c[t]; i++) place(t);
  });
  if (sc.macular) for (let i = 0; i < 4; i++) place("EX", { x: fovea.x, y: fovea.y, rad: dd * 0.9 });
  return items.sort((a, b) => b.area_frac - a.area_frac).slice(0, 200);
}

function summary(items: Lesion[]): Lesions["summary"] {
  const s: Lesions["summary"] = { MA: { count: 0, area_frac: 0 }, HE: { count: 0, area_frac: 0 }, EX: { count: 0, area_frac: 0 }, SE: { count: 0, area_frac: 0 } };
  for (const l of items) { s[l.type].count++; s[l.type].area_frac += l.area_frac; }
  return s;
}

function qualityFor(sc: Scenario, r: () => number): Quality {
  const issue = sc.issue;
  const cat = sc.quality ?? "adequate";
  const bad = cat === "inadequate", mid = cat === "usable";
  const mk = (code: string, label: string, value: number, threshold: number, higherIsBetter: boolean, hard: boolean, detail: string): QualityCheck => ({
    code, label, value, threshold, hard, detail, pass: higherIsBetter ? value >= threshold : value <= threshold,
  });
  const focus = issue === "blur" ? (bad ? 0.12 : 0.31) : 0.55 + r() * 0.3;
  const light = issue === "dark" ? (bad ? 0.09 : 0.2) : 0.42 + r() * 0.2;
  const field = issue === "field" ? (bad ? 0.48 : 0.7) : 0.9 + r() * 0.08;
  const discConf = issue === "field" && bad ? 0.22 : issue === "dark" && bad ? 0.28 : 0.7 + r() * 0.25;
  const macConf = issue === "dark" && bad ? 0.2 : 0.62 + r() * 0.3;
  const vessels = issue === "blur" ? (bad ? 0.018 : 0.034) : issue === "dark" && bad ? 0.021 : 0.06 + r() * 0.03;
  const art = issue === "artefact" ? (bad ? 0.31 : 0.16) : 0.02 + r() * 0.05;
  const checks: QualityCheck[] = [
    mk("FOCUS", "Focus", focus, 0.35, true, false, "Variance of the Laplacian on the green channel, normalised"),
    mk("ILLUMINATION", "Illumination", light, 0.24, true, true, "Median luminance inside the fundus mask"),
    mk("FIELD", "Field definition", field, 0.78, true, false, "Share of the expected circular field that is visible"),
    mk("DISC_VISIBLE", "Optic disc visible", discConf, 0.35, true, false, "Landmark model confidence for the optic disc"),
    mk("MACULA_VISIBLE", "Macula visible", macConf, 0.3, true, false, "Landmark model confidence for the fovea"),
    mk("VESSELS", "Vessels visible", vessels, 0.04, true, false, "Vessel-like pixel share (Frangi response)"),
    mk("ARTEFACT", "Artefact", art, 0.2, false, false, "Share of saturated or occluded pixels"),
  ];
  const failed = checks.filter((c) => !c.pass).sort((a, b) => Number(b.hard) - Number(a.hard)).map((c) => c.code);
  const probs = bad ? { adequate: 0.06, usable: 0.18, inadequate: 0.76 } : mid ? { adequate: 0.28, usable: 0.6, inadequate: 0.12 } : { adequate: 0.86 + r() * 0.08, usable: 0.08, inadequate: 0.02 };
  const sum = probs.adequate + probs.usable + probs.inadequate;
  const p = { adequate: probs.adequate / sum, usable: probs.usable / sum, inadequate: probs.inadequate / sum };
  return { category: cat, score: p.adequate + 0.5 * p.usable, probs: p, reasons: failed, checks };
}

export function analyse(seed: number, sc: Scenario, eye: Eye, view: View, fov = 45, policy: Policy = MOCK_POLICY): Analysis {
  const r = rng(seed);
  const discSide = (eye === "OD" ? 1 : -1) * (sc.mismatch ? -1 : 1);
  const dd = 0.105 + r() * 0.015;
  let fovea: { x: number; y: number }, disc: { x: number; y: number };
  const sep = 0.33 * (45 / fov);
  if (view === "disc") {
    disc = { x: 0.5 + discSide * 0.04, y: 0.48 + (r() - 0.5) * 0.03 };
    fovea = { x: disc.x - discSide * sep, y: disc.y + 0.02 };
  } else {
    fovea = { x: 0.5 - discSide * 0.04 + (r() - 0.5) * 0.02, y: 0.51 + (r() - 0.5) * 0.02 };
    disc = { x: fovea.x + discSide * sep, y: fovea.y - 0.025 };
  }
  const items = lesionsFor(seed, sc, fovea, disc, dd);
  const lesions: Lesions = { summary: summary(items), items };
  const quality = qualityFor(sc, r);

  let base = PEAK[sc.grade];
  if (sc.spread) base = [0.24, 0.27, 0.24, 0.15, 0.1];
  const cnnP = jitter(base, r, 0.25);
  let vitP = jitter(base, r, 0.25);
  if (sc.disagree) vitP = sc.grade >= 2 ? jitter(PEAK[1], r, 0.2) : jitter(PEAK[2], r, 0.2);
  const T = policy.temperatures ?? { cnn: 1.3, vit: 1.1 };
  const models: ModelGrade[] = [
    { name: "cnn_effb3", probs: cnnP, p_referable: pref(cnnP), temperature: T.cnn ?? 1.3 },
    { name: "vit_dinov2", probs: vitP, p_referable: pref(vitP), temperature: T.vit ?? 1.1 },
  ];
  const ens = cnnP.map((x, i) => (x + vitP[i]) / 2) as Probs5;
  const grading: Grading = { models, ensemble: { probs: ens, grade: argmax(ens), p_referable: pref(ens) } };
  const ent = entropy(ens);
  const dis = Math.abs(models[0].p_referable - models[1].p_referable);
  const ood = sc.ood ? 55 + r() * 12 : 18 + r() * 14;
  const flags: string[] = [];
  if (ent > policy.t_entropy) flags.push("HIGH_ENTROPY");
  if (dis > policy.t_disagreement) flags.push("DISAGREEMENT");
  if (ood > policy.t_ood) flags.push("OOD");
  const uncertainty: Uncertainty = {
    entropy: ent, entropy_threshold: policy.t_entropy, disagreement: dis, disagreement_threshold: policy.t_disagreement,
    ood_score: ood, ood_threshold: policy.t_ood, flags,
  };
  const exNear = items.filter((l) => l.type === "EX" && (l.dist_fovea_dd ?? 99) <= (policy.macular_radius_dd ?? 1)).length;
  const macular_risk: MacularRisk = { flag: exNear > 0, ex_within_1dd: exNear, label: "Macular finding for review. Not a DME diagnosis." };
  const predicted: Eye = disc.x > fovea.x ? "OD" : "OS";
  const landmarks: Landmarks = {
    od: { x: disc.x, y: disc.y, conf: quality.checks[3].value },
    fovea: { x: fovea.x, y: fovea.y, conf: quality.checks[4].value },
    disc_diameter: dd,
    laterality: { predicted, confidence: 0.86 + r() * 0.12, selected: eye, mismatch: predicted !== eye },
  };
  const triage = triageImage(quality, grading, uncertainty, lesions, policy);
  const timings_ms: Record<string, number> = {
    decode: 18 + Math.round(r() * 10), quality: 41 + Math.round(r() * 20), landmarks: 37 + Math.round(r() * 15),
    grader_cnn: 182 + Math.round(r() * 60), grader_vit: 391 + Math.round(r() * 90), lesions: 236 + Math.round(r() * 70),
    uncertainty: 9 + Math.round(r() * 5), policy: 1, overlays: 64 + Math.round(r() * 20),
  };
  const core = { quality, landmarks, grading, uncertainty, lesions, macular_risk, triage, model_versions: MODEL_VERSIONS };
  const result_hash = sha256(JSON.stringify(core));
  const art: ArtParams = {
    seed, eye: sc.mismatch ? (eye === "OD" ? "OS" : "OD") : eye, fovea, disc, dd, lesions: items,
    light: sc.issue === "dark" ? (sc.quality === "inadequate" ? 0.25 : 0.55) : 1,
    blur: sc.issue === "blur" ? (sc.quality === "inadequate" ? 7 : 3) : 0,
    artefact: sc.issue === "artefact",
    fieldShift: sc.issue === "field" ? { x: 0.16, y: -0.12 } : undefined,
  };
  return { ...core, timings_ms, result_hash, art };
}

// ------------------------------------------------------------------ demo cases

export interface DemoDef extends Omit<DemoCase, "thumb"> { scenario: Scenario; seed: number }
export const DEMO_DEFS: DemoDef[] = [
  { name: "idrid_moderate", title: "Moderate NPDR", description: "Haemorrhages and hard exudates along the arcades.", source: "Procedural illustration (mock of IDRiD-style image)", license: "CC-BY-4.0 (real demo cases)", eye: "OD", view: "macula", seed: 1201, scenario: { grade: 2 } },
  { name: "ddr_severe", title: "Severe NPDR", description: "Many haemorrhages in four quadrants.", source: "Procedural illustration (mock of DDR-style image)", license: "CC-BY-4.0 (real demo cases)", eye: "OS", view: "macula", seed: 1202, scenario: { grade: 3 } },
  { name: "ddr_dark", title: "Underexposed photo", description: "Too dark to see the retina. Expect RETAKE.", source: "Procedural illustration (mock of DDR ungradable)", license: "CC-BY-4.0 (real demo cases)", eye: "OD", view: "macula", seed: 1203, scenario: { grade: 0, quality: "inadequate", issue: "dark" } },
  { name: "idrid_macular", title: "Exudates near the fovea", description: "Macular finding for review.", source: "Procedural illustration (mock of IDRiD-style image)", license: "CC-BY-4.0 (real demo cases)", eye: "OS", view: "macula", seed: 1204, scenario: { grade: 2, macular: true } },
  { name: "aptos_normal", title: "No visible DR", description: "Clear photo, no lesion candidates.", source: "Procedural illustration (mock of APTOS-style image)", license: "Kaggle competition data (not redistributed)", eye: "OD", view: "macula", seed: 1205, scenario: { grade: 0 } },
  { name: "ddr_disagree", title: "Graders disagree", description: "The CNN and ViT read it differently. Expect a human.", source: "Procedural illustration", license: "CC-BY-4.0 (real demo cases)", eye: "OS", view: "macula", seed: 1206, scenario: { grade: 1, disagree: true } },
];

// ------------------------------------------------------------------ metrics.json

function erf(x: number): number {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
function PhiInv(p: number): number {
  let lo = -8, hi = 8;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (Phi(m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

function roc(auc: number) {
  const d = Math.SQRT2 * PhiInv(auc);
  const fpr: number[] = [], tpr: number[] = [];
  for (let i = 0; i <= 60; i++) {
    const z = 4 - (i / 60) * 8;
    fpr.push(1 - Phi(z));
    tpr.push(1 - Phi(z - d));
  }
  fpr[0] = 0; tpr[0] = 0; fpr[60] = 1; tpr[60] = 1;
  return { fpr, tpr };
}

function reliability(ece: number, seed: number): Reliability {
  const r = rng(seed);
  const bins: number[] = [], acc: number[] = [], conf: number[] = [], count: number[] = [];
  for (let i = 0; i < 15; i++) {
    const c = (i + 0.5) / 15;
    const n = Math.round(400 * Math.exp(-((c - 0.1) ** 2) / 0.02) + 60 * Math.exp(-((c - 0.9) ** 2) / 0.02) + 8 + r() * 6);
    bins.push(c); conf.push(c + (r() - 0.5) * 0.02);
    acc.push(Math.max(0, Math.min(1, c - ece * 2.2 * Math.sin(c * Math.PI) + (r() - 0.5) * ece)));
    count.push(n);
  }
  return { bins, acc, conf, count };
}

function confusion(n: number, prev: number[], recall: number[], seed: number): number[][] {
  const r = rng(seed);
  return prev.map((pv, i) => {
    const total = Math.round(n * pv);
    const row = [0, 0, 0, 0, 0];
    row[i] = Math.round(total * recall[i]);
    let rest = total - row[i];
    while (rest > 0) {
      const j = Math.max(0, Math.min(4, i + (r() < 0.5 ? -1 : 1) * (r() < 0.8 ? 1 : 2)));
      if (j === i) continue;
      row[j]++; rest--;
    }
    return row;
  });
}

function gm(auc: number, sens: number, spec: number, qwk: number, eceB: number, eceA: number, n: number, prev: number[], recall: number[], seed: number) {
  const ci = (x: number, w: number): [number, number] => [Math.max(0, x - w), Math.min(1, x + w)];
  const w = 1.4 / Math.sqrt(n);
  const p = prev[2] + prev[3] + prev[4];
  const ppv = (sens * p) / (sens * p + (1 - spec) * (1 - p));
  const npv = (spec * (1 - p)) / (spec * (1 - p) + (1 - sens) * p);
  return {
    n, prevalence: p, auroc: auc, auroc_ci: ci(auc, w * 0.35), sens, sens_ci: ci(sens, w), spec, spec_ci: ci(spec, w * 0.8),
    ppv, npv, qwk, ece_before: eceB, ece_after: eceA, brier: 0.06 + (1 - auc) * 0.6,
    per_grade_recall: recall, confusion: confusion(n, prev, recall, seed), reliability: reliability(eceA, seed + 1), roc: roc(auc),
  };
}

function riskCoverage(base: number) {
  const coverage: number[] = [], risk: number[] = [];
  for (let i = 0; i < 20; i++) {
    const c = 0.05 + (i / 19) * 0.95;
    coverage.push(c);
    risk.push(base * Math.pow(c, 1.8) + 0.004);
  }
  return { coverage, risk };
}

/** MOCK app-level evaluation: plausible shapes, invented numbers. */
function mockAppEval(): NonNullable<MetricsAvailable["app_eval"]> {
  const set = (n: number, refTot: number, missed: number, routine: number, refer: number, review: number, retake: number, cov: number, s: number, sp: number) => ({
    n, n_gradable: Math.round(n * (1 - retake)), coverage: cov, auto_sens: s, auto_spec: sp, routine_rate: routine, referral_rate: refer,
    human_review_rate: review, retake_rate: retake, referable_routed_routine: missed, referable_total: refTot, nonreferable_routine_rate: routine / Math.max(0.01, 1 - refTot / n),
    ungradable_n: Math.round(n * retake * 1.2), ungradable_routine: 0, excluded_lesion_train_overlap: n > 1000 ? 58 : 40, landmarks: "out-of-fold (MOCK)",
  });
  const band = (share: number, auroc: number | null, routine: number, refer: number, review: number, retake: number) =>
    ({ share, auroc, routine_rate: routine, referral_rate: refer, human_review_rate: review, retake_rate: retake });
  const lvl = (n: number, refTot: number, missed: number, o: [number, number, number, number]) => ({
    n_eyes: n, referable_routed_routine: missed, referable_total: refTot, referable_not_routine_rate: 1 - missed / refTot, nonreferable_routine_rate: o[0] / (n - refTot),
    outcomes: { ROUTINE: o[0], REFER: o[1], HUMAN_REVIEW: o[2], RETAKE: o[3] },
  });
  const pat = (n: number, refP: number, missed: number, o: [number, number, number, number]) => ({
    n_patients: n, referable_patients: refP, referable_routed_routine: missed, nonreferable_routine_rate: o[0] / (n - refP),
    outcomes: { ROUTINE: o[0], REFER: o[1], HUMAN_REVIEW: o[2], RETAKE: o[3] },
  });
  return {
    method: "MOCK · the app's own pipeline (quality gate, graders, lesion rules, policy) replayed on test images",
    fidelity_gpu_vs_onnx: { n: 200, outcome_agreement: 0.995, max_abs_diff_p_referable: 0.004 },
    sets: {
      idrid: set(476, 245, 1, 0.13, 0.22, 0.6, 0.05, 0.35, 0.98, 0.93),
      ddr: set(4047, 1660, 51, 0.3, 0.29, 0.36, 0.05, 0.59, 0.91, 0.9),
      deepdrid_val: set(400, 162, 4, 0.24, 0.2, 0.45, 0.11, 0.44, 0.93, 0.88),
      aptos_test: set(550, 226, 2, 0.4, 0.34, 0.23, 0.03, 0.74, 0.97, 0.95),
    },
    quality_bands: {
      idrid: { adequate: band(0.71, 0.93, 0.15, 0.24, 0.59, 0), usable: band(0.24, 0.88, 0.1, 0.2, 0.66, 0.04), inadequate: band(0.05, null, 0, 0, 0.2, 0.8) },
      ddr: { adequate: band(0.62, 0.92, 0.34, 0.3, 0.34, 0.02), usable: band(0.29, 0.86, 0.25, 0.27, 0.44, 0.04), inadequate: band(0.09, 0.71, 0.01, 0.05, 0.31, 0.63) },
      deepdrid_val: { adequate: band(0.6, 0.9, 0.3, 0.22, 0.46, 0.02), usable: band(0.25, 0.84, 0.18, 0.2, 0.55, 0.07), inadequate: band(0.15, 0.7, 0, 0.04, 0.3, 0.66) },
      aptos_test: { adequate: band(0.8, 0.98, 0.42, 0.35, 0.21, 0.02), usable: band(0.17, 0.95, 0.33, 0.32, 0.31, 0.04), inadequate: band(0.03, null, 0, 0, 0.25, 0.75) },
    },
    macular_risk_vs_dme: { n: 516, dme_positive: 243, sensitivity: 0.83, specificity: 0.78, ppv: 0.77, npv: 0.84, note: "MOCK: IDRiD 'risk of macular oedema' labels; the cue looks for exudates near the fovea." },
    deepdrid_encounters: {
      single_view: {
        eye_level: lvl(200, 81, 3, [52, 46, 91, 11]),
        patient_level_va_not_recorded: pat(100, 49, 0, [0, 41, 57, 2]),
        patient_level_va_assumed_normal: pat(100, 49, 2, [21, 41, 36, 2]),
      },
      dual_view: {
        eye_level: lvl(200, 81, 1, [47, 52, 95, 6]),
        patient_level_va_not_recorded: pat(100, 49, 0, [0, 44, 55, 1]),
        patient_level_va_assumed_normal: pat(100, 49, 1, [19, 44, 36, 1]),
      },
      note: "MOCK: DeepDRiD records no visual acuity. Without VA the policy never clears a patient as ROUTINE; the second row assumes normal VA to show what the images alone would do.",
    },
    quality_gate_ablation: {
      n: 4047,
      with_quality_gate: { referable_routed_routine: 51, referable_total: 1660, routine_rate: 0.3, retake_rate: 0.05, human_review_rate: 0.36, referral_rate: 0.29, wrong_auto_decisions: 212 },
      without_quality_gate: { referable_routed_routine: 88, referable_total: 1660, routine_rate: 0.34, retake_rate: 0, human_review_rate: 0.35, referral_rate: 0.31, wrong_auto_decisions: 331 },
    },
  };
}

export function mockMetrics(): MetricsAvailable {
  const P_APTOS = [0.49, 0.1, 0.27, 0.05, 0.09], P_IDRID = [0.33, 0.05, 0.33, 0.18, 0.11], P_DDR = [0.46, 0.05, 0.33, 0.06, 0.1];
  const R1 = [0.97, 0.52, 0.8, 0.41, 0.6], R2 = [0.92, 0.18, 0.69, 0.42, 0.51], R3 = [0.9, 0.11, 0.64, 0.29, 0.55];
  const mk = (k: number) => ({
    aptos_test: gm(0.981 - k * 0.008, 0.93 - k * 0.01, 0.94 - k * 0.012, 0.88 - k * 0.02, 0.071, 0.019, 550, P_APTOS, R1, 11 + k),
    idrid: gm(0.912 - k * 0.012, 0.86 - k * 0.02, 0.82 - k * 0.015, 0.71 - k * 0.03, 0.094, 0.041, 516, P_IDRID, R2, 21 + k),
    ddr: gm(0.894 - k * 0.01, 0.84 - k * 0.02, 0.85 - k * 0.02, 0.69 - k * 0.03, 0.103, 0.047, 4105, P_DDR, R3, 31 + k),
  });
  const tri = (cov: number, s: number, sp: number, base: number) => ({
    n: 550, coverage: cov, auto_sens: s, auto_spec: sp, referral_rate: 0.38, human_review_rate: 1 - cov - 0.04,
    retake_rate: 0.04, routine_rate: cov - 0.38, referable_routed_routine: 2, referable_total: 226, risk_coverage: riskCoverage(base),
  });
  return {
    available: true,
    generated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    git: "mock000", policy_version: MOCK_POLICY.version,
    datasets: {
      aptos_test: { n: 550, source: "APTOS 2019 held-out test (internal)" },
      idrid: { n: 516, source: "IDRiD, all 516 graded images (external)" },
      ddr: { n: 4105, source: "DDR test (external)" },
    },
    models: { cnn_effb3: mk(1), vit_dinov2: mk(2), ensemble: mk(0) },
    triage: { aptos_test: tri(0.84, 0.97, 0.95, 0.09), idrid: tri(0.71, 0.93, 0.87, 0.21), ddr: tri(0.74, 0.92, 0.89, 0.19) },
    quality: {
      deepdrid_val: { n: 400, n_poor: 108, auroc_inadequate: 0.87, poor_flagged_rate: 0.81, poor_inadequate_rate: 0.58, good_adequate_rate: 0.79, good_rejected_rate: 0.04, categories: { adequate: 251, usable: 85, inadequate: 64 } },
      ddr_ungradable: { n: 1151, not_routine_rate: 0.96, retake_rate: 0.83 },
    },
    lesions: {
      idrid_test: { dice: { MA: 0.31, HE: 0.52, EX: 0.68, SE: 0.44 }, aupr: { MA: 0.29, HE: 0.55, EX: 0.74, SE: 0.47 } },
      ddr_test: { dice: { MA: 0.18, HE: 0.39, EX: 0.51, SE: 0.29 }, aupr: { MA: 0.16, HE: 0.41, EX: 0.55, SE: 0.31 } },
    },
    landmarks: { idrid_test: { od_err_dd_median: 0.11, fovea_err_dd_median: 0.24, od_within_1dd: 0.98, fovea_within_1dd: 0.91 } },
    explanations: {
      pointing_game: { cam: 0.71, attention: 0.63, n: 81 },
      deletion_auc: { cam: 0.22, attention: 0.27, random: 0.41 },
      randomisation_ssim: { cam: 0.14, attention: 0.19, passed: 1 },
      iou: { dataset: "MOCK · IDRiD segmentation test (n=27)", top_5pct: { cnn: 0.18, vit: 0.21, random: 0.04 }, top_10pct: { cnn: 0.22, vit: 0.24, random: 0.07 }, note: "MOCK: IoU of the top-k% map pixels with the union of lesion masks." },
      stability: { dataset: "MOCK · APTOS test (n=60)", spearman_original_vs_perturbed: { brightness: { cnn: 0.91, vit: 0.86 }, blur: { cnn: 0.78, vit: 0.83 }, jpeg: { cnn: 0.94, vit: 0.9 }, rotate_5deg: { cnn: 0.72, vit: 0.69 } }, note: "MOCK: rank correlation between maps before and after a small change." },
      runtime_ms: { grader_cnn: 41, grader_vit: 63, note: "MOCK: extra CPU time per image to produce the map." },
    },
    app_eval: mockAppEval(),
    leakage_check: {
      method: "MOCK · 32x32 grey thumbnail match between test images and lesion-model training images",
      scope: "affects only the lesion rules of the triage simulation; grader AUROC is unaffected",
      idrid: { overlapping_images: 40, n_after_removal: 476, referable_routed_routine: 1, referable_total: 245, human_review_rate: 0.66, coverage: 0.34, auto_sens: 0.98, full_set: { referable_routed_routine: 2, referable_total: 286, human_review_rate: 0.67, coverage: 0.33 } },
      ddr: { overlapping_images: 58, n_after_removal: 4047, referable_routed_routine: 51, referable_total: 1660, human_review_rate: 0.4, coverage: 0.62, auto_sens: 0.91, full_set: { referable_routed_routine: 53, referable_total: 1690, human_review_rate: 0.41, coverage: 0.61 } },
    },
    site_calibration: {
      profile: { site: "MOCK · DeepDRiD camera", temperatures: { grader_cnn: 1.31, grader_vit: 1.18 }, t_refer: 0.41, provenance: "MOCK: fitted on 300 DeepDRiD validation images" },
      test: {
        dataset: "MOCK · DeepDRiD held-out test (n=400)",
        generic: { auroc: 0.86, sens: 0.81, spec: 0.79, ppv: 0.72, npv: 0.86, ece: 0.094, t_refer: 0.384, triage: { n: 400, human_review_rate: 0.52, routine_rate: 0.24, referable_routed_routine: 6, referable_total: 162, nonreferable_routine_rate: 0.39 } },
        site_calibrated: { auroc: 0.86, sens: 0.85, spec: 0.77, ppv: 0.71, npv: 0.88, ece: 0.041, t_refer: 0.41, triage: { n: 400, human_review_rate: 0.44, routine_rate: 0.29, referable_routed_routine: 4, referable_total: 162, nonreferable_routine_rate: 0.47 } },
      },
    },
    quantization: {
      model: "grader_vit", method: "MOCK · dynamic INT8 (MatMul weights)", size_mb: { fp32: 345, int8: 91 }, cpu_ms_per_image: { fp32: 1180, int8: 790 },
      idrid_auroc_vit: { fp32: 0.89, int8: 0.88 }, idrid_auroc_ensemble: { fp32: 0.92, int8: 0.91 }, max_abs_diff_p_referable_ensemble: 0.21,
      decision_flips_at_t_refer: 19, n: 516, accepted: false,
    },
    latency_ms: { p50: 980, p95: 1460, cpu: "Mock CPU (8 threads)" },
    notes: [
      "MOCK DATA: these numbers are invented for UI development and are not results.",
      "Research prototype on public datasets; not clinical validation.",
      "Graders trained on APTOS + DDR train + DeepDRiD train; IDRiD is the only fully external test set.",
      "Referable = grade >= 2 (research definition).",
      "PPV/NPV depend on prevalence and do not transfer to PHC populations.",
    ],
  };
}
