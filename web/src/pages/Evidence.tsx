import { motion } from "framer-motion";
import { memo, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BarChart3 } from "lucide-react";
import { assetUrl } from "../api/client";
import { useDemoCases } from "../api/hooks";
import { useStartDemo } from "../components/DemoButton";
import { EmptyState } from "../components/EmptyState";
import { useMetrics } from "../api/hooks";
import type { GradeMetrics, MetricsAvailable, Reliability } from "../api/types";
import { Award, Check, FileText, Lock } from "../components/icons";
import { Odometer } from "../components/Odometer";
import { Page } from "../components/Page";
import { Ring } from "../components/Ring";
import { Segmented } from "../components/Segmented";
import { ErrorState, Skeleton } from "../components/Skeleton";
import { LargeTitle } from "../components/TopBar";
import { fx, LESION_COLOR, LESION_NAME, LESION_TYPES, pct, shortTime } from "../lib/format";
import { useSession } from "../lib/session";
import { IS_MOCK } from "../api/client";
import { Big, Card, Empty, Lazy } from "./evidence/kit";
import { AppDecides, ByQuality, Encounters, ExplanationExtras, explanationBasics, FailureGallery, GateAblation, Leakage, MacularDme, QuantCard, SiteCal } from "./evidence/AppSections";

const DATASETS = [
  { value: "idrid", label: "IDRiD · external" },
  { value: "ddr", label: "DDR · held-out" },
  { value: "deepdrid_val", label: "DeepDRiD · held-out" },
  { value: "aptos_test", label: "APTOS · held-out" },
] as const;
const MODELS = [
  { value: "cnn_effb3", label: "CNN" },
  { value: "vit_dinov2", label: "ViT" },
  { value: "ensemble", label: "Ensemble" },
] as const;
type DS = (typeof DATASETS)[number]["value"];
type MD = (typeof MODELS)[number]["value"];

export default function Evidence() {
  const q = useMetrics();
  return (
    <Page>
      <LargeTitle sub="How well the models did on public test datasets they were not trained on (IDRiD) or held out from training. Every number comes from the evaluation script.">Evidence</LargeTitle>
      {q.isLoading && <EvidenceSkeleton />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.available && (
        <div className="space-y-6">
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" />}
            title="Evaluation not run yet"
            body={<>The report card appears after the evaluation script has scored the models on public test sets. Run <code className="rounded bg-s2 px-1.5 py-0.5 text-[13px] text-white">python -m ml.eval.evaluate</code> on this device. No placeholder numbers are shown. Meanwhile you can see the AI work on real example images below.</>}
          />
          <RealExamples />
          <Glossary />
        </div>
      )}
      {q.data && q.data.available && <Report m={q.data} />}
    </Page>
  );
}

function EvidenceSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[360px] !rounded-card" />
      <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-72 !rounded-card" /><Skeleton className="h-72 !rounded-card" /></div>
    </div>
  );
}

const ci = (c?: [number, number] | null) => (c ? ` (${fx(c[0])}–${fx(c[1])})` : "");
const p0 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "–" : `${Math.round(x * 100)}%`);

/** Plain-language one-liners computed from the data. */
function rocTakeaway(g: GradeMetrics): string {
  return `At the operating point the AI catches ${p0(g.sens)} of referable eyes and clears ${p0(g.spec)} of healthy ones${g.auroc != null ? ` (AUROC ${g.auroc.toFixed(2)}; 0.5 is a coin flip, 1.0 is perfect)` : ""}.`;
}
function reliabilityTakeaway(g: GradeMetrics): string | null {
  const { after } = relOf(g);
  if (!after) return null;
  let best = -1, bd = 9;
  after.bins.forEach((b, i) => { if (after.count[i] > 0 && Math.abs(b - 0.7) < bd) { bd = Math.abs(b - 0.7); best = i; } });
  const ece = g.ece_after;
  const bin = best >= 0 ? ` When it says about ${Math.round(after.bins[best] * 100)}%, ${Math.round(after.acc[best] * 100)}% of those eyes were actually referable.` : "";
  return `${ece != null ? `On average the stated probability is off by ${(ece * 100).toFixed(1)} percentage points.` : ""}${bin}`.trim() || null;
}
function riskAt(rc: { coverage: number[]; risk: number[] }, c: number): number | null {
  const xs = rc.coverage, ys = rc.risk;
  if (!xs.length) return null;
  if (c <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (c <= xs[i]) { const t = (c - xs[i - 1]) / (xs[i] - xs[i - 1] || 1); return ys[i - 1] + t * (ys[i] - ys[i - 1]); }
  return ys[ys.length - 1];
}
function riskTakeaway(rc: { coverage: number[]; risk: number[] }, op: number): string {
  const r = riskAt(rc, op);
  const all = rc.risk[rc.risk.length - 1];
  return `Deciding only the ${p0(op)} of cases it is surest about, the AI is wrong on about ${r == null ? "–" : (r * 100).toFixed(1) + "%"} of them; deciding everything it would be wrong on ${all == null ? "–" : (all * 100).toFixed(1) + "%"}. The rest go to a person.`;
}
function confusionTakeaway(cm: number[][]): string {
  let tot = 0, exact = 0, near = 0;
  cm.forEach((row, i) => row.forEach((v, j) => { tot += v; if (i === j) exact += v; if (Math.abs(i - j) <= 1) near += v; }));
  return tot ? `The AI gives the exact grade for ${p0(exact / tot)} of images and is within one grade for ${p0(near / tot)} (n = ${tot}).` : "No images in this table.";
}
function recallTakeaway(r: number[]): string {
  if (!r.length) return "";
  let lo = 0;
  r.forEach((v, i) => { if (v < r[lo]) lo = i; });
  return `Hardest grade to recognise: grade ${lo}, found ${p0(r[lo])} of the time. Grades 2 to 4 (referable) are found ${r.length >= 5 ? `${p0(r[2])}, ${p0(r[3])} and ${p0(r[4])}` : "–"} of the time.`;
}

function Report({ m }: { m: MetricsAvailable }) {
  const available = DATASETS.filter((d) => m.datasets[d.value]);
  const [ds, setDs] = useState<DS>((available.find((d) => d.value === "idrid") ?? available[0])?.value ?? "aptos_test");
  const [md, setMd] = useState<MD>("ensemble");
  const g: GradeMetrics | undefined = m.models[md]?.[ds];
  const info = m.datasets[ds];
  const tri = m.triage[ds];
  const replayOk = useSession((s) => s.determinismVerified);

  const badges = useMemo(() => {
    const anyCal = Object.values(m.models).some((mm) => Object.values(mm).some((x) => x.ece_after != null && x.ece_before != null && x.ece_after < x.ece_before));
    const external = ["idrid", "ddr"].some((k) => m.datasets[k]);
    const expl = !!m.explanations && Object.keys(m.explanations).length > 0;
    const det = m.determinism?.verified === true || replayOk;
    return [
      { on: anyCal, label: "Calibrated", sub: "ECE ↓ after temperature scaling" },
      { on: external, label: "External test run", sub: "IDRiD never trained on or fitted" },
      { on: expl, label: "Explanations tested", sub: "pointing game, deletion, randomisation" },
      { on: det, label: "Determinism verified", sub: m.determinism?.verified ? "recorded by ml/eval" : replayOk ? "replay matched in this session" : "run a Replay on a case" },
    ];
  }, [m, replayOk]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Segmented ariaLabel="Dataset" value={ds} onChange={setDs} options={DATASETS.map((d) => ({ value: d.value, label: d.label, disabled: !m.datasets[d.value] }))} />
        <Segmented ariaLabel="Model" value={md} onChange={setMd} options={MODELS.map((x) => ({ ...x }))} />
      </div>

      {/* hero */}
      <section className="card flex flex-col items-center px-6 py-10 text-center">
        {g?.auroc != null ? (
          <>
            <Ring value={g.auroc} size={260} stroke={14} color="#fff" stiffness={40}>
              <div className="text-[68px] font-semibold leading-none tracking-[-0.04em]"><Odometer value={g.auroc} format={(v) => v.toFixed(3)} /></div>
              <div className="mt-2 text-eyebrow uppercase text-l2">AUROC</div>
            </Ring>
            <div className="mt-6 text-headline">{MODELS.find((x) => x.value === md)?.label} · referable DR (grade ≥ 2)</div>
            <div className="mt-1 text-body text-l2">{info?.source} · n = {info?.n ?? g.n}{g.auroc_ci ? ` · 95% CI ${fx(g.auroc_ci[0], 3)}–${fx(g.auroc_ci[1], 3)}` : ""}</div>
            <div className="num mt-3 text-[15px]">sensitivity {fx(g.sens)}{ci(g.sens_ci)} · specificity {fx(g.spec)}{ci(g.spec_ci)}</div>
            <p className="mt-4 max-w-xl text-[14px] leading-snug text-white/80">In plain words: on {info?.n ?? g.n ?? "these"} images from {info?.source?.split(",")[0] ?? "this dataset"}, the AI catches {p0(g.sens)} of eyes that need a specialist and correctly clears {p0(g.spec)} of eyes that do not. Use the switches above to see other test sets and models.</p>
          </>
        ) : (
          <div className="py-10 text-l2">No grading metrics for this dataset and model.</div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {badges.map((b) => (
          <motion.div key={b.label} whileHover={b.on ? { scale: 1.03 } : undefined} className="card flex items-center gap-3 p-4" title={b.sub}>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full" style={b.on ? { background: "radial-gradient(circle at 35% 30%, #FFE76A, #FFD60A 45%, #C9A400)", boxShadow: "0 0 24px rgba(255,214,10,0.45)" } : { boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.18)" }}>
              {b.on ? <Award className="h-5 w-5 text-black" /> : <Lock className="h-4 w-4 text-l3" />}
            </span>
            <div className="min-w-0"><div className={`text-[14px] font-semibold ${b.on ? "" : "text-l2"}`}>{b.label}{!b.on && <span className="font-normal"> (not yet)</span>}</div><div className="text-[12px] leading-snug text-l2">{b.sub}</div></div>
          </motion.div>
        ))}
      </section>

      {g && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="ROC curve" caption={`${info?.source ?? ds}. Dot = operating point fixed on validation data.`}
            how="Each point is one possible threshold. Up means more referable eyes caught; left means fewer healthy eyes wrongly flagged. The closer the curve hugs the top-left corner, the better; the dashed diagonal is guessing."
            takeaway={rocTakeaway(g)}>
            {g.roc ? <Roc roc={g.roc} sens={g.sens} spec={g.spec} /> : <Empty />}
          </Card>
          <Card title="Reliability" caption={`Calibration of P(referable). ECE before ${fx(g.ece_before, 3)} → after ${fx(g.ece_after, 3)}.`}
            how="Images are grouped by the probability the AI gave. Each bar shows how many in that group really were referable. Bars on the dashed diagonal mean the AI's percentages can be taken at face value."
            takeaway={reliabilityTakeaway(g)}>
            <ReliabilityChart g={g} />
          </Card>
          <Card title="Risk–coverage" caption="What happens when the AI decides only the cases it is most certain about."
            how="Moving right, the AI decides more cases by itself (fewer go to a person). The curve shows the share of those AI decisions that are wrong. The orange line is where the triage policy actually sits."
            takeaway={tri?.risk_coverage ? riskTakeaway(tri.risk_coverage, tri.coverage) : null}>
            {tri?.risk_coverage ? <RiskCoverage rc={tri.risk_coverage} op={tri.coverage} /> : <Empty />}
          </Card>
          <Card title="Confusion" caption="Rows = true grade (dataset label), columns = grade the AI predicted."
            how="Each cell counts images. The outlined diagonal is where the AI agreed with the label; brighter cells hold a bigger share of their row. Cells far from the diagonal are big mistakes."
            takeaway={g.confusion ? confusionTakeaway(g.confusion) : null}>
            {g.confusion ? <Confusion cm={g.confusion} /> : <Empty />}
          </Card>
          <Card title="Per-grade recall" caption={`QWK ${fx(g.qwk, 3)} · Brier ${fx(g.brier, 3)} · PPV ${fx(g.ppv)} · NPV ${fx(g.npv)} (PPV/NPV depend on prevalence ${pct(g.prevalence)})`}
            how="For each true grade (0 = no retinopathy to 4 = proliferative), the share of images the AI put in exactly that grade. Bright bars are the referable grades."
            takeaway={g.per_grade_recall ? recallTakeaway(g.per_grade_recall) : null}>
            {g.per_grade_recall ? <Recall r={g.per_grade_recall} /> : <Empty />}
          </Card>
          <Card title="Triage policy" caption="Share of images the policy decided automatically and how they were routed."
            how="Coverage is the share the AI settled without a person. Auto sensitivity and specificity are measured only on those settled cases. Everything else went to human review or retake."
            takeaway={tri ? `The policy settled ${p0(tri.coverage)} of images by itself and sent ${p0(tri.human_review_rate)} to a person; on the settled ones it caught ${p0(tri.auto_sens)} of referable eyes.` : null}>
            {tri ? (
              <div className="grid grid-cols-3 gap-3">
                <Big label="Coverage" v={pct(tri.coverage)} />
                <Big label="Auto sensitivity" v={fx(tri.auto_sens)} />
                <Big label="Auto specificity" v={fx(tri.auto_spec)} />
                <Big label="Refer" v={pct(tri.referral_rate)} color="#FF9F0A" />
                <Big label="Human review" v={pct(tri.human_review_rate)} color="#FFD60A" />
                <Big label="Retake" v={pct(tri.retake_rate)} color="#64D2FF" />
              </div>
            ) : <Empty />}
          </Card>
        </div>
      )}

      <AppEvalSections m={m} ds={ds} />

      <RealExamples />

      <Card title="Internal vs external" caption="The drop on external data is shown, not hidden. Same model, same thresholds."
        how="Columns are test sets. Small grey numbers are the change against APTOS (the internal test set); red means worse on data from other hospitals and cameras.">
        <Compare m={m} md={md} />
      </Card>

      <div className="grid gap-4 md:grid-flow-row-dense md:grid-cols-2">
        <Card title="Quality gate" caption="Against real quality labels (DeepDRiD) and DDR's ungradable images.">
          <KV obj={m.quality} />
        </Card>
        <Card title="Lesion candidates" caption="Pixel-level Dice per type on held-out segmentation sets.">
          {m.lesions ? Object.entries(m.lesions).map(([k, v]) => (
            <div key={k} className="mb-4 last:mb-0">
              <div className="mb-2 text-eyebrow uppercase text-l2">{k.replace(/_/g, " ")}</div>
              <div className="space-y-2">
                {LESION_TYPES.map((t) => {
                  const d = v.dice?.[t];
                  return (
                    <div key={t} className="flex items-center gap-3 text-[13px]">
                      <span className="w-28 text-l2">{LESION_NAME[t]}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><motion.div className="h-full rounded-full" style={{ background: LESION_COLOR[t] }} initial={{ width: 0 }} whileInView={{ width: `${(d ?? 0) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.8 }} /></div>
                      <span className="num w-10 text-right">{fx(d)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )) : <Empty />}
        </Card>
        <Card title="Landmarks" caption="Distance error in disc diameters (DD).">
          <KV obj={m.landmarks} />
        </Card>
        <Card className="md:col-span-2" title="Explanation tests" caption="Do attention maps point at lesions, and do they depend on the trained weights?">
          <div className="grid gap-6 md:grid-cols-2">
            <KV obj={explanationBasics(m.explanations)} />
            <ExplanationExtras e={m.explanations} />
          </div>
        </Card>
        <Card title="Latency" caption="Per image, all models, on this kind of CPU.">
          {m.latency_ms ? (
            <div className="grid grid-cols-2 gap-3">
              <Big label="p50" v={m.latency_ms.p50 != null ? `${m.latency_ms.p50} ms` : "–"} />
              <Big label="p95" v={m.latency_ms.p95 != null ? `${m.latency_ms.p95} ms` : "–"} />
              <div className="col-span-2 text-[12px] text-l3">{m.latency_ms.cpu}</div>
            </div>
          ) : <Empty />}
        </Card>
        <Card title="Notes" caption={`Generated ${shortTime(m.generated_at)} · policy ${m.policy_version}${m.git ? ` · ${m.git}` : ""}`}>
          <ul className="space-y-2">
            {m.notes.map((n, i) => <li key={i} className="flex gap-2 text-[14px] text-white/85"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-l3" />{n}</li>)}
          </ul>
          {IS_MOCK && <div className="mt-3 rounded-full bg-review/15 px-3 py-1.5 text-[12px] text-review">Mock mode: these are invented numbers for UI development.</div>}
        </Card>
      </div>

      <Glossary />
    </div>
  );
}

/** App-level evaluation sections; each renders only when its metrics key exists. Below the fold: lazy. */
const AppEvalSections = memo(function AppEvalSections({ m, ds }: { m: MetricsAvailable; ds: string }) {
  const ev = m.app_eval;
  return (
    <>
      {ev?.sets && <Lazy minHeight={420}><AppDecides ev={ev} /></Lazy>}
      {ev?.quality_bands && <Lazy minHeight={300}><ByQuality ev={ev} preferred={ds} /></Lazy>}
      {ev?.quality_gate_ablation && (
        <div className={`grid gap-4 ${ev.macular_risk_vs_dme ? "lg:grid-cols-2" : ""}`}>
          {ev?.quality_gate_ablation && <Lazy minHeight={360}><GateAblation ab={ev.quality_gate_ablation} /></Lazy>}
          {ev?.macular_risk_vs_dme && <Lazy minHeight={360}><MacularDme m={ev.macular_risk_vs_dme} /></Lazy>}
        </div>
      )}
      {ev?.deepdrid_encounters && <Lazy minHeight={420}><Encounters enc={ev.deepdrid_encounters} /></Lazy>}
      {!ev?.quality_gate_ablation && ev?.macular_risk_vs_dme && <Lazy minHeight={300}><MacularDme m={ev.macular_risk_vs_dme} /></Lazy>}
      {(m.site_calibration || m.leakage_check) && (
        <div className={`grid gap-4 ${m.site_calibration && m.leakage_check ? "lg:grid-cols-2" : ""}`}>
          {m.site_calibration && <Lazy minHeight={380}><SiteCal sc={m.site_calibration} /></Lazy>}
          {m.leakage_check && <Lazy minHeight={300}><Leakage lc={m.leakage_check} /></Lazy>}
        </div>
      )}
      {m.quantization && <Lazy minHeight={320}><QuantCard q={m.quantization} /></Lazy>}
      <Lazy minHeight={360}><FailureGallery /></Lazy>
    </>
  );
});

function KV({ obj }: { obj: unknown }) {
  if (!obj || typeof obj !== "object" || !Object.keys(obj).length) return <Empty />;
  const fmt = (k: string, v: unknown): string => {
    if (typeof v === "number") return /rate|within|acc|auroc|game|share/i.test(k) && v <= 1 ? (v * 100).toFixed(1) + "%" : Number.isInteger(v) ? String(v) : v.toFixed(3);
    if (v == null) return "–";
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([a, b]) => `${a} ${typeof b === "number" ? (Number.isInteger(b) ? b : b.toFixed(2)) : String(b)}`).join(" · ");
    return String(v);
  };
  return (
    <div className="space-y-4">
      {Object.entries(obj as Record<string, unknown>).map(([group, val]) => (
        <div key={group}>
          <div className="mb-1.5 text-eyebrow uppercase text-l2">{group.replace(/_/g, " ")}</div>
          {val && typeof val === "object" ? (
            <dl className="space-y-1">
              {Object.entries(val as Record<string, unknown>).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-[13px]"><dt className="text-l2">{k.replace(/_/g, " ")}</dt><dd className="num text-right">{fmt(k, v)}</dd></div>
              ))}
            </dl>
          ) : <div className="num text-[13px]">{fmt(group, val)}</div>}
        </div>
      ))}
    </div>
  );
}

const W = 340, H = 260, P = 46, PB = 50;
const sx = (x: number) => P + x * (W - P - 10);
const sy = (y: number) => H - PB - y * (H - PB - 10);
const TICK = "rgba(255,255,255,0.6)";
const AXIS = "rgba(255,255,255,0.8)";

function Axes({ xl, yl, yTicks = [0, 0.5, 1], yFmt = (t: number) => String(t) }: { xl: string; yl: string; yTicks?: number[]; yFmt?: (t: number) => string }) {
  return (
    <g>
      <line x1={P} y1={H - PB} x2={W - 10} y2={H - PB} stroke="#48484A" />
      <line x1={P} y1={10} x2={P} y2={H - PB} stroke="#48484A" />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={`x${t}`}>
          <line x1={sx(t)} x2={sx(t)} y1={H - PB} y2={H - PB + 4} stroke="#48484A" />
          <text x={sx(t)} y={H - PB + 16} fill={TICK} fontSize={10} textAnchor="middle">{t}</text>
        </g>
      ))}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={P - 4} x2={P} y1={sy(t)} y2={sy(t)} stroke="#48484A" />
          <line x1={P} x2={W - 10} y1={sy(t)} y2={sy(t)} stroke="rgba(255,255,255,0.05)" />
          <text x={P - 7} y={sy(t) + 3.5} fill={TICK} fontSize={10} textAnchor="end">{yFmt(t)}</text>
        </g>
      ))}
      <text x={(W + P) / 2} y={H - 12} fill={AXIS} fontSize={11} fontWeight={500} textAnchor="middle">{xl}</text>
      <text x={12} y={(H - PB) / 2} fill={AXIS} fontSize={11} fontWeight={500} textAnchor="middle" transform={`rotate(-90 12 ${(H - PB) / 2})`}>{yl}</text>
    </g>
  );
}

function Legend({ items }: { items: { swatch: ReactNode; label: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-l2">
      {items.map((it) => <span key={it.label} className="flex items-center gap-1.5">{it.swatch}{it.label}</span>)}
    </div>
  );
}
const LineSw = ({ color = "#fff", dashed }: { color?: string; dashed?: boolean }) => (
  <svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth={dashed ? 1.2 : 2.2} strokeDasharray={dashed ? "3 3" : undefined} /></svg>
);
const DotSw = ({ color }: { color: string }) => <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />;

const Roc = memo(function Roc({ roc, sens, spec }: { roc: { fpr: number[]; tpr: number[] }; sens: number; spec: number }) {
  const d = useMemo(() => roc.fpr.map((f, i) => `${i ? "L" : "M"}${sx(f).toFixed(1)},${sy(roc.tpr[i]).toFixed(1)}`).join(" "), [roc]);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`ROC curve. Operating point: sensitivity ${fx(sens)}, specificity ${fx(spec)}.`}>
        <Axes xl="False-positive rate (1 − specificity)" yl="Sensitivity" />
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 4" />
        <path d={`${d} L${sx(1)},${sy(0)} Z`} fill="rgba(255,255,255,0.05)" />
        <motion.path d={d} fill="none" stroke="#fff" strokeWidth={2.2} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }} />
        <circle cx={sx(1 - spec)} cy={sy(sens)} r={5.5} fill="#FF9F0A" stroke="#000" strokeWidth={1.5} />
        <text x={sx(1 - spec) + 9} y={sy(sens) + 14} fill="#FF9F0A" fontSize={10.5} fontWeight={600}>sens {fx(sens)} · spec {fx(spec)}</text>
      </svg>
      <Legend items={[{ swatch: <LineSw />, label: "model" }, { swatch: <LineSw dashed color="rgba(255,255,255,0.5)" />, label: "chance (coin flip)" }, { swatch: <DotSw color="#FF9F0A" />, label: "operating point" }]} />
    </div>
  );
});

function relOf(g: GradeMetrics): { after?: Reliability; before?: Reliability } {
  const r = g.reliability;
  if (r && "bins" in r) return { after: r, before: g.reliability_before };
  return { after: (r as { after?: Reliability } | undefined)?.after ?? g.reliability_after, before: (r as { before?: Reliability } | undefined)?.before ?? g.reliability_before };
}

const ReliabilityChart = memo(function ReliabilityChart({ g }: { g: GradeMetrics }) {
  const { after, before } = relOf(g);
  if (!after) return <Empty />;
  const n = after.bins.length;
  const bw = (W - P - 10) / n;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Reliability diagram: predicted probability against observed referable rate">
        <Axes xl="Predicted P(referable)" yl="Observed referable rate" />
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="rgba(255,255,255,0.45)" strokeDasharray="3 4" />
        {before?.acc.map((a, i) => (
          <rect key={`b${i}`} x={sx(before.bins[i]) - bw / 2 + 1} width={bw - 2} y={sy(a)} height={sy(0) - sy(a)} fill="none" stroke="rgba(255,159,10,0.75)" strokeWidth={1} rx={2} />
        ))}
        {after.acc.map((a, i) => (
          <rect key={i} x={sx(after.bins[i]) - bw / 2 + 2} width={bw - 4} rx={3} y={sy(a)} height={sy(0) - sy(a)} fill={after.count[i] > 0 ? "rgba(255,255,255,0.85)" : "transparent"}>
            <title>{`Predicted ≈ ${(after.bins[i] * 100).toFixed(0)}%: ${(a * 100).toFixed(0)}% referable (${after.count[i]} images)`}</title>
          </rect>
        ))}
      </svg>
      <Legend items={[
        { swatch: <span className="h-2.5 w-2.5 rounded-sm bg-white/85" />, label: "after calibration" },
        ...(before ? [{ swatch: <span className="h-2.5 w-2.5 rounded-sm border border-refer/80" />, label: "before calibration" }] : []),
        { swatch: <LineSw dashed color="rgba(255,255,255,0.6)" />, label: "perfect calibration" },
      ]} />
      {!before && <div className="mt-1 text-[12px] text-l2">The uncalibrated diagram was not exported; ECE values are in the caption.</div>}
    </div>
  );
});

const RiskCoverage = memo(function RiskCoverage({ rc, op }: { rc: { coverage: number[]; risk: number[] }; op: number }) {
  const maxR = Math.max(0.05, ...rc.risk) * 1.1;
  const d = rc.coverage.map((c, i) => `${i ? "L" : "M"}${sx(c).toFixed(1)},${sy(rc.risk[i] / maxR).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Risk coverage curve: share of cases decided by the AI against error rate">
        <Axes xl="Share of cases decided by the AI" yl="Error rate of those decisions" yFmt={(t) => `${Math.round(t * maxR * 100)}%`} />
        <motion.path d={d} fill="none" stroke="#fff" strokeWidth={2.2} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.0 }} />
        <line x1={sx(op)} x2={sx(op)} y1={10} y2={H - PB} stroke="#FF9F0A" strokeDasharray="4 3" />
        <text x={sx(op) + 5} y={22} fill="#FF9F0A" fontSize={10.5} fontWeight={600}>policy {pct(op)}</text>
      </svg>
      <Legend items={[{ swatch: <LineSw />, label: "error rate" }, { swatch: <LineSw dashed color="#FF9F0A" />, label: "where the triage policy sits" }]} />
    </div>
  );
});

const Confusion = memo(function Confusion({ cm }: { cm: number[][] }) {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-1 text-[12px] font-medium text-white/80">Predicted grade →</div>
      <div className="flex items-stretch gap-2" style={{ width: "min(100%, 360px)" }}>
        <div className="flex items-center"><span className="text-[12px] font-medium text-white/80 [writing-mode:vertical-rl] rotate-180">True grade →</span></div>
        <div className="grid flex-1 grid-cols-[22px_repeat(5,minmax(0,1fr))] gap-1.5">
          <div />
          {[0, 1, 2, 3, 4].map((j) => <div key={j} className="text-center text-[12px] text-l2">{j}</div>)}
          {cm.map((row, i) => {
            const tot = row.reduce((a, b) => a + b, 0) || 1;
            return [
              <div key={`r${i}`} className="grid place-items-center text-[12px] text-l2">{i}</div>,
              ...row.map((v, j) => {
                const s = v / tot;
                return (
                  <div key={`${i}-${j}`} title={`True ${i} → predicted ${j}: ${v} images (${(s * 100).toFixed(0)}% of grade ${i})`}
                    className="num grid aspect-square place-items-center rounded-[6px] text-[11px]"
                    style={{ background: `rgba(255,255,255,${0.06 + s * 0.94})`, color: s > 0.45 ? "#000" : "rgba(255,255,255,0.85)", boxShadow: i === j ? "inset 0 0 0 1.5px rgba(255,214,10,0.9)" : "none" }}>
                    {v}
                  </div>
                );
              }),
            ];
          })}
        </div>
      </div>
      <Legend items={[{ swatch: <span className="h-2.5 w-2.5 rounded-sm" style={{ boxShadow: "inset 0 0 0 1.5px rgba(255,214,10,0.9)" }} />, label: "AI agrees with the label" }, { swatch: <span className="h-2.5 w-5 rounded-sm" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.06), #fff)" }} />, label: "share of the row" }]} />
    </div>
  );
});

const Recall = memo(function Recall({ r }: { r: number[] }) {
  return (
    <div>
      <div className="flex h-40 items-end justify-around gap-3">
        {r.map((v, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
            <div className="num text-[12px] text-white/85">{p0(v)}</div>
            <div className="relative w-5 flex-1 rounded-full bg-white/[0.06]">
              <motion.div className="absolute bottom-0 w-full rounded-full" style={{ background: i >= 2 ? "#fff" : "rgba(255,255,255,0.45)" }} initial={{ height: 0 }} whileInView={{ height: `${v * 100}%` }} viewport={{ once: true }} transition={{ delay: i * 0.05, type: "spring", stiffness: 120, damping: 18 }} />
            </div>
            <div className="text-[12px] font-semibold">{i}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 text-center text-[12px] font-medium text-white/80">True grade (bar = share recognised correctly)</div>
      <Legend items={[{ swatch: <span className="h-2.5 w-2.5 rounded-full bg-white" />, label: "referable grades (2–4)" }, { swatch: <span className="h-2.5 w-2.5 rounded-full bg-white/45" />, label: "not referable (0–1)" }]} />
    </div>
  );
});

function RealExamples() {
  const demos = useDemoCases();
  const start = useStartDemo("case");
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-title">See it on real images</h3>
          <p className="mt-0.5 max-w-2xl text-footnote text-l2">Numbers are averages. These public-dataset photos show what the AI actually does on single cases, including when it hands a case to a person. Opening one runs a fresh analysis on this device.</p>
        </div>
        <Link to="/queue" className="link text-[14px]">Already analysed cases are in the Queue <ArrowRight className="inline h-3.5 w-3.5" /></Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {demos.isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[150px] !rounded-[18px]" />)}
        {demos.isError && <div className="text-l2">Example cases are unavailable.</div>}
        {demos.data?.length === 0 && <div className="text-l2">No example cases are bundled with this install.</div>}
        {demos.data?.map((d) => (
          <div key={d.name} className="flex flex-col rounded-[18px] bg-s2/60 p-3">
            <div className="flex items-start gap-3">
              <img src={assetUrl(d.thumb)} alt={`${d.title}: fundus photo`} className="h-16 w-16 shrink-0 rounded-full object-cover" />
              <div className="min-w-0">
                <div className="text-[15px] font-semibold leading-snug">{d.title}</div>
                <div className="mt-0.5 text-[12px] leading-snug text-l2">Expected: {d.description}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[11px] text-l2">{d.source} · {d.license}</span>
              <button type="button" className="btn-ghost h-9 px-3 text-[13px]" disabled={start.isPending} title={start.isPending ? "Another case is starting…" : "Run the analysis and open the case"} onClick={() => start.mutate(d.name)}>
                {start.isPending && start.variables === d.name ? "Opening…" : "Open this case"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const GLOSSARY: [string, string][] = [
  ["Sensitivity", "Of the eyes that really need a specialist, the share the AI flags. Missing one is the costly mistake."],
  ["Specificity", "Of the healthy eyes, the share the AI correctly clears. Low specificity means many unnecessary referrals."],
  ["AUROC", "One number for how well the AI ranks sick above healthy eyes across all thresholds. 0.5 is guessing, 1.0 is perfect."],
  ["Calibration", "Whether the AI's percentages mean what they say: of images given 70%, about 70% should really be referable. ECE is the average gap."],
  ["Abstention / human review", "When the AI is unsure, the photo looks unlike its training data, or the two models disagree, it does not decide. A clinician does."],
];

function Glossary() {
  return (
    <section className="card p-5">
      <h3 className="text-title">Words used on this page</h3>
      <dl className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-2">
        {GLOSSARY.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[14px] font-semibold">{k}</dt>
            <dd className="text-[13px] leading-snug text-l2">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Compare({ m, md }: { m: MetricsAvailable; md: MD }) {
  const cols = DATASETS.filter((d) => m.models[md]?.[d.value]);
  const rows: { k: keyof GradeMetrics; label: string; d?: number; higher: boolean }[] = [
    { k: "auroc", label: "AUROC", d: 3, higher: true }, { k: "sens", label: "Sensitivity", higher: true }, { k: "spec", label: "Specificity", higher: true },
    { k: "qwk", label: "QWK", higher: true }, { k: "ece_after", label: "ECE (calibrated)", d: 3, higher: false },
  ];
  const base = m.models[md]?.aptos_test;
  if (!cols.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="num w-full text-[14px]">
        <thead>
          <tr className="text-left text-[12px] text-l2"><th className="py-2 font-medium">Metric</th>{cols.map((c) => <th key={c.value} className="py-2 text-right font-medium">{c.label}<div className="text-[11px] font-normal text-l3">n = {m.datasets[c.value]?.n}</div></th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-t border-sep/60" style={{ borderTopWidth: 0.5 }}>
              <td className="py-2.5 text-l2">{r.label}</td>
              {cols.map((c) => {
                const v = m.models[md][c.value]?.[r.k] as number | null | undefined;
                const b = base?.[r.k] as number | null | undefined;
                const delta = c.value !== "aptos_test" && v != null && b != null ? v - b : null;
                const worse = delta != null && (r.higher ? delta < -0.005 : delta > 0.005);
                return (
                  <td key={c.value} className="py-2.5 text-right">
                    {fx(v, r.d ?? 2)}
                    {delta != null && <span className={`ml-2 text-[12px] ${worse ? "text-urgent" : "text-l3"}`}>{delta > 0 ? "+" : ""}{delta.toFixed(r.d ?? 2)}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-l3"><Check className="h-3.5 w-3.5" /> Δ against APTOS internal; red = worse on external data. Designed for multi-camera compatibility; generalisability under evaluation.</div>
    </div>
  );
}
