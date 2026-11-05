"""Share prices from the Massive market data API, or a simulator when no key is set.

Set MASSIVE_API_KEY to use live data. Without it, prices come from market_simulator
so the whole trading floor still runs out of the box.
"""

import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from massive import RESTClient
from .market_simulator import simulated_price

load_dotenv(override=True)

massive_api_key = os.getenv("MASSIVE_API_KEY")


def _last_trade(client: RESTClient, symbol: str) -> float:
    return float(client.get_last_trade(symbol).price)


def _snapshot(client: RESTClient, symbol: str) -> float:
    snapshot = client.get_snapshot_ticker("stocks", symbol)
    return float(snapshot.min.close or snapshot.prev_day.close)


def _previous_close(client: RESTClient, symbol: str) -> float:
    return float(client.get_previous_close_agg(symbol)[0].close)


# Best price first, prior close last. Lower tier plans reject the earlier calls,
# so we remember the first tier that works and start there next time.
price_methods = [_last_trade, _snapshot, _previous_close]
plan_tier = 0


def get_share_price(symbol: str) -> float:
    """Return the current price for a symbol, from Massive or the simulator."""
    if massive_api_key:
        try:
            return get_share_price_massive(symbol)
        except Exception as e:
            print(f"Massive API unavailable ({e}); using a simulated price")
    return simulated_price(symbol)


def get_share_price_massive(symbol: str) -> float:
    """Best price the plan allows, remembering the working tier to avoid repeat failures."""
    global plan_tier
    client = RESTClient(massive_api_key)
    for tier in range(plan_tier, len(price_methods)):
        try:
            price = price_methods[tier](client, symbol)
            plan_tier = tier
            return price
        except Exception:
            continue
    raise RuntimeError(f"No Massive price available for {symbol}")


def quote(symbol: str) -> float | None:
    """The current price from one source only: Massive when there is a key, else the
    simulator. None when Massive fails, never a simulated stand-in (D1), for figures
    that compare prices over time."""
    if not massive_api_key:
        return simulated_price(symbol)
    try:
        return get_share_price_massive(symbol)
    except Exception as e:
        print(f"No Massive price for {symbol} ({e})")
        return None


def price_at(symbol: str, when: datetime) -> float | None:
    """The price at a past moment, for reviewing old trades. From Massive, the close of
    the last daily bar on or before that day; from the simulator, its price at that time.
    None when Massive has no bar for it."""
    if not massive_api_key:
        return simulated_price(symbol, when)
    try:
        day = when.astimezone(timezone.utc).date()
        bars = RESTClient(massive_api_key).get_aggs(symbol, 1, "day", day - timedelta(days=7), day, sort="asc")
        return float(bars[-1].close) if bars else None
    except Exception as e:
        print(f"No Massive history for {symbol} at {when} ({e})")
        return None


def is_market_open() -> bool:
    """Whether the US market is open; True on simulated data or if Massive is unreachable."""
    if not massive_api_key:
        return True
    try:
        client = RESTClient(massive_api_key)
        return client.get_market_status().market == "open"
    except Exception:
        return True
