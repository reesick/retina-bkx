// SSE progress stream: GET /images/{id}/events. Mock mode replays a simulated stream.
import { API_BASE, IS_MOCK } from "./client";
import type { ImageResult, ProgressEvent, StepEvent } from "./types";

export type Unsubscribe = () => void;

export function subscribeProgress(imageId: string, onEvent: (e: ProgressEvent) => void): Unsubscribe {
  if (IS_MOCK) {
    let unsub: Unsubscribe | null = null;
    let closed = false;
    void import("./mock").then((m) => {
      if (!closed) unsub = m.mockEvents(imageId, onEvent);
    });
    return () => {
      closed = true;
      unsub?.();
    };
  }
  const es = new EventSource(`${API_BASE}/images/${imageId}/events`);
  let finished = false;
  const parse = <T,>(ev: MessageEvent): T | null => {
    try {
      return JSON.parse(ev.data as string) as T;
    } catch {
      return null;
    }
  };
  es.addEventListener("step", (ev) => {
    const d = parse<StepEvent>(ev as MessageEvent);
    if (d) onEvent({ type: "step", data: d });
  });
  es.addEventListener("done", (ev) => {
    const d = parse<ImageResult>(ev as MessageEvent);
    finished = true;
    es.close();
    if (d) onEvent({ type: "done", data: d });
  });
  es.addEventListener("error", (ev) => {
    const me = ev as MessageEvent;
    if (finished) return;
    if (typeof me.data === "string" && me.data) {
      const d = parse<{ message: string }>(me);
      finished = true;
      es.close();
      onEvent({ type: "error", data: { message: d?.message ?? "Analysis failed." } });
      return;
    }
    // transport error: EventSource will retry; give up if closed
    if (es.readyState === EventSource.CLOSED) {
      finished = true;
      onEvent({ type: "error", data: { message: "Lost connection to the local server." } });
    }
  });
  return () => {
    finished = true;
    es.close();
  };
}
