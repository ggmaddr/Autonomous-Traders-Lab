"""The post-cycle review (plan §11.4). After each cycle, every traced decision that has
reached a review horizon (3 days, then 10) gets its outcome computed and one short
prompt on the local model turns it into 1–3 lessons. Each lesson is saved as a row in
`lessons` and written into the trader's memory graph, where its researcher can find it.

A decision is the fills of one run in one symbol on one side. Its return is the
symbol's move since the fill, signed so that positive means the decision was right
(a buy that rose, a sell that fell); the benchmark is SPY's move over the same days.

Run it by hand with `uv run -m backend.review`.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone

from agents import Agent, Runner, trace

from local_llm import local_model
from . import memory, runs
from .accounts import Account
from .database import mark_contradicted, read_lessons, set_recalled_counts, write_lesson
from .market import price_at, quote
from .templates import LESSON_PATTERNS, review_instructions, review_message
from .tracers import make_trace_id

HORIZONS = (3, 10)  # days after the trade
BENCHMARK = "SPY"
EVIDENCE_CHARS = 700
KINDS = {"success", "mistake"}


def _fill_time(stamp: str) -> datetime:
    """Transaction times are naive local time (D9)."""
    return datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S").astimezone()


def decisions(trader: str) -> list[dict]:
    """The trader's traced fills, grouped into decisions."""
    account = Account.get(trader)
    grouped: dict[tuple, dict] = {}
    for i, t in enumerate(account.transactions):
        if not t.trace_id:
            continue
        side = "buy" if t.quantity > 0 else "sell"
        d = grouped.setdefault(
            (t.trace_id, t.symbol, side),
            {"trader": trader.lower(), "trace_id": t.trace_id, "symbol": t.symbol, "side": side,
             "fill_ids": [], "quantity": 0, "cost": 0.0, "at": _fill_time(t.timestamp), "rationale": t.rationale},
        )
        d["fill_ids"].append(f"{trader.lower()}-{i}")
        d["quantity"] += abs(t.quantity)
        d["cost"] += abs(t.quantity) * t.price
    for d in grouped.values():
        d["price"] = d["cost"] / d["quantity"]
    return list(grouped.values())


def due_horizon(decision: dict, reviewed: dict[tuple, int], now: datetime) -> int | None:
    """The longest horizon the decision has reached, unless it was already reviewed
    there or later. A decision first seen at 12 days old is reviewed once, at 10."""
    age = now - decision["at"]
    reached = [h for h in HORIZONS if age >= timedelta(days=h)]
    if not reached:
        return None
    done = reviewed.get((decision["trace_id"], decision["symbol"], decision["side"]), 0)
    return reached[-1] if reached[-1] > done else None


def pending(trader: str, now: datetime | None = None) -> list[dict]:
    """Decisions waiting for their next review, with the day it falls due."""
    now = now or datetime.now(timezone.utc)
    reviewed = _reviewed(trader)
    out = []
    for d in decisions(trader):
        done = reviewed.get((d["trace_id"], d["symbol"], d["side"]), 0)
        later = [h for h in HORIZONS if h > done]
        if later:
            out.append({
                "trader": d["trader"], "symbol": d["symbol"], "side": d["side"], "fill_ids": d["fill_ids"],
                "decided_at": d["at"].isoformat(), "horizon_days": later[0],
                "due_at": (d["at"] + timedelta(days=later[0])).isoformat(),
            })
    return out


def _reviewed(trader: str) -> dict[tuple, int]:
    done: dict[tuple, int] = {}
    for lesson in read_lessons(trader):
        for trace_id in lesson["trace_ids"]:
            key = (trace_id, lesson["symbol"], lesson["side"])
            done[key] = max(done.get(key, 0), lesson["horizon_days"] or 0)
    return done


def outcome(decision: dict) -> dict | None:
    """None when the symbol has no price now; the review then waits for the next cycle.
    A missing SPY price leaves only the benchmark empty."""
    now_price = quote(decision["symbol"])
    if now_price is None:
        return None
    move = now_price / decision["price"] - 1
    spy_then = price_at(BENCHMARK, decision["at"])
    spy_now = quote(BENCHMARK) if spy_then else None
    return {
        "price_now": now_price,
        "return": move if decision["side"] == "buy" else -move,
        "move": move,
        "benchmark_return": spy_now / spy_then - 1 if spy_then and spy_now else None,
    }


def evidence(decision: dict) -> str:
    """What the trader had at the time, from its saved run: its reason, the research
    that named the symbol, the prices it looked up, and the strategy in force."""
    run = runs.run_detail(decision["trace_id"]) or {}
    lines = [f"Reason given: {decision['rationale']}"]
    cited = [r for r in run.get("research", []) if decision["symbol"] in (r.get("answer") or "")]
    for r in cited[:2]:
        lines.append(f"Research asked: {r['request'][:200]}\nResearch answer: {r['answer'][:EVIDENCE_CHARS]}")
    if not cited:
        lines.append("No research in the run named the symbol.")
    looked_up = [c for c in run.get("market_calls", []) if decision["symbol"] in json.dumps(c.get("args"))]
    lines.append(f"Price lookups for {decision['symbol']} before trading: {len(looked_up)}")
    if run.get("strategy"):
        lines.append(f"Strategy in force: {run['strategy'][:400]}")
    return "\n".join(lines)


def describe(decision: dict, result: dict, horizon: int) -> str:
    bench = result["benchmark_return"]
    spy = f"{bench:+.1%}" if bench is not None else "unknown"
    return (
        f"{decision['side']} {decision['quantity']} {decision['symbol']} at ${decision['price']:.2f} "
        f"on {decision['at']:%Y-%m-%d}. {horizon} days later it is ${result['price_now']:.2f} "
        f"({result['move']:+.1%}); SPY over the same days: {spy}."
    )


def parse_lessons(text: str) -> list[dict]:
    """The first JSON object in the reply, kept to well-formed lessons."""
    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[i:])
        except ValueError:
            continue
        items = value.get("lessons") if isinstance(value, dict) else None
        if isinstance(items, list):
            return [
                {
                    "text": str(x["text"]).strip(),
                    "kind": x["kind"],
                    "pattern": x.get("pattern") if x.get("pattern") in LESSON_PATTERNS else "other",
                }
                for x in items[:3]
                if isinstance(x, dict) and x.get("text") and x.get("kind") in KINDS
            ]
    return []


async def write_lessons(decision: dict, horizon: int, cycle_id: str | None) -> list[int]:
    result = outcome(decision)
    if result is None:
        print(f"Review of {decision['trader']} {decision['symbol']} waits: no price now")
        return []
    summary = describe(decision, result, horizon)
    trader = decision["trader"]
    trace_id = make_trace_id(trader)
    agent = Agent(name=f"{trader.capitalize()} reviewer", instructions=review_instructions(), model=local_model)
    metadata = {"trader": trader, "mode": "review", "cycle_id": cycle_id, "horizon_days": str(horizon)}
    with trace(f"{trader.capitalize()}-review", trace_id=trace_id, group_id=cycle_id, metadata=metadata):
        reply = await Runner.run(agent, review_message(trader.capitalize(), summary, evidence(decision)), max_turns=1)
    drafts = parse_lessons(str(reply.final_output))
    ids = []
    for draft in drafts:
        lesson_id = write_lesson({
            "trader": trader,
            "text": draft["text"],
            "kind": draft["kind"],
            "pattern": draft["pattern"],
            "fill_ids": decision["fill_ids"],
            "trace_ids": [decision["trace_id"]],
            "return": result["return"],
            "benchmark_return": result["benchmark_return"],
            "symbol": decision["symbol"],
            "side": decision["side"],
            "horizon_days": horizon,
            "decided_at": decision["at"].isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "review_trace_id": trace_id,
        })
        memory.write_lesson(trader, lesson_id, decision["symbol"], draft["pattern"], [
            draft["text"],
            f"{draft['kind'].capitalize()}. {summary}",
            f"Pattern: {draft['pattern']}. From fills {', '.join(decision['fill_ids'])}.",
        ])
        contradict(trader, lesson_id)
        ids.append(lesson_id)
    return ids


def contradict(trader: str, lesson_id: int):
    """A lesson about the same symbol or pattern that points the other way marks the
    earlier ones contradicted. "other" is not a pattern, so it only matches on symbol."""
    lessons = read_lessons(trader)
    new = next(l for l in lessons if l["id"] == lesson_id)
    earlier = [
        l for l in lessons
        if l["id"] < lesson_id
        and l["kind"] != new["kind"]
        and l["contradicted_by"] is None
        and (l["symbol"] == new["symbol"] or (l["pattern"] == new["pattern"] and new["pattern"] != "other"))
    ]
    if not earlier:
        return
    mark_contradicted([l["id"] for l in earlier], lesson_id)
    later = memory.lesson_name(lesson_id, new["symbol"])
    memory.write_contradiction(
        trader, later, [memory.lesson_name(l["id"], l["symbol"]) for l in earlier],
        f"Contradicted by {later}: {new['text']}",
    )


def recalls(trader: str, lessons: list[dict] | None = None) -> dict[int, list[dict]]:
    """For each lesson, the memory reads in later runs that returned it before the
    run's first order: the trader recalled it before trading."""
    lessons = lessons if lessons is not None else read_lessons(trader)
    created = {l["id"]: l["created_at"] for l in lessons}
    found: dict[int, list[dict]] = {i: [] for i in created}
    for read in runs.memory_reads(trader):
        if not read["before_order"]:
            continue
        for name in read["returned"]:
            lesson_id = memory.lesson_id_of(name)
            if lesson_id in created and (read["at"] or "") > created[lesson_id]:
                found[lesson_id].append(read)
    return found


async def review(traders: list[str], cycle_id: str | None = None) -> int:
    """Review every decision that is due, then refresh the recall counts."""
    now = datetime.now(timezone.utc)
    written = 0
    for trader in traders:
        reviewed = _reviewed(trader)
        for decision in decisions(trader):
            horizon = due_horizon(decision, reviewed, now)
            if horizon is None:
                continue
            try:
                written += len(await write_lessons(decision, horizon, cycle_id))
            except Exception as e:
                print(f"Review of {trader} {decision['symbol']} failed: {type(e).__name__}: {e}")
        set_recalled_counts({i: len(r) for i, r in recalls(trader).items()})
    return written


if __name__ == "__main__":
    from agents import add_trace_processor
    from .tracers import LogTracer, SpanStore
    from .trading_floor import names

    add_trace_processor(LogTracer())
    add_trace_processor(SpanStore())
    print(f"Wrote {asyncio.run(review(names))} lessons")
