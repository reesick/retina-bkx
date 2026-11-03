// Evidence sections built from the app-level evaluation (metrics.json optional keys) and /api/failures.
// Every section renders only when its key exists, and every sentence is computed from the numbers shown.
import { memo, useMemo, useState } from "react";
import { assetUrl } from "../../api/client";
import { useFailures } from "../../api/hooks";
import type {
  AppEval, AppTriage, BandMetrics, EncounterLevel, EncounterView, EvalSet, ExplanationIoU, ExplanationRuntime, ExplanationStability,
  FailureCase, FailureCategory, GateArm, LeakageCheck, LeakageSet, MetricsAvailable, QualityBand, Quantization, Reason, SiteArm, SiteCalibration,
} from "../../api/types";
import { OutcomePill } from "../../components/OutcomePill";
import { Segmented } from "../../components/Segmented";
import { Sheet } from "../../components/Sheet";
import { Skeleton } from "../../components/Skeleton";
import { flagLabel, URGENT } from "../../lib/format";
import { Big, Card, f2, int, isNum, ofN, OutcomeLegend, outcomeShares, p0, p1, StackBar } from "./kit";

export const SET_LABEL: Record<EvalSet, string> = { idrid: "IDRiD", ddr: "DDR", deepdrid_val: "DeepDRiD", aptos_test: "APTOS" };
const SET_ORDER: EvalSet[] = ["idrid", "ddr", "deepdrid_val", "aptos_test"];
const setLabel = (k: string) => SET_LABEL[k as EvalSet] ?? k;
const sum = (xs: (number | undefined)[]) => xs.reduce<number>((a, b) => a + (isNum(b) ? b : 0), 0);
const missColor = (x: number | undefined) => (isNum(x) && x > 0 ? URGENT : undefined);

// ------------------------------------------------------------------ a) What the app actually decides
export const AppDecides = memo(function AppDecides({ ev }: { ev: AppEval }) {
  const rows = useMemo(() => SET_ORDER.filter((k) => ev.sets?.[k]).map((k) => [k, ev.sets![k]!] as [EvalSet, AppTriage]), [ev.sets]);
  if (!rows.length) return null;
  const missed = sum(rows.map(([, s]) => s.referable_routed_routine));
  const refTot = sum(rows.map(([, s]) => s.referable_total));
  const mostReview = rows.filter(([, s]) => isNum(s.human_review_rate)).sort((a, b) => b[1].human_review_rate! - a[1].human_review_rate!)[0];
  const excluded = rows.filter(([, s]) => isNum(s.excluded_lesion_train_overlap) && s.excluded_lesion_train_overlap! > 0);
  const landmarks = [...new Set(rows.map(([, s]) => s.landmarks).filter(Boolean))];
  const fid = ev.fidelity_gpu_vs_onnx;
  const caption = [
    landmarks.length ? `Landmarks: ${landmarks.join(", ")}.` : null,
    excluded.length ? `Excluded images also used to train the lesion model: ${excluded.map(([k, s]) => `${setLabel(k)} ${int(s.excluded_lesion_train_overlap)}`).join(", ")}.` : null,
    fid && isNum(fid.outcome_agreement) ? `Fidelity check: the GPU replay gives the same outcome as the on-device ONNX models for ${p1(fid.outcome_agreement)} of ${int(fid.n)} images (largest P(referable) difference ${f2(fid.max_abs_diff_p_referable, 3)}).` : null,
  ].filter(Boolean).join(" ");
  return (
    <Card title="What the app actually decides" caption={caption || ev.method}
      how="Each bar is one test set run through the whole app: quality check, both graders, lesion rules and the triage policy. Colours show where the photos went. The number on the right is the costly mistake: eyes the dataset calls referable that the app cleared as ROUTINE."
      takeaway={refTot ? `Across ${rows.length} test set${rows.length === 1 ? "" : "s"}, ${int(missed)} of ${int(refTot)} referable eyes (${p1(missed / refTot)}) were cleared as ROUTINE; the rest were referred or handed to a person.${mostReview ? ` ${setLabel(mostReview[0])} sends the most photos to a person (${p0(mostReview[1].human_review_rate)}).` : ""}` : null}>
      <div className="space-y-4">
        {rows.map(([k, s]) => (
          <div key={k} className="grid items-center gap-x-4 gap-y-2 md:grid-cols-[150px_minmax(0,1fr)_320px]">
            <div>
              <div className="text-[15px] font-semibold">{setLabel(k)}</div>
              <div className="text-[12px] text-l2">n = {int(s.n)}{isNum(s.n_gradable) ? ` · ${int(s.n_gradable)} gradable` : ""}</div>
            </div>
            <div>
              <StackBar shares={outcomeShares(s)} label={setLabel(k)} />
              <div className="num mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-l2">
                <span>routine {p0(s.routine_rate)}</span><span>refer {p0(s.referral_rate)}</span><span>review {p0(s.human_review_rate)}</span><span>retake {p0(s.retake_rate)}</span>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-x-3 text-[13px]">
              <span className="text-l2">Referable cleared as ROUTINE</span><span className="num text-right font-semibold" style={{ color: missColor(s.referable_routed_routine) }}>{ofN(s.referable_routed_routine, s.referable_total)}</span>
              <span className="text-l2">Decided without a person</span><span className="num text-right">{p0(s.coverage)}</span>
              <span className="text-l2">Auto sensitivity · specificity</span><span className="num text-right">{f2(s.auto_sens)} · {f2(s.auto_spec)}</span>
            </div>
          </div>
        ))}
        <OutcomeLegend />
      </div>
    </Card>
  );
});

// ------------------------------------------------------------------ b) By image quality
const BANDS: { k: QualityBand; label: string }[] = [{ k: "adequate", label: "Adequate" }, { k: "usable", label: "Usable" }, { k: "inadequate", label: "Inadequate" }];
export const ByQuality = memo(function ByQuality({ ev, preferred }: { ev: AppEval; preferred: string }) {
  const sets = SET_ORDER.filter((k) => ev.quality_bands?.[k]);
  const [ds, setDs] = useState<EvalSet>(sets.includes(preferred as EvalSet) ? (preferred as EvalSet) : sets[0]);
  if (!sets.length) return null;
  const cur = sets.includes(ds) ? ds : sets[0];
  const b = ev.quality_bands![cur]!;
  const a = b.adequate, u = b.usable, bad = b.inadequate;
  const parts: string[] = [];
  if (isNum(a?.auroc) && isNum(u?.auroc)) parts.push(`AUROC is ${f2(a!.auroc)} on adequate photos and ${f2(u!.auroc)} on usable ones`);
  if (bad && isNum(bad.retake_rate)) parts.push(`${p0(bad.retake_rate)} of inadequate photos are sent for a retake`);
  return (
    <Card title="By image quality" caption={`${setLabel(cur)}: photos split by the quality model's own category.`}
      how="Share is how many photos fell in each quality band. AUROC shows how well the graders rank sick above healthy eyes within the band (1.0 is perfect). The bar is what the app did with those photos."
      takeaway={parts.length ? `On ${setLabel(cur)}, ${parts.join("; ")}.` : null}>
      {sets.length > 1 && <div className="mb-4"><Segmented ariaLabel="Quality dataset" value={cur} onChange={setDs} options={sets.map((k) => ({ value: k, label: setLabel(k) }))} /></div>}
      <div className="grid gap-3 md:grid-cols-3">
        {BANDS.map(({ k, label }) => {
          const m: BandMetrics | undefined = b[k];
          return (
            <div key={k} className="rounded-[16px] bg-s2/60 p-3">
              <div className="flex items-baseline justify-between"><span className="text-[14px] font-semibold">{label}</span><span className="num text-[12px] text-l2">AUROC {m?.auroc == null ? "–" : f2(m.auroc)}</span></div>
              <div className="num mt-2 text-[28px] font-semibold leading-none">{p0(m?.share)}</div>
              <div className="mb-3 mt-1 text-[12px] text-l2">of photos</div>
              {m ? <StackBar shares={outcomeShares(m)} label={label} /> : <div className="text-[12px] text-l3">No photos in this band.</div>}
            </div>
          );
        })}
      </div>
      <div className="mt-3"><OutcomeLegend /></div>
    </Card>
  );
});

// ------------------------------------------------------------------ c) Quality gate ablation
export const GateAblation = memo(function GateAblation({ ab }: { ab: NonNullable<AppEval["quality_gate_ablation"]> }) {
  const w = ab.with_quality_gate, wo = ab.without_quality_gate;
  if (!w && !wo) return null;
  let take: string | null = null;
  if (w && wo && isNum(w.referable_routed_routine) && isNum(wo.referable_routed_routine)) {
    const d = wo.referable_routed_routine - w.referable_routed_routine;
    const dw = isNum(w.wrong_auto_decisions) && isNum(wo.wrong_auto_decisions) ? wo.wrong_auto_decisions - w.wrong_auto_decisions : null;
    take = d > 0
      ? `With the quality gate, ${int(d)} fewer referable eyes are cleared as ROUTINE (${int(w.referable_routed_routine)} vs ${int(wo.referable_routed_routine)})${dw != null ? ` and ${dw >= 0 ? `${int(dw)} fewer` : `${int(-dw)} more`} automatic decisions are wrong` : ""}.`
      : d < 0
        ? `The quality gate does not help here: ${int(-d)} more referable eyes are cleared as ROUTINE with it (${int(w.referable_routed_routine)} vs ${int(wo.referable_routed_routine)}).`
        : `The gate makes no difference to referable eyes cleared as ROUTINE (${int(w.referable_routed_routine)} either way)${dw != null ? `; wrong automatic decisions change by ${int(-dw)}` : ""}.`;
  }
  const Arm = ({ a, title }: { a?: GateArm; title: string }) => (
    <div className="rounded-[16px] bg-s2/60 p-4">
      <div className="text-[14px] font-semibold">{title}</div>
      {a ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div><div className="num text-[26px] font-semibold leading-none" style={{ color: missColor(a.referable_routed_routine) }}>{int(a.referable_routed_routine)}</div><div className="mt-1 text-[12px] text-l2">referable cleared as ROUTINE{isNum(a.referable_total) ? ` (of ${int(a.referable_total)})` : ""}</div></div>
            <div><div className="num text-[26px] font-semibold leading-none">{int(a.wrong_auto_decisions)}</div><div className="mt-1 text-[12px] text-l2">wrong automatic decisions</div></div>
          </div>
          <div className="mt-4"><StackBar shares={outcomeShares(a)} label={title} /></div>
          <div className="num mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-l2"><span>routine {p0(a.routine_rate)}</span><span>refer {p0(a.referral_rate)}</span><span>review {p0(a.human_review_rate)}</span><span>retake {p0(a.retake_rate)}</span></div>
        </>
      ) : <div className="mt-2 text-[13px] text-l3">Not run.</div>}
    </div>
  );
  return (
    <Card title="Does the quality gate help?" caption={`Same ${isNum(ab.n) ? `${int(ab.n)} ` : ""}photos run twice: with the quality check, and with it switched off.`}
      how="Left is the app as shipped; right skips the photo-quality check so every photo goes straight to the graders. A wrong automatic decision is a ROUTINE or REFER that disagrees with the dataset label."
      takeaway={take}>
      <div className="grid gap-3 md:grid-cols-2"><Arm a={w} title="With the quality gate" /><Arm a={wo} title="Without the quality gate" /></div>
    </Card>
  );
});

// ------------------------------------------------------------------ d) Patients, not photos
const LEVELS: { k: keyof EncounterView; label: string; sub: string }[] = [
  { k: "eye_level", label: "Per eye", sub: "each eye decided on its own" },
  { k: "patient_level_va_not_recorded", label: "Per patient · VA not recorded", sub: "as DeepDRiD ships: no visual acuity" },
  { k: "patient_level_va_assumed_normal", label: "Per patient · VA assumed normal", sub: "what the photos alone would do" },
];
export const Encounters = memo(function Encounters({ enc }: { enc: NonNullable<AppEval["deepdrid_encounters"]> }) {
  const views = ([["single_view", "Single view"], ["dual_view", "Two views per eye"]] as const).filter(([k]) => enc[k]);
  if (!views.length) return null;
  const Cell = ({ l, patient }: { l?: EncounterLevel; patient: boolean }) => l ? (
    <div className="space-y-1.5">
      <StackBar shares={outcomeShares(undefined, l.outcomes)} counts={l.outcomes} height={10} />
      <div className="num text-[12px] text-l2">
        <span style={{ color: missColor(l.referable_routed_routine) }}>{ofN(l.referable_routed_routine, patient ? l.referable_patients ?? l.referable_total : l.referable_total)}</span> referable cleared as ROUTINE
      </div>
      <div className="num text-[12px] text-l2">{p0(l.nonreferable_routine_rate)} of healthy cleared as ROUTINE · n = {int(patient ? l.n_patients : l.n_eyes)}</div>
    </div>
  ) : <div className="text-[12px] text-l3">Not run.</div>;
  const s = enc.single_view?.eye_level, d = enc.dual_view?.eye_level;
  const noVa = (enc.dual_view ?? enc.single_view)?.patient_level_va_not_recorded;
  const parts: string[] = [];
  if (s && d && isNum(s.referable_routed_routine) && isNum(d.referable_routed_routine))
    parts.push(`Two views per eye clear ${int(d.referable_routed_routine)} referable eye${d.referable_routed_routine === 1 ? "" : "s"} as ROUTINE against ${int(s.referable_routed_routine)} with one view`);
  if (noVa?.outcomes && isNum(noVa.n_patients)) parts.push(`without a recorded VA, ${int(noVa.outcomes.ROUTINE ?? 0)} of ${int(noVa.n_patients)} patients are cleared as ROUTINE`);
  return (
    <Card title="Patients, not photos" caption="DeepDRiD has two photos per eye and both eyes per patient, so decisions can be counted per eye and per patient."
      how="A patient is cleared as ROUTINE only if both eyes are. Columns compare using one photo per eye with using both. The policy treats missing visual acuity (VA) as not normal, so the middle row is the honest one for this dataset."
      takeaway={parts.length ? parts.map((p, i) => (i ? p : p[0].toUpperCase() + p.slice(1))).join("; ") + "." : null}>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-x-4 gap-y-4" style={{ gridTemplateColumns: `200px repeat(${views.length}, minmax(0,1fr))` }}>
          <div />
          {views.map(([k, label]) => <div key={k} className="text-[13px] font-semibold">{label}</div>)}
          {LEVELS.map((lv) => [
            <div key={lv.k}><div className="text-[13px] font-medium">{lv.label}</div><div className="text-[11px] text-l2">{lv.sub}</div></div>,
            ...views.map(([k]) => <Cell key={`${lv.k}-${k}`} l={enc[k]?.[lv.k]} patient={lv.k !== "eye_level"} />),
          ])}
        </div>
      </div>
      {enc.note && <p className="mt-4 rounded-[12px] bg-review/10 px-3 py-2 text-[13px] leading-snug text-white/85"><span className="font-semibold text-review">Visual acuity: </span>{enc.note}</p>}
      <div className="mt-3"><OutcomeLegend /></div>
    </Card>
  );
});

// ------------------------------------------------------------------ e) Macular cue vs DME labels
export const MacularDme = memo(function MacularDme({ m }: { m: NonNullable<AppEval["macular_risk_vs_dme"]> }) {
  return (
    <Card title="Macular cue vs DME labels" caption={`${isNum(m.n) ? `${int(m.n)} images` : "Images"} with a macular oedema label${isNum(m.dme_positive) ? `, ${int(m.dme_positive)} of them positive` : ""}.`}
      how="The app flags a macular finding when lesion candidates that look like hard exudates sit within one disc diameter of the fovea. This compares that flag with the dataset's oedema label."
      takeaway={isNum(m.sensitivity) ? `The cue flags ${p0(m.sensitivity)} of eyes labelled as oedema risk and stays quiet on ${p0(m.specificity)} of the others. It is a prompt to look, not a DME diagnosis.` : null}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Big label="Sensitivity" v={f2(m.sensitivity)} /><Big label="Specificity" v={f2(m.specificity)} /><Big label="PPV" v={f2(m.ppv)} /><Big label="NPV" v={f2(m.npv)} />
      </div>
      <p className="mt-3 text-[13px] leading-snug text-l2"><span className="font-semibold text-white">Not a DME diagnosis.</span> Diabetic macular oedema is diagnosed with OCT or stereo examination; a 2D photo shows only indirect signs.{m.note ? ` ${m.note}` : ""}</p>
    </Card>
  );
});

// ------------------------------------------------------------------ f) Site calibration
export const SiteCal = memo(function SiteCal({ sc }: { sc: SiteCalibration }) {
  const g = sc.test?.generic, c = sc.test?.site_calibrated;
  if (!g && !c) return null;
  const rows: { label: string; get: (a?: SiteArm) => number | null | undefined; fmt: (x: number | null | undefined) => string; better: "up" | "down" | null }[] = [
    { label: "Sensitivity", get: (a) => a?.sens, fmt: f2, better: "up" },
    { label: "Specificity", get: (a) => a?.spec, fmt: f2, better: "up" },
    { label: "ECE (calibration error)", get: (a) => a?.ece, fmt: (x) => f2(x, 3), better: "down" },
    { label: "Sent to a person", get: (a) => a?.triage?.human_review_rate, fmt: p0, better: "down" },
    { label: "Referable cleared as ROUTINE", get: (a) => a?.triage?.referable_routed_routine, fmt: int, better: "down" },
    { label: "AUROC", get: (a) => a?.auroc, fmt: f2, better: null },
    { label: "Referral threshold", get: (a) => a?.t_refer, fmt: (x) => f2(x, 3), better: null },
  ];
  const parts: string[] = [];
  if (isNum(g?.ece) && isNum(c?.ece)) parts.push(`calibration error goes from ${f2(g!.ece, 3)} to ${f2(c!.ece, 3)}`);
  if (isNum(g?.triage?.human_review_rate) && isNum(c?.triage?.human_review_rate)) parts.push(`photos sent to a person from ${p0(g!.triage!.human_review_rate)} to ${p0(c!.triage!.human_review_rate)}`);
  if (isNum(g?.sens) && isNum(c?.sens)) parts.push(`sensitivity from ${f2(g!.sens)} to ${f2(c!.sens)}`);
  const prov = sc.profile?.provenance;
  return (
    <Card title="New camera? Calibrate once" caption={`${sc.test?.dataset ?? "Site test set"}${sc.profile?.site ? ` · profile: ${sc.profile.site}` : ""}${typeof prov === "string" ? ` · ${prov}` : ""}`}
      how="Generic uses the thresholds and temperatures fitted on the training data. Site-calibrated refits only those few numbers on a small labelled set from the new camera; the models themselves are unchanged. The site test images were not used for fitting."
      takeaway={parts.length ? `After calibrating on this camera, ${parts.join(", ")}.` : null}>
      <table className="num w-full text-[14px]">
        <thead><tr className="text-left text-[12px] text-l2"><th className="py-2 font-medium">Metric</th><th className="py-2 text-right font-medium">Generic</th><th className="py-2 text-right font-medium">Site-calibrated</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const a = r.get(g), b = r.get(c);
            const better = r.better && isNum(a) && isNum(b) && a !== b ? (r.better === "up" ? b > a : b < a) : null;
            return (
              <tr key={r.label} className="border-t border-sep/60" style={{ borderTopWidth: 0.5 }}>
                <td className="py-2 text-l2">{r.label}</td><td className="py-2 text-right">{r.fmt(a)}</td>
                <td className="py-2 text-right font-semibold" style={{ color: better == null ? undefined : better ? "#30D158" : URGENT }}>{r.fmt(b)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sc.profile?.temperatures && <div className="num mt-2 text-[12px] text-l2">Fitted temperatures: {Object.entries(sc.profile.temperatures).map(([k, v]) => `${k.replace("grader_", "")} ${f2(v)}`).join(" · ")}</div>}
    </Card>
  );
});

// ------------------------------------------------------------------ g) Explanation extras (IoU, stability, runtime)
const EXPL_EXTRA = new Set(["iou", "stability", "runtime_ms"]);
export const explanationBasics = (e: MetricsAvailable["explanations"]) => (e ? Object.fromEntries(Object.entries(e).filter(([k]) => !EXPL_EXTRA.has(k))) : undefined);

export const ExplanationExtras = memo(function ExplanationExtras({ e }: { e: MetricsAvailable["explanations"] }) {
  const iou = e?.iou as ExplanationIoU | undefined;
  const st = e?.stability as ExplanationStability | undefined;
  const rt = e?.runtime_ms as ExplanationRuntime | undefined;
  if (!iou && !st && !rt) return null;
  const pert = st?.spearman_original_vs_perturbed ? Object.entries(st.spearman_original_vs_perturbed) : [];
  const t5 = iou?.top_5pct;
  const ratio = t5 && isNum(t5.random) && t5.random > 0 ? [t5.cnn, t5.vit].filter(isNum).map((x) => x / t5.random!) : [];
  const worst = pert.flatMap(([k, v]) => [["CNN", k, v.cnn], ["ViT", k, v.vit]] as const).filter(([, , x]) => isNum(x)).sort((a, b) => (a[2] as number) - (b[2] as number))[0];
  const parts: string[] = [];
  if (ratio.length) parts.push(`the brightest 5% of the maps overlap lesions ${ratio.map((r) => `${r.toFixed(1)}×`).join(" and ")} more than random pixels (CNN${ratio.length > 1 ? ", ViT" : ""})`);
  if (worst) parts.push(`maps change most under ${String(worst[1]).replace(/_/g, " ")} (${worst[0]} Spearman ${f2(worst[2] as number)})`);
  const bar = (v: number | undefined, max: number, color: string) => (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full" style={{ width: `${isNum(v) ? Math.min(100, (v / max) * 100) : 0}%`, background: color }} /></div>
  );
  const maxIoU = Math.max(0.05, ...[iou?.top_5pct, iou?.top_10pct].flatMap((x) => [x?.cnn, x?.vit, x?.random]).filter(isNum));
  return (
    <div className="mt-5 space-y-5 border-t border-white/[0.08] pt-4 md:mt-0 md:border-t-0 md:pt-0">
      <p className="rounded-[12px] bg-white/[0.04] px-3 py-2 text-[13px] leading-snug text-white/80"><span className="font-semibold text-white">How to read this: </span>Overlap (IoU) compares the brightest part of each attention map with the lesion masks; grey is random pixels. Stability is the rank correlation between maps before and after a small change to the photo (1.0 = unchanged).</p>
      {iou && (
        <div>
          <div className="mb-2 text-eyebrow uppercase text-l2">Overlap with lesions (IoU){iou.dataset ? ` · ${iou.dataset}` : ""}</div>
          {([["top_5pct", "Top 5%"], ["top_10pct", "Top 10%"]] as const).map(([k, label]) => iou[k] && (
            <div key={k} className="mb-2 space-y-1">
              <div className="text-[12px] text-l2">{label} of map pixels</div>
              {([["cnn", "CNN", "#fff"], ["vit", "ViT", "rgba(255,255,255,0.7)"], ["random", "Random", "rgba(255,255,255,0.3)"]] as const).map(([m, ml, col]) => (
                <div key={m} className="flex items-center gap-3 text-[12px]"><span className="w-14 text-l2">{ml}</span>{bar(iou[k]![m], maxIoU, col)}<span className="num w-10 text-right">{f2(iou[k]![m])}</span></div>
              ))}
            </div>
          ))}
        </div>
      )}
      {pert.length > 0 && (
        <div>
          <div className="mb-2 text-eyebrow uppercase text-l2">Stability (Spearman){st?.dataset ? ` · ${st.dataset}` : ""}</div>
          <table className="num w-full text-[13px]">
            <thead><tr className="text-left text-[12px] text-l2"><th className="py-1 font-medium">Change to the photo</th><th className="py-1 text-right font-medium">CNN</th><th className="py-1 text-right font-medium">ViT</th></tr></thead>
            <tbody>{pert.map(([k, v]) => <tr key={k} className="border-t border-sep/60" style={{ borderTopWidth: 0.5 }}><td className="py-1.5 text-l2">{k.replace(/_/g, " ")}</td><td className="py-1.5 text-right">{f2(v.cnn)}</td><td className="py-1.5 text-right">{f2(v.vit)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {rt && (isNum(rt.grader_cnn) || isNum(rt.grader_vit)) && (
        <div className="grid grid-cols-2 gap-3">
          <Big label="Map time · CNN" v={isNum(rt.grader_cnn) ? `${Math.round(rt.grader_cnn)} ms` : "–"} />
          <Big label="Map time · ViT" v={isNum(rt.grader_vit) ? `${Math.round(rt.grader_vit)} ms` : "–"} />
          {rt.note && <div className="col-span-2 text-[12px] text-l2">{rt.note}</div>}
        </div>
      )}
      {(iou?.note || st?.note) && <div className="text-[12px] text-l2">{[iou?.note, st?.note].filter(Boolean).join(" ")}</div>}
      {parts.length > 0 && <p className="border-t border-white/[0.08] pt-3 text-[14px] font-medium leading-snug text-white">{parts[0][0].toUpperCase() + parts[0].slice(1)}{parts[1] ? `; ${parts[1]}` : ""}.</p>}
    </div>
  );
});

// ------------------------------------------------------------------ h) Smaller model test
export const QuantCard = memo(function QuantCard({ q }: { q: Quantization }) {
  const ratio = (a?: number, b?: number) => (isNum(a) && isNum(b) && b > 0 ? a / b : null);
  const smaller = ratio(q.size_mb?.fp32, q.size_mb?.int8);
  const faster = ratio(q.cpu_ms_per_image?.fp32, q.cpu_ms_per_image?.int8);
  const flips = q.decision_flips_at_t_refer;
  const verdict = q.accepted == null ? null : q.accepted
    ? `Accepted: ${isNum(flips) ? `${int(flips)} decision${flips === 1 ? "" : "s"} changed at the referral threshold` : "decisions unchanged"}.`
    : `Rejected: ${isNum(flips) && flips > 0 ? `${int(flips)} decision${flips === 1 ? "" : "s"} changed at the referral threshold${isNum(q.n) ? ` (of ${int(q.n)} images)` : ""}` : "it did not meet the acceptance rule"}.`;
  const parts: string[] = [];
  if (smaller) parts.push(`${smaller.toFixed(1)}× smaller`);
  if (faster) parts.push(`${faster.toFixed(1)}× faster on CPU`);
  const ens = q.idrid_auroc_ensemble;
  const take = parts.length || verdict
    ? `INT8 ${q.model ? `${q.model.replace("grader_", "")} ` : ""}is ${parts.join(" and ") || "the compressed model"}${ens && isNum(ens.fp32) && isNum(ens.int8) ? `, ensemble AUROC ${f2(ens.int8)} vs ${f2(ens.fp32)}` : ""}${q.accepted === false ? `, but the app keeps full precision because individual decisions must not change${isNum(q.max_abs_diff_p_referable_ensemble) ? ` (P(referable) moved by up to ${f2(q.max_abs_diff_p_referable_ensemble)})` : ""}` : q.accepted ? ", so it can replace the full-precision model" : ""}.`
    : null;
  const pair = (label: string, a?: number, b?: number, unit = "", d = 0) => (
    <div className="rounded-[16px] bg-s2/60 p-3">
      <div className="text-[12px] text-l2">{label}</div>
      <div className="num mt-1 text-[18px] font-semibold">{isNum(a) ? `${a.toFixed(d)}${unit}` : "–"} <span className="text-l2">→</span> {isNum(b) ? `${b.toFixed(d)}${unit}` : "–"}</div>
    </div>
  );
  return (
    <Card title="Smaller model test" caption={`${q.method ?? "Quantisation"}${q.model ? ` · ${q.model}` : ""}${isNum(q.n) ? ` · IDRiD n = ${int(q.n)}` : ""}`}
      how="Left of each arrow is the full-precision model (FP32), right the 8-bit version (INT8). A smaller, faster model is only accepted if it keeps the app's referral decisions the same; a higher AUROC alone is not enough."
      takeaway={take}>
      <div className="grid grid-cols-2 gap-3">
        {pair("Size", q.size_mb?.fp32, q.size_mb?.int8, " MB")}
        {pair("CPU time per image", q.cpu_ms_per_image?.fp32, q.cpu_ms_per_image?.int8, " ms")}
        {pair("AUROC · ViT", q.idrid_auroc_vit?.fp32, q.idrid_auroc_vit?.int8, "", 3)}
        {pair("AUROC · ensemble", ens?.fp32, ens?.int8, "", 3)}
      </div>
      {verdict && (
        <div className="mt-3 rounded-full px-3 py-1.5 text-[13px] font-medium" style={{ background: q.accepted ? "rgba(48,209,88,0.14)" : "rgba(255,69,58,0.14)", color: q.accepted ? "#30D158" : "#FF6961" }}>{verdict}</div>
      )}
    </Card>
  );
});

// ------------------------------------------------------------------ i) Leakage check
export const Leakage = memo(function Leakage({ lc }: { lc: LeakageCheck }) {
  const rows = (["idrid", "ddr"] as const).filter((k) => lc[k]).map((k) => [k, lc[k]!] as [string, LeakageSet]);
  if (!rows.length) return null;
  const t = rows[0];
  return (
    <Card title="Leakage check" caption={lc.method}
      how="Some test photos were also used to train the lesion model, which the triage rules use. We removed them and re-ran the app. Small changes mean the overlap did not flatter the results."
      takeaway={isNum(t[1].overlapping_images) ? `Removing the ${int(t[1].overlapping_images)} overlapping ${setLabel(t[0])} images changes referable eyes cleared as ROUTINE from ${ofN(t[1].full_set?.referable_routed_routine, t[1].full_set?.referable_total)} to ${ofN(t[1].referable_routed_routine, t[1].referable_total)}.${lc.scope ? ` Scope: ${lc.scope}.` : ""}` : null}>
      <table className="num w-full text-[13px]">
        <thead><tr className="text-left text-[12px] text-l2"><th className="py-2 font-medium">Set</th><th className="py-2 text-right font-medium">Overlap removed</th><th className="py-2 text-right font-medium">Referable → ROUTINE</th><th className="py-2 text-right font-medium">Sent to a person</th></tr></thead>
        <tbody>
          {rows.map(([k, s]) => (
            <tr key={k} className="border-t border-sep/60 align-top" style={{ borderTopWidth: 0.5 }}>
              <td className="py-2 font-medium">{setLabel(k)}</td>
              <td className="py-2 text-right">{int(s.overlapping_images)}<div className="text-[11px] text-l2">{int(s.n_after_removal)} left</div></td>
              <td className="py-2 text-right">{ofN(s.referable_routed_routine, s.referable_total)}<div className="text-[11px] text-l2">all: {ofN(s.full_set?.referable_routed_routine, s.full_set?.referable_total)}</div></td>
              <td className="py-2 text-right">{p0(s.human_review_rate)}<div className="text-[11px] text-l2">all: {p0(s.full_set?.human_review_rate)}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
});

// ------------------------------------------------------------------ j) Where it fails
const CATS: { k: FailureCategory; title: string; line: string }[] = [
  { k: "missed_referable", title: "Missed", line: "The dataset says referable, Retinitry said ROUTINE. The costly mistake." },
  { k: "over_referral", title: "Over-referral", line: "The dataset says not referable, Retinitry said REFER. Costs a specialist visit." },
  { k: "abstained_healthy", title: "Handed to a person", line: "The dataset says healthy, Retinitry asked for human review. Costs clinician time." },
  { k: "wrong_retake", title: "Unneeded retake", line: "The dataset graded the photo, Retinitry asked for a new one." },
];
const reasonText = (r: string | Reason) => (typeof r === "string" ? r : r.text || r.code);
const gradeText = (c: FailureCase) => (c.dataset_grade == null ? "ungradable" : `grade ${c.dataset_grade}${c.dataset_grade_label ? ` · ${c.dataset_grade_label}` : ""}`);

export function FailureGallery() {
  const q = useFailures();
  const [open, setOpen] = useState<FailureCase | null>(null);
  const groups = useMemo(() => CATS.map((c) => ({ ...c, cases: (q.data?.cases ?? []).filter((x) => x.category === c.k) })).filter((g) => g.cases.length), [q.data]);
  const counts = q.data?.idrid_counts;
  const take = counts && Object.values(counts).some(isNum)
    ? `On IDRiD: ${CATS.filter((c) => isNum(counts[c.k])).map((c) => `${int(counts[c.k])} ${c.title.toLowerCase()}`).join(", ")}.`
    : null;
  return (
    <Card title="Where it fails" caption={q.data?.note ?? "Real test images where the app and the dataset label disagree."}
      how="Each card is one public test photo. The coloured pill is what Retinitry decided; the line under it is the dataset's own grade. Open a card for the reasons and the rules that fired."
      takeaway={q.data?.available ? take : null}>
      {q.isLoading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[260px] !rounded-[18px]" />)}</div>}
      {q.isError && <div className="py-6 text-center text-[14px] text-l2">The failure gallery could not be loaded.</div>}
      {q.data && (!q.data.available || !groups.length) && <div className="py-6 text-center text-[14px] text-l2">Failure gallery not generated yet.</div>}
      {q.data?.available && groups.map((g) => (
        <div key={g.k} className="mb-6 last:mb-0">
          <div className="flex flex-wrap items-baseline gap-x-3"><h4 className="text-headline">{g.title}</h4><span className="text-[13px] text-l2">{g.line}</span>{isNum(counts?.[g.k]) && <span className="num text-[12px] text-l2">IDRiD total {int(counts![g.k])}</span>}</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {g.cases.map((c) => (
              <button key={`${c.dataset}-${c.image_id}`} type="button" onClick={() => setOpen(c)} className="flex flex-col rounded-[18px] bg-s2/60 p-3 text-left transition-colors hover:bg-s2" aria-label={`${setLabel(c.dataset)} ${c.image_id}: details`}>
                <img src={assetUrl(c.image)} alt={`${setLabel(c.dataset)} ${c.image_id}`} loading="lazy" decoding="async" className="aspect-square w-full rounded-[14px] bg-black object-cover" />
                <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[12px] text-l2">{setLabel(c.dataset)} · {c.image_id}</span><span className="num text-[12px] text-l2">P {f2(c.p_referable)}</span></div>
                <div className="mt-1.5"><OutcomePill outcome={c.outcome} urgency={c.urgency ?? null} size="sm" /></div>
                <div className="mt-1 text-[12px] text-white/85">Dataset: {gradeText(c)}</div>
                {c.reasons?.[0] && <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-l2">{reasonText(c.reasons[0])}</div>}
                {!!c.fired_rules?.length && <div className="mt-1.5 flex flex-wrap gap-1">{c.fired_rules.slice(0, 3).map((r) => <span key={r} className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-l2">{r}</span>)}</div>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Sheet open={!!open} onClose={() => setOpen(null)} side="right" width={460} title={open ? `${setLabel(open.dataset)} · ${open.image_id}` : ""}>
        {open && <FailureDetail c={open} />}
      </Sheet>
    </Card>
  );
}

function FailureDetail({ c }: { c: FailureCase }) {
  const cat = CATS.find((x) => x.k === c.category);
  const kv: [string, string][] = [
    ["Dataset grade", gradeText(c)],
    ["Predicted grade", c.predicted_grade == null ? "–" : String(c.predicted_grade)],
    ["P(referable)", f2(c.p_referable, 3)],
    ["Photo quality", c.quality ?? "–"],
    ["Entropy", f2(c.uncertainty?.entropy, 3)],
    ["Grader disagreement", f2(c.uncertainty?.disagreement, 3)],
    ["Unfamiliarity (OOD)", f2(c.uncertainty?.ood_score, 3)],
  ];
  return (
    <div className="space-y-4">
      <img src={assetUrl(c.image)} alt={`${setLabel(c.dataset)} ${c.image_id}`} className="w-full rounded-[18px] bg-black object-contain" />
      <div className="flex flex-wrap items-center gap-2"><OutcomePill outcome={c.outcome} urgency={c.urgency ?? null} /><span className="text-[13px] text-l2">vs dataset {gradeText(c)}</span></div>
      {cat && <p className="text-[13px] leading-snug text-white/85"><span className="font-semibold">{cat.title}: </span>{cat.line}</p>}
      <dl className="space-y-1.5">{kv.map(([k, v]) => <div key={k} className="flex justify-between gap-3 text-[13px]"><dt className="text-l2">{k}</dt><dd className="num text-right">{v}</dd></div>)}</dl>
      {!!c.quality_reasons?.length && <div><div className="mb-1 text-eyebrow uppercase text-l2">Quality checks failed</div><div className="flex flex-wrap gap-1">{c.quality_reasons.map((r) => <span key={r} className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[12px] text-white/85">{flagLabel(r)}</span>)}</div></div>}
      {!!c.reasons?.length && <div><div className="mb-1 text-eyebrow uppercase text-l2">Reasons</div><ul className="space-y-1">{c.reasons.map((r, i) => <li key={i} className="text-[13px] leading-snug text-white/85">{reasonText(r)}</li>)}</ul></div>}
      {!!c.fired_rules?.length && <div><div className="mb-1 text-eyebrow uppercase text-l2">Rules that fired</div><div className="flex flex-wrap gap-1">{c.fired_rules.map((r) => <span key={r} className="num rounded-full bg-white/[0.08] px-2 py-0.5 text-[12px] text-white/85">{r}</span>)}</div></div>}
      {c.license && <div className="text-[12px] text-l2">{c.license}</div>}
    </div>
  );
}
