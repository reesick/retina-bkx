import { Plus, Settings as Gear } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { IS_MOCK } from "../api/client";
import { useHealth } from "../api/hooks";
import { initials } from "../lib/format";
import { useSettings } from "../lib/store";

export function TopBar() {
  const loc = useLocation();
  const reviewer = useSettings((s) => s.reviewer);
  const health = useHealth();
  const today = loc.pathname === "/";
  const ok = health.isSuccess;
  return (
    <header className="relative z-40 flex items-start justify-between px-6 pt-6 lg:px-8">
      <Link to="/" className="group block rounded-lg" aria-label="Retinitry, home">
        <div className="text-eyebrow uppercase text-white" style={{ letterSpacing: "0.42em" }}>
          Retinitry
        </div>
        {today && <div className="mt-1 text-[14px] text-l2">One look at a time.</div>}
      </Link>
      <div className="flex items-center gap-3">
        {IS_MOCK && (
          <span className="rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.14em] text-black" style={{ background: "#FFD60A" }} title="All data on screen is invented by the in-browser mock API">
            MOCK DATA
          </span>
        )}
        <span className="hidden items-center gap-2 rounded-full bg-s1 px-3 py-1.5 text-[12px] text-l2 sm:flex" title={ok ? `Server ${health.data?.version}` : health.isError ? "Local server not reachable" : "Checking"}>
          <span className="h-2 w-2 rounded-full" style={{ background: ok ? "#30D158" : health.isError ? "#FF453A" : "#8E8E93", boxShadow: ok ? "0 0 8px #30D158" : "none" }} />
          {ok ? "Offline · on this device" : health.isError ? "Server not reachable" : "Connecting…"}
        </span>
        <Link to="/settings" aria-label="Settings" className="grid h-9 w-9 place-items-center rounded-full bg-s1 text-white/80 transition-colors hover:bg-s2">
          <Gear className="h-[18px] w-[18px]" />
        </Link>
        <Link to="/settings" aria-label={`Reviewer ${reviewer}`} className="grid h-9 w-9 place-items-center rounded-full bg-s2 text-[12px] font-semibold">
          {initials(reviewer)}
        </Link>
        {!loc.pathname.startsWith("/screen") && (
          <Link to="/screen/new" className="btn-white h-9 px-4 text-[14px]">
            <Plus className="h-4 w-4" strokeWidth={2.5} /> New screening
          </Link>
        )}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="px-6 pb-28 pt-10 text-center text-footnote text-l3 lg:px-8">
      Research prototype · triage aid, not a diagnosis · runs offline
    </footer>
  );
}

export function LargeTitle({ children, right, sub }: { children: React.ReactNode; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-title-xl">{children}</h1>
        {sub && <div className="mt-1 text-body text-l2">{sub}</div>}
      </div>
      {right}
    </div>
  );
}
