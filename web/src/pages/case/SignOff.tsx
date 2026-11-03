import { AnimatePresence, motion } from "framer-motion";
import { forwardRef, useEffect, useState } from "react";
import { useReview } from "../../api/hooks";
import type { Encounter, Outcome, Urgency } from "../../api/types";
import { Bloom } from "../../components/Bloom";
import { HoldButton } from "../../components/HoldButton";
import { Check, Seal } from "../../components/icons";
import { Segmented } from "../../components/Segmented";
import { Sheet } from "../../components/Sheet";
import { SPRING } from "../../components/motion";
import { flagLabel, OUTCOME_LABEL, outcomeColor, shortTime, urgencyLabel } from "../../lib/format";
import { sound } from "../../lib/sound";
import { useSettings, useUI } from "../../lib/store";

const REASONS = ["Lesions not confirmed", "Artefact", "Additional clinical info", "Image actually adequate"];
const OUTCOMES: Outcome[] = ["ROUTINE", "REFER", "HUMAN_REVIEW", "RETAKE"];

export const SignOff = forwardRef<HTMLDivElement, { enc: Encounter; autoFocus?: boolean }>(function SignOff({ enc, autoFocus }, ref) {
  const reviewer = useSettings((s) => s.reviewer);
  const review = useReview(enc.id);
  const toast = useUI((s) => s.toast);
  const flags = enc.ai?.flags ?? [];
  const [ack, setAck] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState(false);
  const [final, setFinal] = useState<Outcome>(enc.ai?.outcome ?? "HUMAN_REVIEW");
  const [urg, setUrg] = useState<Urgency>("soon");
  const [reasonChips, setReasonChips] = useState<Set<string>>(new Set());
  const [reasonText, setReasonText] = useState("");
  const [signedFlash, setSignedFlash] = useState(false);
  const allAck = flags.every((f) => ack.has(f.code));
  useEffect(() => {
    if (autoFocus) (document.getElementById("signoff-first") as HTMLElement | null)?.focus();
  }, [autoFocus]);

  if (!enc.ai) return null;
  const ai = enc.ai;

  const submit = (decision: "approve" | "override") => {
    const fo = decision === "approve" ? ai.outcome : final;
    const fu: Urgency = decision === "approve" ? ai.urgency : fo === "REFER" ? urg : fo === "ROUTINE" ? "routine_12m" : null;
    const reason = decision === "approve" ? "" : [...reasonChips, reasonText.trim()].filter(Boolean).join("; ");
    review.mutate(
      { reviewer, decision, final_outcome: fo, final_urgency: fu, reason, acknowledged_flags: [...ack] },
      {
        onSuccess: (e) => {
          setSheet(false);
          setSignedFlash(true);
          setTimeout(() => setSignedFlash(false), 2600);
          if (e.referral) toast({ text: "Referral issued", tone: "ok", href: "/referrals", linkText: "Open referrals" });
          else toast({ text: "Signed", tone: "ok" });
        },
        onError: (x) => { sound.fail(); toast({ text: x instanceof Error ? x.message : "Sign-off failed", tone: "error" }); },
      },
    );
  };

  if (enc.review) {
    const r = enc.review;
    const c = outcomeColor(r.final_outcome, r.final_urgency);
    return (
      <div ref={ref} id="signoff" className="card relative overflow-hidden p-5">
        <Bloom show={signedFlash} color={c} size={520} settle={0} />
        <AnimatePresence>
          {signedFlash && (
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 16 }} className="mb-3 text-[44px] font-bold leading-none tracking-[-0.04em]" style={{ textShadow: `0 0 40px ${c}` }}>
              SIGNED.
            </motion.div>
          )}
        </AnimatePresence>
        <div className="relative flex items-center gap-3">
          <Seal className="h-8 w-8" style={{ color: c }} />
          <div>
            <div className="text-headline">{r.decision === "approve" ? "Approved" : "Overridden"} · {OUTCOME_LABEL[r.final_outcome]}{r.final_urgency ? ` · ${urgencyLabel(r.final_urgency)}` : ""}</div>
            <div className="text-footnote text-l2">{r.reviewer} · {shortTime(r.at)}</div>
          </div>
        </div>
        {r.reason && <p className="relative mt-3 text-[14px] text-l2">Reason: {r.reason}</p>}
        {r.acknowledged_flags.length > 0 && <p className="relative mt-1 text-[12px] text-l3">Acknowledged: {r.acknowledged_flags.map(flagLabel).join(", ")}</p>}
      </div>
    );
  }

  const aiColor = outcomeColor(ai.outcome, ai.urgency);
  return (
    <div ref={ref} id="signoff" className="card p-5" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-title">Sign-off</h3>
        <span className="text-[12px] text-l3">Clinician makes the final decision</span>
      </div>
      {flags.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[13px] text-l2">Acknowledge before signing</div>
          {flags.map((f, i) => {
            const on = ack.has(f.code);
            return (
              <button
                key={f.code}
                id={i === 0 ? "signoff-first" : undefined}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => { sound.tick(); setAck((s) => { const n = new Set(s); if (n.has(f.code)) n.delete(f.code); else n.add(f.code); return n; }); }}
                className={`flex w-full items-start gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors ${on ? "bg-white/[0.08]" : "bg-s2/60 hover:bg-s2"}`}
              >
                <motion.span animate={{ scale: on ? [1, 1.25, 1] : 1 }} className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: on ? "#30D158" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(255,255,255,0.35)" }}>
                  {on && <Check className="h-3.5 w-3.5 text-black" strokeWidth={3} />}
                </motion.span>
                <span><span className="block text-[14px] font-medium">{flagLabel(f.code)}</span><span className="block text-[12px] text-l2">{f.text}</span></span>
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-5 flex items-center gap-5">
        <HoldButton size={150} color={aiColor} disabled={!allAck || review.isPending} disabledReason={review.isPending ? "Signing…" : "Tick every flag above first"} pending={review.isPending} label={"HOLD TO\nAPPROVE"} onComplete={() => submit("approve")} />
        <div className="min-w-0 flex-1">
          <div className="text-headline">Approve AI outcome</div>
          <div className="text-[13px]" style={{ color: aiColor }}>{OUTCOME_LABEL[ai.outcome]}{ai.urgency ? ` · ${urgencyLabel(ai.urgency)}` : ""}</div>
          <div className="mt-1 text-[12px] text-l2">{allAck ? "Press and hold 1.2 s (or hold Space)." : "Tick every flag above first; then the button unlocks."}</div>
          <button type="button" className="btn-ghost mt-3" disabled={!allAck} title={allAck ? "Sign a different outcome than the AI" : "Tick every flag above first"} onClick={() => { setFinal(ai.outcome === "REFER" ? "HUMAN_REVIEW" : "REFER"); setSheet(true); }}>Override…</button>
        </div>
      </div>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Override">
        <div className="space-y-6 pb-2">
          <div>
            <div className="mb-2 text-[13px] text-l2">Final outcome</div>
            <div className="grid grid-cols-2 gap-2.5">
              {OUTCOMES.map((o) => {
                const c = outcomeColor(o, o === "REFER" ? urg : null);
                const on = final === o;
                return (
                  <motion.button key={o} type="button" whileTap={{ scale: 0.97 }} transition={SPRING} onClick={() => { sound.tick(); setFinal(o); }} aria-pressed={on} className="flex h-16 items-center justify-center gap-2.5 rounded-[18px] text-[17px] font-semibold"
                    style={{ background: on ? `${c}26` : "#2C2C2E", color: on ? c : "rgba(255,255,255,0.8)", boxShadow: on ? `inset 0 0 0 1.5px ${c}, 0 0 30px ${c}33` : "none" }}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{OUTCOME_LABEL[o]}
                  </motion.button>
                );
              })}
            </div>
          </div>
          {final === "REFER" && (
            <div>
              <div className="mb-2 text-[13px] text-l2">Urgency</div>
              <Segmented value={urg ?? "soon"} onChange={(v) => setUrg(v as Urgency)} options={[{ value: "soon", label: "Soon · 3–6 months" }, { value: "immediate", label: "Immediate" }]} />
            </div>
          )}
          <div>
            <div className="mb-2 text-[13px] text-l2">Reason (required)</div>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => {
                const on = reasonChips.has(r);
                return <button key={r} type="button" aria-pressed={on} onClick={() => { sound.tick(); setReasonChips((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; }); }} className={`chip ${on ? "!bg-white !text-black" : ""}`}>{r}</button>;
              })}
            </div>
            <textarea value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="Why do you disagree with the AI?" className="input mt-3 h-24 resize-none py-2.5" aria-label="Override reason" />
          </div>
          <div className="flex items-center gap-5">
            <HoldButton size={140} color={outcomeColor(final, urg)} disabled={!(reasonChips.size || reasonText.trim()) || review.isPending} disabledReason={review.isPending ? "Signing…" : "Pick or type a reason first"} pending={review.isPending} label={"HOLD\nTO SIGN"} onComplete={() => submit("override")} />
            <div className="text-[13px] text-l2">
              AI said <span style={{ color: aiColor }}>{OUTCOME_LABEL[ai.outcome]}</span>. You are signing <span style={{ color: outcomeColor(final, urg) }}>{OUTCOME_LABEL[final]}</span>. Both are stored.
              {review.isError && <div className="mt-1 text-urgent">{(review.error as Error).message}</div>}
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
});
