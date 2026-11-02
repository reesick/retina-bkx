import type { Outcome, Urgency, LesionType, ReferralStatus } from "../api/types";

export const OUTCOME_COLOR: Record<Outcome, string> = {
  ROUTINE: "#30D158",
  REFER: "#FF9F0A",
  HUMAN_REVIEW: "#FFD60A",
  RETAKE: "#64D2FF",
};
export const URGENT = "#FF453A";

export function outcomeColor(o: Outcome | null | undefined, u?: Urgency): string {
  if (!o) return "rgba(255,255,255,0.32)";
  if (o === "REFER" && u === "immediate") return URGENT;
  return OUTCOME_COLOR[o];
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  ROUTINE: "Routine",
  REFER: "Refer",
  HUMAN_REVIEW: "Needs review",
  RETAKE: "Retake",
};

/** The single bold word at the moment of truth. */
export const OUTCOME_WORD: Record<Outcome, string> = {
  ROUTINE: "ROUTINE.",
  REFER: "REFER.",
  HUMAN_REVIEW: "NEEDS A HUMAN.",
  RETAKE: "RETAKE.",
};

export function urgencyLabel(u: Urgency): string {
  switch (u) {
    case "immediate": return "Immediate";
    case "soon": return "Soon · 3–6 months";
    case "routine_12m": return "Rescreen in 12 months";
    default: return "";
  }
}

export const LESION_COLOR: Record<LesionType, string> = { MA: "#FF375F", HE: "#FF453A", EX: "#FFD60A", SE: "#E5E5EA" };
export const LESION_NAME: Record<LesionType, string> = {
  MA: "Microaneurysm", HE: "Haemorrhage", EX: "Hard exudate", SE: "Soft exudate",
};
export const LESION_TYPES: LesionType[] = ["MA", "HE", "EX", "SE"];

export const REFERRAL_COLUMNS: ReferralStatus[] = ["issued", "scheduled", "attended", "feedback", "closed"];
export const REFERRAL_LABEL: Record<ReferralStatus, string> = {
  issued: "Issued", scheduled: "Scheduled", attended: "Attended", feedback: "Feedback", closed: "Closed",
  not_completed: "Not completed",
};
const NEXT: Partial<Record<ReferralStatus, ReferralStatus>> = {
  issued: "scheduled", scheduled: "attended", attended: "feedback", feedback: "closed",
};
export function referralMoveAllowed(from: ReferralStatus, to: ReferralStatus): boolean {
  if (to === "not_completed") return from !== "closed" && from !== "not_completed";
  return NEXT[from] === to;
}

export const fx = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(d));
export const pct = (x: number | null | undefined, d = 0) =>
  x == null || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(d)}%`;

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)} min`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)} h`;
  const d = h / 24;
  return `${Math.floor(d)} d`;
}

export function shortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function shortDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export const shortHash = (h: string | null | undefined, n = 10) => (h ? h.slice(0, n) : "–");

export const FLAG_LABEL: Record<string, string> = {
  VA_NOT_MEASURED_OD: "VA not measured · OD",
  VA_NOT_MEASURED_OS: "VA not measured · OS",
  VA_REDUCED_OD: "Reduced vision · OD",
  VA_REDUCED_OS: "Reduced vision · OS",
  MACULAR_RISK: "Macular finding",
  LATERALITY_MISMATCH: "Laterality mismatch",
  EYE_MISSING_OD: "OD missing",
  EYE_MISSING_OS: "OS missing",
  HIGH_ENTROPY: "Spread-out grade",
  DISAGREEMENT: "Graders disagree",
  OOD: "Unfamiliar image",
};
export const flagLabel = (c: string) => FLAG_LABEL[c] ?? c.replace(/_/g, " ").toLowerCase();

export function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "–";
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
