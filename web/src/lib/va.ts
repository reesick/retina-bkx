// Visual acuity helpers. Same conversion as core/policy.py va_to_logmar.

export const VA_VALUES = [
  "6/5", "6/6", "6/7.5", "6/9", "6/12", "6/18", "6/24", "6/36", "6/60", "CF", "HM", "PL", "NPL",
] as const;

const LOW: Record<string, number> = { CF: 1.9, HM: 2.3, PL: 2.7, NPL: 3.0 };

export function vaToLogmar(value: string | null | undefined): number | null {
  if (value == null) return null;
  const v = String(value).trim().toUpperCase();
  if (!v || v === "NM" || v === "NOT MEASURED" || v === "NONE") return null;
  if (v in LOW) return LOW[v];
  const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(v);
  if (m) {
    const num = parseFloat(m[1]), den = parseFloat(m[2]);
    if (num <= 0 || den <= 0) return null;
    return Math.log10(den / num);
  }
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : null;
}

/** Worse than 6/12 triggers the VA referral guardrail. */
export const VA_REFER_LOGMAR = Math.log10(12 / 6);
