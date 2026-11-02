// The analysis theatre: SSE-driven, growing circle, progress ring, scan shader, partials drawn on the image,
// then the outcome reveal (overshoot, coloured bloom, one bold word, sound).
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { assetUrl } from "../api/client";
import { qk, useEncounter } from "../api/hooks";
import { subscribeProgress } from "../api/sse";
import type { Encounter, ImageResult, Landmarks, Lesions, ModelGrade, Quality, StepName, Triage, Uncertainty } from "../api/types";
import { Bloom } from "../components/Bloom";
import { GradeBars } from "../components/GradeBars";
import { Gauge } from "../components/Gauge";
import { Check, X } from "../components/icons";
import { encounterReasonLine, imageReasonLine, STEP_LINE, STEPS } from "../lib/copy";
import { LESION_COLOR, OUTCOME_WORD, outcomeColor } from "../lib/format";
import { sound } from "../lib/sound";
import { useReducedMotion } from "../lib/store";
import { ScanCanvas } from "../three/ScanCanvas";

interface RunState {
  step: StepName | null;
  done: Set<StepName>;
  quality?: Quality; landmarks?: Landmarks; cnn?: ModelGrade; vit?: ModelGrade; lesions?: Lesions; uncertainty?: Uncertainty; triage?: Triage;
  result?: ImageResult;
  error?: string;
}
type Act = { t: "reset" } | { t: "start"; step: StepName } | { t: "stepDone"; step: StepName; partial?: unknown } | { t: "done"; r: ImageResult } | { t: "error"; m: string };

function reducer(s: RunState, a: Act): RunState {
  switch (a.t) {
    case "reset": return { step: null, done: new Set() };
    case "start": return { ...s, step: a.step };
    case "stepDone": {
      const done = new Set(s.done);
      done.add(a.step);
      const n: RunState = { ...s, done };
      const p = a.partial;
      if (p) {
        if (a.step === "quality") n.quality = p as Quality;
        if (a.step === "landmarks") n.landmarks = p as Landmarks;
        if (a.step === "grader_cnn") n.cnn = p as ModelGrade;
        if (a.step === "grader_vit") n.vit = p as ModelGrade;
        if (a.step === "lesions") n.lesions = p as Lesions;
        if (a.step === "uncertainty") n.uncertainty = p as Uncertainty;
        if (a.step === "policy") n.triage = p as Triage;
      }
      return n;
    }
    case "done": {
      const r = a.r;
      return {
        ...s, step: null, done: new Set(STEPS), result: r, quality: s.quality ?? r.quality, landmarks: s.landmarks ?? r.landmarks,
        cnn: s.cnn ?? r.grading?.models[0], vit: s.vit ?? r.grading?.models[1], lesions: s.lesions ?? r.lesions,
        uncertainty: s.uncertainty ?? r.uncertainty, triage: s.triage ?? r.triage,
      };
    }
    case "error": return { ...s, error: a.m, step: null };
  }
}

export default function Theatre() {
  const { encId = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const enc = useEncounter(encId);
  const reduced = useReducedMotion();
  const images = useMemo(() => enc.data?.images ?? [], [enc.data]);
  const [idx, setIdx] = useState(0);
  const [st, dispatch] = useReducer(reducer, { step: null, done: new Set<StepName>() });
  const [finalEnc, setFinalEnc] = useState<Encounter | null>(null);
  const [retry, setRetry] = useState(0);
  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => {
    const r = () => setVh(window.innerHeight);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  const current = images[idx];
  const currentId = current?.id;
  // subscribe to the SSE stream of the current image
  useEffect(() => {
    if (!currentId) return;
    dispatch({ t: "reset" });
    const un = subscribeProgress(currentId, (ev) => {
      if (ev.type === "step") {
        if (ev.data.status === "start") dispatch({ t: "start", step: ev.data.step });
        else {
          dispatch({ t: "stepDone", step: ev.data.step, partial: ev.data.partial });
          sound.lowTick();
        }
      } else if (ev.type === "done") {
        dispatch({ t: "done", r: ev.data });
      } else {
        sound.fail();
        dispatch({ t: "error", m: ev.data.message });
      }
    });
    return un;
  }, [currentId, retry]);

  // after an image is done: next image, or the encounter outcome
  useEffect(() => {
    if (!st.result) return;
    const last = idx >= images.length - 1;
    const t = setTimeout(async () => {
      if (!last) {
        setIdx((i) => i + 1);
        return;
      }
      try {
        const e = await qc.fetchQuery({ queryKey: qk.encounter(encId), queryFn: () => import("../api/client").then((m) => m.api.encounter(encId)), staleTime: 0 });
        setFinalEnc(e);
        void qc.invalidateQueries({ queryKey: qk.queue });
        void qc.invalidateQueries({ queryKey: qk.stats });
        void qc.invalidateQueries({ queryKey: ["encounters"] });
      } catch {
        setFinalEnc(enc.data ?? null);
      }
    }, last ? 650 : 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.result]);

  // keyboard: Esc leaves, Enter opens the case when finished
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") nav(`/case/${encId}`);
      if (e.key === "Enter" && finalEnc) nav(`/case/${encId}`);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [finalEnc, encId, nav]);

  const outcome = finalEnc?.ai?.outcome ?? null;
  const ocolor = outcome ? outcomeColor(outcome, finalEnc?.ai?.urgency) : "#fff";
  useEffect(() => {
    if (!outcome) return;
    sound.thud();
    const t = setTimeout(() => sound.success(), 90);
    return () => clearTimeout(t);
  }, [outcome]);

  const progress = st.done.size / STEPS.length;
  const target = Math.min(vh * 0.7, 860);
  const size = useMotionValue(320);
  const analysing = !!current && !st.result && !st.error;
  useEffect(() => {
    if (!analysing) return;
    size.set(reduced ? target * 0.85 : 320);
    if (reduced) return;
    const a = animate(size, target, { duration: 9, ease: [0.12, 0.6, 0.3, 1] });
    return () => a.stop();
  }, [analysing, idx, target, size, reduced]);

  if (enc.isError) {
    return <Shell><p className="text-l2">Could not load this encounter.</p><Link to="/" className="btn-ghost mt-4">Back to Today</Link></Shell>;
  }
  if (enc.isLoading || !enc.data) return <Shell><div className="h-[320px] w-[320px] rounded-full skeleton" /></Shell>;
  if (!images.length) return <Shell><p className="text-l2">No images in this encounter.</p><Link to={`/case/${encId}`} className="btn-ghost mt-4">Open case</Link></Shell>;

  // canonical exists once "decode" has run; before that show the original upload
  const src = st.done.has("decode") || current.status === "done" || st.result ? assetUrl(current.urls.canonical) : assetUrl(current.urls.original) ?? assetUrl(current.urls.canonical);
  const line = st.error ? "Something went wrong." : st.step ? STEP_LINE[st.step] : st.result ? (idx < images.length - 1 ? "Next photo." : "") : "Waiting for the analysis worker.";

  return (
    <motion.main initial={{ opacity: 0, filter: "blur(12px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.5 }} className="fixed inset-0 overflow-hidden bg-black">
      <div className="absolute left-6 top-6 text-eyebrow uppercase text-white/40" style={{ letterSpacing: "0.42em" }}>Retinitry</div>
      <div className="absolute right-6 top-6 text-[13px] text-l3 num">{enc.data.patient_code} · {current.eye} · {current.view}</div>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {/* headline: step lines cross-fade, then the outcome word */}
        <div className="relative mb-6 flex h-[180px] w-full items-end justify-center">
          <AnimatePresence initial={false}>
            {outcome ? (
              <motion.div key="word" className="absolute inset-x-0 bottom-0 text-center" initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
                <div className="font-bold leading-[0.9] tracking-[-0.045em]" style={{ fontSize: "clamp(64px, 11vw, 160px)", color: "#fff", textShadow: `0 0 60px ${ocolor}99` }}>
                  {OUTCOME_WORD[outcome]}
                </div>
                <div className="mt-3 text-[17px] text-white/80">{finalEnc ? encounterReasonLine(finalEnc) : ""}</div>
              </motion.div>
            ) : (
              <motion.div key={line} className="absolute inset-x-0 bottom-0 text-center text-[26px] font-semibold tracking-[-0.01em]" initial={{ opacity: 0, y: 8, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8, filter: "blur(6px)" }} transition={{ duration: 0.35 }}>
                {line}
                {st.error && <div className="mt-2 text-[15px] font-normal text-urgent">{st.error}</div>}
                {st.result && !outcome && idx < images.length && <div className="mt-2 text-[15px] font-normal" style={{ color: outcomeColor(st.result.triage?.outcome, st.result.triage?.urgency) }}>{st.result.triage ? `${current.eye}: ${imageReasonLine(st.result)}` : ""}</div>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative flex items-center justify-center gap-10">
          <SideBars grade={st.cnn} label="CNN" side="left" />
          <Circle size={size} src={src} st={st} progress={progress} analysing={analysing} outcome={outcome} color={ocolor} reduced={reduced} />
          <SideBars grade={st.vit} label="ViT" side="right" />
        </div>

        {/* doubt gauges */}
        <div className="mt-8 h-[84px] w-[min(720px,90vw)]">
          <AnimatePresence>
            {st.uncertainty && !outcome && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid grid-cols-3 gap-6">
                <Gauge compact label="Entropy" value={st.uncertainty.entropy} threshold={st.uncertainty.entropy_threshold} max={Math.log(5)} />
                <Gauge compact label="Disagreement" value={st.uncertainty.disagreement} threshold={st.uncertainty.disagreement_threshold} max={1} />
                <Gauge compact label="OOD" value={st.uncertainty.ood_score} threshold={st.uncertainty.ood_threshold} format={(v) => v.toFixed(1)} />
              </motion.div>
            )}
            {outcome && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="flex justify-center gap-3">
                <Link to={`/case/${encId}`} className="btn-white h-12 px-8 text-[16px]">Open case</Link>
                <Link to="/screen/new" className="btn-ghost h-12 px-6 text-[16px]">Next patient</Link>
              </motion.div>
            )}
            {st.error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center gap-3">
                <button type="button" className="btn-white" onClick={() => setRetry((r) => r + 1)}>Retry</button>
                <Link to={`/case/${encId}`} className="btn-ghost">Open case</Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* queue of images */}
      {images.length > 1 && (
        <div className="absolute inset-x-0 bottom-10 flex justify-center gap-3">
          {images.map((im, i) => (
            <motion.div key={im.id} animate={{ scale: i === idx ? 1.15 : 1, opacity: i < idx || i === idx ? 1 : 0.45 }} className="relative h-11 w-11 overflow-hidden rounded-full" style={{ boxShadow: i === idx ? "0 0 0 2px #fff" : i < idx ? "0 0 0 2px rgba(255,255,255,0.3)" : "none" }}>
              <img src={assetUrl(im.urls.canonical)} alt="" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[9px] font-semibold">{im.eye}</span>
            </motion.div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => nav(`/case/${encId}`)} className="absolute bottom-10 right-6 text-[13px] text-l3 hover:text-white">Skip · Esc</button>
    </motion.main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="fixed inset-0 flex flex-col items-center justify-center bg-black">{children}</main>;
}

function SideBars({ grade, label, side }: { grade?: ModelGrade; label: string; side: "left" | "right" }) {
  return (
    <div className="w-[190px]">
      <AnimatePresence>
        {grade && (
          <motion.div initial={{ opacity: 0, x: side === "left" ? -20 : 20 }} animate={{ opacity: 1, x: 0 }} className={`flex flex-col ${side === "left" ? "items-end" : "items-start"}`}>
            <GradeBars probs={grade.probs} label={label} height={110} barWidth={14} gap={10} />
            <div className="mt-1 text-[12px] text-l2 num">P(ref) {grade.p_referable.toFixed(2)}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Circle({
  size, src, st, progress, analysing, outcome, color, reduced,
}: { size: ReturnType<typeof useMotionValue<number>>; src: string | undefined; st: RunState; progress: number; analysing: boolean; outcome: string | null; color: string; reduced: boolean }) {
  const ring = 14;
  const outer = useTransform(size, (s) => s + ring * 2 + 40);
  const [px, setPx] = useState(320);
  useEffect(() => size.on("change", (v) => setPx(v)), [size]);
  const R = px / 2 + ring + 6;
  const C = px / 2 + ring + 20;
  const L = 2 * Math.PI * R;
  const headA = progress * Math.PI * 2;
  const checks = st.quality?.checks ?? [];
  const lesionsShown = useRef(0);
  const items = (st.lesions?.items ?? []).slice(0, 60);
  lesionsShown.current = items.length;
  return (
    <motion.div className="relative" style={{ width: outer, height: outer }} animate={outcome && !reduced ? { scale: [1, 1.06, 1] } : { scale: 1 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
      <Bloom show={!!outcome} color={color} size={px * 2.4} />
      <div aria-hidden className="absolute inset-0 rounded-full" style={{ background: `radial-gradient(circle, rgba(255,255,255,${0.05 + progress * 0.08}), transparent 65%)`, transform: "scale(1.5)" }} />
      {/* ring with glowing head */}
      <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${C * 2} ${C * 2}`} aria-hidden>
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={3} />
        <motion.circle cx={C} cy={C} r={R} fill="none" stroke={outcome ? color : "#fff"} strokeWidth={3.5} strokeLinecap="round" transform={`rotate(-90 ${C} ${C})`} initial={false} animate={{ strokeDasharray: `${progress * L} ${L}` }} transition={{ type: "spring", stiffness: 70, damping: 18 }} />
        {progress > 0 && progress < 1 && (
          <motion.g initial={false} animate={{ x: C + R * Math.sin(headA), y: C - R * Math.cos(headA) }} transition={{ type: "spring", stiffness: 70, damping: 18 }}>
            <circle r={9} fill="#fff" opacity={0.6} style={{ filter: "blur(6px)" }} />
            <circle r={3.2} fill="#fff" />
          </motion.g>
        )}
        {/* quality chips around the ring */}
        {checks.map((c, i) => {
          const ANG = [-54, -27, 0, 27, 54, 160, 200, 180, -80, 80];
          const a = ((ANG[i] ?? i * 36) - 90) * (Math.PI / 180);
          const rr = R + 26;
          const x = C + rr * Math.cos(a), y = C + rr * Math.sin(a);
          const col = c.pass ? "#30D158" : c.hard ? "#FF453A" : "#FFD60A";
          return (
            <motion.g key={c.code} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: outcome ? 0.35 : 1, scale: 1 }} transition={{ delay: i * 0.06, type: "spring", stiffness: 380, damping: 22 }} style={{ originX: `${x}px`, originY: `${y}px` }}>
              <rect x={x - 46} y={y - 11} width={92} height={22} rx={11} fill="rgba(28,28,30,0.85)" stroke={`${col}66`} strokeWidth={0.8} />
              <circle cx={x - 33} cy={y} r={6} fill={`${col}33`} />
              <text x={x - 33} y={y + 3.3} textAnchor="middle" fontSize={9} fill={col} fontWeight={700}>{c.pass ? "✓" : "✕"}</text>
              <text x={x - 23} y={y + 3.6} fontSize={10} fill="rgba(255,255,255,0.85)">{c.label.length > 12 ? c.label.slice(0, 11) + "…" : c.label}</text>
            </motion.g>
          );
        })}
      </svg>
      {/* the photo */}
      <motion.div className="absolute overflow-hidden rounded-full bg-[#0b0b0c]" style={{ width: size, height: size, left: ring + 20, top: ring + 20 }}>
        {src && <img src={src} alt="Fundus photo being analysed" className="h-full w-full object-cover" draggable={false} />}
        <ScanCanvas src={src} active={analysing} size={px} />
        {/* partials drawn on the image (normalised coordinates) */}
        <svg viewBox="0 0 1000 1000" className="absolute inset-0 h-full w-full" aria-hidden>
          {items.map((l, i) => {
            const [x, y, w, h] = l.bbox;
            const pad = 0.006;
            const W = (w + pad * 2) * 1000, H = (h + pad * 2) * 1000;
            const per = 2 * (W + H);
            return (
              <motion.rect
                key={l.id}
                x={(x - pad) * 1000} y={(y - pad) * 1000} width={W} height={H} rx={Math.min(W, H) / 2}
                fill="none" stroke={LESION_COLOR[l.type]} strokeWidth={3}
                initial={{ strokeDasharray: per, strokeDashoffset: per, opacity: 0.95 }}
                animate={{ strokeDashoffset: 0, opacity: outcome ? 0.5 : 0.95 }}
                transition={{ duration: 0.6, delay: 0.02 * i, ease: [0.22, 1, 0.36, 1] }}
                style={{ filter: `drop-shadow(0 0 4px ${LESION_COLOR[l.type]})` }}
              />
            );
          })}
          {st.landmarks && (
            <>
              <Crosshair x={st.landmarks.od.x} y={st.landmarks.od.y} label="Disc" r={st.landmarks.disc_diameter * 500 + 10} />
              <Crosshair x={st.landmarks.fovea.x} y={st.landmarks.fovea.y} label="Fovea" r={34} delay={0.15} />
            </>
          )}
        </svg>
      </motion.div>
      {outcome && (
        <motion.div className="absolute inset-0 grid place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          <span className="sr-only">Analysis finished</span>
        </motion.div>
      )}
      {st.error && <div className="absolute inset-0 grid place-items-center"><X className="h-16 w-16 text-urgent" /></div>}
      {st.result && !outcome && <div className="absolute right-[18%] top-[10%]"><Check className="h-8 w-8 rounded-full bg-black/60 p-1" style={{ color: outcomeColor(st.result.triage?.outcome, st.result.triage?.urgency) }} /></div>}
    </motion.div>
  );
}

function Crosshair({ x, y, label, r, delay = 0 }: { x: number; y: number; label: string; r: number; delay?: number }) {
  const X = x * 1000, Y = y * 1000;
  return (
    <motion.g initial={{ opacity: 0, scale: 2.2 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 20, delay }} style={{ originX: `${X}px`, originY: `${Y}px` }}>
      <circle cx={X} cy={Y} r={r} fill="none" stroke="#fff" strokeWidth={2.5} opacity={0.9} />
      {[0, 90, 180, 270].map((a) => {
        const rad = (a * Math.PI) / 180;
        return <line key={a} x1={X + Math.cos(rad) * (r + 6)} y1={Y + Math.sin(rad) * (r + 6)} x2={X + Math.cos(rad) * (r + 22)} y2={Y + Math.sin(rad) * (r + 22)} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />;
      })}
      <text x={X + r + 26} y={Y - r - 8} fill="#fff" fontSize={26} fontWeight={600} style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.6)", strokeWidth: 4 }}>{label}</text>
    </motion.g>
  );
}
