import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useReducedMotion } from "../lib/store";
import { pageVariants } from "./motion";

export function Page({ children, className = "", wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <motion.main
      variants={pageVariants(reduced)}
      initial="initial"
      animate="animate"
      exit="exit"
      className={`mx-auto w-full px-6 pb-[140px] pt-6 lg:px-8 ${wide ? "max-w-[1840px]" : "max-w-[1280px]"} ${className}`}
    >
      {children}
    </motion.main>
  );
}
