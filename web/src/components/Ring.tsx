import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect, useId, type ReactNode } from "react";
import { useReducedMotion } from "../lib/store";

/** SVG ring with a glowing head dot (the STRONGER hold ring). value 0..1. */
export function Ring({
  value, size = 160, stroke = 8, color = "#fff", track = "rgba(255,255,255,0.08)", marker, markerLabel, children, glow = true,
  stiffness = 90, className = "", head = true,
}: {
  value: number; size?: number; stroke?: number; color?: string; track?: string; marker?: number | null; markerLabel?: string;
  children?: ReactNode; glow?: boolean; stiffness?: number; className?: string; head?: boolean;
}) {
  const reduced = useReducedMotion();
  const v = useSpring(0, { stiffness, damping: 20 });
  useEffect(() => {
    const x = Math.max(0, Math.min(1, value));
    if (reduced) v.jump(x);
    else v.set(x);
  }, [value, v, reduced]);
  const r = (size - stroke) / 2 - (glow ? 4 : 0);
  const c = size / 2;
  const L = 2 * Math.PI * r;
  const dash = useTransform(v, (x) => `${x * L} ${L}`);
  const hx = useTransform(v, (x) => c + r * Math.sin(x * 2 * Math.PI));
  const hy = useTransform(v, (x) => c - r * Math.cos(x * 2 * Math.PI));
  const headOpacity = useTransform(v, (x) => (x > 0.004 ? 1 : 0));
  const id = useId().replace(/:/g, "");
  const m = marker != null ? Math.max(0, Math.min(1, marker)) : null;
  return (
    <div className={`relative inline-grid place-items-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 overflow-visible" aria-hidden>
        <defs>
          <filter id={`g${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={stroke * 0.6} />
          </filter>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          style={{ strokeDasharray: dash }} transform={`rotate(-90 ${c} ${c})`}
        />
        {m != null && (
          <g>
            <line
              x1={c + (r - stroke * 1.4) * Math.sin(m * 2 * Math.PI)} y1={c - (r - stroke * 1.4) * Math.cos(m * 2 * Math.PI)}
              x2={c + (r + stroke * 1.4) * Math.sin(m * 2 * Math.PI)} y2={c - (r + stroke * 1.4) * Math.cos(m * 2 * Math.PI)}
              stroke="rgba(255,255,255,0.85)" strokeWidth={2} strokeLinecap="round"
            />
            {markerLabel && (
              <text
                x={c + (r + stroke * 3.2) * Math.sin(m * 2 * Math.PI)} y={c - (r + stroke * 3.2) * Math.cos(m * 2 * Math.PI)}
                fill="rgba(255,255,255,0.6)" fontSize={10} textAnchor="middle" dominantBaseline="middle"
              >
                {markerLabel}
              </text>
            )}
          </g>
        )}
        {head && (
          <motion.g style={{ opacity: headOpacity }}>
            {glow && <motion.circle cx={hx} cy={hy} r={stroke * 1.1} fill={color} filter={`url(#g${id})`} opacity={0.9} />}
            <motion.circle cx={hx} cy={hy} r={stroke * 0.55} fill="#fff" />
          </motion.g>
        )}
      </svg>
      <div className="relative z-10 grid place-items-center text-center">{children}</div>
    </div>
  );
}
