import { motion } from "framer-motion";
import { AlertTriangle, Clock, Eye as EyeIcon, Glasses, Layers, Crosshair } from "../components/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { assetUrl } from "../api/client";
import { useQueue } from "../api/hooks";
import type { EncounterSummary, Outcome } from "../api/types";
import { Odometer } from "../components/Odometer";
import { OutcomePill } from "../components/OutcomePill";
import { Page } from "../components/Page";
import { Ring } from "../components/Ring";
import { Segmented } from "../components/Segmented";
import { ErrorState, Skeleton } from "../components/Skeleton";
import { LargeTitle } from "../components/TopBar";
import { ago, flagLabel } from "../lib/format";
import { sound } from "../lib/sound";

type Filter = "all" | Outcome;

function FlagIcon({ code }: { code: string }) {
  const cls = "h-3.5 w-3.5";
  const I = code.startsWith("VA") ? Glasses : code === "MACULAR_RISK" ? Crosshair : code === "LATERALITY_MISMATCH" ? Layers : code.startsWith("EYE_MISSING") ? EyeIcon : AlertTriangle;
  return <span title={flagLabel(code)} aria-label={flagLabel(code)} className="grid h-6 w-6 place-items-center rounded-full bg-s2 text-review"><I className={cls} /></span>;
}

export default function Queue() {
  const q = useQueue();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [cursor, setCursor] = useState(0);
  const rows = useMemo(() => (q.data ?? []).filter((e) => filter === "all" || e.ai_outcome === filter), [q.data, filter]);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if (!rows.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(rows.length - 1, c + 1)); sound.tick(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); sound.tick(); }
      else if (e.key === "Enter") { e.preventDefault(); nav(`/case/${rows[cursor].id}`); }
      else if (e.key.toLowerCase() === "a" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); nav(`/case/${rows[cursor].id}?signoff=1`); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [rows, cursor, nav]);
  useEffect(() => { refs.current[cursor]?.scrollIntoView({ block: "nearest" }); }, [cursor]);
  useEffect(() => setCursor(0), [filter]);

  const count = (o: Outcome) => (q.data ?? []).filter((e) => e.ai_outcome === o).length;

  return (
    <Page>
      <LargeTitle right={<div className="text-[44px] font-semibold leading-none tracking-[-0.03em]"><Odometer value={rows.length} /></div>} sub="Sorted by priority. ↑ ↓ to move, Enter to open, A to sign off.">
        Queue
      </LargeTitle>
      <Segmented
        className="mb-6"
        ariaLabel="Filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: `All ${q.data?.length ?? ""}` },
          { value: "HUMAN_REVIEW", label: `Human review ${count("HUMAN_REVIEW")}` },
          { value: "REFER", label: `Refer ${count("REFER")}` },
          { value: "RETAKE", label: `Retake ${count("RETAKE")}` },
        ]}
      />
      {q.isLoading && <div className="space-y-px overflow-hidden rounded-card">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[72px] !rounded-none" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && rows.length === 0 && (
        <div className="flex flex-col items-center py-20">
          <Ring value={1} size={140} stroke={6} color="rgba(255,255,255,0.25)" head={false} />
          <div className="mt-6 text-title">Nothing needs you.</div>
          <div className="mt-1 text-body text-l2">{filter === "all" ? "Every analysed encounter is signed." : "No cases with this outcome."}</div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-card bg-s1" role="listbox" aria-label="Queue" aria-activedescendant={rows[cursor] ? `q-${rows[cursor].id}` : undefined}>
          {rows.map((e, i) => (
            <QueueRow key={e.id} e={e} i={i} active={i === cursor} refCb={(el) => (refs.current[i] = el)} onHover={() => setCursor(i)} onOpen={() => nav(`/case/${e.id}`)} />
          ))}
        </div>
      )}
    </Page>
  );
}

function QueueRow({ e, i, active, refCb, onHover, onOpen }: { e: EncounterSummary; i: number; active: boolean; refCb: (el: HTMLButtonElement | null) => void; onHover: () => void; onOpen: () => void }) {
  return (
    <motion.button
      ref={refCb}
      id={`q-${e.id}`}
      role="option"
      aria-selected={active}
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.03 }}
      onMouseEnter={onHover}
      onClick={onOpen}
      className={`relative flex w-full items-center gap-4 px-4 py-3 text-left transition-colors ${i > 0 ? "border-t border-sep/70" : ""} ${active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}
      style={{ borderTopWidth: i > 0 ? 0.5 : 0 }}
    >
      {active && <motion.span layoutId="qcur" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-white" />}
      {e.thumb ? <img src={assetUrl(e.thumb)} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" /> : <div className="hatch h-12 w-12 shrink-0 rounded-full bg-s2" />}
      <div className="min-w-0 flex-1">
        <div className="num truncate text-headline">{e.patient_code}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-footnote text-l2">
          <Clock className="h-3.5 w-3.5" /> waiting {ago(e.created_at)} · {e.n_images} image{e.n_images === 1 ? "" : "s"}
        </div>
      </div>
      <div className="flex gap-1">{e.flags.slice(0, 5).map((f) => <FlagIcon key={f} code={f} />)}</div>
      <OutcomePill outcome={e.ai_outcome} urgency={e.ai_urgency} />
    </motion.button>
  );
}
