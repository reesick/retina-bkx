"""Encounter orchestration graph (LangGraph).

One graph run per encounter, persisted with a SQLite checkpointer (thread = encounter + run number), so a run
survives a server restart and its every step is inspectable. The graph pauses for the clinician (LangGraph
interrupt) and resumes when the encounter is signed.

    load_case ─► plan ─┬─► second_opinion ◄─┐ (round 2 only if round 1 was inconclusive)
                       │        └───────────┘
                       └─► reconcile ─► coach ─► write_brief ─► check_brief ─┬─► write_brief (rewrite, ≤ 2 more)
                                                                             └─► publish ─► await_signoff (interrupt)
                                                                       ─► [REFER] write_letter ─► check_letter ─┬─► write_letter
                                                                                                                └─► done
The triage decision is always made by core/policy.py. The only automatic change any agent may make is
HUMAN_REVIEW -> REFER after a consistent second opinion, and only when policy.json enables it with a margin
fitted on validation data.
"""
from __future__ import annotations

import operator
import sqlite3
import time
from pathlib import Path
from typing import Annotated, Any, Callable, Optional, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from . import coach as C
from . import grounding as G
from . import llm as L
from . import second_opinion as SO
from . import writer as W

MAX_SO_ROUNDS = 2
MAX_WRITES = 3
DOUBT_CODES = {"HIGH_ENTROPY", "DISAGREEMENT"}


class EncState(TypedDict, total=False):
    encounter_id: str
    encounter: dict
    so_targets: list[str]
    so_round: int
    second_opinion: dict           # image_id -> latest round result
    overrides: dict                # image_id -> triage override (validated upgrade only)
    coaching: dict                 # image_id -> [instructions]
    facts: dict
    brief: dict                    # {"text", "source": "llm"|"template", "attempts", "grounding", "llm"}
    brief_feedback: list
    brief_attempts: int
    review: dict
    letter: dict
    letter_feedback: list
    letter_attempts: int
    status: str
    trace: Annotated[list, operator.add]


class Tools:
    """What the graph may touch. Implemented by the server Service (see service.py: AgentTools)."""
    get_encounter: Callable[[str], dict]
    image_bytes: Callable[[str], bytes]
    pipeline: Any
    pipeline_lock: Any
    policy: Callable[[], dict]
    set_overrides: Callable[[str, dict], dict]      # returns the recomputed encounter
    audit: Callable[[str, str, dict], None]
    facility: Callable[[str], Optional[str]]


def _t(node: str, t0: float, note: str, **extra) -> list:
    return [{"node": node, "ms": round((time.perf_counter() - t0) * 1000), "note": note, "at": time.time(), **extra}]


def build(tools: Tools, db_path: Path):
    g = StateGraph(EncState)

    # ------------------------------------------------------------------ nodes
    def load_case(st: EncState):
        t0 = time.perf_counter()
        enc = tools.get_encounter(st["encounter_id"])
        done = [i for i in enc["images"] if i["status"] == "done"]
        return {"encounter": enc, "so_round": 0, "second_opinion": {}, "overrides": {}, "brief_attempts": 0,
                "letter_attempts": 0, "brief_feedback": [], "letter_feedback": [], "status": "running",
                "trace": _t("load_case", t0, f"{len(done)} analysed image(s), AI outcome {(enc.get('ai') or {}).get('outcome')}")}

    def plan(st: EncState):
        t0 = time.perf_counter()
        targets = []
        for img in st["encounter"]["images"]:
            if img["status"] != "done":
                continue
            tri = img["triage"]
            codes = {r["code"] for r in tri["reasons"]}
            if tri["outcome"] == "HUMAN_REVIEW" and codes & DOUBT_CODES:
                targets.append(img["id"])
        note = (f"second opinion needed for {len(targets)} uncertain image(s)" if targets
                else "no uncertain images; no second opinion needed")
        return {"so_targets": targets, "trace": _t("plan", t0, note, targets=targets)}

    def second_opinion(st: EncState):
        t0 = time.perf_counter()
        pol = tools.policy()
        cfg = pol.get("second_opinion") or {}
        margin = float(cfg.get("margin", 0.15))
        rnd = st.get("so_round", 0) + 1
        res = dict(st.get("second_opinion") or {})
        for img_id in st["so_targets"]:
            prev = res.get(img_id)
            if prev and prev["verdict"] != "doubt_confirmed":
                continue  # already settled in round 1
            with tools.pipeline_lock:
                sq = SO.canonical(tools.pipeline, tools.image_bytes(img_id))
                res[img_id] = SO.run_round(tools.pipeline, sq, rnd, prev["views"] if prev else [], float(pol["t_refer"]), margin)
        summary = {k: v["verdict"] for k, v in res.items()}
        tools.audit(st["encounter_id"], "agent_second_opinion", {"round": rnd, "verdicts": summary, "margin": margin})
        return {"second_opinion": res, "so_round": rnd,
                "trace": _t("second_opinion", t0, f"round {rnd}: " + ", ".join(f"{v}" for v in summary.values()), verdicts=summary)}

    def reconcile(st: EncState):
        t0 = time.perf_counter()
        cfg = tools.policy().get("second_opinion") or {}
        overrides = {}
        if cfg.get("enabled"):
            for img_id, so in (st.get("second_opinion") or {}).items():
                if so["verdict"] == "consistent_referable":
                    overrides[img_id] = {"outcome": "REFER", "urgency": "soon", "rule": "R3b second opinion",
                                         "detail": f"{so['n_views']} views all ≥ {so['t_refer'] + so['margin']:.3f} (min {so['min']:.3f})"}
        enc = tools.set_overrides(st["encounter_id"], overrides) if overrides or st["encounter"].get("agent_overrides") else st["encounter"]
        if overrides:
            note = f"{len(overrides)} image(s) upgraded HUMAN_REVIEW → REFER by validated second-opinion rule"
        elif st.get("second_opinion"):
            note = ("second opinion recorded for the reviewer; automatic upgrade disabled until validated"
                    if not cfg.get("enabled") else "second opinion did not meet the upgrade rule; outcome unchanged")
        else:
            note = "nothing to reconcile"
        return {"encounter": enc, "overrides": overrides, "trace": _t("reconcile", t0, note, enabled=bool(cfg.get("enabled")))}

    def coach(st: EncState):
        t0 = time.perf_counter()
        out = {}
        for img in st["encounter"]["images"]:
            if img["status"] == "done" and img["quality"]["category"] != "adequate":
                tips = C.coach(img["quality"])
                if tips:
                    out[img["id"]] = tips
        return {"coaching": out, "trace": _t("coach", t0, f"capture instructions for {len(out)} image(s)" if out else "all photos adequate")}

    def write_brief(st: EncState):
        t0 = time.perf_counter()
        facts = W.case_facts(st["encounter"], st.get("second_opinion"), st.get("coaching"))
        n = st.get("brief_attempts", 0) + 1
        if L.available():
            try:
                r = L.chat(W.BRIEF_SYSTEM, W.brief_prompt(facts, st.get("brief_feedback")))
                b = {"text": r["text"], "source": "llm", "attempts": n,
                     "llm": {k: r[k] for k in ("model", "digest", "prompt_sha256", "ms", "options")}}
                return {"facts": facts, "brief": b, "brief_attempts": n,
                        "trace": _t("write_brief", t0, f"LLM draft {n} ({r['ms']} ms)", prompt_sha256=r["prompt_sha256"])}
            except Exception as e:  # LLM failed: use the template
                note = f"LLM error ({type(e).__name__}); using template"
        else:
            note = "LLM not available; using template"
        b = {"text": W.template_brief(facts), "source": "template", "attempts": n, "llm": None}
        return {"facts": facts, "brief": b, "brief_attempts": MAX_WRITES, "trace": _t("write_brief", t0, note)}

    def check_brief(st: EncState):
        t0 = time.perf_counter()
        b = dict(st["brief"])
        res = G.check(b["text"], st["facts"])
        b["grounding"] = res
        upd: dict = {"brief": b}
        if res["ok"]:
            note = f"grounded ({res['numbers_checked']} numbers verified)"
        elif st["brief_attempts"] < MAX_WRITES:
            note = f"rejected: {'; '.join(res['problems'][:3])} → rewrite"
            upd["brief_feedback"] = res["problems"]
        else:
            note = f"rejected after {st['brief_attempts']} drafts → deterministic template"
            tb = W.template_brief(st["facts"])
            upd["brief"] = {"text": tb, "source": "template", "attempts": st["brief_attempts"], "llm": b.get("llm"),
                            "grounding": G.check(tb, st["facts"]), "rejected_drafts": st["brief_attempts"]}
        tools.audit(st["encounter_id"], "agent_brief_check", {"ok": res["ok"], "problems": res["problems"][:6],
                                                              "source": b["source"], "attempt": st["brief_attempts"],
                                                              "prompt_sha256": (b.get("llm") or {}).get("prompt_sha256")})
        return {**upd, "trace": _t("check_brief", t0, note, problems=res["problems"][:6])}

    def route_brief(st: EncState) -> str:
        return "publish" if st["brief"].get("grounding", {}).get("ok") or st["brief"]["source"] == "template" else "write_brief"

    def publish(st: EncState):
        t0 = time.perf_counter()
        tools.audit(st["encounter_id"], "agent_ready", {"brief_source": st["brief"]["source"],
                                                        "second_opinion": {k: v["verdict"] for k, v in (st.get("second_opinion") or {}).items()},
                                                        "overrides": list((st.get("overrides") or {}).keys()),
                                                        "coached_images": list((st.get("coaching") or {}).keys())})
        return {"status": "awaiting_signoff", "trace": _t("publish", t0, "brief, second opinion and coaching ready for the reviewer")}

    def await_signoff(st: EncState):
        review = interrupt({"waiting_for": "clinician sign-off", "encounter_id": st["encounter_id"]})
        return {"review": review, "status": "signed", "trace": [{"node": "await_signoff", "ms": 0, "at": time.time(),
                "note": f"signed by {review.get('reviewer')}: {review.get('decision')} → {review.get('final_outcome')}"}]}

    def route_signed(st: EncState) -> str:
        return "write_letter" if st["review"].get("final_outcome") == "REFER" else "done"

    def write_letter(st: EncState):
        t0 = time.perf_counter()
        enc = tools.get_encounter(st["encounter_id"])
        facts = W.case_facts(enc, st.get("second_opinion"), st.get("coaching"))
        fac = tools.facility(st["encounter_id"])
        n = st.get("letter_attempts", 0) + 1
        if L.available():
            try:
                r = L.chat(W.LETTER_SYSTEM, W.letter_prompt(facts, st["review"], fac, st.get("letter_feedback")))
                return {"facts": {**facts, "reviewer": st["review"].get("reviewer"), "reviewer_note": st["review"].get("reason")},
                        "letter": {"text": r["text"], "source": "llm", "attempts": n,
                                   "llm": {k: r[k] for k in ("model", "digest", "prompt_sha256", "ms", "options")}},
                        "letter_attempts": n, "trace": _t("write_letter", t0, f"LLM draft {n} ({r['ms']} ms)")}
            except Exception as e:
                note = f"LLM error ({type(e).__name__}); using template"
        else:
            note = "LLM not available; using template"
        return {"facts": facts, "letter": {"text": W.template_letter(facts, st["review"], fac), "source": "template",
                                           "attempts": n, "llm": None},
                "letter_attempts": MAX_WRITES, "trace": _t("write_letter", t0, note)}

    def check_letter(st: EncState):
        t0 = time.perf_counter()
        lt = dict(st["letter"])
        res = G.check(lt["text"], st["facts"], must_include=[st["encounter"]["patient_code"]])
        lt["grounding"] = res
        upd: dict = {"letter": lt}
        if res["ok"]:
            note = f"grounded ({res['numbers_checked']} numbers verified)"
        elif st["letter_attempts"] < MAX_WRITES:
            note = f"rejected: {'; '.join(res['problems'][:3])} → rewrite"
            upd["letter_feedback"] = res["problems"]
        else:
            fac = tools.facility(st["encounter_id"])
            tl = W.template_letter(st["facts"], st["review"], fac)
            upd["letter"] = {"text": tl, "source": "template", "attempts": st["letter_attempts"], "llm": lt.get("llm"),
                             "grounding": G.check(tl, st["facts"]), "rejected_drafts": st["letter_attempts"]}
            note = "rejected after retries → deterministic template"
        tools.audit(st["encounter_id"], "agent_letter_check", {"ok": res["ok"], "problems": res["problems"][:6], "source": lt["source"]})
        return {**upd, "trace": _t("check_letter", t0, note, problems=res["problems"][:6])}

    def route_letter(st: EncState) -> str:
        return "done" if st["letter"].get("grounding", {}).get("ok") or st["letter"]["source"] == "template" else "write_letter"

    def done(st: EncState):
        return {"status": "done", "trace": [{"node": "done", "ms": 0, "at": time.time(), "note": "run complete"}]}

    for name, fn in [("load_case", load_case), ("plan", plan), ("second_opinion", second_opinion), ("reconcile", reconcile),
                     ("coach", coach), ("write_brief", write_brief), ("check_brief", check_brief), ("publish", publish),
                     ("await_signoff", await_signoff), ("write_letter", write_letter), ("check_letter", check_letter),
                     ("done", done)]:
        g.add_node(name, fn)
    g.add_edge(START, "load_case")
    g.add_edge("load_case", "plan")
    g.add_conditional_edges("plan", lambda st: "second_opinion" if st["so_targets"] else "reconcile",
                            ["second_opinion", "reconcile"])
    g.add_conditional_edges("second_opinion",
                            lambda st: "second_opinion" if st["so_round"] < MAX_SO_ROUNDS and any(
                                v["verdict"] == "doubt_confirmed" for v in st["second_opinion"].values()) else "reconcile",
                            ["second_opinion", "reconcile"])
    g.add_edge("reconcile", "coach")
    g.add_edge("coach", "write_brief")
    g.add_edge("write_brief", "check_brief")
    g.add_conditional_edges("check_brief", route_brief, ["write_brief", "publish"])
    g.add_edge("publish", "await_signoff")
    g.add_conditional_edges("await_signoff", route_signed, ["write_letter", "done"])
    g.add_edge("write_letter", "check_letter")
    g.add_conditional_edges("check_letter", route_letter, ["write_letter", "done"])
    g.add_edge("done", END)

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    return g.compile(checkpointer=SqliteSaver(conn)), conn


def resume_command(review: dict) -> Command:
    return Command(resume=review)


MERMAID = None


def mermaid(graph) -> str:
    try:
        return graph.get_graph().draw_mermaid()
    except Exception:
        return ""
