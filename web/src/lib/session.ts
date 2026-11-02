import { create } from "zustand";

/** Session-only facts measured in this browser session (e.g. a replay that matched). Never persisted. */
interface SessionFacts { determinismVerified: boolean }
export const useSession = create<SessionFacts>()(() => ({ determinismVerified: false }));
export const markDeterminismVerified = () => useSession.setState({ determinismVerified: true });
