import type { Transition, Variants } from "framer-motion";

export const SPRING: Transition = { type: "spring", stiffness: 380, damping: 30 };
export const SOFT_SPRING: Transition = { type: "spring", stiffness: 180, damping: 24 };
export const EASE = [0.22, 1, 0.36, 1] as const;

export const pageVariants = (reduced: boolean): Variants =>
  reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.2 } }, exit: { opacity: 0, transition: { duration: 0.15 } } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
        exit: { opacity: 0, y: -4, transition: { duration: 0.15, ease: EASE } },
      };

export const listVariants: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.03 } },
};
export const itemVariants = (reduced: boolean): Variants =>
  reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } } };
