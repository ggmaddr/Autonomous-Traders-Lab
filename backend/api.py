"""HTTP API over the trading floor, for a separate frontend to consume.

This serves the data in accounts.db as JSON so a decoupled web frontend can
render it. Everything here is read-only except queueing and cancelling lab
experiments (backend/lab/routes.py); the trading floor and the lab worker write
the database out of band.

Run it from the project root so it shares the engine's accounts.db:

    uv run uvicorn backend.api:app --port 8000
"""

from fastapi import FastAPI, HTTPException

from backend import market, memory, review, runs
from backend.accounts import Account
from backend.database import read_lessons, read_log
from backend.trading_floor import names, lastnames, short_model_names
from backend.lab.routes import router as lab_router
from backend.quant.routes import router as market_year_router

# Colour for each log line type, so the frontend can draw the activity panel.
LOG_COLORS = {
    "trace": "#87CEEB",
    "agent": "#00dddd",
    "function": "#00dd00",
    "generation": "#dddd00",
    "response": "#aa00dd",
    "account": "#dd0000",
}
DEFAULT_LOG_COLOR = "#87CEEB"

roster = [
    {"name": name, "lastname": lastname, "model_name": model_name}
    for name, lastname, model_name in zip(names, lastnames, short_model_names)
]
roster_by_name = {trader["name"].lower(): trader for trader in roster}

app = FastAPI(title="Trading Floor")
app.include_router(lab_router)
app.include_router(market_year_router)


def average_cost(account: Account, symbol: str) -> float:
    """Average price paid across this symbol's buys, for per-holding profit."""
    spend = sum(t.price * t.quantity for t in account.transactions if t.symbol == symbol and t.quantity > 0)
    bought = sum(t.quantity for t in account.transactions if t.symbol == symbol and t.quantity > 0)
    return spend / bought if bought else 0.0


def holdings_detail(account: Account) -> list[dict]:
    """Current holdings enriched with price, market value and unrealised profit."""
    details = []
    for symbol, quantity in account.holdings.items():
        price = account.mark_price(symbol)
        cost = average_cost(account, symbol)
        details.append(
            {
                "symbol": symbol,
                "quantity": quantity,
                "price": price,
                "avg_cost": cost,
                "market_value": price * quantity,
                "unrealized_pnl": (price - cost) * quantity,
            }
        )
    return details


def require_trader(name: str) -> dict:
    trader = roster_by_name.get(name.lower())
    if not trader:
        raise HTTPException(status_code=404, detail=f"Unknown trader {name}")
    return trader


@app.get("/api/traders")
def get_traders() -> list[dict]:
    """The four traders on the floor."""
    return roster


@app.get("/api/market")
def get_market() -> dict:
    """Which price source is live, and whether the market is open."""
    source = "massive" if market.massive_api_key else "simulator"
    return {"source": source, "is_market_open": market.is_market_open()}


@app.get("/api/traders/{name}")
def get_trader(name: str) -> dict:
    """A trader's full state: value, profit, holdings, transactions and history."""
    trader = require_trader(name)
    account = Account.get(name)
    holdings = holdings_detail(account)
    portfolio_value = account.balance + sum(h["market_value"] for h in holdings)
    return {
        "name": trader["name"],
        "lastname": trader["lastname"],
        "model_name": trader["model_name"],
        "balance": account.balance,
        "strategy": account.strategy,
        "portfolio_value": portfolio_value,
        "pnl": account.calculate_profit_loss(portfolio_value),
        "holdings": holdings,
        "transactions": account.list_transactions(),
        "time_series": [{"datetime": ts, "value": value} for ts, value in account.portfolio_value_time_series],
    }


@app.get("/api/traders/{name}/logs")
def get_trader_logs(name: str, last_n: int = 13) -> list[dict]:
    """Recent trace and account log lines, oldest first, with their panel colour."""
    require_trader(name)
    rows = list(read_log(name, last_n))
    return [
        {"datetime": ts, "type": kind, "message": message, "color": LOG_COLORS.get(kind, DEFAULT_LOG_COLOR)}
        for ts, kind, message in rows
    ]


@app.get("/api/research")
def get_research(trader: str | None = None, limit: int = 100) -> list[dict]:
    """Every Researcher call, newest first: the request, the answer, its sources and its cost."""
    if trader:
        require_trader(trader)
    return runs.research(trader, limit)


@app.get("/api/runs")
def get_runs(trader: str | None = None, limit: int = 200) -> list[dict]:
    """Each trader run that was traced, newest first."""
    if trader:
        require_trader(trader)
    return runs.runs(trader, limit)


@app.get("/api/runs/{trace_id}")
def get_run(trace_id: str) -> dict:
    """One run: strategy in force, portfolio before and after, research, prices looked up,
    orders tried, and the SDK span timeline."""
    detail = runs.run_detail(trace_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"No saved run {trace_id}")
    return detail


def recurrence_key(lesson: dict) -> tuple:
    """Lessons recur when the same trader learns the same kind of thing again: the same
    pattern and verdict, or for lessons with no pattern, the same symbol and verdict."""
    topic = lesson["symbol"] if lesson["pattern"] == "other" else lesson["pattern"]
    return (lesson["trader"], topic, lesson["kind"])


@app.get("/api/lessons")
def get_lessons(trader: str | None = None) -> dict:
    """Lessons the review wrote, newest first, with how often each recurs, what
    contradicted it, and the runs that recalled it before trading; and the traced
    decisions still waiting for their next review."""
    names = [require_trader(trader)["name"]] if trader else [t["name"] for t in roster]
    lessons, waiting = [], []
    for name in names:
        own = read_lessons(name)
        recalled = review.recalls(name, own)
        fills = fills_by_trace(name)
        for lesson in own:
            lesson["recalls"] = [
                {"trace_id": r["trace_id"], "at": r["at"], "tool": r["tool"], "query": r["query"],
                 "fill_ids": fills.get(r["trace_id"], [])}
                for r in recalled[lesson["id"]]
            ]
            lesson["recalled_count"] = len(lesson["recalls"])
            lesson["contradicts"] = [l["id"] for l in own if l["contradicted_by"] == lesson["id"]]
            lesson["memory_node"] = memory.lesson_name(lesson["id"], lesson["symbol"])
        lessons += own
        waiting += review.pending(name)
    counts: dict[tuple, int] = {}
    for lesson in lessons:
        counts[recurrence_key(lesson)] = counts.get(recurrence_key(lesson), 0) + 1
    for lesson in lessons:
        lesson["recurs"] = counts[recurrence_key(lesson)]
    lessons.sort(key=lambda l: l["id"], reverse=True)
    waiting.sort(key=lambda p: p["due_at"])
    return {"lessons": lessons, "pending": waiting, "horizons": list(review.HORIZONS)}


def fills_by_trace(name: str) -> dict[str, list[str]]:
    """Fill IDs ("<trader>-<index>", as the frontend ledger numbers them) per run."""
    out: dict[str, list[str]] = {}
    for i, t in enumerate(Account.get(name).transactions):
        if t.trace_id:
            out.setdefault(t.trace_id, []).append(f"{name.lower()}-{i}")
    return out


def node_uses(name: str) -> dict[str, list[dict]]:
    """For each memory node, the runs whose memory reads returned it."""
    fills = fills_by_trace(name)
    modes = {r["trace_id"]: r["mode"] for r in runs.runs(name, 1000)}
    uses: dict[str, list[dict]] = {}
    for read in runs.memory_reads(name):
        use = {
            "trace_id": read["trace_id"], "span_id": read["span_id"], "at": read["at"], "tool": read["tool"],
            "query": read["query"], "before_order": read["before_order"], "run_had_orders": read["run_had_orders"],
            "mode": modes.get(read["trace_id"]), "fill_ids": fills.get(read["trace_id"], []),
        }
        for node in read["returned"]:
            uses.setdefault(node, []).append(use)
    return uses


@app.get("/api/memory/{name}")
def get_memory(name: str) -> dict:
    """A trader's knowledge graph from memory/<Name>.db: nodes with their observations
    and timestamps, edges, and how many runs read each node."""
    trader = require_trader(name)
    graph = memory.read_graph(trader["name"])
    uses = node_uses(trader["name"])
    for node in graph["nodes"]:
        node["used"] = len({u["trace_id"] for u in uses.get(node["name"], [])})
    reads = runs.memory_reads(trader["name"])
    return {"trader": trader["name"].lower(), **graph, "reads": len(reads)}


@app.get("/api/memory/{name}/node/{node:path}")
def get_memory_node(name: str, node: str) -> dict:
    """One node: its observations, its edges, and the runs that read it, with their fills."""
    trader = require_trader(name)
    graph = memory.read_graph(trader["name"])
    found = next((n for n in graph["nodes"] if n["name"] == node), None)
    if not found:
        raise HTTPException(status_code=404, detail=f"No memory node {node} for {trader['name']}")
    edges = [e for e in graph["edges"] if node in (e["source"], e["target"])]
    lesson = None
    if found["lesson_id"]:
        lesson = next((l for l in read_lessons(trader["name"]) if l["id"] == found["lesson_id"]), None)
    return {**found, "edges": edges, "uses": node_uses(trader["name"]).get(node, []), "lesson": lesson}
