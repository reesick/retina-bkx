"""Background runner for the encounter graph: one thread, a queue of (kind, encounter_id, payload).

kind = "start"  : new run (after all images of an encounter are analysed, or when inputs change before sign-off)
kind = "resume" : resume a paused run after clinician sign-off (LangGraph interrupt -> Command(resume=review))
"""
from __future__ import annotations

import json
import logging
import queue
import threading
import time
from pathlib import Path

from . import encounter_graph as EG

log = logging.getLogger("retinitry.agents")


class AgentRunner:
    def __init__(self, service, db_path: Path):
        self.svc = service
        self.db_path = db_path
        self.q: queue.Queue = queue.Queue()
        self.graph = None
        self.conn = None
        self.thread: threading.Thread | None = None
        self.stopping = False
        self.last_error: str | None = None

    def start(self):
        try:
            self.graph, self.conn = EG.build(self.svc.agent_tools(), self.db_path)
        except Exception as e:  # LangGraph missing or broken: the app still works without agents
            self.last_error = f"agent graph unavailable: {type(e).__name__}: {e}"
            log.error(self.last_error)
            return
        self.thread = threading.Thread(target=self._loop, name="agents", daemon=True)
        self.thread.start()

    def stop(self):
        self.stopping = True
        self.q.put(None)

    @property
    def ready(self) -> bool:
        return self.graph is not None

    def submit(self, kind: str, enc_id: str, payload: dict | None = None):
        if self.graph is not None:
            self.q.put((kind, enc_id, payload or {}))

    def _loop(self):
        while not self.stopping:
            item = self.q.get()
            if item is None:
                break
            kind, enc_id, payload = item
            try:
                self._handle(kind, enc_id, payload)
            except Exception as e:
                log.exception("agent run failed for %s", enc_id)
                self.svc.agent_save(enc_id, status="error", error=f"{type(e).__name__}: {e}")

    def _handle(self, kind: str, enc_id: str, payload: dict):
        if kind == "start":
            run_no, thread_id = self.svc.agent_new_run(enc_id)
            cfg = {"configurable": {"thread_id": thread_id}, "recursion_limit": 40}
            self.svc.agent_save(enc_id, status="running")
            for _ in self.graph.stream({"encounter_id": enc_id, "trace": []}, cfg, stream_mode="updates"):
                self._snapshot(enc_id, cfg, "running")
            self._snapshot(enc_id, cfg, None)
        elif kind == "resume":
            thread_id = self.svc.agent_thread(enc_id)
            if not thread_id:
                return
            cfg = {"configurable": {"thread_id": thread_id}, "recursion_limit": 40}
            snap = self.graph.get_state(cfg)
            if not snap.next or "await_signoff" not in snap.next:
                return  # run is not waiting (e.g. still running or never reached sign-off)
            self.svc.agent_save(enc_id, status="running")
            for _ in self.graph.stream(EG.resume_command(payload), cfg, stream_mode="updates"):
                self._snapshot(enc_id, cfg, "running")
            self._snapshot(enc_id, cfg, None)

    def _snapshot(self, enc_id: str, cfg: dict, status: str | None):
        snap = self.graph.get_state(cfg)
        v = dict(snap.values)
        v.pop("encounter", None)  # large and already stored by the app
        st = status or (("awaiting_signoff" if "await_signoff" in (snap.next or ()) else v.get("status") or "done"))
        v["next"] = list(snap.next or [])
        self.svc.agent_save(enc_id, status=st, state=v)

    def graph_mermaid(self) -> str:
        return EG.mermaid(self.graph) if self.graph else ""
