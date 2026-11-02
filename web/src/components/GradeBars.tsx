import { motion } from "framer-motion";
import { SOFT_SPRING } from "./motion";

/**
 * Five vertical bars (grades 0..4) like STRONGER's week bars. The predicted grade is white, others grey. Referable
 * zone (2–4) bracketed underneath. Optional per-model ghost bars behind.
 */
export function GradeBars({
  probs, ghosts = [], height = 120, barWidth = 18, gap = 14, label, showValues = true, highlight,
}: { probs: number[]; ghosts?: number[][]; height?: number; barWidth?: number; gap?: number; label?: string; showValues?: boolean; highlight?: string }) {
  const g = probs.indexOf(Math.max(...probs));
  const w = 5 * barWidth + 4 * gap;
  return (
    <div className="inline-flex flex-col items-center" aria-label={`${label ?? "Grade"} probabilities ${probs.map((p, i) => `grade ${i} ${(p * 100).toFixed(0)}%`).join(", ")}`} role="img">
      {label && <div className="mb-2 text-eyebrow uppercase text-l2">{label}</div>}
      <div className="relative flex items-end" style={{ height, gap, width: w }}>
        {probs.map((p, i) => (
          <div key={i} className="relative flex h-full flex-col items-center justify-end" style={{ width: barWidth }}>
            <div className="absolute inset-x-0 bottom-0 top-0 rounded-full bg-white/[0.06]" />
            {ghosts.map((gh, k) => (
              <motion.div
                key={k}
                className="absolute bottom-0 rounded-full"
                style={{ left: k === 0 ? -3 : undefined, right: k === 1 ? -3 : undefined, width: 3, background: "rgba(255,255,255,0.35)" }}
                initial={{ height: 0 }}
                animate={{ height: Math.max(3, gh[i] * height) }}
                transition={{ ...SOFT_SPRING, delay: 0.05 * i }}
              />
            ))}
            <motion.div
              className="relative w-full rounded-full"
              initial={{ height: 0 }}
              animate={{ height: Math.max(barWidth, p * height) }}
              transition={{ ...SOFT_SPRING, delay: 0.04 * i }}
              style={{
                background: i === g ? highlight ?? "#fff" : "rgba(255,255,255,0.28)",
                boxShadow: i === g ? `0 0 18px ${highlight ?? "rgba(255,255,255,0.45)"}` : "none",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex" style={{ gap, width: w }}>
        {probs.map((p, i) => (
          <div key={i} className="text-center" style={{ width: barWidth }}>
            <div className={`text-[12px] font-semibold ${i === g ? "text-white" : "text-l3"}`}>{i}</div>
            {showValues && <div className="num text-[10px] text-l3">{Math.round(p * 100)}</div>}
          </div>
        ))}
      </div>
      <div className="relative mt-1" style={{ width: w, height: 16 }}>
        <div className="absolute top-1 h-[6px] rounded-b-md border border-t-0 border-white/30" style={{ left: 2 * (barWidth + gap) - 2, right: -2 }} />
        <div className="absolute top-[7px] text-center text-[10px] uppercase tracking-wider text-l3" style={{ left: 2 * (barWidth + gap), right: 0 }}>
          referable
        </div>
      </div>
    </div>
  );
}
