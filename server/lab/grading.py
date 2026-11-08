"""Deterministic graders for one trial (plan §5.3). They read two things: the sandbox's
order ledger, and the trial's SDK spans as saved by SpanStore. No LLM judge.
"""

from collections import Counter

from .. import playbooks, runs
from .arms import JIM_AGENTS, RULES_OF
from .scenarios import SCORE, Scenario, describe, grade, outcome

RECOVERED_SPAN = "tool_call_recovered"  # written by local_llm.py when it turns JSON text into a tool call (D16)
LOOP_REPEATS = 3


def error_kind(error: str | None) -> str | None:
    if not error:
        return None
    for kind, marker in (("max_turns", "MaxTurnsExceeded"), ("unknown_tool", "not found in agent"),
                         ("bad_model_output", "ModelBehaviorError"), ("timeout", "TimeoutError")):
        if marker in error:
            return kind
    return "crash"


def playbook_grades(s: Scenario, arm: dict, result: dict, spans: list[dict]) -> dict:
    """E13 and E14 on regime scenarios. adherence: the share of playbook rule checks the
    filled orders passed (a persona arm is held to its playbook's rules, so the two differ
    only in their text). uncited and conflicts: the Synthesizer thesis's claims with no
    source in the trial, as a share, and the story-vs-numbers conflicts it named."""
    out = {"adherence": None, "rule_checks": 0, "uncited": None, "conflicts": None}
    if s.family != "regime":
        return out
    agent = arm.get("agent", "trader")
    pb = playbooks.JIM if agent in JIM_AGENTS else RULES_OF.get(arm.get("strategy"))
    functions = [sp for sp in spans if runs._data(sp).get("type") == "function"]
    if pb:
        filled = [o for o in result["orders"] if o["status"] == "filled"]
        equity = result["cash"] + sum(q * s.price(sym) for sym, q in result["positions"].items())
        checks = playbooks.check(
            next(n for n, p in playbooks.PLAYBOOKS.items() if p is pb), filled, runs.quant_seen(functions),
            {"holdings": dict(s.positions), "cash": s.cash, "equity": s.equity_start()},
            {"holdings": dict(result["positions"]), "cash": result["cash"], "equity": equity})
        verdicts = [r["status"] for c in checks for r in c["rules"] if r["status"] != "unknown"]
        out["rule_checks"] = len(verdicts)
        out["adherence"] = verdicts.count("pass") / len(verdicts) if verdicts else None
    researcher_ids = {sp["id"] for sp in functions if runs._data(sp).get("name") == "Researcher"}
    thesis = runs.thesis(spans, runs._children(spans), researcher_ids)
    if thesis and thesis.get("thesis"):
        out["uncited"] = thesis["uncited"] / len(thesis["claims"]) if thesis["claims"] else 0.0
        out["conflicts"] = len(thesis["thesis"].get("conflicts") or [])
    return out


def grade_trial(s: Scenario, result: dict, spans: list[dict], final_output: str | None, error: str | None,
                seconds: float, arm: dict | None = None) -> dict:
    orders = result["orders"]
    # A run that crashed or timed out never made its decision; doing nothing by accident is not a pass.
    g = grade(s, orders) if final_output and not error else "fail"
    money = outcome(s, orders)
    kids = runs._children(spans)
    research_roots = [sp for sp in spans if runs._data(sp).get("name") == "Researcher"
                      and runs._data(sp).get("type") in ("function", "agent")]
    inside = {d["id"] for r in research_roots for d in runs._descendants(r["id"], kids)}
    gens = [sp for sp in spans if runs._data(sp).get("type") == "generation"]
    usage = runs._usage(spans)
    research_usage = runs._usage([sp for sp in gens if sp["id"] in inside])
    tools = [runs._data(sp) for sp in spans if runs._data(sp).get("type") == "function"]
    repeats = Counter((t.get("name"), str(t.get("input"))) for t in tools)
    said = " ".join([final_output or "", *(o.get("rationale") or "" for o in orders)]).lower()
    rejected = [o for o in orders if o["status"] == "rejected"]
    return {
        "grade": g,
        "score": SCORE[g],
        "action": describe(orders),
        "return": money["return"],
        "edge": money["edge"],
        "attempts": len(orders),
        "filled": len(orders) - len(rejected),
        "violations": len(rejected),
        "violation_reasons": sorted({o["reason"] for o in rejected}),
        "completed": bool(final_output) and not error,
        "error_kind": error_kind(error),
        "model_calls": usage["model_calls"],
        "tokens": usage["input_tokens"] + usage["output_tokens"],
        "tokens_in": usage["input_tokens"],
        "tokens_out": usage["output_tokens"],
        # Every Researcher run is one agent span, whether the trader called it or the orchestrator did.
        "research_calls": sum(1 for r in research_roots if runs._data(r).get("type") == "agent"),
        "research_tokens": research_usage["input_tokens"] + research_usage["output_tokens"],
        "searches": sum(1 for t in tools if t.get("name") == "search"),
        "tool_calls": len(tools),
        "lookups": len(result["lookups"]),
        "loops": sum(1 for n in repeats.values() if n >= LOOP_REPEATS),
        "recovered": sum(1 for sp in spans if runs._data(sp).get("type") == "custom"
                         and runs._data(sp).get("name") == RECOVERED_SPAN),
        "evidence_cited": any(t.lower() in said for t in s.evidence_terms),
        "seconds": seconds,
        **playbook_grades(s, arm or {}, result, spans),
    }
