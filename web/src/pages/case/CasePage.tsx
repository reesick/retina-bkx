import { motion } from "framer-motion";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, assetUrl, IS_MOCK } from "../../api/client";
import { useEncounter } from "../../api/hooks";
import { subscribeProgress } from "../../api/sse";
import type { Eye } from "../../api/types";
import { FileText, Seal } from "../../components/icons";
import { OutcomePill } from "../../components/OutcomePill";
import { Page } from "../../components/Page";
import { Segmented } from "../../components/Segmented";
import { ErrorState, Skeleton } from "../../components/Skeleton";
import { outcomeColor, shortTime } from "../../lib/format";
import { useUI } from "../../lib/store";
import { ConfidenceCard, DoubtCard, LesionsCard, OutcomeCard, QualityCard, ReceiptCard, SafeguardsCard } from "./DecisionPanel";
import { SignOff } from "./SignOff";
import { defaultLayers, Viewer2D, type ViewerLayers } from "./Viewer2D";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "../../api/hooks";
import { markDeterminismVerified } from "../../lib/session";

const CaseEye = lazy(() => import("../../three/CaseEye"));

export default function CasePage() {
  const { encId = "" } = useParams();
  const loc = useLocation();
  const q = useEncounter(encId);
  const qc = useQueryClient();
  const enc = q.data;
  const toast = useUI((s) => s.toast);
  const selected = useUI((s) => s.selectedLesion);
  const select = useUI((s) => s.selectLesion);
  const [eye, setEye] = useState<Eye>("OD");
  const [imgId, setImgId] = useState<string | null>(null);
  const [layers, setLayers] = useState<ViewerLayers>(defaultLayers);
  const signRef = useRef<HTMLDivElement>(null);
  const wantSign = new URLSearchParams(loc.search).has("signoff");

  // default to the first eye that has images
  useEffect(() => {
    if (!enc) return;
    if (!enc.images.some((i) => i.eye === eye)) {
      const e = enc.images[0]?.eye;
      if (e) setEye(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enc?.id]);
  useEffect(() => () => select(null), [select]);
  useEffect(() => {
    if (wantSign && enc) setTimeout(() => signRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
  }, [wantSign, enc]);

  // images still analysing: follow their streams and refresh when done
  useEffect(() => {
    if (!enc) return;
    const pending = enc.images.filter((i) => i.status === "queued" || i.status === "running");
    const uns = pending.map((i) => subscribeProgress(i.id, (ev) => { if (ev.type !== "step") void qc.invalidateQueries({ queryKey: qk.encounter(encId) }); }));
    return () => uns.forEach((u) => u());
  }, [enc, encId, qc]);

  const eyeImages = useMemo(() => (enc?.images ?? []).filter((i) => i.eye === eye), [enc, eye]);
  const image = eyeImages.find((i) => i.id === imgId) ?? eyeImages[0];
  const selLesion = image?.lesions?.items.find((l) => l.id === selected) ?? null;

  if (q.isError) return <Page><ErrorState error={q.error} onRetry={() => void q.refetch()} title="Could not load this case" /></Page>;
  if (!enc) return <CaseSkeleton />;

  const ai = enc.ai;
  const rv = enc.review;
  const layer3d = {
    cam: layers.on.cam ? layers.opacity.cam : 0,
    att: layers.on.att ? layers.opacity.att : 0,
    les: layers.on.les ? layers.opacity.les : 0,
  };

  return (
    <Page wide>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="num text-title-xl">{enc.patient_code}</h1>
            {rv && (
              <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 14, delay: 0.3 }} title={`Signed by ${rv.reviewer}`}>
                <Seal className="h-8 w-8" style={{ color: outcomeColor(rv.final_outcome, rv.final_urgency) }} />
              </motion.span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-body text-l2">
            <span>{[enc.age != null ? `${enc.age} y` : null, enc.sex, enc.diabetes_years != null ? `diabetes ${enc.diabetes_years} y` : null].filter(Boolean).join(" · ") || "No demographics"}</span>
            <span className="text-l3">·</span>
            <span>{shortTime(enc.created_at)}</span>
            <span className="text-l3">·</span>
            <OutcomePill outcome={ai?.outcome} urgency={ai?.urgency} prefix="AI" size="sm" />
            {rv && <OutcomePill outcome={rv.final_outcome} urgency={rv.final_urgency} prefix="Final" size="sm" />}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Segmented ariaLabel="Eye" value={eye} onChange={(v) => { setEye(v); setImgId(null); select(null); }} options={[{ value: "OD", label: "OD · right", disabled: !enc.images.some((i) => i.eye === "OD") }, { value: "OS", label: "OS · left", disabled: !enc.images.some((i) => i.eye === "OS") }]} />
          <div className="flex gap-2">
            {eyeImages.map((i) => (
              <button key={i.id} type="button" onClick={() => { setImgId(i.id); select(null); }} className="relative h-11 w-11 overflow-hidden rounded-full" style={{ boxShadow: image?.id === i.id ? "0 0 0 2px #fff" : "0 0 0 1px rgba(255,255,255,0.15)" }} aria-label={`${i.eye} ${i.view} image`} title={`${i.view} · ${i.status}`}>
                <img src={assetUrl(i.urls.canonical)} alt="" className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[8px] font-semibold uppercase">{i.view}</span>
              </button>
            ))}
          </div>
          <a
            href={IS_MOCK ? undefined : api.reportUrl(enc.id)}
            onClick={(e) => { if (IS_MOCK) { e.preventDefault(); toast({ text: "PDF reports are produced by the local server (not available in mock mode).", tone: "info" }); } }}
            target="_blank" rel="noreferrer" className="btn-ghost"
          >
            <FileText className="h-4 w-4" /> Report
          </a>
        </div>
      </header>

      {!image ? (
        <div className="card p-8 text-center text-l2">No image for this eye. <Link to="/screen/new" className="underline">Start a new screening</Link>.</div>
      ) : image.status !== "done" ? (
        <div className="card flex items-center gap-4 p-6">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <div>
            <div className="text-headline">{image.status === "error" ? "Analysis failed" : "Analysing…"}</div>
            <div className="text-footnote text-l2">{image.error ?? "This page updates when the result is ready."}</div>
          </div>
          <Link to={`/screen/${enc.id}/analyse`} className="btn-ghost ml-auto">Watch</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_420px] lg:grid-cols-2">
          <div><Viewer2D image={image} layers={layers} setLayers={(f) => setLayers(f)} selected={selected} onSelect={select} /></div>
          <div className="xl:sticky xl:top-6 xl:self-start">
            <Suspense fallback={<Skeleton className="aspect-square w-full !rounded-card" />}>
              <CaseEye className="aspect-square w-full" image={image} layers={layer3d} selected={selLesion} onSelect={select} />
            </Suspense>
          </div>
          <aside className="flex flex-col gap-4 lg:col-span-2 xl:col-span-1">
            <OutcomeCard enc={enc} image={image} />
            <ConfidenceCard image={image} />
            <DoubtCard image={image} />
            <QualityCard image={image} />
            <SafeguardsCard enc={enc} image={image} />
            <LesionsCard image={image} selected={selected} onSelect={select} />
            <ReceiptCard image={image} onVerified={markDeterminismVerified} />
            <div className="sticky bottom-24 z-10">
              <SignOff ref={signRef} enc={enc} autoFocus={wantSign} />
            </div>
          </aside>
        </div>
      )}
    </Page>
  );
}

function CaseSkeleton() {
  return (
    <Page wide>
      <Skeleton className="mb-3 h-10 w-64" />
      <Skeleton className="mb-6 h-5 w-96" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr_420px]">
        <Skeleton className="aspect-square w-full !rounded-card" />
        <Skeleton className="aspect-square w-full !rounded-card" />
        <div className="space-y-4"><Skeleton className="h-56 !rounded-card" /><Skeleton className="h-48 !rounded-card" /><Skeleton className="h-40 !rounded-card" /></div>
      </div>
    </Page>
  );
}
