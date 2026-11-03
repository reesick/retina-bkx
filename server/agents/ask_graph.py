"""'Ask Retinitry': a programme-lead agent (LangGraph tool-calling loop) over read-only tools.

    agent ─► tools ─► agent ... (≤ 5 tool rounds) ─► answer ─► check (numbers must come from tool results) ─┬─► END
                                                                                                          └─► answer (rewrite once)
The agent never sees raw SQL or patient images; every tool is a fixed read-only query implemented by the Service.
Without the local LLM, the endpoint reports that the agent is unavailable (no guessing).
"""
from __future__ import annotations

import json
import operator
import time
from typing import Annotated, Any, Callable, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.graph import END, START, StateGraph

from . import grounding as G
from . import llm as L

MAX_TOOL_ROUNDS = 5

SYSTEM = (
    "You are the assistant for a diabetic-retinopathy screening programme lead. Answer questions about screenings, "
    "referrals, clinician overrides and measured model performance using ONLY the tools. Always call a tool before "
    "answering a question about numbers. Copy numbers exactly from tool results; never estimate. If the tools cannot "
    "answer, say so. Never give medical advice about an individual patient. Answer in at most 4 sentences."
)


class AskState(TypedDict, total=False):
    question: str
    messages: Annotated[list, operator.add]
    tool_results: Annotated[list, operator.add]
    rounds: int
    answer: str
    grounding: dict
    rewrites: int
    trace: Annotated[list, operator.add]


def make_tools(fns: dict[str, Callable[..., Any]]) -> list[StructuredTool]:
    def T(name, fn, desc):
        return StructuredTool.from_function(fn, name=name, description=desc)

    return [
        T("screening_summary", fns["screening_summary"],
          "Counts of screenings in the last `days` days: total, by AI outcome, by final clinician outcome, awaiting review."),
        T("referral_pipeline", fns["referral_pipeline"],
          "Referral counts by status (issued, scheduled, attended, feedback, closed, not_completed), completion rate, "
          "median days to attendance, number overdue."),
        T("overdue_referrals", fns["overdue_referrals"],
          "List of overdue referrals with patient code, status, days since issue and priority."),
        T("override_summary", fns["override_summary"],
          "Clinician sign-offs in the last `days` days: approvals vs overrides, AI→final outcome changes, override reasons."),
        T("model_performance", fns["model_performance"],
          "Measured model results for a dataset: 'idrid' (external), 'ddr', 'deepdrid_val' or 'aptos_test'. "
          "Returns AUROC, sensitivity, specificity, referable eyes cleared as routine, human review rate."),
        T("find_case", fns["find_case"], "Status and outcomes of one screening by patient code."),
    ]


def build(fns: dict[str, Callable[..., Any]]):
    tools = make_tools(fns)
    by_name = {t.name: t for t in tools}
    g = StateGraph(AskState)

    def _llm():
        from langchain_ollama import ChatOllama

        return ChatOllama(model=L.MODEL, base_url=L.OLLAMA_URL, **L.OPTIONS).bind_tools(tools)

    def agent(st: AskState):
        t0 = time.perf_counter()
        msgs = st.get("messages") or []
        if not msgs:
            msgs_in = [SystemMessage(content=SYSTEM), HumanMessage(content=st["question"])]
        else:
            msgs_in = [SystemMessage(content=SYSTEM), HumanMessage(content=st["question"]), *msgs]
        out = _llm().invoke(msgs_in)
        calls = [c["name"] for c in (out.tool_calls or [])]
        return {"messages": [out], "rounds": st.get("rounds", 0) + 1,
                "trace": [{"node": "agent", "ms": round((time.perf_counter() - t0) * 1000),
                           "note": ("calls " + ", ".join(calls)) if calls else "answers"}]}

    def run_tools(st: AskState):
        t0 = time.perf_counter()
        last: AIMessage = st["messages"][-1]
        msgs, results = [], []
        for c in last.tool_calls:
            t = by_name.get(c["name"])
            try:
                val = t.invoke(c.get("args") or {}) if t else {"error": f"unknown tool {c['name']}"}
            except Exception as e:  # bad arguments from the model
                val = {"error": f"{type(e).__name__}: {e}"}
            results.append({"tool": c["name"], "args": c.get("args"), "result": val})
            msgs.append(ToolMessage(content=json.dumps(val, default=str), tool_call_id=c["id"]))
        return {"messages": msgs, "tool_results": results,
                "trace": [{"node": "tools", "ms": round((time.perf_counter() - t0) * 1000),
                           "note": ", ".join(f"{r['tool']}({json.dumps(r['args'])})" for r in results)}]}

    def route_agent(st: AskState) -> str:
        last = st["messages"][-1]
        if getattr(last, "tool_calls", None) and st.get("rounds", 0) <= MAX_TOOL_ROUNDS:
            return "tools"
        return "check"

    def check(st: AskState):
        t0 = time.perf_counter()
        text = str(st["messages"][-1].content).strip()
        facts = {"tool_results": [r["result"] for r in st.get("tool_results", [])]}
        if not st.get("tool_results"):
            res = {"ok": False, "problems": ["answered without using any tool"], "numbers_checked": 0}
        else:
            res = G.check(text, facts)
            # programme answers may legitimately mention ordinary words like 'diagnosis' when quoting a question; keep only number problems
            res["problems"] = [p for p in res["problems"] if p.startswith("number") or p.startswith("answered")]
            res["ok"] = not res["problems"]
        return {"answer": text, "grounding": res,
                "trace": [{"node": "check", "ms": round((time.perf_counter() - t0) * 1000),
                           "note": "grounded" if res["ok"] else "rejected: " + "; ".join(res["problems"][:3])}]}

    def route_check(st: AskState) -> str:
        return END if st["grounding"]["ok"] or st.get("rewrites", 0) >= 1 else "rewrite"

    def rewrite(st: AskState):
        fb = "Your answer was rejected: " + "; ".join(st["grounding"]["problems"]) + \
             ". Use the tools if you have not, and only copy numbers that appear in tool results."
        return {"messages": [HumanMessage(content=fb)], "rewrites": st.get("rewrites", 0) + 1,
                "trace": [{"node": "rewrite", "ms": 0, "note": "asked the agent to fix its answer"}]}

    g.add_node("agent", agent)
    g.add_node("tools", run_tools)
    g.add_node("check", check)
    g.add_node("rewrite", rewrite)
    g.add_edge(START, "agent")
    g.add_conditional_edges("agent", route_agent, ["tools", "check"])
    g.add_edge("tools", "agent")
    g.add_conditional_edges("check", route_check, [END, "rewrite"])
    g.add_edge("rewrite", "agent")
    return g.compile()


def ask(graph, question: str) -> dict:
    t0 = time.perf_counter()
    st = graph.invoke({"question": question, "messages": [], "tool_results": [], "trace": [], "rounds": 0, "rewrites": 0},
                      {"recursion_limit": 30})
    return {"question": question, "answer": st.get("answer", ""), "grounded": st.get("grounding", {}).get("ok", False),
            "problems": st.get("grounding", {}).get("problems", []), "tool_calls": st.get("tool_results", []),
            "trace": st.get("trace", []), "ms": round((time.perf_counter() - t0) * 1000), "model": L.MODEL}
