import { motion } from "framer-motion";
import { useId } from "react";
import { sound } from "../lib/sound";
import { SPRING } from "./motion";

export interface SegOption<T extends string> { value: T; label: string; disabled?: boolean; title?: string }

export function Segmented<T extends string>({
  options, value, onChange, size = "md", className = "", ariaLabel,
}: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; size?: "sm" | "md"; className?: string; ariaLabel?: string }) {
  const id = useId();
  const h = size === "sm" ? "h-8 text-[13px]" : "h-9 text-[14px]";
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`inline-flex rounded-[10px] bg-[#111113] p-[3px] ${className}`} style={{ boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.06)" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            title={o.title ?? (o.disabled ? "Not available here" : undefined)}
            onClick={() => {
              if (!active) sound.tick();
              onChange(o.value);
            }}
            onKeyDown={(e) => {
              const i = options.findIndex((x) => x.value === value);
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const n = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
                if (!n.disabled) onChange(n.value);
              }
            }}
            className={`relative flex-1 whitespace-nowrap rounded-[8px] px-3.5 font-medium transition-colors disabled:opacity-40 ${h} ${active ? "text-white" : "text-white/70 hover:bg-white/[0.04] hover:text-white"}`}
          >
            {active && (
              <motion.span layoutId={`seg-${id}`} transition={SPRING} className="absolute inset-0 rounded-[8px] bg-s2" style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.5), inset 0 0 0 0.5px rgba(255,255,255,0.1)" }} />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
