import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** Horizontal strip with edge fades and arrow buttons that scroll by one card. */
export function ScrollStrip({ children, label, header, right, className = "" }: { children: ReactNode; label: string; header?: ReactNode; right?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 4, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true });
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [update]);
  const step = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(el).columnGap || "12") || 12;
    const w = first ? first.getBoundingClientRect().width + gap : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * w, behavior: "smooth" });
  };
  return (
    <div className={className}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">{header}</div>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          <button type="button" onClick={() => step(-1)} disabled={!edges.left} aria-label={`Scroll ${label} left`} title={edges.left ? "Previous" : "Already at the start"} className="grid h-9 w-9 place-items-center rounded-full bg-s2 text-white transition-colors hover:bg-[#3a3a3c] disabled:opacity-35">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => step(1)} disabled={!edges.right} aria-label={`Scroll ${label} right`} title={edges.right ? "More" : "Already at the end"} className="grid h-9 w-9 place-items-center rounded-full bg-s2 text-white transition-colors hover:bg-[#3a3a3c] disabled:opacity-35">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="relative" data-scroll-hint>
        <div ref={ref} role="region" aria-label={label} className="scrollbar-none -mx-2 flex gap-3 overflow-x-auto scroll-smooth px-2 pb-2">
          {children}
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-black to-transparent transition-opacity" style={{ opacity: edges.left ? 1 : 0 }} />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-black to-transparent transition-opacity" style={{ opacity: edges.right ? 1 : 0 }} />
      </div>
    </div>
  );
}
