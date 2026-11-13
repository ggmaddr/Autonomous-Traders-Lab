"""Two inexpensive, deterministic paper traders on a shared one-minute desk.

No model or search calls. Fresh IEX trades drive both signals and fills; missing
data means no order. Persisted transactions provide cooldowns across restarts.
"""
import asyncio
import json
import math
import os
import fcntl
from datetime import datetime, timedelta, timezone

from agents import custom_span, trace, add_trace_processor

from .accounts import Account, SPREAD, Transaction
from .database import start_run, end_run, write_log
from . import database
from .orb import UNIVERSE, BARS_URL, LATEST_URL, _get
from .quant.bars import NY
from .tracers import make_trace_id, LogTracer, SpanStore

NAMES = ["Jinbe", "Law"]
STRATEGIES = {
    "Jinbe": "Rules v1 · Momentum sprinter · checks every 60 seconds. Buy a 0.15% five-minute rise "
    "above the prior five bars' highs. Exit at +0.8%, -0.5%, after 20 minutes, or 10 minutes before "
    "the session closes. No overnight positions intended; missed exits retry next session.",
    "Law": "Rules v1 · Dip and rebound · checks every 60 seconds throughout the regular session. "
    "Buy 0.3% below the trailing 20-minute volume-weighted price when the latest minute turns up. "
    "Exit at the moving average, +0.9%, -0.7%, or after 90 elapsed minutes. May hold overnight.",
}
LIMITS = " Long only; 15% per position, 4 positions, 5-minute cooldown after a sale, 30 entries per session. " \
    "Fresh Alpaca IEX only; paper fills include 0.2% each side. No LLM or Tavily."


def stamp(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc)  # legacy naive account timestamps are local


def initialize():
    for name in NAMES:
        account = Account.get(name)
        account.strategy = STRATEGIES[name] + LIMITS
        account.price_source = "alpaca_iex"
        if not account.portfolio_value_time_series:
            account.portfolio_value_time_series.append((datetime.now().astimezone().isoformat(), account.balance))
        account.save()


def market_snapshot(now: datetime) -> dict:
    # Exchange calendar includes holidays and early closes; no fail-open assumption.
    clock = _get("https://paper-api.alpaca.markets/v2/clock", {})
    if not clock["is_open"]:
        return {"open": False, "bars": {}, "prices": {}, "close": None}
    end = now - timedelta(minutes=1)  # completed minute bars only
    body = _get(BARS_URL, {"symbols": ",".join(UNIVERSE), "timeframe": "1Min",
        "start": (now - timedelta(minutes=35)).isoformat(), "end": end.isoformat(),
        "feed": "iex", "limit": 10000, "sort": "asc"})
    trades = _get(LATEST_URL, {"symbols": ",".join(UNIVERSE), "feed": "iex"}).get("trades", {})
    prices = {}
    for symbol, row in trades.items():
        price = float(row["p"])
        age = (now - stamp(row["t"])).total_seconds()
        if math.isfinite(price) and price > 0 and -5 <= age <= 90:
            prices[symbol] = price
    return {"open": True, "bars": body.get("bars") or {}, "prices": prices,
            "close": stamp(clock["next_close"])}


def signal(name: str, bars: list[dict], price: float, now: datetime) -> tuple[bool, float | None, str]:
    rows = sorted((b for b in bars if 60 <= (now - stamp(b["t"])).total_seconds() <= 25 * 60
                   and stamp(b["t"]).astimezone(NY).date() == now.astimezone(NY).date()),
                  key=lambda b: b["t"])
    if len(rows) < 6 or (now - stamp(rows[-1]["t"])).total_seconds() > 180:
        return False, None, "waiting for fresh completed minute bars"
    if name == "Jinbe":
        recent = rows[-6:]
        move = price / recent[0]["c"] - 1
        high = max(b["h"] for b in recent[:-1])
        return move >= .0015 and price > high, None, f"five-bar momentum {move:.2%}; breakout above {high:.2f}"
    recent = rows[-20:]
    volume = sum(b["v"] for b in recent)
    if len(recent) < 15 or volume <= 0:
        return False, None, "waiting for 15+ bars with volume"
    mean = sum(b.get("vw", b["c"]) * b["v"] for b in recent) / volume
    return price <= mean * .997 and rows[-1]["c"] > rows[-2]["c"], mean, f"dip below rolling VWAP {mean:.2f}; last minute rising"


def fill(account: Account, symbol: str, quantity: int, price: float, reason: str, run_id: str, now: datetime):
    if symbol not in UNIVERSE or not quantity or not math.isfinite(price) or price <= 0:
        raise ValueError("Invalid paper order")
    execution = price * (1 + SPREAD if quantity > 0 else 1 - SPREAD)
    if quantity > 0 and quantity * execution > account.balance + 1e-8:
        raise ValueError("Insufficient cash")
    if quantity < 0 and -quantity > account.holdings.get(symbol, 0):
        raise ValueError("Insufficient shares")
    account.balance -= quantity * execution
    account.holdings[symbol] = account.holdings.get(symbol, 0) + quantity
    if not account.holdings[symbol]:
        del account.holdings[symbol]
    account.transactions.append(Transaction(symbol=symbol, quantity=quantity, price=execution,
        timestamp=now.astimezone().isoformat(), rationale=reason, trace_id=run_id))
    account.save()
    write_log(account.name, "account", f"{'Bought' if quantity > 0 else 'Sold'} {abs(quantity)} {symbol}: {reason}")


def decide(account: Account, name: str, snapshot: dict, now: datetime, run_id: str) -> list[str]:
    prices, actions = snapshot["prices"], []
    account.last_quotes.update(prices)
    account.quotes_as_of = now.isoformat()
    close = snapshot["close"]
    flatten = name == "Jinbe" and now >= close - timedelta(minutes=10)
    today = now.astimezone(NY).date()
    # Exits are never blocked by the entry cap or cooldown.
    for symbol, qty in list(account.holdings.items()):
        if symbol not in prices:
            continue
        buy = next(t for t in reversed(account.transactions) if t.symbol == symbol and t.quantity > 0)
        held_minutes = (now - stamp(buy.timestamp)).total_seconds() / 60
        change = prices[symbol] / (buy.price / (1 + SPREAD)) - 1
        _, mean, _ = signal(name, snapshot["bars"].get(symbol, []), prices[symbol], now)
        carried = name == "Jinbe" and stamp(buy.timestamp).astimezone(NY).date() < today
        reason = ("session flatten" if flatten or carried else
                  "stop loss" if change <= (-.005 if name == "Jinbe" else -.007) else
                  "profit target" if change >= (.008 if name == "Jinbe" else .009) else
                  "rebound to VWAP" if name == "Law" and mean and prices[symbol] >= mean else
                  "time exit" if held_minutes >= (20 if name == "Jinbe" else 90) else None)
        if reason:
            fill(account, symbol, -qty, prices[symbol], f"{name}: {reason}; move {change:.2%}", run_id, now)
            actions.append(f"Sold {symbol}: {reason}")
    entries = sum(t.quantity > 0 and stamp(t.timestamp).astimezone(NY).date() == today for t in account.transactions)
    if flatten or now >= close - timedelta(minutes=15):
        return actions
    equity = account.calculate_portfolio_value()
    for symbol in UNIVERSE:
        if entries >= 30 or len(account.holdings) >= 4:
            break
        if symbol in account.holdings or symbol not in prices:
            continue
        last = next((t for t in reversed(account.transactions) if t.symbol == symbol), None)
        if last and (now - stamp(last.timestamp)).total_seconds() < 300:
            continue
        enter, _, reason = signal(name, snapshot["bars"].get(symbol, []), prices[symbol], now)
        quantity = math.floor(min(equity * .15, account.balance) / (prices[symbol] * (1 + SPREAD)))
        if enter and quantity > 0:
            fill(account, symbol, quantity, prices[symbol], f"{name}: {reason}", run_id, now)
            entries += 1
            actions.append(f"Bought {symbol}: {reason}")
    return actions


def run_once(now: datetime | None = None):
    now = now or datetime.now(timezone.utc)
    try:
        snapshot = market_snapshot(now)
        snapshot_error = None
    except Exception as exc:
        snapshot = {"open": False}
        snapshot_error = f"Market data unavailable: {type(exc).__name__}: {exc}"
    for name in NAMES:
        account = Account.get(name)
        run_id = make_trace_id(name.lower())
        cycle = f"active_{now:%Y%m%dT%H%M%SZ}"
        def report():
            data = account.model_dump(exclude={"portfolio_value_time_series", "transactions"})
            data["total_portfolio_value"] = account.calculate_portfolio_value()
            return json.dumps(data)
        start_run(run_id, cycle, name, "rules", account.strategy, report(), now.isoformat())
        error = snapshot_error
        output = "Market closed; waiting for the next regular session."
        with trace(f"{name}-rules", trace_id=run_id, group_id=cycle,
                   metadata={"trader": name, "mode": "rules", "model": "None — deterministic", "source": "alpaca_iex"}):
            try:
                if snapshot_error:
                    output = snapshot_error
                elif snapshot["open"]:
                    with custom_span("Active desk decision", data={**snapshot, "close": snapshot["close"].isoformat()}):
                        actions = decide(account, name, snapshot, now, run_id)
                    output = "; ".join(actions) or "No qualifying setup; monitoring fresh prices and exits."
                    account.portfolio_value_time_series.append((now.astimezone().isoformat(), account.calculate_portfolio_value()))
                    account.save()
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
                output = f"Decision failed: {error}"
            finally:
                end_run(run_id, report(), output, error, datetime.now(timezone.utc).isoformat())
                write_log(name, "agent", output)


async def run_forever():
    # A standalone fast desk and the main floor may coexist during upgrades,
    # but only one may write these two accounts. The OS releases this on exit.
    with open(f"{database.DB}.active.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Jinbe and Law already have an active worker; skipping duplicate.", flush=True)
            return
        await _loop()


async def _loop():
    initialize()
    interval = max(30, int(os.getenv("ACTIVE_TRADER_INTERVAL_SECONDS", "60")))
    while True:
        start = asyncio.get_running_loop().time()
        try:
            await asyncio.to_thread(run_once)
        except Exception as exc:
            write_log("active", "agent", f"Active desk failed: {type(exc).__name__}: {exc}")
        await asyncio.sleep(max(1, interval - (asyncio.get_running_loop().time() - start)))


if __name__ == "__main__":
    add_trace_processor(LogTracer())
    add_trace_processor(SpanStore())
    print("Jinbe and Law: one-minute rules desk; no model or Tavily calls.", flush=True)
    asyncio.run(run_forever())
