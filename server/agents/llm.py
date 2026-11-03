"""Local LLM access (Ollama on 127.0.0.1, offline) with fixed decoding so runs are repeatable.

Every call records: model name, model digest, prompt SHA-256, options and latency. If Ollama is not running or the
model is missing, `available()` is False and agents use their deterministic templates instead. Nothing ever leaves
the machine.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.request

OLLAMA_URL = os.environ.get("RETINITRY_OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("RETINITRY_LLM", "llama3.2:3b")
OPTIONS = {"temperature": 0, "seed": 42, "top_k": 1, "top_p": 1.0, "num_ctx": 4096, "num_predict": 600}
if os.environ.get("RETINITRY_LLM_CPU") == "1":   # keep the GPU free (e.g. while training)
    OPTIONS["num_gpu"] = 0
_STATUS: dict = {"checked": 0.0, "ok": False, "digest": None, "error": None}


def _get(path: str, timeout: float = 2.0) -> dict:
    with urllib.request.urlopen(OLLAMA_URL + path, timeout=timeout) as r:
        return json.loads(r.read())


def status(refresh: bool = False) -> dict:
    """{"ok", "model", "digest", "error"}; cached for 30 s."""
    if refresh or time.time() - _STATUS["checked"] > 30:
        _STATUS["checked"] = time.time()
        try:
            tags = _get("/api/tags")
            m = next((x for x in tags.get("models", []) if x.get("name") == MODEL or x.get("model") == MODEL), None)
            _STATUS.update(ok=m is not None, digest=(m or {}).get("digest"),
                           error=None if m else f"model {MODEL} not pulled (run: ollama pull {MODEL})")
        except Exception as e:  # server not running
            _STATUS.update(ok=False, digest=None, error=f"Ollama not reachable at {OLLAMA_URL}: {type(e).__name__}")
    return {"ok": _STATUS["ok"], "model": MODEL, "digest": _STATUS["digest"], "error": _STATUS["error"], "url": OLLAMA_URL}


def available() -> bool:
    return status()["ok"]


def chat(system: str, user: str, json_mode: bool = False, timeout: float = 180.0) -> dict:
    """One chat completion through langchain-ollama (ChatOllama) with fixed decoding.

    Returns {"text", "model", "digest", "prompt_sha256", "ms", "options"}. Raises on failure.
    """
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_ollama import ChatOllama

    llm = ChatOllama(model=MODEL, base_url=OLLAMA_URL, format="json" if json_mode else None,
                     client_kwargs={"timeout": timeout}, **OPTIONS)
    t0 = time.perf_counter()
    msg = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
    ph = hashlib.sha256((system + "\n\n" + user).encode()).hexdigest()
    st = status()
    return {"text": str(msg.content).strip(), "model": MODEL, "digest": st["digest"], "prompt_sha256": ph,
            "ms": round((time.perf_counter() - t0) * 1000), "options": OPTIONS}
