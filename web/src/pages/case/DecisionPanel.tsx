import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { usePolicy, usePutVA, useReplay } from "../../api/hooks";
import type { Encounter, Eye, ImageResult, LesionType, RuleStep } from "../../api/types";
import { GradeBars } from "../../components/GradeBars";
import { Gauge } from "../../components/Gauge";
import { Check, ChevronRight, Hash, RefreshCw, ShieldCheck } from "../../components/icons";
import { OutcomePill } from "../../components/OutcomePill";
import { Ring } from "../../components/Ring";
import { WheelPicker } from "../../components/WheelPicker";
import { SPRING } from "../../components/motion";
import { encounterReasonLine } from "../../lib/copy";
import { flagLabel, fx, LESION_COLOR, LESION_NAME, LESION_TYPES, OUTCOME_WORD, outcomeColor, shortHash, urgencyLabel } from "../../lib/format";
import { sound } from "../../lib/sound";
import { useUI } from "../../lib/store";
import { VA_REFER_LOGMAR, VA_VALUES, vaToLogmar } from "../../lib/va";

export function Card({ title, children, right, id, explain }: { title?: ReactNode; children: ReactNode; right?: ReactNode; id?: string; explain?: ReactNode }) {
  return (
    <section id={id} className="card p-5">
      {title && (
        <div className="mb-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-title">{title}</h3>
            {right}
          </div>
          {explain && <p className="mt-0.5 text-[13px] leading-snug text-l2">{explain}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

function Trace({ steps }: { steps: RuleStep[] }) {
  return (
    <ol className="relative ml-2 border-l border-white/10 pl-5">
      {steps.map((s, i) => (
        <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="relative pb-3 last:pb-0">
          <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full" style={{ background: s.fired ? "#fff" : "#38383A", boxShadow: s.fired ? "0 0 10px rgba(255,255,255,0.8)" : "none" }} />
          <div className={`text-[14px] ${s.fired ? "font-semibold text-white" : "text-l3"}`}>{s.rule} {s.fired ? "· fired" : "· skipped"}</div>
          <div className={`num text-[12px] ${s.fired ? "text-l2" : "text-l3"}`}>{s.detail}</div>
        </motion.li>
      ))}
    </ol>
  );
}

export function OutcomeCard({ enc, image }: { enc: Encounter; image: ImageResult | undefined }) {
  const [open, setOpen] = useState(false);
  const ai = enc.ai;
  if (!ai) return <Card title="Outcome"><p className="text-body text-l2">Waiting for at least one analysed image.</p></Card>;
  const c = outcomeColor(ai.outcome, ai.urgency);
  return (
    <Card>
      <div className="text-eyebrow uppercase text-l2">AI outcome · encounter</div>
      <p className="mt-1 text-[13px] leading-snug text-l2">What the AI recommends for this patient, combining both eyes and the vision check. A clinician signs the final decision below.</p>
      <div className="mt-2 text-[52px] font-bold leading-none tracking-[-0.04em]" style={{ color: c, textShadow: `0 0 40px ${c}55` }}>{OUTCOME_WORD[ai.outcome]}</div>
      {ai.urgency && <div className="mt-2 text-headline">{urgencyLabel(ai.urgency)}</div>}
      <p className="mt-2 text-body text-white/85">{encounterReasonLine(enc)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["OD", "OS"] as Eye[]).map((eye) => <OutcomePill key={eye} prefix={eye} outcome={ai.eyes[eye]?.outcome} urgency={ai.eyes[eye]?.urgency} size="sm" />)}
      </div>
      {ai.flags.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {ai.flags.map((f) => <li key={f.code} className="flex gap-2 text-[14px]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-review" /><span><span className="font-medium">{flagLabel(f.code)}.</span> <span className="text-l2">{f.text}</span></span></li>)}
        </ul>
      )}
      <button type="button" onClick={() => { sound.tick(); setOpen((o) => !o); }} aria-expanded={open} className="mt-4 flex items-center gap-1 text-[14px] font-medium text-white/85 hover:text-white">
        Why this outcome <motion.span animate={{ rotate: open ? 90 : 0 }}><ChevronRight className="h-4 w-4" /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className="overflow-hidden">
            <div className="mt-4 space-y-4">
              {image?.triage && (
                <div>
                  <div className="mb-2 text-eyebrow uppercase text-l2">Image rules · {image.eye} {image.view}</div>
                  <Trace steps={image.triage.rule_trace} />
                </div>
              )}
              <div>
                <div className="mb-2 text-eyebrow uppercase text-l2">Encounter rules</div>
                <Trace steps={ai.rule_trace} />
              </div>
              <div className="text-[12px] text-l3">Policy {ai.policy_version}. Deterministic: same inputs, same outcome. Clinician makes the final decision.</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

export function ConfidenceCard({ image }: { image: ImageResult }) {
  const policy = usePolicy();
  const g = image.grading;
  if (!g) return null;
  const [cnn, vit] = g.models;
  const t = policy.data?.t_refer;
  return (
    <Card title="Confidence" explain="How likely the AI thinks this eye needs a specialist. Past the marked line on the ring, it recommends a referral.">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <GradeBars probs={g.ensemble.probs} ghosts={g.models.map((m) => m.probs)} label="Ensemble grade" height={120} />
        <div className="flex flex-col items-center">
          <Ring value={g.ensemble.p_referable} size={132} stroke={9} marker={t ?? null} markerLabel={t != null ? `op ${t.toFixed(2)}` : undefined} color={t != null && g.ensemble.p_referable >= t ? "#FF9F0A" : "#fff"}>
            <div className="num text-[30px] font-semibold leading-none">{g.ensemble.p_referable.toFixed(2)}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-l2">P(referable)</div>
          </Ring>
        </div>
      </div>
      <div className="num mt-4 text-[13px] text-l2">
        {cnn && vit && <>CNN {cnn.p_referable.toFixed(2)} · ViT {vit.p_referable.toFixed(2)} · Δ {Math.abs(cnn.p_referable - vit.p_referable).toFixed(2)}</>}
      </div>
      <div className="num mt-1 text-[12px] text-l3">
        Calibrated (temperature {g.models.map((m) => `${m.name.startsWith("cnn") ? "CNN" : "ViT"} T=${m.temperature.toFixed(2)}`).join(", ")}). Ghost bars: per-model probabilities. Operating point from validation, not tuned per case.
      </div>
    </Card>
  );
}

export function DoubtCard({ image }: { image: ImageResult }) {
  const policy = usePolicy();
  const u = image.uncertainty;
  if (!u) return null;
  const prov = policy.data?.provenance;
  const fitted = prov?.fitted_on ?? "validation data";
  return (
    <Card title="Doubt" explain="How unsure the AI is. Above the line, it hands the case to a person." right={<span className="text-[12px] text-l2">thresholds: {fitted}</span>}>
      <Gauge label="Entropy" value={u.entropy} threshold={u.entropy_threshold} max={Math.log(5)} hint={prov?.t_entropy ? `Set on ${fitted}: ${prov.t_entropy}` : undefined} />
      <Gauge label="Grader disagreement" value={u.disagreement} threshold={u.disagreement_threshold} max={1} hint={prov?.t_disagreement ? `Set on ${fitted}: ${prov.t_disagreement}` : undefined} />
      <Gauge label="Unlike training images (OOD)" value={u.ood_score} threshold={u.ood_threshold} format={(v) => v.toFixed(1)} hint={prov?.t_ood ? `Set on ${fitted}: ${prov.t_ood}` : undefined} />
    </Card>
  );
}

export function QualityCard({ image }: { image: ImageResult }) {
  const q = image.quality;
  if (!q) return null;
  const col = q.category === "adequate" ? "#30D158" : q.category === "usable" ? "#FFD60A" : "#FF453A";
  return (
    <Card title="Quality" explain="Whether the photo is good enough to read. Failing a hard check means the photo must be retaken." right={<span className="rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize" style={{ background: `${col}22`, color: col }}>{q.category}</span>}>
      {q.probs && (
        <div className="mb-3 flex h-2 overflow-hidden rounded-full" title="Quality model probabilities">
          <div style={{ width: `${q.probs.adequate * 100}%`, background: "#30D158" }} />
          <div style={{ width: `${q.probs.usable * 100}%`, background: "#FFD60A" }} />
          <div style={{ width: `${q.probs.inadequate * 100}%`, background: "#FF453A" }} />
        </div>
      )}
      {q.checks.map((c) => (
        <Gauge key={c.code} label={<>{c.label}{c.hard && <span className="ml-1.5 rounded bg-white/10 px-1 text-[10px] uppercase tracking-wider text-l2">hard</span>}</>} value={c.value} threshold={c.threshold} pass={c.pass} failAbove={(c.value >= c.threshold) !== c.pass} hint={c.detail} compact />
      ))}
    </Card>
  );
}

function VAEdit({ enc }: { enc: Encounter }) {
  const put = usePutVA(enc.id);
  const toast = useUI((s) => s.toast);
  const [edit, setEdit] = useState<Eye | null>(null);
  const [val, setVal] = useState<string | null>(null);
  const save = (eye: Eye, v: string | null) => {
    const before = enc.ai?.outcome;
    put.mutate(
      { OD: { value: eye === "OD" ? v : enc.va.OD.value }, OS: { value: eye === "OS" ? v : enc.va.OS.value }, method: enc.va.method ?? "Snellen", operator: enc.va.operator, measured_at: new Date().toISOString() },
      {
        onSuccess: (e) => {
          setEdit(null);
          sound.lowTick();
          toast({ text: before !== e.ai?.outcome ? `VA saved. Policy re-run: ${before ?? "–"} → ${e.ai?.outcome ?? "–"}` : "VA saved. Policy re-run, outcome unchanged.", tone: "ok" });
        },
        onError: (x) => { sound.fail(); toast({ text: x instanceof Error ? x.message : "Could not save VA", tone: "error" }); },
      },
    );
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["OD", "OS"] as Eye[]).map((eye) => {
        const v = enc.va[eye].value;
        const lm = vaToLogmar(v);
        const bad = lm != null && lm > VA_REFER_LOGMAR + 1e-6;
        return (
          <div key={eye} className="rounded-[16px] bg-s2/60 p-3">
            <div className="text-eyebrow uppercase text-l2">VA · {eye}</div>
            {edit === eye ? (
              <div className="mt-2">
                <WheelPicker label={`Edit VA ${eye}`} values={VA_VALUES} value={val} onChange={setVal} visible={3} />
                <div className="mt-2 flex gap-1.5">
                  <button type="button" className="btn-white h-8 flex-1 px-3 text-[13px]" disabled={put.isPending} onClick={() => save(eye, val)}>{put.isPending ? "Saving…" : "Save"}</button>
                  <button type="button" className="btn-ghost h-8 px-3 text-[13px]" onClick={() => save(eye, null)} disabled={put.isPending}>Not measured</button>
                  <button type="button" className="btn-ghost h-8 px-2 text-[13px]" onClick={() => setEdit(null)}>✕</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => { setVal(v ?? "6/6"); setEdit(eye); }} className="mt-1 flex w-full items-baseline justify-between text-left" aria-label={`Edit visual acuity ${eye}`}>
                <span className={`num text-[26px] font-semibold ${v == null ? "text-review" : bad ? "text-refer" : ""}`}>{v ?? "—"}</span>
                <span className="text-[12px] text-l2 underline-offset-2 hover:underline">Edit</span>
              </button>
            )}
            {edit !== eye && <div className={`text-[12px] ${v == null ? "text-review" : bad ? "text-refer" : "text-l3"}`}>{v == null ? "Not measured · missing is not normal" : bad ? "Worse than 6/12 → refer flag" : `logMAR ${lm?.toFixed(2)}`}</div>}
          </div>
        );
      })}
      <div className="col-span-2 text-[12px] text-l3">{enc.va.method ?? "Method not recorded"}{enc.va.operator ? ` · ${enc.va.operator}` : ""}. Changing VA re-runs the encounter policy.</div>
    </div>
  );
}

export function SafeguardsCard({ enc, image }: { enc: Encounter; image: ImageResult | undefined }) {
  const mr = enc.images.find((i) => i.macular_risk?.flag)?.macular_risk ?? image?.macular_risk;
  const lat = image?.landmarks?.laterality;
  return (
    <Card title="Clinical safeguards" explain="Checks that can refer regardless of the AI: poor vision, exudates near the centre of vision, a left/right label mix-up.">
      <VAEdit enc={enc} />
      <div className="mt-3 rounded-[16px] bg-s2/60 p-3">
        <div className="flex items-center justify-between">
          <div className="text-headline">Macular risk</div>
          <span className={`text-[12px] font-semibold ${mr?.flag ? "text-review" : "text-l2"}`}>{mr?.flag ? "Flagged" : "Not flagged"}</span>
        </div>
        <div className="mt-1 text-[13px] text-l2">{mr ? `${mr.ex_within_1dd} hard-exudate candidate${mr.ex_within_1dd === 1 ? "" : "s"} within 1 disc diameter of the fovea.` : "No macular-risk output."}</div>
        <div className="mt-1 text-[12px] text-l3">Macular finding for review. Not a DME diagnosis.</div>
      </div>
      {lat && (
        <div className="mt-3 rounded-[16px] bg-s2/60 p-3">
          <div className="flex items-center justify-between">
            <div className="text-headline">Laterality</div>
            <span className={`text-[12px] font-semibold ${lat.mismatch ? "text-review" : "text-routine"}`}>{lat.mismatch ? "Mismatch" : "Consistent"}</span>
          </div>
          <div className="mt-1 text-[13px] text-l2">Labelled {lat.selected}. Disc position suggests {lat.predicted} ({(lat.confidence * 100).toFixed(0)}%).</div>
        </div>
      )}
    </Card>
  );
}

export function LesionsCard({ image, selected, onSelect }: { image: ImageResult; selected: string | null; onSelect: (id: string | null) => void }) {
  const L = image.lesions;
  const [open, setOpen] = useState<LesionType | null>(null);
  if (!L) return null;
  return (
    <Card title="Lesion candidates" explain="Spots the AI marked as possible damage. Open a type and click one to find it on the photo and the 3D eye." right={<span className="text-[12px] text-l2">model-predicted</span>}>
      <div className="space-y-1.5">
        {LESION_TYPES.map((t) => {
          const s = L.summary[t];
          const list = L.items.filter((l) => l.type === t);
          return (
            <div key={t} className="rounded-[14px] bg-s2/50">
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={() => setOpen(open === t ? null : t)} aria-expanded={open === t} disabled={!list.length} title={list.length ? `Show ${LESION_NAME[t].toLowerCase()} candidates` : "None found on this image"}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: LESION_COLOR[t], boxShadow: `0 0 8px ${LESION_COLOR[t]}` }} />
                <span className="flex-1 text-[15px]">{LESION_NAME[t]}</span>
                <span className="num text-[14px] font-semibold">{s.count}</span>
                <span className="num w-20 text-right text-[12px] text-l2">{(s.area_frac * 100).toFixed(2)}% area</span>
                {list.length > 0 && <ChevronRight className={`h-4 w-4 text-l3 transition-transform ${open === t ? "rotate-90" : ""}`} />}
              </button>
              <AnimatePresence initial={false}>
                {open === t && (
                  <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="max-h-56 overflow-y-auto px-2 pb-2">
                      {list.map((l) => (
                        <button key={l.id} type="button" onClick={() => { sound.tick(); onSelect(l.id === selected ? null : l.id); }} className={`num flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-[12px] ${l.id === selected ? "bg-white text-black" : "text-l2 hover:bg-white/5"}`}>
                          <span>{l.id.slice(-5)}</span>
                          <span>{(l.confidence * 100).toFixed(0)}%</span>
                          <span>{l.dist_fovea_dd != null ? `${l.dist_fovea_dd.toFixed(1)} DD` : "–"}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function ReceiptCard({ image, onVerified }: { image: ImageResult; onVerified?: () => void }) {
  const replay = useReplay();
  const r = replay.data;
  return (
    <Card title="Determinism receipt" explain="Proof the result is reproducible: re-running the same photo must give the same fingerprint (hash)." right={<Hash className="h-4 w-4 text-l3" />}>
      <dl className="num space-y-1.5 text-[12px]">
        <Row k="Input SHA-256" v={shortHash(image.sha256, 16)} full={image.sha256} />
        {Object.entries(image.model_versions ?? {}).map(([k, v]) => <Row key={k} k={k} v={shortHash(v, 16)} full={v} />)}
        <Row k="Result hash" v={shortHash(image.result_hash, 16)} full={image.result_hash ?? ""} />
        {image.timings_ms && <Row k="Compute" v={`${Object.values(image.timings_ms).reduce((a, b) => a + b, 0)} ms`} />}
      </dl>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="btn-ghost" disabled={replay.isPending || image.status !== "done"} title={replay.isPending ? "Replaying…" : image.status !== "done" ? "Wait until the analysis finishes" : "Re-run every model and compare hashes"} onClick={() => replay.mutate(image.id, { onSuccess: (x) => { if (x.match) { sound.success(); onVerified?.(); } else sound.fail(); }, onError: () => sound.fail() })}>
          <RefreshCw className={`h-4 w-4 ${replay.isPending ? "animate-spin" : ""}`} /> {replay.isPending ? "Replaying…" : "Replay"}
        </button>
        <AnimatePresence>
          {r && !replay.isPending && (
            <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING} className={`flex items-center gap-1.5 text-[14px] font-semibold ${r.match ? "text-routine" : "text-urgent"}`}>
              {r.match ? <><Check className="h-4 w-4" /> Identical</> : "Different!"}
            </motion.span>
          )}
        </AnimatePresence>
        {replay.isError && <span className="text-[13px] text-urgent">{(replay.error as Error).message}</span>}
      </div>
      {r && !replay.isPending && (
        <div className="num mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-[10px] bg-s2/60 p-2"><div className="text-l3">original</div><div className="break-all">{r.original_hash}</div></div>
          <div className="rounded-[10px] bg-s2/60 p-2"><div className="text-l3">replay · {r.ms} ms</div><div className="break-all" style={{ color: r.match ? "#30D158" : "#FF453A" }}>{r.replay_hash}</div></div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-l3"><ShieldCheck className="h-3.5 w-3.5" /> Replay re-runs every model on the stored input and compares hashes.</div>
    </Card>
  );
}

function Row({ k, v, full }: { k: string; v: string; full?: string }) {
  return (
    <div className="flex justify-between gap-3" title={full}>
      <dt className="text-l2">{k}</dt>
      <dd className="truncate text-white/90">{v}</dd>
    </div>
  );
}

export { fx };
