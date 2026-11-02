import { motion, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useEffect } from "react";
import { useReducedMotion } from "../lib/store";

/** Rolling digits: numbers never jump. */
export function Odometer({
  value, decimals = 0, prefix = "", suffix = "", className = "", format,
}: { value: number | null | undefined; decimals?: number; prefix?: string; suffix?: string; className?: string; format?: (v: number) => string }) {
  if (value == null || !Number.isFinite(value)) return <span className={className}>–</span>;
  const text = format ? format(value) : value.toFixed(decimals);
  const chars = (prefix + text + suffix).split("");
  // index digits from the right so columns stay stable as the number grows
  let digitIdx = chars.filter((c) => /\d/.test(c)).length;
  return (
    <span className={`num inline-flex overflow-hidden leading-none ${className}`} aria-label={prefix + text + suffix} role="img">
      {chars.map((c, i) => {
        if (/\d/.test(c)) {
          digitIdx--;
          return <Digit key={`d${digitIdx}`} d={parseInt(c, 10)} />;
        }
        return (
          <span key={`c${i}`} aria-hidden>
            {c}
          </span>
        );
      })}
    </span>
  );
}

function Digit({ d }: { d: number }) {
  const reduced = useReducedMotion();
  const mv = useSpring(d, { stiffness: 140, damping: 22, mass: 0.9 });
  useEffect(() => {
    if (reduced) mv.jump(d);
    else mv.set(d);
  }, [d, mv, reduced]);
  return (
    <span aria-hidden className="relative inline-block" style={{ height: "1em", width: "0.62em" }}>
      <Strip mv={mv} />
    </span>
  );
}

function Strip({ mv }: { mv: MotionValue<number> }) {
  const y = useTransform(mv, (v) => `${-v}em`);
  return (
    <motion.span className="absolute left-0 top-0 flex flex-col items-center" style={{ y, width: "100%" }}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} style={{ height: "1em", lineHeight: "1em" }}>
          {i}
        </span>
      ))}
    </motion.span>
  );
}
