import { LayoutGroup, motion } from "framer-motion";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMoveReferral, useReferrals } from "../api/hooks";
import type { ReferralStatus, ReferralUpdate, ReferralWithPatient } from "../api/types";
import { Calendar, MapPin, MessageSquare } from "../components/icons";
import { Odometer } from "../components/Odometer";
import { Page } from "../components/Page";
import { Ring } from "../components/Ring";
import { Sheet } from "../components/Sheet";
import { ErrorState, Skeleton } from "../components/Skeleton";
import { LargeTitle } from "../components/TopBar";
import { ago, REFERRAL_COLUMNS, REFERRAL_LABEL, referralMoveAllowed, shortDate, shortTime, urgencyLabel, URGENT } from "../lib/format";
import { sound } from "../lib/sound";
import { useUI } from "../lib/store";

const COLS: ReferralStatus[] = [...REFERRAL_COLUMNS, "not_completed"];
const isoIn = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

export default function Referrals() {
  const q = useReferrals();
  const move = useMoveReferral();
  const toast = useUI((s) => s.toast);
  const colRefs = useRef<Partial<Record<ReferralStatus, HTMLDivElement | null>>>({});
  const [open, setOpen] = useState<ReferralWithPatient | null>(null);
  const [pending, setPending] = useState<{ r: ReferralWithPatient; to: ReferralStatus } | null>(null);
  const [hot, setHot] = useState<ReferralStatus | null>(null);
  const items = q.data?.items ?? [];
  const s = q.data?.stats;

  const colAt = (x: number, y: number): ReferralStatus | null => {
    for (const c of COLS) {
      const el = colRefs.current[c];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return c;
    }
    return null;
  };

  const commit = (r: ReferralWithPatient, b: ReferralUpdate) => {
    move.mutate({ id: r.id, ...b }, {
      onSuccess: () => { sound.lowTick(); toast({ text: `${r.patient_code} → ${REFERRAL_LABEL[b.to]}`, tone: "ok" }); },
      onError: (x) => { sound.fail(); toast({ text: x instanceof Error ? x.message : "Move failed", tone: "error" }); },
    });
  };

  const drop = (r: ReferralWithPatient, to: ReferralStatus | null) => {
    setHot(null);
    if (!to || to === r.status) return;
    if (!referralMoveAllowed(r.status, to)) {
      sound.fail();
      toast({ text: `Not allowed: ${REFERRAL_LABEL[r.status]} → ${REFERRAL_LABEL[to]}. Steps go one at a time.`, tone: "error" });
      return;
    }
    if (to === "scheduled" || to === "feedback" || to === "not_completed") setPending({ r, to });
    else commit(r, { to, note: "", ...(to === "attended" ? { attended_at: new Date().toISOString() } : {}) });
  };

  return (
    <Page wide>
      <LargeTitle sub="From issued to closed. Drag a card one step to the right.">Referrals</LargeTitle>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card flex items-center gap-4 p-5">
          <Ring value={s?.completed_rate ?? 0} size={84} stroke={7} color="#30D158">
            <span className="num text-[18px] font-semibold"><Odometer value={Math.round((s?.completed_rate ?? 0) * 100)} suffix="%" /></span>
          </Ring>
          <div><div className="text-headline">Completion</div><div className="text-footnote text-l2">attended or later</div></div>
        </div>
        <StatTile label="Median days to attendance" value={s?.median_days_to_attend ?? null} decimals={1} loading={q.isLoading} />
        <StatTile label="Overdue" value={s?.overdue ?? null} tone={(s?.overdue ?? 0) > 0 ? URGENT : undefined} loading={q.isLoading} />
        <StatTile label="Feedback received" value={s ? Math.round(s.with_feedback_rate * 100) : null} suffix="%" loading={q.isLoading} />
      </section>

      {q.isError && <div className="mt-6"><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>}
      <LayoutGroup>
        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {COLS.map((c) => {
            const list = items.filter((r) => r.status === c);
            const tray = c === "not_completed";
            return (
              <div
                key={c}
                ref={(el) => (colRefs.current[c] = el)}
                className={`min-h-[360px] rounded-card p-3 transition-colors ${tray ? "bg-[#140b0b]" : "bg-s1"}`}
                style={{ boxShadow: hot === c ? "inset 0 0 0 1.5px rgba(255,255,255,0.6)" : tray ? "inset 0 0 0 0.5px rgba(255,69,58,0.25)" : "none" }}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className={`text-eyebrow uppercase ${tray ? "text-urgent/80" : "text-l2"}`}>{REFERRAL_LABEL[c]}</span>
                  <span className="num text-[13px] text-l3">{list.length}</span>
                </div>
                <div className="space-y-2">
                  {q.isLoading && <Skeleton className="h-20 !rounded-[16px]" />}
                  {list.map((r) => (
                    <Card key={r.id} r={r} onOpen={() => setOpen(r)} onDragOver={(x, y) => setHot(colAt(x, y))} onDrop={(x, y) => drop(r, colAt(x, y))} />
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </LayoutGroup>

      <MoveSheet pending={pending} onClose={() => setPending(null)} onConfirm={(b) => { if (pending) commit(pending.r, b); setPending(null); }} />
      <Sheet open={!!open} onClose={() => setOpen(null)} side="right" title={open ? <span className="num">{open.patient_code}</span> : ""}>
        {open && <Detail r={items.find((x) => x.id === open.id) ?? open} />}
      </Sheet>
    </Page>
  );
}

function StatTile({ label, value, decimals = 0, suffix = "", tone, loading }: { label: string; value: number | null; decimals?: number; suffix?: string; tone?: string; loading?: boolean }) {
  return (
    <div className="card p-5">
      {loading ? <Skeleton className="h-10 w-20" /> : <div className="text-[44px] font-semibold leading-none tracking-[-0.03em]" style={{ color: tone }}>{value == null ? "–" : <Odometer value={value} decimals={decimals} suffix={suffix} />}</div>}
      <div className="mt-3 text-[15px] text-l2">{label}</div>
    </div>
  );
}

function Card({ r, onOpen, onDrop, onDragOver }: { r: ReferralWithPatient; onOpen: () => void; onDrop: (x: number, y: number) => void; onDragOver: (x: number, y: number) => void }) {
  const overdue = (r.appointment_at && new Date(r.appointment_at).getTime() < Date.now() && !r.attended_at && !["closed", "not_completed"].includes(r.status)) ||
    (r.status === "issued" && Date.now() - new Date(r.issued_at).getTime() > 30 * 86400000);
  const imm = r.priority === "immediate";
  return (
    <motion.div
      layout
      layoutId={r.id}
      drag
      dragSnapToOrigin
      dragElastic={0.2}
      dragTransition={{ bounceStiffness: 380, bounceDamping: 26 }}
      whileDrag={{ scale: 1.05, rotate: -2, zIndex: 50, boxShadow: "0 20px 50px rgba(0,0,0,0.6)" }}
      onDrag={(_, i) => onDragOver(i.point.x - window.scrollX, i.point.y - window.scrollY)}
      onDragEnd={(_, i) => onDrop(i.point.x - window.scrollX, i.point.y - window.scrollY)}
      onTap={onOpen}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className="relative cursor-grab touch-none rounded-[16px] bg-s2 p-3 active:cursor-grabbing"
      tabIndex={0}
      role="button"
      aria-label={`Referral ${r.patient_code}, ${REFERRAL_LABEL[r.status]}`}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="num truncate text-[14px] font-semibold">{r.patient_code}</span>
        {imm && <span className="h-2 w-2 shrink-0 rounded-full bg-urgent shadow-[0_0_8px_#FF453A]" title="Immediate" />}
      </div>
      <div className="mt-1 text-[12px] text-l2">{urgencyLabel(r.priority) || "–"}</div>
      <div className="mt-1 text-[11px] text-l3">issued {ago(r.issued_at)} ago{r.appointment_at ? ` · appt ${shortDate(r.appointment_at)}` : ""}</div>
      {overdue && <div className="mt-1.5 inline-block rounded-full bg-urgent/15 px-2 py-0.5 text-[11px] font-semibold text-urgent">Overdue</div>}
    </motion.div>
  );
}

function MoveSheet({ pending, onClose, onConfirm }: { pending: { r: ReferralWithPatient; to: ReferralStatus } | null; onClose: () => void; onConfirm: (b: ReferralUpdate) => void }) {
  const [facility, setFacility] = useState("District Eye Hospital, Retina clinic");
  const [date, setDate] = useState(isoIn(7));
  const [text, setText] = useState("");
  const [follow, setFollow] = useState(isoIn(180));
  const to = pending?.to;
  const valid = to === "scheduled" ? !!facility && !!date : to === "not_completed" || to === "feedback" ? !!text.trim() : true;
  return (
    <Sheet open={!!pending} onClose={onClose} title={to ? `Move to ${REFERRAL_LABEL[to]}` : ""}>
      <div className="space-y-4">
        {to === "scheduled" && (
          <>
            <label className="block"><span className="mb-1.5 block text-[13px] text-l2">Facility</span><input className="input" value={facility} onChange={(e) => setFacility(e.target.value)} /></label>
            <label className="block"><span className="mb-1.5 block text-[13px] text-l2">Appointment date</span><input type="date" className="input num" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </>
        )}
        {to === "feedback" && (
          <>
            <label className="block"><span className="mb-1.5 block text-[13px] text-l2">Specialist feedback</span><textarea className="input h-24 resize-none py-2.5" value={text} onChange={(e) => setText(e.target.value)} /></label>
            <label className="block"><span className="mb-1.5 block text-[13px] text-l2">Next follow-up</span><input type="date" className="input num" value={follow} onChange={(e) => setFollow(e.target.value)} /></label>
          </>
        )}
        {to === "not_completed" && (
          <label className="block"><span className="mb-1.5 block text-[13px] text-l2">Reason (required)</span><textarea className="input h-24 resize-none py-2.5" value={text} onChange={(e) => setText(e.target.value)} placeholder="Why the referral could not be completed" /></label>
        )}
        <button
          type="button"
          className="btn-white w-full"
          disabled={!valid}
          onClick={() => {
            if (!to) return;
            const b: ReferralUpdate = { to, note: text.trim() };
            if (to === "scheduled") { b.facility = facility; b.appointment_at = new Date(date).toISOString(); }
            if (to === "feedback") { b.feedback = text.trim(); b.next_followup_at = new Date(follow).toISOString(); }
            if (to === "not_completed") b.not_completed_reason = text.trim();
            setText("");
            onConfirm(b);
          }}
        >
          Confirm
        </button>
      </div>
    </Sheet>
  );
}

function Detail({ r }: { r: ReferralWithPatient }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold">{REFERRAL_LABEL[r.status]}</span>
        <span className="text-[13px]" style={{ color: r.priority === "immediate" ? URGENT : "#FF9F0A" }}>{urgencyLabel(r.priority)}</span>
      </div>
      <dl className="space-y-2 text-[14px]">
        <F icon={<MapPin className="h-4 w-4" />} k="Facility" v={r.facility ?? "–"} />
        <F icon={<Calendar className="h-4 w-4" />} k="Appointment" v={shortDate(r.appointment_at)} />
        <F icon={<Calendar className="h-4 w-4" />} k="Attended" v={shortDate(r.attended_at)} />
        <F icon={<MessageSquare className="h-4 w-4" />} k="Feedback" v={r.feedback ?? "–"} />
        <F icon={<Calendar className="h-4 w-4" />} k="Next follow-up" v={shortDate(r.next_followup_at)} />
        {r.not_completed_reason && <F icon={<MessageSquare className="h-4 w-4" />} k="Not completed" v={r.not_completed_reason} />}
      </dl>
      <div>
        <div className="mb-3 text-eyebrow uppercase text-l2">Timeline</div>
        <ol className="relative ml-2 border-l border-white/10 pl-5">
          {r.events.map((e, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative pb-4 last:pb-0">
              <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)]" />
              <div className="text-[14px] font-medium">{e.from ? `${REFERRAL_LABEL[e.from]} → ` : ""}{REFERRAL_LABEL[e.to]}</div>
              <div className="num text-[12px] text-l2">{shortTime(e.at)}</div>
              {e.note && <div className="mt-0.5 text-[12px] text-l3">{e.note}</div>}
            </motion.li>
          ))}
        </ol>
      </div>
      <Link to={`/case/${r.encounter_id}`} className="btn-ghost w-full">Open case</Link>
    </div>
  );
}

function F({ icon, k, v }: { icon: React.ReactNode; k: string; v: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-l3">{icon}</span>
      <dt className="w-28 shrink-0 text-l2">{k}</dt>
      <dd className="min-w-0 flex-1 text-white/90">{v}</dd>
    </div>
  );
}
