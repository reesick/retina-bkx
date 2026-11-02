import { animate, motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { useEffect, useRef } from "react";
import { sound } from "../lib/sound";

const ITEM = 36;

/** iOS-style vertical wheel picker with momentum, snapping and a tick per detent. Keyboard: ↑↓. */
export function WheelPicker({
  values, value, onChange, label, visible = 5, dim,
}: { values: readonly string[]; value: string | null; onChange: (v: string) => void; label: string; visible?: number; dim?: boolean }) {
  const idx = value == null ? -1 : values.indexOf(value);
  const y = useMotionValue(-Math.max(0, idx) * ITEM);
  const last = useRef(Math.max(0, idx));
  const dragging = useRef(false);
  const H = ITEM * visible;

  useEffect(() => {
    if (dragging.current) return;
    const target = -Math.max(0, idx) * ITEM;
    const a = animate(y, target, { type: "spring", stiffness: 380, damping: 32 });
    return () => a.stop();
  }, [idx, y]);

  useEffect(
    () =>
      y.on("change", (v) => {
        const i = Math.round(-v / ITEM);
        if (i !== last.current && i >= 0 && i < values.length) {
          last.current = i;
          sound.tick();
        }
      }),
    [y, values.length],
  );

  const settle = (vy: number) => {
    const projected = y.get() + vy * 0.18;
    const i = Math.max(0, Math.min(values.length - 1, Math.round(-projected / ITEM)));
    animate(y, -i * ITEM, { type: "spring", stiffness: 300, damping: 30, velocity: vy });
    onChange(values[i]);
  };

  return (
    <div
      role="listbox"
      aria-label={label}
      aria-activedescendant={idx >= 0 ? `${label}-${idx}` : undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const i = Math.max(0, Math.min(values.length - 1, (idx < 0 ? 0 : idx) + (e.key === "ArrowDown" ? 1 : -1)));
          onChange(values[i]);
        }
      }}
      onWheel={(e) => {
        const i = Math.max(0, Math.min(values.length - 1, (idx < 0 ? 0 : idx) + (e.deltaY > 0 ? 1 : -1)));
        onChange(values[i]);
      }}
      className={`relative select-none overflow-hidden rounded-[18px] bg-[#0e0e10] ${dim ? "opacity-60" : ""}`}
      style={{ height: H, boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.06)" }}
    >
      <div className="pointer-events-none absolute inset-x-2 rounded-[10px] bg-white/[0.08]" style={{ top: (H - ITEM) / 2, height: ITEM }} />
      <motion.div
        drag="y"
        dragConstraints={{ top: -(values.length - 1) * ITEM, bottom: 0 }}
        dragElastic={0.15}
        dragMomentum={false}
        onDragStart={() => (dragging.current = true)}
        onDragEnd={(_, info) => {
          dragging.current = false;
          settle(info.velocity.y);
        }}
        style={{ y, paddingTop: (H - ITEM) / 2, paddingBottom: (H - ITEM) / 2 }}
        className="cursor-grab active:cursor-grabbing"
      >
        {values.map((v, i) => (
          <WheelItem key={v} v={v} i={i} y={y} selected={i === idx} id={`${label}-${i}`} onClick={() => onChange(v)} />
        ))}
      </motion.div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-[#0e0e10] to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#0e0e10] to-transparent" />
    </div>
  );
}

function WheelItem({ v, i, y, selected, id, onClick }: { v: string; i: number; y: MotionValue<number>; selected: boolean; id: string; onClick: () => void }) {
  const d = useTransform(y, (yy) => Math.abs(i * ITEM + yy) / ITEM);
  const opacity = useTransform(d, [0, 1, 2.5], [1, 0.55, 0.15]);
  const rotateX = useTransform(y, (yy) => Math.max(-70, Math.min(70, ((i * ITEM + yy) / ITEM) * -22)));
  const scale = useTransform(d, [0, 2], [1, 0.86]);
  return (
    <motion.div
      id={id}
      role="option"
      aria-selected={selected}
      onClick={onClick}
      style={{ height: ITEM, opacity, rotateX, scale, transformPerspective: 300 }}
      className={`num flex items-center justify-center text-[19px] ${selected ? "font-semibold text-white" : "text-white/80"}`}
    >
      {v}
    </motion.div>
  );
}
