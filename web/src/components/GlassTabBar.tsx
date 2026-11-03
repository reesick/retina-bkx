import { motion, useMotionValue, animate, type PanInfo } from "framer-motion";
import { BarChart3, Eye, Inbox, Send, Sun } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueue } from "../api/hooks";
import { sound } from "../lib/sound";
import { Odometer } from "./Odometer";

const TABS = [
  { to: "/", label: "Today", icon: Sun },
  { to: "/queue", label: "Queue", icon: Inbox },
  { to: "/referrals", label: "Referrals", icon: Send },
  { to: "/evidence", label: "Evidence", icon: BarChart3 },
  { to: "/lab", label: "Eye Lab", icon: Eye },
] as const;
const TAB_W = 96;
const PAD = 6;

function activeIndex(path: string): number {
  if (path === "/") return 0;
  const i = TABS.findIndex((t) => t.to !== "/" && path.startsWith(t.to));
  return i;
}

/** Floating glass capsule with a brighter lens that slides between tabs on a spring and can be dragged. */
export function GlassTabBar() {
  const loc = useLocation();
  const nav = useNavigate();
  const idx = activeIndex(loc.pathname);
  const x = useMotionValue(Math.max(0, idx) * TAB_W);
  const [dragging, setDragging] = useState(false);
  const [pressed, setPressed] = useState(false);
  const queue = useQueue();
  const count = queue.data?.length ?? 0;
  const lastIdx = useRef(idx);

  useLayoutEffect(() => {
    if (dragging || idx < 0) return;
    const a = animate(x, idx * TAB_W, { type: "spring", stiffness: 380, damping: 30 });
    return () => a.stop();
  }, [idx, dragging, x]);

  useEffect(() => {
    if (idx !== lastIdx.current && idx >= 0) sound.tick();
    lastIdx.current = idx;
  }, [idx]);

  const go = (i: number) => {
    if (TABS[i].to !== loc.pathname) nav(TABS[i].to);
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    setDragging(false);
    const i = Math.max(0, Math.min(TABS.length - 1, Math.round((x.get() + info.velocity.x * 0.08) / TAB_W)));
    animate(x, i * TAB_W, { type: "spring", stiffness: 380, damping: 30 });
    go(i);
  };

  return (
    <nav aria-label="Primary" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center">
      <div className="glass pointer-events-auto relative flex h-16 rounded-full" style={{ padding: PAD, background: "rgba(28,28,30,0.62)", boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.09), 0 12px 40px rgba(0,0,0,0.6)" }}>
        {idx >= 0 && (
          <motion.div
            drag="x"
            dragConstraints={{ left: 0, right: (TABS.length - 1) * TAB_W }}
            dragElastic={0.12}
            dragMomentum={false}
            onDragStart={() => setDragging(true)}
            onDragEnd={onDragEnd}
            onPointerDown={() => setPressed(true)}
            onPointerUp={() => setPressed(false)}
            animate={{ scale: pressed || dragging ? 0.96 : 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute top-[6px] h-[52px] cursor-grab rounded-full active:cursor-grabbing"
            style={{ x, left: PAD, width: TAB_W, background: "rgba(255,255,255,0.13)", boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.08)" }}
            aria-hidden
          />
        )}
        {TABS.map((t, i) => {
          const active = i === idx;
          const Icon = t.icon;
          return (
            <motion.button
              key={t.to}
              type="button"
              onClick={() => go(i)}
              whileTap={{ scale: 0.96 }}
              aria-current={active ? "page" : undefined}
              aria-label={t.label}
              title={t.to === "/queue" && count > 0 ? `${t.label} · ${count} awaiting review` : t.label}
              className={`relative z-10 flex h-[52px] flex-col items-center justify-center gap-1 rounded-full text-[11px] font-medium transition-colors ${active ? "text-white" : "text-l2 hover:text-white/85"}`}
              style={{ width: TAB_W, pointerEvents: dragging ? "none" : "auto" }}
            >
              <span className="relative">
                <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.3 : 1.8} />
                {t.to === "/queue" && count > 0 && (
                  <span className="absolute -right-3 -top-2 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-review px-1 text-[11px] font-bold text-black" aria-hidden>
                    <Odometer value={count} />
                  </span>
                )}
              </span>
              {t.label}
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
}
