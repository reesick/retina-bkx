import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { holdTension, sound } from "../lib/sound";
import { useReducedMotion } from "../lib/store";

/**
 * STRONGER's hold circle reused for clinician sign-off. Hold for `ms` (default 1.2 s): the ring fills, rising sound
 * with accelerating ticks, the circle grows. Release early: the ring drains with a falling sound. Space/Enter hold too.
 */
export function HoldButton({
  onComplete, ms = 1200, size = 168, color = "#fff", label = "HOLD\nTO SIGN", disabled, disabledReason, doneLabel = "SIGNED.", done = false, pending = false,
}: {
  onComplete: () => void; ms?: number; size?: number; color?: string; label?: string; disabled?: boolean; disabledReason?: string; doneLabel?: string; done?: boolean; pending?: boolean;
}) {
  const reduced = useReducedMotion();
  const p = useMotionValue(0);
  const [holding, setHolding] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const anim = useRef<ReturnType<typeof animate> | null>(null);
  const fired = useRef(false);
  const r = size / 2 - 10;
  const L = 2 * Math.PI * r;
  const dash = useTransform(p, (x) => `${x * L} ${L}`);
  const hx = useTransform(p, (x) => size / 2 + r * Math.sin(x * 2 * Math.PI));
  const hy = useTransform(p, (x) => size / 2 - r * Math.cos(x * 2 * Math.PI));
  const scale = useTransform(p, [0, 1], [1, reduced ? 1 : 1.08]);
  const glow = useTransform(p, (x) => `0 0 ${20 + x * 70}px ${x * 18}px ${color}${Math.round(20 + x * 60).toString(16).padStart(2, "0")}`);
  const headOpacity = useTransform(p, (x) => (x > 0.01 && x < 0.999 ? 1 : 0));

  useEffect(() => () => { cancel.current?.(); anim.current?.stop(); }, []);
  useEffect(() => {
    if (done) p.set(1);
  }, [done, p]);

  const start = () => {
    if (disabled || done || pending || holding) return;
    fired.current = false;
    setHolding(true);
    cancel.current = holdTension(ms * (1 - p.get()));
    anim.current?.stop();
    anim.current = animate(p, 1, {
      duration: (ms / 1000) * (1 - p.get()), ease: "linear",
      onComplete: () => {
        if (fired.current) return;
        fired.current = true;
        cancel.current?.();
        setHolding(false);
        sound.thud();
        setTimeout(() => sound.success(), 80);
        onComplete();
      },
    });
  };
  const end = () => {
    if (!holding) return;
    setHolding(false);
    if (fired.current) return;
    cancel.current?.();
    anim.current?.stop();
    if (p.get() > 0.02) sound.fall();
    anim.current = animate(p, 0, { duration: 0.45, ease: [0.22, 1, 0.36, 1] });
  };

  const lines = (done ? doneLabel : label).split("\n");
  return (
    <motion.button
      type="button"
      aria-label={done ? "Signed" : "Press and hold to sign"}
      disabled={disabled || done}
      title={done ? "Already signed" : disabled ? disabledReason ?? "Not available yet" : "Press and hold to sign (or hold Space)"}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); start(); }}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") end(); }}
      onContextMenu={(e) => e.preventDefault()}
      className={`group relative grid touch-none select-none place-items-center rounded-full ${disabled ? "cursor-not-allowed opacity-35" : done ? "cursor-default" : "cursor-pointer"}`}
      style={{ width: size, height: size, scale }}
      animate={done && !reduced ? { scale: [1.12, 0.97, 1] } : undefined}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.span className="absolute inset-[14px] rounded-full transition-[filter] duration-200 group-enabled:group-hover:brightness-125" style={{ boxShadow: glow, background: "radial-gradient(circle at 50% 35%, #3a3a3c, #1c1c1e 70%)" }} />
      <svg width={size} height={size} className="absolute inset-0 overflow-visible" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={3} className="transition-[stroke] duration-200 group-enabled:group-hover:[stroke:rgba(255,255,255,0.3)]" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" style={{ strokeDasharray: dash }} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <motion.circle cx={hx} cy={hy} r={6} fill={color} style={{ filter: "blur(4px)", opacity: headOpacity }} />
        <motion.circle cx={hx} cy={hy} r={2.6} fill="#fff" style={{ opacity: headOpacity }} />
      </svg>
      <span className="relative text-center text-[13px] font-semibold uppercase leading-[1.35] tracking-[0.18em]" style={{ color: done ? color : "#fff" }}>
        {pending ? "SIGNING…" : lines.map((l, i) => <span key={i} className="block">{l}</span>)}
      </span>
    </motion.button>
  );
}
