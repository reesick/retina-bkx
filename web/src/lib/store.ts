import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Volume = "soft" | "balanced" | "strong";

interface Settings {
  reviewer: string;
  sound: boolean;
  volume: Volume;
  reducedMotion: boolean;
  showUnimaged: boolean;
  defaultFov: number;
  set: (p: Partial<Omit<Settings, "set">>) => void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      reviewer: "Dr. A. Rao",
      sound: true,
      volume: "balanced",
      reducedMotion: false,
      showUnimaged: true,
      defaultFov: 45,
      set: (p) => set(p),
    }),
    { name: "retinitry.settings", partialize: ({ set: _s, ...rest }) => rest },
  ),
);

interface UI {
  /** Lesion selected in 2D viewer, 3D eye or list (shared). */
  selectedLesion: string | null;
  selectLesion: (id: string | null) => void;
  /** Post-processing auto-degrades below 45 fps. */
  lowPower: boolean;
  setLowPower: (v: boolean) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}
export interface Toast { id: number; text: string; tone?: "ok" | "error" | "info"; href?: string; linkText?: string }

let tid = 1;
export const useUI = create<UI>()((set) => ({
  selectedLesion: null,
  selectLesion: (id) => set({ selectedLesion: id }),
  lowPower: typeof window !== "undefined" && new URLSearchParams(window.location.search).has("lowpower"),
  setLowPower: (v) => set({ lowPower: v }),
  toasts: [],
  toast: (t) => {
    const id = tid++;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

export function useReducedMotion(): boolean {
  const r = useSettings((s) => s.reducedMotion);
  return r || !!mq?.matches;
}
export function reducedMotionNow(): boolean {
  return useSettings.getState().reducedMotion || !!mq?.matches;
}
