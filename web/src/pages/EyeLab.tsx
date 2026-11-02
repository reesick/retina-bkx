import { AnimatePresence, motion } from "framer-motion";
import { lazy, Suspense, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Grade } from "../api/types";
import { Switch } from "../components/Switch";
import { Skeleton } from "../components/Skeleton";
import { SPRING } from "../components/motion";
import { buildEye, focusError, refractiveError, refractiveLabel, traceFan, trialLens, LE_GRAND_EMMETROPIC_AXIAL } from "../lib/optics";
import { IRIS_COLORS } from "../three/EyeModel";
import { AnatomyScene, CoverageScene, StagesScene, STAGE_TEXT, coverageFields, coverageShare, type CoverageKey } from "../three/LabScenes";

const OpticsView = lazy(() => import("../three/OpticsView"));
const Scenes = { Anatomy: AnatomyScene, Stages: StagesScene, Coverage: CoverageScene };

type Mode = "anatomy" | "optics" | "stages" | "coverage";

export default function EyeLab() {
  const initial = new URLSearchParams(useLocation().search).get("mode") as Mode | null;
  const [mode, setMode] = useState<Mode>(initial && ["anatomy", "optics", "stages", "coverage"].includes(initial) ? initial : "anatomy");
  // anatomy
  const [explode, setExplode] = useState(0);
  const [section, setSection] = useState(13);
  const [iris, setIris] = useState<keyof typeof IRIS_COLORS>("brown");
  // optics
  const [axial, setAxial] = useState(24.2);
  const [acc, setAcc] = useState(0);
  const [vergence, setVergence] = useState(0); // object vergence in D: 0 = infinity, 4 = 25 cm
  const [pupil, setPupil] = useState(4);
  const [corrective, setCorrective] = useState(false);
  // stages / coverage
  const [grade, setGrade] = useState<Grade>(2);
  const [cov, setCov] = useState<CoverageKey>("one");

  const objectDist = vergence <= 0.001 ? Infinity : 1000 / vergence;
  const optics = useMemo(() => {
    const eye = buildEye({ axialLength: axial, accommodation: acc, pupil });
    const rx = refractiveError({ axialLength: axial, accommodation: 0, pupil });
    const corr = trialLens(eye, objectDist);
    const lens = corrective && corr != null ? { x: -12, power: corr } : null;
    const err = focusError(eye, objectDist, lens);
    const fan = traceFan(eye, objectDist, 15, lens);
    return { rx, corr, err, blur: fan.blurDiameter, lensPower: lens?.power ?? null };
  }, [axial, acc, pupil, objectDist, corrective]);

  const covShares = useMemo(() => Object.fromEntries((["one", "two", "four", "uwf"] as CoverageKey[]).map((k) => {
    const f = coverageFields(k);
    return [k, coverageShare(f.dirs, f.half)];
  })) as Record<CoverageKey, number>, []);

  return (
    <div className="fixed inset-0 top-[84px] overflow-hidden">
      <Suspense fallback={<div className="absolute inset-0 grid place-items-center"><Skeleton round className="h-72 w-72" /></div>}>
        <AnimatePresence mode="wait">
          <motion.div key={mode} className="absolute inset-0" initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
            {mode === "optics" ? (
              <OpticsView className="absolute inset-0" axial={axial} accommodation={acc} pupil={pupil} objectDist={objectDist} lensPower={optics.lensPower} />
            ) : mode === "anatomy" ? (
              <Scenes.Anatomy className="absolute inset-0" explode={explode} section={section} irisColor={IRIS_COLORS[iris]} />
            ) : mode === "stages" ? (
              <Scenes.Stages className="absolute inset-0" grade={grade} />
            ) : (
              <Scenes.Coverage className="absolute inset-0" k={cov} />
            )}
          </motion.div>
        </AnimatePresence>
      </Suspense>

      <motion.aside initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={SPRING} className="glass absolute bottom-28 left-6 top-4 z-10 flex w-[360px] flex-col overflow-hidden rounded-[26px]">
        <div className="p-5 pb-3">
          <h1 className="text-title-xl">Eye Lab</h1>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {(["anatomy", "optics", "stages", "coverage"] as Mode[]).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={`relative h-9 rounded-[12px] text-[14px] font-medium capitalize ${mode === m ? "text-black" : "text-white/75 hover:bg-white/5"}`}>
                {mode === m && <motion.span layoutId="labmode" transition={SPRING} className="absolute inset-0 rounded-[12px] bg-white" />}
                <span className="relative">{m === "stages" ? "DR stages" : m}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {mode === "anatomy" && (
            <div className="space-y-5">
              <p className="text-[14px] text-l2">Hover any part to see what it does. Drag to orbit, scroll to zoom.</p>
              <Slider label="Explode" value={explode} min={0} max={1} step={0.01} onChange={setExplode} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Section" value={13 - section} min={0} max={26} step={0.1} onChange={(v) => setSection(13 - v)} fmt={(v) => (v < 0.1 ? "off" : `${v.toFixed(1)} mm`)} />
              <div>
                <div className="mb-2 text-[13px] text-l2">Iris colour</div>
                <div className="flex gap-2">
                  {(Object.keys(IRIS_COLORS) as (keyof typeof IRIS_COLORS)[]).map((c) => (
                    <button key={c} type="button" aria-label={c} aria-pressed={iris === c} onClick={() => setIris(c)} className="h-8 w-8 rounded-full" style={{ background: IRIS_COLORS[c], boxShadow: iris === c ? "0 0 0 2px #000, 0 0 0 4px #fff" : "inset 0 0 0 1px rgba(255,255,255,0.2)" }} />
                  ))}
                </div>
              </div>
              <Caption>Generic procedural eye built from geometry, not a scan. Sizes approximate (axial length 24 mm).</Caption>
            </div>
          )}
          {mode === "optics" && (
            <div className="space-y-4">
              <Slider label="Axial length" value={axial} min={21} max={28} step={0.05} onChange={setAxial} fmt={(v) => `${v.toFixed(2)} mm`} />
              <Slider label="Accommodation" value={acc} min={0} max={8} step={0.1} onChange={setAcc} fmt={(v) => `${v.toFixed(1)} D`} />
              <Slider label="Object distance" value={vergence} min={0} max={4} step={0.05} onChange={setVergence} fmt={(v) => (v < 0.001 ? "∞" : `${(100 / v).toFixed(0)} cm`)} />
              <Slider label="Pupil" value={pupil} min={2} max={8} step={0.1} onChange={setPupil} fmt={(v) => `${v.toFixed(1)} mm`} />
              <div className="grid grid-cols-2 gap-2">
                <Readout label="Refraction" value={refractiveLabel(optics.rx)} />
                <Readout label="Focus vs retina" value={!Number.isFinite(optics.err) ? "–" : Math.abs(optics.err) < 0.02 ? "on the retina" : `${Math.abs(optics.err).toFixed(2)} mm ${optics.err < 0 ? "in front" : "behind"}`} tone={Math.abs(optics.err) < 0.05 ? "#30D158" : "#FFD60A"} />
              </div>
              <BlurInset blurMm={optics.blur} />
              <div className="flex items-center justify-between rounded-[14px] bg-white/[0.05] px-3 py-2.5">
                <div>
                  <div className="text-[14px] font-medium">Corrective lens</div>
                  <div className="num text-[12px] text-l2">{optics.corr == null ? "out of ±10 D" : `${optics.corr > 0 ? "+" : ""}${optics.corr.toFixed(2)} D at 12 mm`}</div>
                </div>
                <Switch label="Corrective lens" checked={corrective} onChange={setCorrective} />
              </div>
              <Caption>Le Grand full theoretical eye, meridional rays, vector Snell's law. Default axial length 24.2 mm is emmetropic (paraxial focus {LE_GRAND_EMMETROPIC_AXIAL.toFixed(2)} mm). Accommodation interpolates lens radii and thickness; schematic, not this patient.</Caption>
            </div>
          )}
          {mode === "stages" && (
            <div className="space-y-4">
              <div className="rounded-full bg-review/15 px-3 py-1.5 text-center text-[12px] font-semibold uppercase tracking-[0.2em] text-review">Illustration</div>
              <Slider label="Grade" value={grade} min={0} max={4} step={1} onChange={(v) => setGrade(Math.round(v) as Grade)} fmt={(v) => String(Math.round(v))} />
              <AnimatePresence mode="wait">
                <motion.div key={grade} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                  <div className="text-headline">{STAGE_TEXT[grade].title}</div>
                  <p className="mt-1 text-[14px] text-l2">{STAGE_TEXT[grade].body}</p>
                </motion.div>
              </AnimatePresence>
              <Caption>Procedurally placed example lesions on a generic retina, viewed from inside. Not patient data; not a grading reference.</Caption>
            </div>
          )}
          {mode === "coverage" && (
            <div className="space-y-3">
              <p className="text-[14px] text-l2">Blue caps show what each protocol photographs. Grey is never imaged.</p>
              {(["one", "two", "four", "uwf"] as CoverageKey[]).map((k) => (
                <button key={k} type="button" onClick={() => setCov(k)} aria-pressed={cov === k} className={`flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-left transition-colors ${cov === k ? "bg-white text-black" : "bg-white/[0.05] hover:bg-white/10"}`}>
                  <span className="text-[14px] font-medium">{coverageFields(k).label}</span>
                  <span className="num text-[14px] font-semibold">{(covShares[k] * 100).toFixed(0)}%</span>
                </button>
              ))}
              <Caption>Share of the modelled retina inside each field, computed on this generic eye (field angles treated as subtended at the eye centre, retina to 140° from the posterior pole). Single-field screening sees only the posterior pole; peripheral lesions fall in the grey.</Caption>
            </div>
          )}
        </div>
      </motion.aside>
      <div className="pointer-events-none absolute inset-x-0 bottom-[92px] text-center text-footnote text-l3">Research prototype · triage aid, not a diagnosis · runs offline · approximate generic eye</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <div className="flex items-baseline justify-between"><span className="text-[13px] text-l2">{label}</span><span className="num text-[14px] font-semibold">{fmt(value)}</span></div>
      <input type="range" className="slider w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ["--fill" as string]: `${fill}%` }} aria-label={label} />
    </label>
  );
}

function Readout({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[14px] bg-white/[0.05] p-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-l3">{label}</div>
      <div className="mt-1 text-[15px] font-semibold" style={{ color: tone }}>{value}</div>
    </div>
  );
}

function BlurInset({ blurMm }: { blurMm: number }) {
  const um = blurMm * 1000;
  const px = Math.min(14, blurMm * 60);
  return (
    <div className="flex items-center gap-3 rounded-[14px] bg-white/[0.05] p-3">
      <div className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-[#2a0a06]" aria-label="Blur on the retina">
        <span className="font-bold text-white" style={{ fontSize: 34, filter: `blur(${px}px)` }}>E</span>
        <span className="absolute rounded-full border border-review/70" style={{ width: Math.max(4, Math.min(76, um / 6)), height: Math.max(4, Math.min(76, um / 6)) }} />
      </div>
      <div>
        <div className="text-[14px] font-medium">Blur circle</div>
        <div className="num text-[13px] text-l2">{um < 1 ? "< 1 µm" : `${um.toFixed(0)} µm`} on the retina</div>
        <div className="text-[11px] text-l3">Geometric spread of the traced rays</div>
      </div>
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-snug text-l3">{children}</p>;
}
