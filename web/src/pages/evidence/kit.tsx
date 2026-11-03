// Shared building blocks for the Evidence page.
import { motion } from "framer-motion";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import type { Outcome } from "../../api/types";
import { OUTCOME_COLOR, OUTCOME_LABEL } from "../../lib/format";

export function Card({ title, caption, how, takeaway, children, className = "" }: { title: string; caption?: ReactNode; how?: ReactNode; takeaway?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.4 }} className={`card flex flex-col p-5 ${className}`}>
      <h3 className="text-title">{title}</h3>
      {caption && <p className="mt-0.5 text-footnote text-l2">{caption}</p>}
      {how && <p className="mt-2 rounded-[12px] bg-white/[0.04] px-3 py-2 text-[13px] leading-snug text-white/80"><span className="font-semibold text-white">How to read this: </span>{how}</p>}
      <div className="mt-4 flex-1">{children}</div>
      {takeaway && <p className="mt-3 border-t border-white/[0.08] pt-3 text-[14px] font-medium leading-snug text-white">{takeaway}</p>}
    </motion.section>
  );
}

export const Empty = () => <div className="py-6 text-center text-[13px] text-l3">Not measured.</div>;

export function Big({ label, v, color, sub }: { label: string; v: string; color?: string; sub?: string }) {
  return (
    <div className="rounded-[16px] bg-s2/60 p-3">
      <div className="num text-[24px] font-semibold leading-none" style={{ color }}>{v}</div>
      <div className="mt-1.5 text-[12px] text-l2">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-l2">{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ number helpers (never invent: "–" when missing)
export const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export const p0 = (x: number | null | undefined) => (isNum(x) ? `${Math.round(x * 100)}%` : "–");
export const p1 = (x: number | null | undefined) => (isNum(x) ? `${(x * 100).toFixed(1)}%` : "–");
export const f2 = (x: number | null | undefined, d = 2) => (isNum(x) ? x.toFixed(d) : "–");
export const int = (x: number | null | undefined) => (isNum(x) ? Math.round(x).toLocaleString("en-GB") : "–");
export const ofN = (a: number | null | undefined, b: number | null | undefined) => (isNum(a) && isNum(b) ? `${int(a)} of ${int(b)}` : "–");

export const OUTCOMES: Outcome[] = ["ROUTINE", "REFER", "HUMAN_REVIEW", "RETAKE"];

/** Outcome shares from either rates (0..1) or counts. */
export function outcomeShares(r: { routine_rate?: number; referral_rate?: number; human_review_rate?: number; retake_rate?: number } | undefined, counts?: Partial<Record<Outcome, number>>): Partial<Record<Outcome, number>> | null {
  if (counts && Object.values(counts).some(isNum)) {
    const tot = OUTCOMES.reduce((a, o) => a + (counts[o] ?? 0), 0);
    if (!tot) return null;
    return Object.fromEntries(OUTCOMES.map((o) => [o, (counts[o] ?? 0) / tot]));
  }
  if (!r) return null;
  const m: Partial<Record<Outcome, number>> = { ROUTINE: r.routine_rate, REFER: r.referral_rate, HUMAN_REVIEW: r.human_review_rate, RETAKE: r.retake_rate };
  return OUTCOMES.some((o) => isNum(m[o])) ? m : null;
}

/** Horizontal stacked bar of ROUTINE / REFER / HUMAN REVIEW / RETAKE shares. */
export const StackBar = memo(function StackBar({ shares, counts, height = 12, label }: { shares: Partial<Record<Outcome, number>> | null; counts?: Partial<Record<Outcome, number>>; height?: number; label?: string }) {
  if (!shares) return <div className="text-[12px] text-l3">Outcome mix not recorded.</div>;
  const desc = OUTCOMES.filter((o) => isNum(shares[o])).map((o) => `${OUTCOME_LABEL[o]} ${p0(shares[o])}`).join(", ");
  return (
    <div role="img" aria-label={`${label ? label + ": " : ""}${desc}`} className="flex w-full overflow-hidden rounded-full bg-white/[0.06]" style={{ height }}>
      {OUTCOMES.map((o) => {
        const v = shares[o];
        if (!isNum(v) || v <= 0) return null;
        return (
          <motion.div key={o} title={`${OUTCOME_LABEL[o]}: ${p1(v)}${counts?.[o] != null ? ` (${int(counts[o])})` : ""}`} className="h-full"
            style={{ background: OUTCOME_COLOR[o] }} initial={{ width: 0 }} whileInView={{ width: `${v * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
        );
      })}
    </div>
  );
});

export function OutcomeLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-l2">
      {OUTCOMES.map((o) => <span key={o} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: OUTCOME_COLOR[o] }} />{OUTCOME_LABEL[o]}</span>)}
    </div>
  );
}

/** Renders children only once the placeholder comes near the viewport (keeps the first paint light). */
export function Lazy({ children, minHeight = 320 }: { children: ReactNode; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "600px 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  if (seen) return <>{children}</>;
  return <div ref={ref} aria-hidden className="card" style={{ minHeight }} />;
}
