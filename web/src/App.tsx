import { AnimatePresence } from "framer-motion";
import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { GlassTabBar } from "./components/GlassTabBar";
import { Toasts } from "./components/Toasts";
import { Footer, TopBar } from "./components/TopBar";
import Today from "./pages/Today";

const NewScreening = lazy(() => import("./pages/NewScreening"));
const Theatre = lazy(() => import("./pages/Theatre"));
const CasePage = lazy(() => import("./pages/case/CasePage"));
const Queue = lazy(() => import("./pages/Queue"));
const Referrals = lazy(() => import("./pages/Referrals"));
const Evidence = lazy(() => import("./pages/Evidence"));
const EyeLab = lazy(() => import("./pages/EyeLab"));
const Settings = lazy(() => import("./pages/Settings"));
const Audit = lazy(() => import("./pages/Audit"));
const NotFound = lazy(() => import("./pages/NotFound"));

export default function App() {
  const loc = useLocation();
  const immersive = /\/analyse$/.test(loc.pathname);
  const lab = loc.pathname.startsWith("/lab");
  return (
    <div className="relative min-h-screen bg-black">
      {!immersive && <TopBar />}
      <Suspense fallback={<div className="h-[60vh]" />}>
        <AnimatePresence mode="wait" initial={false}>
          <Routes location={loc} key={loc.pathname.split("/").slice(0, 3).join("/")}>
            <Route path="/" element={<Today />} />
            <Route path="/screen/new" element={<NewScreening />} />
            <Route path="/screen/:encId/analyse" element={<Theatre />} />
            <Route path="/case/:encId" element={<CasePage />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/referrals" element={<Referrals />} />
            <Route path="/evidence" element={<Evidence />} />
            <Route path="/lab" element={<EyeLab />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AnimatePresence>
      </Suspense>
      {immersive ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-3 z-40 text-center text-footnote text-l3">Research prototype · triage aid, not a diagnosis · runs offline</div>
      ) : (
        !lab && <Footer />
      )}
      {!immersive && <GlassTabBar />}
      <Toasts />
    </div>
  );
}
