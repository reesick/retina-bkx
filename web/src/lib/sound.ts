// Tiny Web Audio synth: the web's haptics. No audio files. The AudioContext is created on the first user gesture.
import { useSettings } from "./store";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

const VOL = { soft: 0.05, balanced: 0.09, strong: 0.15 } as const;

function unlock() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
}

if (typeof window !== "undefined") {
  const once = () => unlock();
  window.addEventListener("pointerdown", once, { capture: true });
  window.addEventListener("keydown", once, { capture: true });
}

function ready(): { c: AudioContext; out: GainNode; v: number } | null {
  const s = useSettings.getState();
  if (!s.sound || !ctx || !master) return null;
  if (ctx.state === "suspended") void ctx.resume();
  return { c: ctx, out: master, v: VOL[s.volume] };
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; to?: number; attack?: number } = {}) {
  const r = ready();
  if (!r) return;
  const { c, out, v } = r;
  const t0 = c.currentTime + (opts.at ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? "sine";
  o.frequency.setValueAtTime(freq, t0);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  const peak = v * (opts.gain ?? 1);
  const a = opts.attack ?? 0.002;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  return () => {
    const n = c.currentTime;
    g.gain.cancelScheduledValues(n);
    g.gain.setValueAtTime(g.gain.value, n);
    g.gain.linearRampToValueAtTime(0, n + 0.04);
    try { o.stop(n + 0.06); } catch { /* already stopped */ }
  };
}

export const sound = {
  tick: () => tone(2000, 0.008 + 0.012, { gain: 0.5 }),
  lowTick: () => tone(700, 0.03, { gain: 0.6 }),
  thud: () => tone(90, 0.28, { gain: 2.2, to: 55 }),
  rise: (duration = 1.2) => tone(220, duration, { to: 880, gain: 0.35, attack: duration * 0.6, type: "triangle" }),
  fall: () => tone(520, 0.35, { to: 180, gain: 0.4, type: "triangle" }),
  success: () => {
    tone(523.25, 0.7, { gain: 0.6, at: 0 });
    tone(659.25, 0.7, { gain: 0.5, at: 0.06 });
    tone(783.99, 0.9, { gain: 0.45, at: 0.12 });
  },
  fail: () => {
    tone(440, 0.18, { gain: 0.6, type: "triangle" });
    tone(370, 0.3, { gain: 0.6, at: 0.16, type: "triangle" });
  },
};

/** Rising tension for hold-to-sign: ticks accelerate across `ms`. Returns a cancel function. */
export function holdTension(ms: number): () => void {
  let cancelled = false;
  const start = performance.now();
  const stopRise = sound.rise(ms / 1000);
  const loop = () => {
    if (cancelled) return;
    const t = (performance.now() - start) / ms;
    if (t >= 1) return;
    sound.tick();
    const gap = 220 - 170 * t; // 220 ms -> 50 ms
    setTimeout(loop, gap);
  };
  loop();
  return () => {
    cancelled = true;
    stopRise?.();
  };
}
