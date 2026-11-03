import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Play, Seal } from "../components/icons";
import { lazy, Suspense, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api, assetUrl } from "../api/client";
import { useDemoCases, useEncounters, useHealth, useReferrals, useStats } from "../api/hooks";
import type { EncounterSummary } from "../api/types";
import { Odometer } from "../components/Odometer";
import { OutcomePill } from "../components/OutcomePill";
import { Page } from "../components/Page";
import { Ring } from "../components/Ring";
import { Skeleton } from "../components/Skeleton";
import { SPRING } from "../components/motion";
import { ago } from "../lib/format";
import { sound } from "../lib/sound";
import { useUI } from "../lib/store";
import { useRouteActive } from "../lib/route";
import { ScrollStrip } from "../components/ScrollStrip";
import { DemoButton } from "../components/DemoButton";

const LivingEye = lazy(() => import("../three/LivingEye"));

export default function Today() {
  const nav = useNavigate();
  const eyeActive = useRouteActive((p) => p === "/");
  const stats = useStats();
  const health = useHealth();
  const recent = useEncounters({ limit: 200 });
  const refs = useReferrals();
  const demos = useDemoCases();
  const toast = useUI((s) => s.toast);
  const week = (recent.data ?? []).filter((e) => Date.now() - new Date(e.created_at).getTime() < 7 * 86400000).length;
  const awaiting = stats.data?.awaiting_review ?? 0;
  const startDemo = useMutation({
    mutationFn: (name: string) => api.startDemo(name),
    onSuccess: (e) => nav(`/screen/${e.id}/analyse`),
    onError: (e) => { sound.fail(); toast({ text: e instanceof Error ? e.message : "Demo failed", tone: "error" }); },
  });

  return (
    <Page wide>
      {health.data && health.data.missing.length > 0 && (
        <div role="status" className="mb-6 flex items-center gap-3 rounded-full bg-s1 px-4 py-2.5 text-[14px] text-l2">
          <AlertTriangle className="h-4 w-4 text-review" />
          Models not installed. Run <code className="rounded bg-s2 px-1.5 py-0.5 text-[13px] text-white">scripts/fetch_and_train</code>
          <span className="text-l3">({health.data.missing.join(", ")})</span>
        </div>
      )}
      <section className="grid min-h-[560px] grid-cols-1 items-center gap-6 lg:grid-cols-2">
        <div className="flex flex-col items-center text-center lg:items-start lg:pl-[6%] lg:text-left">
          {stats.isLoading ? (
            <Skeleton className="h-[150px] w-[220px]" />
          ) : (
            <div className="text-display font-semibold tracking-[-0.045em]">
              <Odometer value={stats.data?.screened_today ?? 0} />
            </div>
          )}
          <div className="mt-4 text-eyebrow uppercase text-l2" style={{ letterSpacing: "0.38em" }}>Screened today</div>
          <div className="mt-6 text-headline">+{week} this week</div>
          <div className="mt-1 text-body">
            {awaiting > 0 ? (
              <Link to="/queue" className="text-review hover:underline">{awaiting} need{awaiting === 1 ? "s" : ""} you</Link>
            ) : (
              <span className="text-l2">Nothing waiting for review.</span>
            )}
          </div>
          <BeginButton onClick={() => nav("/screen/new")} />
          <p className="mt-6 max-w-[380px] text-[14px] leading-snug text-l2">This is today at a glance. Begin a screening with photos of both eyes, open the cases that need you, or try a demo case below.</p>
        </div>
        <div className="relative h-[520px] lg:h-[640px]">
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05), transparent 45%)" }} />
          {eyeActive && (
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center"><Skeleton round className="h-64 w-64" /></div>}>
              <LivingEye className="absolute inset-0" onActivate={() => nav("/lab")} />
            </Suspense>
          )}
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-footnote text-l2">Hover the eye, then click it to open the Eye Lab</div>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Awaiting review" hint="Cases waiting for a clinician" value={stats.data?.awaiting_review} tone={awaiting > 0 ? "#FFD60A" : undefined} to="/queue" loading={stats.isLoading} />
        <Tile label="Referred today" hint="Sent to a specialist" value={stats.data?.referred_today} to="/referrals" loading={stats.isLoading} />
        <Tile label="Retakes today" hint="Photos too poor to read" value={stats.data?.retake_today} loading={stats.isLoading} />
        <div className="card flex items-center gap-4 p-5">
          <Ring value={refs.data?.stats.completed_rate ?? 0} size={72} stroke={6} color="#30D158">
            <span className="num text-[15px] font-semibold"><Odometer value={Math.round((refs.data?.stats.completed_rate ?? 0) * 100)} suffix="%" /></span>
          </Ring>
          <div>
            <div className="text-headline">Referral completion</div>
            <div className="text-footnote text-l2">{refs.data ? (refs.data.stats.total ? `${refs.data.stats.total} referral${refs.data.stats.total === 1 ? "" : "s"}; share attended or later` : "No referrals yet") : "–"}</div>
          </div>
        </div>
      </section>

      <ScrollStrip
        className="mt-10"
        label="Recent screenings"
        header={<><h2 className="text-title">Recent</h2><p className="text-footnote text-l2">The latest screenings on this device. Open one to see the AI's reasoning.</p></>}
        right={<Link to="/queue" className="link mr-2 text-[14px]">Open queue <ArrowRight className="inline h-3.5 w-3.5" /></Link>}
      >
        {recent.isLoading && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[184px] w-[168px] shrink-0 !rounded-card" />)}
        {recent.isError && <div className="text-l2">Could not load recent encounters.</div>}
        {recent.data?.length === 0 && (
          <div className="card flex w-full flex-col items-start gap-3 p-6">
            <div className="text-headline">No screenings yet</div>
            <p className="text-body text-l2">Screenings you run appear here. Start one with photos of both eyes, or try a bundled demo case below.</p>
            <div className="flex gap-2"><Link to="/screen/new" className="btn-white">Start a screening</Link><DemoButton name="refer-soon" className="btn-ghost" /></div>
          </div>
        )}
        {recent.data?.slice(0, 14).map((e, i) => <RecentCard key={e.id} e={e} i={i} />)}
      </ScrollStrip>

      <ScrollStrip
        className="mt-10"
        label="Demo cases"
        header={<><h2 className="text-title">Try a demo case</h2><p className="text-footnote text-l2">Bundled public-dataset images with attribution. Each starts a real analysis on this device.</p></>}
      >
          {demos.isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[108px] w-[320px] shrink-0 !rounded-card" />)}
          {demos.isError && <div className="text-l2">Demo cases unavailable.</div>}
          {demos.data?.length === 0 && <div className="text-l2">No demo cases are bundled with this install.</div>}
          {demos.data?.map((d) => (
            <motion.button
              key={d.name}
              type="button"
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              transition={SPRING}
              disabled={startDemo.isPending}
              onClick={() => startDemo.mutate(d.name)}
              className="card flex w-[340px] shrink-0 items-center gap-4 p-4 text-left transition-colors hover:bg-[#232325] disabled:opacity-50"
              title={startDemo.isPending ? "Another demo is starting…" : `${d.source} · ${d.license}`}
            >
              <img src={assetUrl(d.thumb)} alt="" className="h-[76px] w-[76px] shrink-0 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <div className="text-headline leading-snug">{d.title}</div>
                <div className="line-clamp-2 text-footnote text-l2">{d.description}</div>
                <div className="mt-1 text-[11px] text-l2">{d.eye} · {d.view} · {d.license}</div>
              </div>
              {startDemo.isPending && startDemo.variables === d.name ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Play className="h-5 w-5 text-l2" />
              )}
            </motion.button>
          ))}
      </ScrollStrip>
    </Page>
  );
}

function BeginButton({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <motion.button
      type="button"
      onClick={() => { sound.tick(); onClick(); }}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      animate={{ scale: hover ? 1.08 : 1 }}
      whileTap={{ scale: 0.96 }}
      transition={SPRING}
      className="relative mt-12 grid h-[168px] w-[168px] place-items-center rounded-full"
      aria-label="Begin screening"
    >
      <span aria-hidden className="absolute -inset-16 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.09), transparent 62%)" }} />
      <span aria-hidden className="absolute inset-0 rounded-full" style={{ boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.14)" }} />
      <span aria-hidden className="absolute inset-[12px] rounded-full" style={{ background: "radial-gradient(circle at 50% 30%, #3a3a3c, #1c1c1e 70%)", boxShadow: hover ? "0 0 60px rgba(255,255,255,0.18)" : "0 0 30px rgba(255,255,255,0.06)" }} />
      <span className="relative text-center text-[13px] font-semibold uppercase leading-[1.4] tracking-[0.2em]">Begin<br />screening</span>
    </motion.button>
  );
}

function Tile({ label, hint, value, tone, to, loading }: { label: string; hint?: string; value: number | undefined; tone?: string; to?: string; loading?: boolean }) {
  const inner = (
    <>
      {loading ? <Skeleton className="h-10 w-16" /> : <div className="text-[44px] font-semibold leading-none tracking-[-0.03em]" style={{ color: tone }}><Odometer value={value ?? 0} /></div>}
      <div className="mt-3 flex items-center gap-1 text-[15px] text-white/85">{label}{to && <ArrowRight className="h-3.5 w-3.5 text-l2" />}</div>
      {hint && <div className="text-footnote text-l2">{hint}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="card block p-5 transition-colors hover:bg-[#232325] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">{inner}</Link>
  ) : (
    <div className="card p-5">{inner}</div>
  );
}

function RecentCard({ e, i }: { e: EncounterSummary; i: number }) {
  const signed = e.status === "signed";
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
      <Link to={`/case/${e.id}`} className="card flex w-[168px] shrink-0 flex-col items-center p-4 text-center transition-colors hover:bg-[#232325]">
        <div className="relative">
          {e.thumb ? <img src={assetUrl(e.thumb)} alt="" className="h-[84px] w-[84px] rounded-full object-cover" /> : <div className="hatch h-[84px] w-[84px] rounded-full bg-s2" />}
          {signed && <Seal className="absolute -right-1 -top-1 h-6 w-6 rounded-full bg-black p-0.5 text-routine" />}
        </div>
        <div className="num mt-3 w-full break-all text-[13px] font-semibold leading-tight" title={e.patient_code}>{e.patient_code}</div>
        <div className="mb-2 text-[11px] text-l2">{ago(e.created_at)} ago</div>
        <OutcomePill outcome={e.final_outcome ?? e.ai_outcome} urgency={e.ai_urgency} size="sm" />
      </Link>
    </motion.div>
  );
}
