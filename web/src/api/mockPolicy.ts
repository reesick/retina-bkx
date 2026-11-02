// Mock-only TypeScript port of core/policy.py (triage_image + triage_encounter) so the mock behaves like the
// server, including re-running the encounter policy when VA changes. The real server is the source of truth.
import type { EncounterAI, Eye, Grading, ImageResult, Lesions, Outcome, Policy, Quality, Reason, RuleStep, Triage, Uncertainty, Urgency } from "./types";
import { vaToLogmar } from "../lib/va";

const SEVERITY: Record<Outcome, number> = { ROUTINE: 0, RETAKE: 1, HUMAN_REVIEW: 2, REFER: 3 };
const r3 = (x: number) => x.toFixed(3);

function lesionSuspicious(lesions: Lesions | undefined, p: Policy): [boolean, string] {
  if (!lesions) return [false, "no lesion output"];
  const cfg = p.lesion_suspicious ?? { HE_area_frac: 0.0015, EX_area_frac: 0.0015, HE_count: 3 };
  const he = lesions.summary.HE, ex = lesions.summary.EX;
  const hit = he.area_frac >= cfg.HE_area_frac || ex.area_frac >= cfg.EX_area_frac || he.count >= cfg.HE_count;
  return [hit, `HE area ${he.area_frac.toFixed(4)} (≥${cfg.HE_area_frac}), HE count ${he.count} (≥${cfg.HE_count}), EX area ${ex.area_frac.toFixed(4)} (≥${cfg.EX_area_frac})`];
}

export function triageImage(q: Quality, g: Grading, u: Uncertainty, les: Lesions | undefined, p: Policy): Triage {
  const trace: RuleStep[] = [];
  const reasons: Reason[] = [];
  const step = (rule: string, fired: boolean, detail: string) => (trace.push({ rule, fired, detail }), fired);
  const out = (outcome: Outcome, urgency: Urgency = null): Triage => ({ outcome, urgency, reasons, rule_trace: trace, policy_version: p.version });
  const pRef = g.ensemble.p_referable;
  const pSev = g.ensemble.probs[3] + g.ensemble.probs[4];
  const cat = q.category;
  const [susp, suspDetail] = lesionSuspicious(les, p);
  const tLow = p.t_refer_low ?? 0.25, tSev = p.t_severe ?? 0.5;

  if (step("R1 image inadequate", cat === "inadequate", `quality = ${cat}`)) {
    const ev = pRef >= p.t_refer || susp;
    if (step("R1a suspicious evidence on inadequate image", ev, `P(referable) ${r3(pRef)} vs ${r3(p.t_refer)}; ${suspDetail}`)) {
      reasons.push({ code: "SUSPICIOUS_ON_INADEQUATE", text: "Image is inadequate but shows possible referable signs. A person must look." });
      return out("HUMAN_REVIEW");
    }
    for (const c of q.reasons) reasons.push({ code: c, text: `Quality check failed: ${c}` });
    reasons.push({ code: "INSUFFICIENT_EVIDENCE", text: "Not enough visible retina to reassure. Retake the photo." });
    return out("RETAKE");
  }
  if (step("R2 unlike training images (OOD)", u.ood_score > p.t_ood, `OOD ${u.ood_score.toFixed(2)} vs ${p.t_ood.toFixed(2)}`)) {
    reasons.push({ code: "OOD", text: "This image looks unlike the images the models learned from." });
    return out("HUMAN_REVIEW");
  }
  const doubt = u.entropy > p.t_entropy || u.disagreement > p.t_disagreement;
  if (step("R3 models unsure or disagree", doubt, `entropy ${r3(u.entropy)} vs ${r3(p.t_entropy)}; disagreement ${r3(u.disagreement)} vs ${r3(p.t_disagreement)}`)) {
    if (u.entropy > p.t_entropy) reasons.push({ code: "HIGH_ENTROPY", text: "The grade distribution is spread out." });
    if (u.disagreement > p.t_disagreement) reasons.push({ code: "DISAGREEMENT", text: "The two graders disagree." });
    return out("HUMAN_REVIEW");
  }
  if (step("R4 likely referable (grade ≥ 2)", pRef >= p.t_refer, `P(referable) ${r3(pRef)} vs operating point ${r3(p.t_refer)}`)) {
    const imm = pSev >= tSev || g.ensemble.grade >= 3;
    step("R4a severe or proliferative", imm, `P(grade ≥ 3) ${r3(pSev)} vs ${r3(tSev)}`);
    reasons.push({ code: "REFERABLE_DR", text: `Estimated grade ${g.ensemble.grade}; P(referable) ${pRef.toFixed(2)}.` });
    return out("REFER", imm ? "immediate" : "soon");
  }
  if (step("R5 lesion candidates conflict with low score", susp, suspDetail)) {
    reasons.push({ code: "EVIDENCE_CONFLICT", text: "Lesion candidates are visible although the graders score low." });
    return out("HUMAN_REVIEW");
  }
  if (step("R6 borderline on usable image", cat === "usable" && pRef >= tLow, `quality ${cat}; P(referable) ${r3(pRef)} vs ${r3(tLow)}`)) {
    reasons.push({ code: "BORDERLINE_LIMITED", text: "Borderline score on an image with limitations." });
    return out("HUMAN_REVIEW");
  }
  step("R7 routine candidate", true, "no rule above fired");
  reasons.push({ code: "NO_REFERRAL_TRIGGER", text: "No referral trigger in this image." });
  return out("ROUTINE", "routine_12m");
}

export function triageEncounter(images: ImageResult[], va: Record<Eye, { value: string | null }>, p: Policy): EncounterAI {
  const trace: RuleStep[] = [];
  const flags: Reason[] = [];
  const eyes = {} as EncounterAI["eyes"];
  const requireBoth = p.require_both_eyes ?? true;
  for (const eye of ["OD", "OS"] as Eye[]) {
    const imgs = images.filter((i) => i.eye === eye && i.triage);
    if (!imgs.length) {
      eyes[eye] = { outcome: requireBoth ? "RETAKE" : null, urgency: null, missing: true };
      continue;
    }
    const outs = imgs.map((i) => i.triage!.outcome);
    const o: Outcome = outs.includes("REFER") ? "REFER" : outs.includes("HUMAN_REVIEW") ? "HUMAN_REVIEW" : outs.includes("ROUTINE") ? "ROUTINE" : "RETAKE";
    const urg = imgs.filter((i) => i.triage!.outcome === "REFER").map((i) => i.triage!.urgency);
    eyes[eye] = { outcome: o, urgency: urg.includes("immediate") ? "immediate" : urg[0] ?? null, missing: false };
    trace.push({ rule: `E1 ${eye} image-set`, fired: true, detail: `image outcomes [${outs.map((x) => `'${x}'`).join(", ")}] -> ${o}` });
  }
  const present = (Object.values(eyes) as EncounterAI["eyes"][Eye][]).filter((e) => e.outcome);
  let outcome: Outcome = present.length ? present.map((e) => e.outcome!).reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a)) : "RETAKE";
  let urgency: Urgency = null;
  if (outcome === "REFER") urgency = present.some((e) => e.urgency === "immediate") ? "immediate" : "soon";
  for (const eye of ["OD", "OS"] as Eye[]) {
    if (eyes[eye].missing) {
      flags.push({ code: `EYE_MISSING_${eye}`, text: `No usable image-set for ${eye}.` });
      trace.push({ rule: `E2 ${eye} missing`, fired: true, detail: requireBoth ? "both eyes required" : "eye optional" });
    }
  }
  const escalate = (to: Outcome, code: string, text: string, rule: string, detail: string) => {
    flags.push({ code, text });
    const before = outcome;
    if (SEVERITY[to] > SEVERITY[outcome]) {
      outcome = to;
      if (to === "REFER" && urgency === null) urgency = "soon";
    }
    trace.push({ rule, fired: true, detail: `${detail}; ${before} -> ${outcome}` });
  };
  const vaRefer = p.va_refer_logmar ?? Math.log10(2);
  for (const eye of ["OD", "OS"] as Eye[]) {
    const lm = vaToLogmar(va[eye]?.value);
    if (lm == null) {
      escalate(outcome === "ROUTINE" ? "HUMAN_REVIEW" : outcome, `VA_NOT_MEASURED_${eye}`, `Visual acuity not recorded for ${eye}. Missing is not normal.`, `G1 VA ${eye} missing`, "routine needs both VA values");
    } else if (lm > vaRefer + 1e-6) {
      escalate("REFER", `VA_REDUCED_${eye}`, `${eye} vision worse than 6/12 (logMAR ${lm.toFixed(2)}). Refer even without DR signs.`, `G1 VA ${eye} worse than 6/12`, `logMAR ${lm.toFixed(2)} > ${vaRefer.toFixed(2)}`);
    } else {
      trace.push({ rule: `G1 VA ${eye}`, fired: false, detail: `logMAR ${lm.toFixed(2)}` });
    }
  }
  if (images.some((i) => i.macular_risk?.flag)) {
    escalate("HUMAN_REVIEW", "MACULAR_RISK", "Hard-exudate candidates near the fovea. Macular finding for review, not a DME diagnosis.", "G2 macular-risk indicator", "exudate candidate within 1 disc diameter of fovea");
  }
  for (const i of images) {
    const lat = i.landmarks?.laterality;
    if (lat && (lat.predicted === "OD" || lat.predicted === "OS") && lat.confidence >= 0.8 && lat.predicted !== i.eye) {
      escalate("HUMAN_REVIEW", "LATERALITY_MISMATCH", `Image labelled ${i.eye} looks like ${lat.predicted} from the optic-disc position.`, "G3 laterality check", `disc position suggests ${lat.predicted}`);
      break;
    }
  }
  return { outcome, urgency, eyes, flags, rule_trace: trace, policy_version: p.version };
}

export const severity = SEVERITY;
