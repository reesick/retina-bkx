// HTTP client for docs/04_API.md. In VITE_MOCK=1 builds every call is served in-browser by ./mock.
import type {
  AuditList, AuditVerify, DemoCase, Encounter, EncounterCreate, EncounterPatch, EncounterSummary, Eye, Health,
  ImageResult, Metrics, Outcome, Policy, Referral, ReferralList, ReferralStatus, ReferralUpdate, ReplayResult,
  ReviewCreate, TodayStats, VAUpdate, View,
} from "./types";

export const IS_MOCK = import.meta.env.VITE_MOCK === "1";
export const API_BASE = "/api";

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (IS_MOCK) {
    const m = await import("./mock");
    return m.handle<T>(method, path, body);
  }
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(API_BASE + path, init);
  } catch {
    throw new ApiError(0, "The local server is not reachable. Start it with scripts/serve.");
  }
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
      else if (j.detail) detail = JSON.stringify(j.detail);
    } catch { /* not json */ }
    throw new ApiError(res.status, detail);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return (await res.text()) as unknown as T;
  return (await res.json()) as T;
}

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return p.length ? "?" + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
};

export const api = {
  health: () => request<Health>("GET", "/health"),
  stats: () => request<TodayStats>("GET", "/stats/today"),

  createEncounter: (b: EncounterCreate) => request<Encounter>("POST", "/encounters", b),
  listEncounters: (q: { status?: string; outcome?: Outcome; q?: string; limit?: number } = {}) =>
    request<EncounterSummary[]>("GET", "/encounters" + qs({ limit: 50, ...q })),
  encounter: (id: string) => request<Encounter>("GET", `/encounters/${id}`),
  patchEncounter: (id: string, b: EncounterPatch) => request<Encounter>("PATCH", `/encounters/${id}`, b),
  putVA: (id: string, b: VAUpdate) => request<Encounter>("PUT", `/encounters/${id}/va`, b),
  deleteImage: (id: string, imageId: string) => request<Encounter>("DELETE", `/encounters/${id}/images/${imageId}`),
  uploadImage: (id: string, file: Blob, eye: Eye, view: View, fov?: number) => {
    const fd = new FormData();
    fd.append("file", file, file instanceof File ? file.name : "image.jpg");
    fd.append("eye", eye);
    fd.append("view", view);
    if (fov) fd.append("fov_deg", String(fov));
    return request<ImageResult>("POST", `/encounters/${id}/images`, fd);
  },
  image: (id: string) => request<ImageResult>("GET", `/images/${id}`),
  replay: (id: string) => request<ReplayResult>("POST", `/images/${id}/replay`),

  queue: () => request<EncounterSummary[]>("GET", "/queue"),
  review: (id: string, b: ReviewCreate) => request<Encounter>("POST", `/encounters/${id}/review`, b),

  referrals: (status?: ReferralStatus) => request<ReferralList>("GET", "/referrals" + qs({ status })),
  moveReferral: (id: string, b: ReferralUpdate) => request<Referral>("PUT", `/referrals/${id}`, b),

  audit: (q: { encounter_id?: string; limit?: number } = {}) => request<AuditList>("GET", "/audit" + qs({ limit: 200, ...q })),
  verifyAudit: () => request<AuditVerify>("GET", "/audit/verify"),

  metrics: () => request<Metrics>("GET", "/metrics"),
  policy: () => request<Policy>("GET", "/policy"),
  demoCases: () => request<DemoCase[]>("GET", "/demo-cases"),
  startDemo: (name: string) => request<Encounter>("POST", `/demo-cases/${encodeURIComponent(name)}`),

  reportUrl: (id: string) => `${API_BASE}/encounters/${id}/report.pdf`,
};

/** Resolve server-relative URLs (e.g. "/api/images/x/file/canonical"). Data/blob URLs pass through. */
export function assetUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("http")) return u;
  if (u.startsWith("/api")) return u;
  return API_BASE + (u.startsWith("/") ? u : "/" + u);
}
