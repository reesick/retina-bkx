import type { ReactNode } from "react";

/** Friendly explained empty state: what would be here, why it is empty, and one primary action. */
export function EmptyState({ icon, title, body, action, secondary, compact }: { icon?: ReactNode; title: string; body: ReactNode; action?: ReactNode; secondary?: ReactNode; compact?: boolean }) {
  return (
    <div className={`card flex flex-col items-center text-center ${compact ? "px-6 py-8" : "px-6 py-14"}`}>
      {icon && <div className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-s2 text-white/80">{icon}</div>}
      <h2 className="text-title">{title}</h2>
      <p className="mt-2 max-w-md text-body text-l2">{body}</p>
      {(action || secondary) && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}{secondary}</div>}
    </div>
  );
}
