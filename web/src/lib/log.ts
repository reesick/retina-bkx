// Front-end logging: errors, unhandled rejections, console.error and WebGL context events go to
// POST /api/client-log (appended to logs/client.log by the server). Never throws; deduped and rate-limited.
import { IS_MOCK } from "../api/client";

export type LogLevel = "error" | "warn" | "info";
export interface ClientLog {
  level?: LogLevel;
  kind: string; // "error" | "unhandledrejection" | "console" | "react" | "webgl" | ...
  message: string;
  stack?: string | null;
  component?: string | null;
  extra?: Record<string, unknown>;
}

const DEDUPE_MS = 10_000;
const MAX_PER_MIN = 50;
const recent = new Map<string, number>();
const sentAt: number[] = [];
let sending = false; // guards against recursion via console.error
let unavailable = false; // server without /api/client-log: stop trying after the first 404

const clip = (s: unknown, n: number) => (typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : s == null ? null : String(s).slice(0, n));

export function logClient(e: ClientLog): void {
  try {
    const now = Date.now();
    const key = `${e.kind}|${e.message}`;
    const prev = recent.get(key);
    if (prev != null && now - prev < DEDUPE_MS) return;
    recent.set(key, now);
    if (recent.size > 200) for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
    while (sentAt.length && now - sentAt[0] > 60_000) sentAt.shift();
    if (sentAt.length >= MAX_PER_MIN || unavailable) return;
    sentAt.push(now);

    const body = {
      level: e.level ?? "error",
      kind: e.kind,
      message: clip(e.message, 2000),
      stack: clip(e.stack ?? null, 6000),
      url: location.href,
      route: location.pathname + location.search,
      component: clip(e.component ?? null, 4000),
      ua: navigator.userAgent,
      extra: e.extra ?? null,
    };
    if (IS_MOCK) {
      console.log("[client-log]", body);
      return;
    }
    sending = true;
    fetch("/api/client-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true })
      .then((r) => { if (r.status === 404 || r.status === 405) unavailable = true; })
      .catch(() => undefined)
      .finally(() => { sending = false; });
  } catch {
    /* logging must never break the app */
  }
}

const errText = (x: unknown): { message: string; stack: string | null } => {
  if (x instanceof Error) return { message: x.message || String(x), stack: x.stack ?? null };
  if (typeof x === "string") return { message: x, stack: null };
  try { return { message: JSON.stringify(x), stack: null }; } catch { return { message: String(x), stack: null }; }
};

let installed = false;
export function installGlobalLogging(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => {
    // resource load errors (img/script) arrive here with a target but no error object
    if (!(ev instanceof ErrorEvent)) return;
    const { message, stack } = errText(ev.error ?? ev.message);
    logClient({ kind: "error", message, stack, extra: { source: ev.filename, line: ev.lineno, col: ev.colno } });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const { message, stack } = errText(ev.reason);
    logClient({ kind: "unhandledrejection", message, stack });
  });
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    orig(...args);
    if (sending) return;
    try {
      const first = args.find((a) => a instanceof Error) as Error | undefined;
      const message = args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : errText(a).message)).join(" ").slice(0, 2000);
      logClient({ kind: "console", message, stack: first?.stack ?? null });
    } catch { /* ignore */ }
  };
}

/** WebGL context events, reported by the 3D stage. */
export function logWebGL(event: "lost" | "restored" | "restore-click", extra?: Record<string, unknown>): void {
  logClient({ level: event === "lost" ? "error" : "info", kind: "webgl", message: `webgl context ${event}`, extra });
}
