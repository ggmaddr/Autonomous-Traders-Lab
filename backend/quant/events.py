"""The news behind each regime transition (plan §4.4.3, step 6): the Researcher is asked
only what the numbers cannot answer, why the market turned around that date. One traced
run per transition, kept as an SDK trace; its headline, summary and sources are saved in
market_events. A transition confirmed within a week of the other model's, already
explained, reuses that explanation instead of searching again.
"""

import json
from contextlib import AsyncExitStack
from datetime import date, timedelta

from agents import Agent, Runner, trace

from local_llm import local_model
from .. import runs
from ..database import read_spans
from ..mcp_servers import web_mcp_servers
from ..tracers import make_trace_id
from . import store
from .regimes import DWELL

MAX_TURNS = 12
NEAR_DAYS = 7

INSTRUCTIONS = """You are a financial researcher. You explain why the US stock market changed character
around a given date, using web search for news from those days: central bank decisions, inflation and jobs
data, earnings, geopolitics, credit events. Search for news dated within the window you are given; do not
rely on what you remember. Then reply with one JSON object and nothing else:
{"headline": "<at most 12 words: what turned the market>",
 "summary": "<2-3 sentences: what happened and how markets reacted, with dates>",
 "sources": [{"title": "<page title>", "url": "<url you actually saw>"}]}"""


def request(t: dict) -> str:
    flip = date.fromisoformat(t["day"]) - timedelta(days=DWELL + 3)
    return (f"US stocks moved from a '{t['from_label']}' regime to a '{t['to_label']}' regime, confirmed on "
            f"{t['day']} after the change had held for {DWELL} trading days. What news moved markets between "
            f"{flip.isoformat()} and {t['day']}? SPY over that window: {t['detail']}.")


def parse(text: str) -> dict | None:
    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[i:])
        except ValueError:
            continue
        if isinstance(value, dict) and value.get("headline"):
            return value
    return None


def transitions(rows: list[dict], start: str) -> list[dict]:
    out = []
    for prev, cur in zip(rows, rows[1:]):
        if cur["day"] >= start and cur["label"] != prev["label"]:
            out.append({"day": cur["day"], "from_label": prev["label"], "to_label": cur["label"]})
    return out


async def explain(t: dict, model: str) -> dict:
    trace_id = make_trace_id("marketyear")
    agent = Agent(name="Researcher", instructions=INSTRUCTIONS, model=local_model)
    metadata = {"mode": "market_year", "model": model, "transition": t["day"]}
    async with AsyncExitStack() as stack:
        agent.mcp_servers = [await stack.enter_async_context(s) for s in web_mcp_servers()]
        with trace(f"Market-Year-{t['day']}", trace_id=trace_id, metadata=metadata):
            result = await Runner.run(agent, request(t), max_turns=MAX_TURNS)
    reply = parse(str(result.final_output)) or {}
    seen = runs._sources(read_spans([trace_id]))
    sources = [s for s in reply.get("sources") or [] if isinstance(s, dict) and s.get("url")] or \
        [{"title": s["title"], "url": s["url"]} for s in seen[:5]]
    return {
        "day": t["day"], "model": model, "from_label": t["from_label"], "to_label": t["to_label"],
        "headline": str(reply.get("headline") or "No explanation found").strip(),
        "summary": str(reply.get("summary") or str(result.final_output)[:600]).strip(),
        "sources": sources[:5], "trace_id": trace_id,
    }


async def explain_all(model_rows: dict[str, list[dict]], start: str, spy_detail) -> int:
    """Research every transition since start that has no explanation yet."""
    written = 0
    known = {(e["model"], e["day"]): e for m in model_rows for e in store.read_events(m, start)}
    for model, rows in model_rows.items():
        for t in transitions(rows, start):
            if (model, t["day"]) in known:
                continue
            day = date.fromisoformat(t["day"])
            # Only the other model's explanation of the same turn is reused, never another turn of this model.
            near = next((e for (m, _), e in known.items()
                         if m != model and abs((date.fromisoformat(e["day"]) - day).days) <= NEAR_DAYS), None)
            if near:
                event = {**near, "day": t["day"], "model": model, "from_label": t["from_label"], "to_label": t["to_label"]}
            else:
                try:
                    event = await explain({**t, "detail": spy_detail(t["day"])}, model)
                except Exception as e:
                    print(f"Transition {t['day']} ({model}) not explained: {type(e).__name__}: {e}")
                    continue
            store.write_event(event)
            known[(model, t["day"])] = event
            written += 1
    return written
