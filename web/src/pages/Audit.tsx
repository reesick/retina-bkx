import { AnimatePresence, motion } from "framer-motion";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAudit } from "../api/hooks";
import type { AuditVerify } from "../api/types";
import { ShieldCheck } from "../components/icons";
import { Page } from "../components/Page";
import { Ring } from "../components/Ring";
import { ErrorState, Skeleton } from "../components/Skeleton";
import { LargeTitle } from "../components/TopBar";
import { shortHash, shortTime } from "../lib/format";
import { sound } from "../lib/sound";

export default function Audit() {
  const q = useAudit();
  const items = q.data?.items ?? [];
  const [scan, setScan] = useState<number | null>(null);
  const [res, setRes] = useState<AuditVerify | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const running = scan !== null;

  const verify = async () => {
    setRes(null);
    setErr(null);
    setScan(0);
    const p = api.verifyAudit();
    // animate a scan down the list while the server verifies
    const n = items.length;
    const step = Math.max(12, Math.min(60, 1600 / Math.max(1, n)));
    for (let i = 0; i < n; i++) {
      setScan(i);
      if (i % 3 === 0) sound.tick();
      await new Promise((r) => setTimeout(r, step));
    }
    try {
      const r = await p;
      setRes(r);
      if (r.valid) sound.success();
      else sound.fail();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Verification failed");
      sound.fail();
    } finally {
      setScan(null);
    }
  };

  const badSeq = res && !res.valid ? res.first_bad_seq : null;

  return (
    <Page className="max-w-[900px]">
      <LargeTitle
        sub="Every action is chained: each entry stores the SHA-256 of the one before."
        right={<button type="button" className="btn-white" onClick={() => void verify()} disabled={running || !items.length}><ShieldCheck className="h-4 w-4" /> {running ? "Verifying…" : "Verify chain"}</button>}
      >
        Audit
      </LargeTitle>
      <AnimatePresence>
        {(res || err) && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card mb-6 flex items-center gap-5 p-5">
            {res ? (
              <>
                <Ring value={1} size={72} stroke={6} color={res.valid ? "#30D158" : "#FF453A"} head={false}>
                  <span className="text-[20px]">{res.valid ? "✓" : "!"}</span>
                </Ring>
                <div>
                  <div className="text-title" style={{ color: res.valid ? "#30D158" : "#FF453A" }}>{res.valid ? `Chain intact · ${res.checked} entries` : `Chain broken at #${res.first_bad_seq}`}</div>
                  <div className="text-footnote text-l2">{res.valid ? "Every hash matches its predecessor." : "Entries from this point cannot be trusted. Investigate the log file."}</div>
                </div>
              </>
            ) : <div className="text-urgent">{err}</div>}
          </motion.div>
        )}
      </AnimatePresence>
      {q.isLoading && <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !items.length && <div className="py-16 text-center text-l2">No audit entries yet.</div>}
      <div ref={list} className="relative">
        <ol className="relative ml-3 border-l border-white/10" style={{ borderLeftWidth: 0.5 }}>
          {items.map((a, i) => {
            const scanned = scan !== null && i <= scan;
            const bad = badSeq != null && a.seq === badSeq;
            return (
              <motion.li key={a.seq} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 30) * 0.02 }} className="relative pb-4 pl-6">
                <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full transition-all duration-200"
                  style={{ background: bad ? "#FF453A" : scanned || (res?.valid ?? false) ? "#30D158" : "#38383A", boxShadow: scan === i ? "0 0 0 6px rgba(48,209,88,0.25), 0 0 16px #30D158" : bad ? "0 0 12px #FF453A" : "none" }} />
                <div className={`rounded-[14px] px-3 py-2 transition-colors ${scan === i ? "bg-white/[0.06]" : ""}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="num text-[12px] text-l3">#{a.seq}</span>
                    <span className="text-[15px] font-medium">{a.event}</span>
                    <span className="text-[13px] text-l2">{a.actor}</span>
                    <span className="num ml-auto text-[12px] text-l3">{shortTime(a.at)}</span>
                  </div>
                  <div className="num mt-0.5 flex flex-wrap gap-x-4 text-[11px] text-l3">
                    <span>prev {shortHash(a.prev_hash, 12)}</span>
                    <span className="text-white/60">hash {shortHash(a.hash, 12)}</span>
                    {a.encounter_id && <Link to={`/case/${a.encounter_id}`} className="hover:text-white">{a.encounter_id}</Link>}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </Page>
  );
}
