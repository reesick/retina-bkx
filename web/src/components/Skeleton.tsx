import type { CSSProperties } from "react";

export function Skeleton({ className = "", style, round }: { className?: string; style?: CSSProperties; round?: boolean }) {
  return <div aria-hidden className={`skeleton ${round ? "rounded-full" : "rounded-[14px]"} ${className}`} style={style} />;
}

export function ErrorState({ error, onRetry, title = "Could not load" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return (
    <div role="alert" className="card flex flex-col items-start gap-3 p-6">
      <div className="text-headline text-urgent">{title}</div>
      <p className="text-body text-l2">{msg}</p>
      {onRetry && (
        <button type="button" className="btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
