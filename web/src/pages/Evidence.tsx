import { motion } from "framer-motion";
import { useMemo, useState, type ReactNode } from "react";
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
      <LargeTitle sub="Public-dataset evaluation. IDRiD is fully external; DDR, DeepDRiD and APTOS test sets are held out from sources seen in training. Every number is read from metrics.json, produced by ml/eval.">Evidence</LargeTitle>
      {q.isLoading && <EvidenceSkeleton />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.available && (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <Ring value={0} size={140} stroke={6} head={false} />
          <h2 className="mt-6 text-title">Evaluation not run yet</h2>
          <p className="mt-2 max-w-md text-body text-l2">No metrics.json on this device. Run <code className="rounded bg-s2 px-1.5 py-0.5 text-[13px] text-white">python -m ml.eval.evaluate</code> to produce the report card. No placeholder numbers are shown.</p>
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

function Card({ title, caption, children, className = "" }: { title: string; caption?: string; children: ReactNode; className?: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.4 }} className={`card p-5 ${className}`}>
      <h3 className="text-title">{title}</h3>
      {caption && <p className="mt-0.5 text-footnote text-l2">{caption}</p>}
      <div className="mt-4">{children}</div>
    </motion.section>
  );
}

const ci = (c?: [number, number] | null) => (c ? ` (${fx(c[0])}–${fx(c[1])})` : "");

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
            <div className="min-w-0"><div className={`text-[14px] font-semibold ${b.on ? "" : "text-l3"}`}>{b.label}</div><div className="truncate text-[12px] text-l3">{b.sub}</div></div>
          </motion.div>
        ))}
      </section>

      {g && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="ROC curve" caption={`${info?.source ?? ds}. Dot = operating point from validation.`}>{g.roc ? <Roc roc={g.roc} sens={g.sens} spec={g.spec} /> : <Empty />}</Card>
          <Card title="Reliability" caption={`P(referable) calibration. ECE before ${fx(g.ece_before, 3)} → after ${fx(g.ece_after, 3)}.`}><ReliabilityChart g={g} /></Card>
          <Card title="Risk–coverage" caption="Error rate when only the most certain cases are automated. Marker = coverage of the triage policy.">{tri?.risk_coverage ? <RiskCoverage rc={tri.risk_coverage} op={tri.coverage} /> : <Empty />}</Card>
          <Card title="Confusion" caption="Rows = reference grade, columns = predicted. Brightness = row share.">{g.confusion ? <Confusion cm={g.confusion} /> : <Empty />}</Card>
          <Card title="Per-grade recall" caption={`QWK ${fx(g.qwk, 3)} · Brier ${fx(g.brier, 3)} · PPV ${fx(g.ppv)} · NPV ${fx(g.npv)} (PPV/NPV depend on prevalence ${pct(g.prevalence)})`}>{g.per_grade_recall ? <Recall r={g.per_grade_recall} /> : <Empty />}</Card>
          <Card title="Triage policy" caption="Share of images the policy decided automatically and how they were routed.">
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

      <Card title="Internal vs external" caption="The drop on external data is shown, not hidden. Same model, same thresholds.">
        <Compare m={m} md={md} />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
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
        <Card title="Explanation tests" caption="Do attention maps point at lesions, and do they depend on the trained weights?">
          <KV obj={m.explanations} />
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
    </div>
  );
}

const Empty = () => <div className="py-6 text-center text-[13px] text-l3">Not measured.</div>;

function Big({ label, v, color }: { label: string; v: string; color?: string }) {
  return (
    <div className="rounded-[16px] bg-s2/60 p-3">
      <div className="num text-[24px] font-semibold leading-none" style={{ color }}>{v}</div>
      <div className="mt-1.5 text-[12px] text-l2">{label}</div>
    </div>
  );
}

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

const W = 320, H = 240, P = 40;
const sx = (x: number) => P + x * (W - P - 8);
const sy = (y: number) => H - P - y * (H - P - 8);

function Axes({ xl, yl }: { xl: string; yl: string }) {
  return (
    <g>
      <line x1={P} y1={H - P} x2={W - 8} y2={H - P} stroke="#38383A" />
      <line x1={P} y1={8} x2={P} y2={H - P} stroke="#38383A" />
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <text x={sx(t)} y={H - P + 14} fill="rgba(255,255,255,0.32)" fontSize={9} textAnchor="middle">{t}</text>
          <text x={P - 6} y={sy(t) + 3} fill="rgba(255,255,255,0.32)" fontSize={9} textAnchor="end">{t}</text>
        </g>
      ))}
      <text x={(W + P) / 2} y={H - 2} fill="rgba(255,255,255,0.5)" fontSize={10} textAnchor="middle">{xl}</text>
      <text x={10} y={(H - P) / 2} fill="rgba(255,255,255,0.5)" fontSize={10} textAnchor="middle" transform={`rotate(-90 10 ${(H - P) / 2})`}>{yl}</text>
    </g>
  );
}

function Roc({ roc, sens, spec }: { roc: { fpr: number[]; tpr: number[] }; sens: number; spec: number }) {
  const d = roc.fpr.map((f, i) => `${i ? "L" : "M"}${sx(f).toFixed(1)},${sy(roc.tpr[i]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="ROC curve">
      <Axes xl="1 − specificity" yl="sensitivity" />
      <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 4" />
      <motion.path d={`${d} L${sx(1)},${sy(0)} Z`} fill="rgba(255,255,255,0.05)" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.8 }} />
      <motion.path d={d} fill="none" stroke="#fff" strokeWidth={2.2} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,0.5))" }} />
      <circle cx={sx(1 - spec)} cy={sy(sens)} r={5} fill="#FF9F0A" style={{ filter: "drop-shadow(0 0 6px #FF9F0A)" }} />
    </svg>
  );
}

function relOf(g: GradeMetrics): { after?: Reliability; before?: Reliability } {
  const r = g.reliability;
  if (r && "bins" in r) return { after: r, before: g.reliability_before };
  return { after: (r as { after?: Reliability } | undefined)?.after ?? g.reliability_after, before: (r as { before?: Reliability } | undefined)?.before ?? g.reliability_before };
}

function ReliabilityChart({ g }: { g: GradeMetrics }) {
  const { after, before } = relOf(g);
  if (!after) return <Empty />;
  const n = after.bins.length;
  const bw = (W - P - 8) / n;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Reliability diagram">
        <Axes xl="predicted P(referable)" yl="observed share referable" />
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="rgba(255,255,255,0.35)" strokeDasharray="3 4" />
        {before?.acc.map((a, i) => (
          <rect key={`b${i}`} x={sx(before.bins[i]) - bw / 2 + 1} width={bw - 2} y={sy(a)} height={sy(0) - sy(a)} fill="none" stroke="rgba(255,159,10,0.6)" strokeWidth={1} rx={2} />
        ))}
        {after.acc.map((a, i) => (
          <motion.rect key={i} x={sx(after.bins[i]) - bw / 2 + 2} width={bw - 4} rx={3} fill={after.count[i] > 0 ? "rgba(255,255,255,0.85)" : "transparent"}
            initial={{ y: sy(0), height: 0 }} whileInView={{ y: sy(a), height: sy(0) - sy(a) }} viewport={{ once: true }} transition={{ delay: i * 0.03, type: "spring", stiffness: 120, damping: 18 }} />
        ))}
      </svg>
      <div className="mt-1 flex gap-4 text-[12px] text-l2">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-white/85" /> after calibration</span>
        {before ? <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-refer/70" /> before</span> : <span className="text-l3">Uncalibrated diagram not exported; ECE values above.</span>}
      </div>
    </div>
  );
}

function RiskCoverage({ rc, op }: { rc: { coverage: number[]; risk: number[] }; op: number }) {
  const maxR = Math.max(0.05, ...rc.risk) * 1.1;
  const d = rc.coverage.map((c, i) => `${i ? "L" : "M"}${sx(c).toFixed(1)},${sy(rc.risk[i] / maxR).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Risk coverage curve">
      <Axes xl="coverage" yl={`error rate (max ${maxR.toFixed(2)})`} />
      <motion.path d={d} fill="none" stroke="#fff" strokeWidth={2.2} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.1 }} />
      <line x1={sx(op)} x2={sx(op)} y1={8} y2={H - P} stroke="#FF9F0A" strokeDasharray="4 3" />
      <text x={sx(op) + 4} y={18} fill="#FF9F0A" fontSize={10}>policy {pct(op)}</text>
    </svg>
  );
}

function Confusion({ cm }: { cm: number[][] }) {
  return (
    <div className="flex flex-col items-center">
      <div className="grid grid-cols-[24px_repeat(5,minmax(0,1fr))] gap-1.5" style={{ width: "min(100%, 340px)" }}>
        <div />
        {[0, 1, 2, 3, 4].map((j) => <div key={j} className="text-center text-[11px] text-l3">{j}</div>)}
        {cm.map((row, i) => {
          const tot = row.reduce((a, b) => a + b, 0) || 1;
          return [
            <div key={`r${i}`} className="grid place-items-center text-[11px] text-l3">{i}</div>,
            ...row.map((v, j) => {
              const s = v / tot;
              return (
                <motion.div key={`${i}-${j}`} title={`ref ${i} → pred ${j}: ${v} (${(s * 100).toFixed(0)}%)`}
                  initial={{ opacity: 0, scale: 0.6 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: (i * 5 + j) * 0.015 }}
                  className="num grid aspect-square place-items-center rounded-[6px] text-[10px]"
                  style={{ background: `rgba(255,255,255,${0.05 + s * 0.95})`, color: s > 0.5 ? "#000" : "rgba(255,255,255,0.6)", boxShadow: i === j ? "inset 0 0 0 1px rgba(255,255,255,0.4)" : "none" }}>
                  {v}
                </motion.div>
              );
            }),
          ];
        })}
      </div>
      <div className="mt-2 text-[11px] text-l3">predicted grade →</div>
    </div>
  );
}

function Recall({ r }: { r: number[] }) {
  return (
    <div className="flex h-40 items-end justify-around gap-3">
      {r.map((v, i) => (
        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
          <div className="num text-[11px] text-l2">{fx(v)}</div>
          <div className="relative w-5 flex-1 rounded-full bg-white/[0.06]">
            <motion.div className="absolute bottom-0 w-full rounded-full" style={{ background: i >= 2 ? "#fff" : "rgba(255,255,255,0.45)" }} initial={{ height: 0 }} whileInView={{ height: `${v * 100}%` }} viewport={{ once: true }} transition={{ delay: i * 0.05, type: "spring", stiffness: 120, damping: 18 }} />
          </div>
          <div className="text-[12px] font-semibold">{i}</div>
        </div>
      ))}
    </div>
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
