import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./client";
import type { Encounter, Failures, Outcome, ReferralList, ReferralUpdate, ReviewCreate, VAUpdate } from "./types";

export const qk = {
  health: ["health"] as const,
  stats: ["stats"] as const,
  encounters: (p: object = {}) => ["encounters", p] as const,
  encounter: (id: string) => ["encounter", id] as const,
  queue: ["queue"] as const,
  referrals: ["referrals"] as const,
  audit: ["audit"] as const,
  metrics: ["metrics"] as const,
  failures: ["failures"] as const,
  policy: ["policy"] as const,
  demo: ["demo"] as const,
};

export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: api.health, staleTime: 30000, retry: 1 });
export const useStats = () => useQuery({ queryKey: qk.stats, queryFn: api.stats });
export const useEncounters = (p: { status?: string; outcome?: Outcome; q?: string; limit?: number } = {}) =>
  useQuery({ queryKey: qk.encounters(p), queryFn: () => api.listEncounters(p) });
export const useEncounter = (id: string | undefined) =>
  useQuery({ queryKey: qk.encounter(id ?? ""), queryFn: () => api.encounter(id!), enabled: !!id });
export const useQueue = () => useQuery({ queryKey: qk.queue, queryFn: api.queue });
export const useReferrals = () => useQuery({ queryKey: qk.referrals, queryFn: () => api.referrals() });
export const useAudit = () => useQuery({ queryKey: qk.audit, queryFn: () => api.audit() });
export const useMetrics = () => useQuery({ queryKey: qk.metrics, queryFn: api.metrics, staleTime: 60000 });
/** Failure gallery; a server without the endpoint (404) is treated as "not generated yet". */
export const useFailures = (enabled = true) => useQuery({
  queryKey: qk.failures, enabled, staleTime: 60000, retry: 0,
  queryFn: async () => {
    try {
      return await api.failures();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return { available: false } as Failures;
      throw e;
    }
  },
});
export const usePolicy = () => useQuery({ queryKey: qk.policy, queryFn: api.policy, staleTime: 60000 });
export const useDemoCases = () => useQuery({ queryKey: qk.demo, queryFn: api.demoCases, staleTime: Infinity });

function useInvalidateLists() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["encounters"] });
    void qc.invalidateQueries({ queryKey: qk.queue });
    void qc.invalidateQueries({ queryKey: qk.stats });
    void qc.invalidateQueries({ queryKey: qk.referrals });
    void qc.invalidateQueries({ queryKey: qk.audit });
  };
}

export function usePutVA(id: string) {
  const qc = useQueryClient();
  const inv = useInvalidateLists();
  return useMutation({
    mutationFn: (b: VAUpdate) => api.putVA(id, b),
    onSuccess: (e: Encounter) => {
      qc.setQueryData(qk.encounter(id), e);
      inv();
    },
  });
}

export function useReview(id: string) {
  const qc = useQueryClient();
  const inv = useInvalidateLists();
  return useMutation({
    mutationFn: (b: ReviewCreate) => api.review(id, b),
    onSuccess: (e: Encounter) => {
      qc.setQueryData(qk.encounter(id), e);
      inv();
    },
  });
}

export function useMoveReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: ReferralUpdate & { id: string }) => api.moveReferral(id, b),
    onMutate: async ({ id, to }) => {
      await qc.cancelQueries({ queryKey: qk.referrals });
      const prev = qc.getQueryData<ReferralList>(qk.referrals);
      if (prev) qc.setQueryData<ReferralList>(qk.referrals, { ...prev, items: prev.items.map((r) => (r.id === id ? { ...r, status: to } : r)) });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.referrals, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.referrals });
      void qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

export const useReplay = () => useMutation({ mutationFn: (imageId: string) => api.replay(imageId) });
