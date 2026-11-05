"""Read the saved SDK spans back as the things the UI shows: what the researcher was
asked and found, which prices the trader looked up, which orders it tried, and the
run's timeline. The spans are stored exactly as the SDK exported them (tracers.py),
so all the interpretation lives here, at read time.
"""

import ast
import json
import os
import re
from datetime import datetime

from .database import read_run, read_runs, read_researcher_trace_ids, read_spans, read_tool_spans

RESEARCHER = "Researcher"
SEARCH_TOOLS = {"tavily_search"}
FETCH_TOOLS = {"fetch"}
ORDER_TOOLS = {"buy_shares", "sell_shares"}
ACCOUNT_TOOLS = {"get_balance", "get_holdings", "change_strategy", "push"}
MEMORY_READ_TOOLS = {"search_nodes", "read_graph"}  # mcp-memory-libsql's read tools
PREVIEW = 600

ENTITY_NAME = re.compile(r'"name"\s*:\s*"((?:[^"\\]|\\.)*)"')
URL = re.compile(r"https?://[^\s\"'<>\\)\]]+")
TITLED = re.compile(r"Title:\s*(.+?)\s*(?:\\n|\n)\s*URL:\s*(https?://[^\s\"'<>\\]+)")


def trader_of(trace_id: str) -> str | None:
    """Traces are named trace_<trader>0<random> (tracers.make_trace_id)."""
    tag = trace_id.split("_", 1)[1] if "_" in trace_id else ""
    return tag.split("0")[0] if "0" in tag else None


def _ms(start: str | None, end: str | None) -> float | None:
    if not start or not end:
        return None
    return (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds() * 1000


def tool_text(output) -> str:
    """The text of a tool result. MCP results arrive as the repr of a content dict or list."""
    if output is None:
        return ""
    text = str(output)
    if text[:1] in "{[" and "'type'" in text:
        try:
            value = ast.literal_eval(text)
            items = value if isinstance(value, list) else [value]
            return "\n".join(str(i.get("text", "")) for i in items if isinstance(i, dict))
        except (ValueError, SyntaxError):
            pass
    return text


def _args(raw) -> dict:
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def _data(span: dict) -> dict:
    return span.get("span_data") or {}


def _name(span: dict) -> str:
    d = _data(span)
    return d.get("name") or d.get("model") or d.get("server") or d.get("type") or "span"


def _children(spans: list[dict]) -> dict[str | None, list[dict]]:
    kids: dict[str | None, list[dict]] = {}
    for s in spans:
        kids.setdefault(s.get("parent_id"), []).append(s)
    return kids


def _descendants(span_id: str, kids: dict) -> list[dict]:
    out, stack = [], list(kids.get(span_id, []))
    while stack:
        s = stack.pop()
        out.append(s)
        stack.extend(kids.get(s["id"], []))
    return out


def _usage(spans: list[dict]) -> dict:
    total = {"model_calls": 0, "input_tokens": 0, "output_tokens": 0}
    for s in spans:
        d = _data(s)
        if d.get("type") != "generation":
            continue
        total["model_calls"] += 1
        usage = d.get("usage") or {}
        total["input_tokens"] += usage.get("input_tokens") or 0
        total["output_tokens"] += usage.get("output_tokens") or 0
    return total


def _sources(spans: list[dict]) -> list[dict]:
    """Every page the researcher saw: search results (with titles when given) and fetches."""
    found: dict[str, dict] = {}
    for s in spans:
        d = _data(s)
        if d.get("type") != "function":
            continue
        if d.get("name") in SEARCH_TOOLS:
            text = tool_text(d.get("output"))
            for title, url in TITLED.findall(text):
                found.setdefault(url, {"url": url, "title": title.strip(), "via": "search"})
            for url in URL.findall(text):
                found.setdefault(url, {"url": url, "title": None, "via": "search"})
        elif d.get("name") in FETCH_TOOLS:
            url = _args(d.get("input")).get("url")
            if url:
                found[url] = {**found.get(url, {"title": None}), "url": url, "via": "fetch"}
    return list(found.values())


def research_item(span: dict, kids: dict) -> dict:
    d = _data(span)
    inner = _descendants(span["id"], kids)
    tools = [_data(s) for s in inner if _data(s).get("type") == "function"]
    request = _args(d.get("input")).get("input") or d.get("input") or ""
    return {
        "id": span["id"],
        "trace_id": span["trace_id"],
        "trader": trader_of(span["trace_id"]),
        "started_at": span.get("started_at"),
        "ended_at": span.get("ended_at"),
        "duration_ms": _ms(span.get("started_at"), span.get("ended_at")),
        "request": request,
        "answer": tool_text(d.get("output")),
        "error": span.get("error"),
        "sources": _sources(inner),
        "searches": [_args(t.get("input")).get("query") for t in tools if t.get("name") in SEARCH_TOOLS],
        "fetches": sum(1 for t in tools if t.get("name") in FETCH_TOOLS),
        "memory_calls": sum(1 for t in tools if t.get("name") not in SEARCH_TOOLS | FETCH_TOOLS),
        **_usage(inner),
    }


def research(trader: str | None = None, limit: int = 100) -> list[dict]:
    """Every Researcher call, newest first."""
    trace_ids = read_researcher_trace_ids(trader, limit)
    spans = read_spans(trace_ids)
    kids = _children(spans)
    items = [
        research_item(s, kids)
        for s in spans
        if _data(s).get("type") == "function" and _data(s).get("name") == RESEARCHER
    ]
    modes = {r["trace_id"]: r["mode"] for r in read_runs(trader, 1000)}
    for item in items:
        item["mode"] = modes.get(item["trace_id"])
    items.sort(key=lambda i: i["started_at"] or "", reverse=True)
    return items[:limit]


def _account(raw: str | None) -> dict | None:
    if not raw:
        return None
    a = _args(raw)
    return {
        "balance": a.get("balance"),
        "holdings": a.get("holdings") or {},
        "portfolio_value": a.get("total_portfolio_value"),
        "pnl": a.get("total_profit_loss"),
    }


def runs(trader: str | None = None, limit: int = 200) -> list[dict]:
    return [
        {k: r[k] for k in ("trace_id", "cycle_id", "trader", "mode", "error", "started_at", "ended_at")}
        for r in read_runs(trader, limit)
    ]


def run_detail(trace_id: str) -> dict | None:
    run = read_run(trace_id)
    spans = read_spans([trace_id])
    if not run and not spans:
        return None
    kids = _children(spans)
    researcher_ids = {
        s["id"] for s in spans if _data(s).get("type") == "function" and _data(s).get("name") == RESEARCHER
    }
    inside_research = {d["id"] for rid in researcher_ids for d in _descendants(rid, kids)}
    own = [s for s in spans if s["id"] not in inside_research]

    def call(s: dict) -> dict:
        d = _data(s)
        return {
            "id": s["id"],
            "name": d.get("name"),
            "args": _args(d.get("input")),
            "result": tool_text(d.get("output"))[:PREVIEW],
            "error": s.get("error"),
            "at": s.get("started_at"),
        }

    functions = [s for s in own if _data(s).get("type") == "function" and _data(s).get("name") != RESEARCHER]
    t0 = min((s["started_at"] for s in spans if s.get("started_at")), default=None)
    depth: dict[str, int] = {}
    for s in spans:
        depth[s["id"]] = depth.get(s.get("parent_id"), -1) + 1 if s.get("parent_id") else 0
    timeline = [
        {
            "id": s["id"],
            "type": _data(s).get("type"),
            "name": _name(s),
            "depth": depth.get(s["id"], 0),
            "offset_ms": _ms(t0, s.get("started_at")),
            "duration_ms": _ms(s.get("started_at"), s.get("ended_at")),
            "error": s.get("error"),
        }
        for s in spans
        if _data(s).get("type") != "mcp_tools"
    ]
    key = os.getenv("OPENAI_API_KEY")
    return {
        "trace_id": trace_id,
        "trader": (run or {}).get("trader") or trader_of(trace_id),
        "cycle_id": (run or {}).get("cycle_id"),
        "mode": (run or {}).get("mode"),
        "strategy": (run or {}).get("strategy"),
        "output": (run or {}).get("output"),
        "error": (run or {}).get("error"),
        "started_at": (run or {}).get("started_at") or t0,
        "ended_at": (run or {}).get("ended_at"),
        "before": _account((run or {}).get("account_before")),
        "after": _account((run or {}).get("account_after")),
        "research": [research_item(s, kids) for s in spans if s["id"] in researcher_ids],
        "orders": [call(s) for s in functions if _data(s).get("name") in ORDER_TOOLS],
        "market_calls": [
            call(s) for s in functions if _data(s).get("name") not in ORDER_TOOLS | ACCOUNT_TOOLS
        ],
        "usage": _usage(spans),
        "mcp_listings": sum(1 for s in spans if _data(s).get("type") == "mcp_tools"),
        "timeline": timeline,
        "openai_trace_url": f"https://platform.openai.com/traces/trace?trace_id={trace_id}" if key else None,
    }


def memory_reads(trader: str) -> list[dict]:
    """Every memory read in this trader's runs (the researcher's, inside the same trace):
    what it searched for, which entities came back, and whether it came before the run's
    first order, so it could have shaped the trade."""
    spans = read_tool_spans(trader, MEMORY_READ_TOOLS | ORDER_TOOLS)
    first_order: dict[str, str] = {}
    for s in spans:
        if _data(s).get("name") in ORDER_TOOLS:
            first_order.setdefault(s["trace_id"], s.get("started_at") or "")
    reads = []
    for s in spans:
        d = _data(s)
        if d.get("name") not in MEMORY_READ_TOOLS:
            continue
        order_at = first_order.get(s["trace_id"])
        reads.append(
            {
                "span_id": s["id"],
                "trace_id": s["trace_id"],
                "at": s.get("started_at"),
                "tool": d.get("name"),
                "query": _args(d.get("input")).get("query"),
                "returned": sorted(set(ENTITY_NAME.findall(tool_text(d.get("output"))))),
                "before_order": order_at is None or (s.get("started_at") or "") < order_at,
                "run_had_orders": order_at is not None,
            }
        )
    return reads
