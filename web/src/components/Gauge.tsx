import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { SOFT_SPRING } from "./motion";

/**
 * Horizontal track with the threshold marked as a tick and the value as a glowing dot; the zone past the threshold
 * is tinted. `failAbove` = values above the threshold fail (entropy, OOD); otherwise below fails (focus, light).
 */
export function Gauge({
  label, value, threshold, max, min = 0, failAbove = true, pass, format = (v) => v.toFixed(2), hint, color, compact,
}: {
  label: ReactNode; value: number; threshold: number; max?: number; min?: number; failAbove?: boolean; pass?: boolean;
  format?: (v: number) => string; hint?: string; color?: string; compact?: boolean;
}) {
  const hi = max ?? Math.max(threshold * 2, value * 1.15, min + 1e-6);
  const t = (x: number) => Math.max(0, Math.min(1, (x - min) / (hi - min || 1)));
  const ok = pass ?? (failAbove ? value <= threshold : value >= threshold);
  const tint = color ?? (ok ? "#30D158" : "#FF453A");
  const tp = t(threshold) * 100, vp = t(value) * 100;
  return (
    <div className={compact ? "py-1.5" : "py-2.5"} title={hint}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-[14px] text-white/90">
          <span className="grid h-4 w-4 place-items-center rounded-full" style={{ background: `${ok ? "#30D158" : "#FF453A"}26` }}>
            {ok ? <Check className="h-2.5 w-2.5 text-routine" strokeWidth={3} /> : <X className="h-2.5 w-2.5 text-urgent" strokeWidth={3} />}
          </span>
          {label}
        </span>
        <span className="num text-[13px] text-l2">
          <span className="text-white">{format(value)}</span> <span className="text-l3">/ {format(threshold)}</span>
        </span>
      </div>
      <div className="relative h-[6px] rounded-full bg-white/[0.07]">
        <div
          className="absolute top-0 h-full rounded-full"
          style={failAbove ? { left: `${tp}%`, right: 0, background: "rgba(255,69,58,0.16)" } : { left: 0, width: `${tp}%`, background: "rgba(255,69,58,0.16)" }}
        />
        <div className="absolute -top-[5px] h-4 w-[2px] rounded bg-white/70" style={{ left: `calc(${tp}% - 1px)` }} />
        <motion.div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full"
          initial={{ left: "0%" }}
          animate={{ left: `calc(${vp}% - 6px)` }}
          transition={SOFT_SPRING}
          style={{ background: "#fff", boxShadow: `0 0 0 3px ${tint}55, 0 0 14px ${tint}` }}
        />
      </div>
      {hint && !compact && <p className="mt-1.5 text-[12px] text-l3">{hint}</p>}
    </div>
  );
}
