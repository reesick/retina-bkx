import { useHealth, usePolicy } from "../api/hooks";
import { IS_MOCK } from "../api/client";
import { Group, Row } from "../components/GroupedList";
import { Page } from "../components/Page";
import { Segmented } from "../components/Segmented";
import { Skeleton } from "../components/Skeleton";
import { Switch } from "../components/Switch";
import { LargeTitle } from "../components/TopBar";
import { sound } from "../lib/sound";
import { useSettings, type Volume } from "../lib/store";

const THRESHOLDS: { k: string; label: string; d: number }[] = [
  { k: "t_refer", label: "Referable operating point", d: 3 },
  { k: "t_entropy", label: "Entropy", d: 3 },
  { k: "t_disagreement", label: "Disagreement", d: 3 },
  { k: "t_ood", label: "OOD distance", d: 1 },
];

export default function Settings() {
  const s = useSettings();
  const policy = usePolicy();
  const health = useHealth();
  const p = policy.data;
  return (
    <Page className="max-w-[720px]">
      <LargeTitle sub="Your name for sign-offs, sound and motion, how the 3D eye is drawn, and where every AI threshold came from. Changes save on this device straight away.">Settings</LargeTitle>
      <div className="space-y-8">
        <Group header="Reviewer">
          <Row label="Name" right={<input value={s.reviewer} onChange={(e) => s.set({ reviewer: e.target.value })} className="w-56 bg-transparent text-right text-[15px] text-l2 focus:text-white" placeholder="Your name" aria-label="Reviewer name" />} />
        </Group>

        <Group header="Feedback">
          <Row label="Sound" right={<Switch label="Sound" checked={s.sound} onChange={(v) => { s.set({ sound: v }); if (v) setTimeout(() => sound.tick(), 30); }} />} />
          <Row label="Volume" right={<Segmented size="sm" ariaLabel="Volume" value={s.volume} onChange={(v: Volume) => { s.set({ volume: v }); setTimeout(() => sound.success(), 30); }} options={[{ value: "soft", label: "Soft" }, { value: "balanced", label: "Balanced" }, { value: "strong", label: "Strong" }]} />} />
          <Row label="Reduced motion" right={<Switch label="Reduced motion" checked={s.reducedMotion} onChange={(v) => s.set({ reducedMotion: v })} />} />
        </Group>

        <Group header="Viewer" footer="Un-imaged retina is shown grey with a fine hatch on the 3D eye.">
          <Row label="Show un-imaged region" right={<Switch label="Show un-imaged region" checked={s.showUnimaged} onChange={(v) => s.set({ showUnimaged: v })} />} />
          <Row label="Default field of view" right={<Segmented size="sm" ariaLabel="Default FOV" value={String(s.defaultFov)} onChange={(v) => s.set({ defaultFov: Number(v) })} options={[{ value: "30", label: "30°" }, { value: "45", label: "45°" }, { value: "50", label: "50°" }, { value: "55", label: "55°" }]} />} />
        </Group>

        <Group header="Threshold provenance" footer={p ? `Policy ${p.version}. ${p.provenance.fitted_on ?? p.provenance.note ?? ""}` : undefined}>
          {policy.isLoading && <div className="p-4"><Skeleton className="h-24" /></div>}
          {policy.isError && <Row label="Policy unavailable" sub={(policy.error as Error).message} />}
          {p && THRESHOLDS.map((t) => {
            const v = p[t.k];
            return <Row key={t.k} label={t.label} sub={p.provenance[t.k]} value={typeof v === "number" ? v.toFixed(t.d) : "–"} />;
          })}
          {p?.provenance.never_used && <Row label="Never used for fitting" sub={p.provenance.never_used} />}
        </Group>

        <Group header="Data">
          <Row label="Audit log" to="/audit" />
          <Row label="Models" value={health.data ? `${Object.values(health.data.models).filter((m) => m.loaded).length} loaded${health.data.missing.length ? ` · ${health.data.missing.length} missing` : ""}` : "–"} />
        </Group>

        <Group header="About">
          <Row label="Retinitry" value={health.data?.version ?? "–"} />
          <Row label="Research prototype. Triage aid, not a diagnosis." sub="Clinician makes the final decision. Performance numbers come only from ml/eval." />
          {IS_MOCK && <Row label="Mock mode" sub="All data is invented by the in-browser mock API." />}
        </Group>
      </div>
      <p className="mt-6 text-center text-footnote text-l2">Everything stays on this device.</p>
    </Page>
  );
}
