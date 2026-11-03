import { useMutation } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { sound } from "../lib/sound";
import { useUI } from "../lib/store";

/** Starts a bundled demo case (real analysis on this device) and opens the analysis theatre. */
export function useStartDemo(to: "analyse" | "case" = "analyse") {
  const nav = useNavigate();
  const toast = useUI((s) => s.toast);
  return useMutation({
    mutationFn: (name: string) => api.startDemo(name),
    onSuccess: (e) => nav(to === "case" ? `/case/${e.id}` : `/screen/${e.id}/analyse`),
    onError: (e) => {
      sound.fail();
      toast({ text: e instanceof Error ? e.message : "Demo failed", tone: "error" });
    },
  });
}

export function DemoButton({ name = "human-review", label = "Try a demo case", className = "btn-white" }: { name?: string; label?: string; className?: string }) {
  const m = useStartDemo();
  return (
    <button type="button" className={className} disabled={m.isPending} title={m.isPending ? "Starting the demo…" : undefined} onClick={() => m.mutate(name)}>
      <Play className="h-4 w-4" /> {m.isPending ? "Starting…" : label}
    </button>
  );
}
