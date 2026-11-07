"""Daily bars from Alpaca's historical data API (plan §19.4), and the aligned price panel
the features and signals are computed on.

One source for every day: the SIP feed, split and dividend adjusted, from 2016. The
free plan serves SIP history up to 15 minutes ago, so the request ends there, and a
day's bar is kept only once that day's session has closed. Adjusted history shifts
after every split and dividend, so each run reloads it whole (about 50 symbols × 11
years, a few requests) rather than appending to old adjusted numbers. Never the
simulator: a symbol with no data simply has no bars (D1).
"""

import bisect
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import requests
from dotenv import load_dotenv

from . import store
from .universe import BENCHMARK, PRIOR_START, SYMBOLS

load_dotenv(override=True)

URL = "https://data.alpaca.markets/v2/stocks/bars"
NY = ZoneInfo("America/New_York")
SOURCE = "alpaca_sip"
BATCH = 25  # symbols per request; pages carry up to 10,000 bars across them


def _headers() -> dict:
    key, secret = os.getenv("ALPACA_API_KEY"), os.getenv("ALPACA_SECRET_KEY")
    if not key or not secret:
        raise RuntimeError("ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in .env to load bars")
    return {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret}


def last_closed_session(now: datetime | None = None) -> str:
    """The latest day whose regular session has closed: today after 16:15 New York time,
    else yesterday. Bars after it are partial and are not stored."""
    ny = (now or datetime.now(timezone.utc)).astimezone(NY)
    closed = ny.hour > 16 or (ny.hour == 16 and ny.minute >= 15)
    return (ny.date() if closed else ny.date() - timedelta(days=1)).isoformat()


def fetch(symbols: list[str], start: str = PRIOR_START) -> list[tuple]:
    end = (datetime.now(timezone.utc) - timedelta(minutes=16)).strftime("%Y-%m-%dT%H:%M:%SZ")
    cutoff = last_closed_session()
    rows, token = [], None
    while True:
        params = {"symbols": ",".join(symbols), "timeframe": "1Day", "start": start, "end": end,
                  "adjustment": "all", "feed": "sip", "limit": 10000, "sort": "asc"}
        if token:
            params["page_token"] = token
        r = requests.get(URL, headers=_headers(), params=params, timeout=60)
        r.raise_for_status()
        body = r.json()
        for symbol, bars in (body.get("bars") or {}).items():
            for b in bars:
                day = b["t"][:10]
                if day <= cutoff:
                    rows.append((symbol, day, b["o"], b["h"], b["l"], b["c"], b["v"], SOURCE))
        token = body.get("next_page_token")
        if not token:
            return rows


def backfill(symbols: list[str] = SYMBOLS) -> dict:
    """Reload every symbol's adjusted history into bars. Returns what was loaded."""
    loaded = 0
    for i in range(0, len(symbols), BATCH):
        rows = fetch(symbols[i:i + BATCH])
        store.write_bars(rows)
        loaded += len(rows)
    return {"bars": loaded, **store.bar_stats()}


@dataclass
class Panel:
    """Prices aligned on the benchmark's trading days. Missing values (a symbol not yet
    listed, a halted day) are NaN, never filled from elsewhere."""
    days: list[str]
    symbols: list[str]
    close: np.ndarray  # days × symbols
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    volume: np.ndarray

    def col(self, symbol: str) -> np.ndarray:
        return self.close[:, self.symbols.index(symbol)]

    def cols(self, symbols: list[str], field: str = "close") -> np.ndarray:
        return getattr(self, field)[:, [self.symbols.index(s) for s in symbols]]

    def index(self, day: str) -> int:
        """Position of the last trading day on or before day."""
        return bisect.bisect_right(self.days, day) - 1


def panel(until: str | None = None, symbols: list[str] = SYMBOLS) -> Panel:
    rows = store.read_bars(symbols, until)
    days = sorted({r["day"] for r in rows if r["symbol"] == BENCHMARK})
    if not days:
        raise RuntimeError("No bars loaded. Run uv run -m backend.quant first.")
    at = {d: i for i, d in enumerate(days)}
    arrays = {k: np.full((len(days), len(symbols)), np.nan) for k in ("close", "open", "high", "low", "volume")}
    pos = {s: j for j, s in enumerate(symbols)}
    for r in rows:
        i = at.get(r["day"])
        if i is None or r["symbol"] not in pos:
            continue
        j = pos[r["symbol"]]
        for k in arrays:
            arrays[k][i, j] = r[k]
    return Panel(days, symbols, **arrays)
