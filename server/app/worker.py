"""Single background analysis worker plus an in-memory per-image event broker.

One worker thread processes queued images one at a time so CPU use stays predictable. Progress events
are buffered per image id, so a subscriber that connects late gets every earlier event replayed and then
the live ones.
"""
from __future__ import annotations

import logging
import queue
import threading
from collections import OrderedDict
from typing import Any, Callable

log = logging.getLogger("retinitry.worker")

TERMINAL = {"done", "error"}


class Channel:
    def __init__(self) -> None:
        self.events: list[tuple[str, Any]] = []
        self.closed = False
        self.cond = threading.Condition()

    def publish(self, event: str, data: Any) -> None:
        with self.cond:
            if self.closed:
                return
            self.events.append((event, data))
            if event in TERMINAL:
                self.closed = True
            self.cond.notify_all()

    def wait(self, index: int, timeout: float) -> tuple[list[tuple[str, Any]], bool]:
        """Events from `index` on (blocking up to timeout if none yet) and whether the channel is closed."""
        with self.cond:
            if len(self.events) <= index and not self.closed:
                self.cond.wait(timeout)
            return self.events[index:], self.closed


class Broker:
    def __init__(self, keep: int = 500) -> None:
        self._ch: OrderedDict[str, Channel] = OrderedDict()
        self._lock = threading.Lock()
        self.keep = keep

    def channel(self, image_id: str) -> Channel:
        with self._lock:
            ch = self._ch.get(image_id)
            if ch is None:
                ch = self._ch[image_id] = Channel()
                while len(self._ch) > self.keep:
                    self._ch.popitem(last=False)
            return ch

    def reset(self, image_id: str) -> Channel:
        with self._lock:
            ch = self._ch[image_id] = Channel()
            return ch

    def publish(self, image_id: str, event: str, data: Any) -> None:
        self.channel(image_id).publish(event, data)

    def drop(self, image_id: str) -> None:
        with self._lock:
            self._ch.pop(image_id, None)


class Worker:
    """Runs `handler(image_id)` for each queued id on one daemon thread."""

    def __init__(self, handler: Callable[[str], None]) -> None:
        self.handler = handler
        self.q: "queue.Queue[str | None]" = queue.Queue()
        self.thread: threading.Thread | None = None
        self.idle = threading.Event()
        self.idle.set()

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self._loop, name="retinitry-worker", daemon=True)
        self.thread.start()

    def submit(self, image_id: str) -> None:
        self.idle.clear()
        self.q.put(image_id)

    def stop(self, timeout: float = 10.0) -> None:
        if self.thread and self.thread.is_alive():
            self.q.put(None)
            self.thread.join(timeout)

    def _loop(self) -> None:
        while True:
            item = self.q.get()
            if item is None:
                return
            try:
                self.handler(item)
            except Exception:  # pragma: no cover - handler records its own errors
                log.exception("worker handler failed for %s", item)
            finally:
                self.q.task_done()
                if self.q.unfinished_tasks == 0:
                    self.idle.set()
