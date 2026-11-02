import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useUI } from "../lib/store";
import { SPRING } from "./motion";

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[100] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.95 }}
            transition={SPRING}
            className="glass pointer-events-auto flex items-center gap-3 rounded-full py-2.5 pl-4 pr-3 text-[14px]"
            onClick={() => dismiss(t.id)}
          >
            {t.tone === "error" ? <AlertCircle className="h-4 w-4 text-urgent" /> : t.tone === "ok" ? <CheckCircle2 className="h-4 w-4 text-routine" /> : <Info className="h-4 w-4 text-white/70" />}
            <span>{t.text}</span>
            {t.href && (
              <Link to={t.href} className="rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-black">
                {t.linkText ?? "Open"}
              </Link>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
