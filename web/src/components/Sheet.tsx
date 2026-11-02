import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SPRING } from "./motion";

/** Bottom or side sheet with spring, glass, drag (by the header) to dismiss, Esc to close. */
export function Sheet({
  open, onClose, side = "bottom", title, children, width = 440,
}: { open: boolean; onClose: () => void; side?: "bottom" | "right"; title?: ReactNode; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (side === "bottom" ? info.offset.y > 120 || info.velocity.y > 600 : info.offset.x > 120 || info.velocity.x > 600) onClose();
  };
  const bottom = side === "bottom";
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="sheet" className="fixed inset-0 z-[80]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { delay: 0.1 } }}>
          <div className="absolute inset-0 bg-black/60" onClick={onClose} style={{ backdropFilter: "blur(6px)" }} />
          <div className={`pointer-events-none absolute inset-0 flex ${bottom ? "items-end justify-center" : "items-stretch justify-end p-3"}`}>
            <motion.div
              ref={ref}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              drag={bottom ? "y" : "x"}
              dragListener={false}
              dragControls={controls}
              dragConstraints={{ top: 0, left: 0, right: 0, bottom: 0 }}
              dragElastic={{ top: 0.05, left: 0.05, bottom: 0.6, right: 0.6 }}
              onDragEnd={onDragEnd}
              initial={bottom ? { y: "100%" } : { x: "105%" }}
              animate={bottom ? { y: 0 } : { x: 0 }}
              exit={bottom ? { y: "100%" } : { x: "105%" }}
              transition={SPRING}
              className={`glass pointer-events-auto flex flex-col overflow-hidden outline-none ${bottom ? "max-h-[88vh] w-[min(720px,100vw)] rounded-t-[28px]" : "rounded-[28px]"}`}
              style={bottom ? { background: "rgba(22,22,24,0.88)" } : { width, maxWidth: "calc(100vw - 24px)", background: "rgba(22,22,24,0.86)" }}
            >
              <div className="shrink-0 cursor-grab touch-none active:cursor-grabbing" onPointerDown={(e) => controls.start(e)}>
                {bottom && <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-white/25" />}
                <div className="flex items-center justify-between px-6 pb-2 pt-4">
                  <div className="text-title">{title}</div>
                  <button type="button" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/15">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
