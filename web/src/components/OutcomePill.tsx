import type { Outcome, Urgency } from "../api/types";
import { OUTCOME_LABEL, outcomeColor } from "../lib/format";

export function OutcomePill({ outcome, urgency, size = "md", prefix }: { outcome: Outcome | null | undefined; urgency?: Urgency; size?: "sm" | "md" | "lg"; prefix?: string }) {
  if (!outcome) {
    return <span className="inline-flex h-7 items-center rounded-full bg-s2 px-3 text-[12px] font-medium text-l3">Pending</span>;
  }
  const c = outcomeColor(outcome, urgency);
  const label = outcome === "REFER" && urgency === "immediate" ? "Refer now" : OUTCOME_LABEL[outcome];
  const h = size === "sm" ? "h-6 text-[12px] px-2.5" : size === "lg" ? "h-9 text-[15px] px-4" : "h-7 text-[13px] px-3";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2 rounded-full font-semibold ${h}`}
      style={{ background: `${c}1f`, color: c, boxShadow: `inset 0 0 12px ${c}22, inset 0 0 0 0.5px ${c}55` }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
      {prefix && <span className="font-medium opacity-70">{prefix}</span>}
      {label}
    </span>
  );
}
