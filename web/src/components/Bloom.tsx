import { AnimatePresence, motion } from "framer-motion";

/** The moment-of-truth bloom: a radial flash in the outcome colour that settles into a soft glow. */
export function Bloom({ show, color = "#fff", size = 900, settle = 0.35 }: { show: boolean; color?: string; size?: number; settle?: number }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
          style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, background: `radial-gradient(circle, ${color}cc 0%, ${color}55 22%, ${color}14 45%, transparent 68%)`, mixBlendMode: "screen" }}
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: [0, 1, settle], scale: [0.3, 1.15, 1] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.4, times: [0, 0.25, 1], ease: [0.22, 1, 0.36, 1] }}
        />
      )}
    </AnimatePresence>
  );
}
