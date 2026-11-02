import { motion } from "framer-motion";
import { sound } from "../lib/sound";
import { SPRING } from "./motion";

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        sound.tick();
        onChange(!checked);
      }}
      className="relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40"
      style={{ background: checked ? "#30D158" : "#39393D" }}
    >
      <motion.span
        layout
        transition={SPRING}
        className="absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white"
        style={{ left: checked ? 22 : 2, boxShadow: "0 3px 8px rgba(0,0,0,0.25), 0 1px 1px rgba(0,0,0,0.16)" }}
      />
    </button>
  );
}
