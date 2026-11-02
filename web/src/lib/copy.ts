import type { Encounter, ImageResult, StepName } from "../api/types";

export const STEP_LINE: Record<StepName, string> = {
  decode: "Reading the photo.",
  quality: "Checking focus and light.",
  landmarks: "Finding the optic disc and fovea.",
  grader_cnn: "First grader reading.",
  grader_vit: "Second grader reading.",
  lesions: "Tracing lesion candidates.",
  uncertainty: "Measuring doubt.",
  policy: "Deciding the next step.",
  overlays: "Drawing the evidence.",
};

export const STEPS: StepName[] = ["decode", "quality", "landmarks", "grader_cnn", "grader_vit", "lesions", "uncertainty", "policy", "overlays"];

const QUALITY_LINE: Record<string, string> = {
  ILLUMINATION: "Too dark to see the retina.",
  FOCUS: "The photo is out of focus.",
  FIELD: "The retina is not centred in the field.",
  ARTEFACT: "Something is blocking the view.",
  VESSELS: "Vessels are not visible enough.",
  DISC_VISIBLE: "The optic disc is not visible.",
  MACULA_VISIBLE: "The macula is not visible.",
};
export const qualityLine = (code: string) => QUALITY_LINE[code] ?? `Quality check failed: ${code.toLowerCase()}.`;

/** One line under the outcome word: the top reason, in plain words. */
export function imageReasonLine(img: ImageResult): string {
  const t = img.triage;
  const g = img.grading?.ensemble;
  if (!t) return "";
  const top = t.reasons[0];
  switch (t.outcome) {
    case "REFER":
      return g ? `Estimated grade ${g.grade} · P(referable) ${g.p_referable.toFixed(2)}` : top?.text ?? "";
    case "ROUTINE":
      return g ? `No referral trigger · P(referable) ${g.p_referable.toFixed(2)}` : "No referral trigger.";
    case "RETAKE": {
      const q = img.quality?.reasons[0];
      return q ? qualityLine(q) : top?.text ?? "Retake the photo.";
    }
    case "HUMAN_REVIEW":
      return top?.text ?? "A person must look.";
  }
}

export function encounterReasonLine(e: Encounter): string {
  const ai = e.ai;
  if (!ai) return "";
  const done = e.images.filter((i) => i.triage);
  const worst = done.find((i) => i.triage!.outcome === ai.outcome) ?? done[0];
  if (ai.outcome === "REFER") {
    const va = ai.flags.find((f) => f.code.startsWith("VA_REDUCED"));
    if (worst?.triage?.outcome === "REFER") return imageReasonLine(worst);
    if (va) return va.text;
  }
  if (ai.outcome === "RETAKE") {
    if (worst?.triage?.outcome === "RETAKE") return imageReasonLine(worst);
    const miss = ai.flags.find((f) => f.code.startsWith("EYE_MISSING"));
    if (miss) return miss.code.endsWith("OS") ? "No usable photo of the left eye." : "No usable photo of the right eye.";
  }
  if (ai.outcome === "HUMAN_REVIEW") {
    if (worst?.triage?.outcome === "HUMAN_REVIEW") return imageReasonLine(worst);
    const f = ai.flags.find((x) => !x.code.startsWith("EYE_MISSING")) ?? ai.flags[0];
    if (f) return f.text;
  }
  return worst ? imageReasonLine(worst) : "";
}
