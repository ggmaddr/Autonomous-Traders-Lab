"""The opening range breakout (ORB), Luffy's one day-trading technique, as plain numbers.

The opening range is the first five-minute bar of the regular session (9:30-9:35 New
York). A long setup is a bullish opening bar (close above open) on unusual volume
(the stock is "in play": the bar's volume at least 1.5x its 14-day average), followed
by a trade above the bar's high. The stop is the bar's low, risk is 1% of equity per
trade, and every position is closed by the end of the day.

Minute data comes from Alpaca's IEX feed, which the free plan serves in real time (SIP
is 15 minutes late). IEX volume is a slice of the market, but relative volume compares
IEX with IEX, so the ratio holds. No simulator: a symbol with no bars has no setup (D1).
"""

import math
from datetime import datetime, time, timedelta, timezone

import requests

from .quant.bars import NY, _headers

BARS_URL = "https://data.alpaca.markets/v2/stocks/bars"
LATEST_URL = "https://data.alpaca.markets/v2/stocks/trades/latest"

# Liquid names only: tight spreads, deep books, and enough of them move on news each day.
UNIVERSE = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO", "NFLX"]

OPEN, RANGE_END = time(9, 30), time(9, 35)
ENTRY_CUTOFF = time(14, 30)  # no new entries after this
FLATTEN_AT = time(15, 50)  # everything is sold from here to the close
CLOSE = time(16, 0)
MIN_REL_VOLUME = 1.5
RISK_PER_TRADE = 0.01
MAX_WEIGHT = 0.25
MAX_POSITIONS = 3
LOOKBACK_DAYS = 14


def _get(url: str, params: dict) -> dict:
    r = requests.get(url, headers=_headers(), params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def five_minute_bars(symbols: list[str], now: datetime) -> dict[str, list[dict]]:
    """Five-minute IEX bars for the last ~4 weeks, oldest first, per symbol."""
    start = (now - timedelta(days=LOOKBACK_DAYS * 2 + 4)).strftime("%Y-%m-%dT%H:%M:%SZ")
    out: dict[str, list[dict]] = {}
    token = None
    while True:
        params = {"symbols": ",".join(symbols), "timeframe": "5Min", "start": start, "feed": "iex",
                  "limit": 10000, "sort": "asc"}
        if token:
            params["page_token"] = token
        body = _get(BARS_URL, params)
        for sym, bars in (body.get("bars") or {}).items():
            out.setdefault(sym, []).extend(bars)
        token = body.get("next_page_token")
        if not token:
            return out


def latest_prices(symbols: list[str]) -> dict[str, float]:
    body = _get(LATEST_URL, {"symbols": ",".join(symbols), "feed": "iex"})
    return {s: float(t["p"]) for s, t in (body.get("trades") or {}).items() if t.get("p")}


def _ny(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(NY)


def clock(now: datetime) -> dict:
    ny = now.astimezone(NY)
    t = ny.time()
    weekday = ny.weekday() < 5
    session = weekday and OPEN <= t < CLOSE
    return {
        "now_new_york": ny.strftime("%Y-%m-%d %H:%M"),
        "session_open": session,
        "range_formed": session and t >= RANGE_END,
        "entries_allowed": session and RANGE_END <= t < ENTRY_CUTOFF,
        "flatten_now": session and t >= FLATTEN_AT,
        "minutes_to_close": max(0, int((datetime.combine(ny.date(), CLOSE, NY) - ny).total_seconds() // 60)) if session else None,
    }


def setup(symbol: str, bars: list[dict], price: float | None, now: datetime) -> dict:
    """The opening range and today's signal for one symbol."""
    ny_now = now.astimezone(NY)
    by_day: dict[str, list[dict]] = {}
    for b in bars:
        by_day.setdefault(_ny(b["t"]).date().isoformat(), []).append(b)
    firsts = {d: next((b for b in bs if _ny(b["t"]).time() == OPEN), None) for d, bs in by_day.items()}
    today = ny_now.date().isoformat()
    first = firsts.get(today)
    if not first:
        return {"symbol": symbol, "signal": "none", "why": "no opening bar today (market closed, or before 9:35 New York)"}
    prior = [b["v"] for d, b in sorted(firsts.items()) if d < today and b][-LOOKBACK_DAYS:]
    rel_volume = first["v"] / (sum(prior) / len(prior)) if prior and sum(prior) else None
    later = [b for b in by_day[today] if _ny(b["t"]).time() >= RANGE_END]
    high_since = max((b["h"] for b in later), default=None)
    row = {
        "symbol": symbol,
        "range_high": first["h"],
        "range_low": first["l"],
        "range_open": first["o"],
        "range_close": first["c"],
        "opening_bar": "up" if first["c"] > first["o"] else "down" if first["c"] < first["o"] else "flat",
        "relative_volume": round(rel_volume, 2) if rel_volume else None,
        "in_play": bool(rel_volume and rel_volume >= MIN_REL_VOLUME),
        "price": price,
        "high_since_range": high_since,
        "stop": first["l"],
    }
    c = clock(now)
    if price is None:
        row.update(signal="none", why="no live price")
    elif not c["range_formed"]:
        row.update(signal="wait", why="the opening range is still forming")
    elif row["opening_bar"] != "up":
        row.update(signal="none", why="opening bar did not close up; long only")
    elif not row["in_play"]:
        row.update(signal="none", why=f"relative volume {row['relative_volume']} is below {MIN_REL_VOLUME}: not in play")
    elif price <= first["h"]:
        row.update(signal="wait", why=f"price {price} has not broken the range high {first['h']}")
    elif not c["entries_allowed"]:
        row.update(signal="none", why="past the 14:30 entry cutoff")
    else:
        row.update(signal="long", why=f"broke {first['h']} on {row['relative_volume']}x volume; stop {first['l']}")
    return row


def size(row: dict, equity: float, cash: float) -> int:
    """Shares for a long setup: 1% of equity at risk to the stop, capped at 25% of equity and the cash."""
    price, stop = row.get("price"), row.get("stop")
    if not price or stop is None or price <= stop:
        return 0
    by_risk = RISK_PER_TRADE * equity / (price - stop)
    cap = min(MAX_WEIGHT * equity, cash) / (price * 1.002)
    return max(0, math.floor(min(by_risk, cap)))


def opening_range(symbols: list[str], holdings: dict[str, int], equity: float, cash: float,
                  now: datetime | None = None) -> dict:
    """Every number Luffy's playbook needs, for the asked symbols and everything held."""
    now = now or datetime.now(timezone.utc)
    asked = [s.upper() for s in symbols if s.upper() in UNIVERSE] or UNIVERSE
    outside = sorted({s.upper() for s in symbols} - set(UNIVERSE))
    held = [s for s, q in holdings.items() if q]
    want = sorted(set(asked) | set(held))
    bars = five_minute_bars(want, now)
    prices = latest_prices(want)
    rows = [setup(s, bars.get(s, []), prices.get(s), now) for s in want]
    c = clock(now)
    for r in rows:
        if r["symbol"] in held:
            r["held"] = holdings[r["symbol"]]
            stop_hit = r.get("price") is not None and r.get("stop") is not None and r["price"] <= r["stop"]
            r["exit"] = "flatten: end of day" if c["flatten_now"] else "stop hit" if stop_hit else None
        elif r["signal"] == "long":
            r["shares"] = size(r, equity, cash)
    open_positions = len(held)
    return {
        "clock": c,
        "rules": {"range": "first 5-minute bar from 9:30 New York", "min_relative_volume": MIN_REL_VOLUME,
                  "risk_per_trade": RISK_PER_TRADE, "max_weight": MAX_WEIGHT, "max_positions": MAX_POSITIONS,
                  "entry_cutoff": "14:30", "flatten_at": "15:50"},
        "account": {"equity": round(equity, 2), "cash": round(cash, 2), "open_positions": open_positions,
                    "slots_left": max(0, MAX_POSITIONS - open_positions)},
        "symbols": rows,
        **({"ignored_outside_universe": outside} if outside else {}),
    }
