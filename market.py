from polygon import RESTClient
from dotenv import load_dotenv
import os
from datetime import datetime
import random
from database import write_market, read_market
from functools import lru_cache
from datetime import timezone

load_dotenv(override=True)

polygon_api_key = os.getenv("POLYGON_API_KEY")
polygon_plan = os.getenv("POLYGON_PLAN")

# Plan flags derived from env; preserved names to avoid breaking imports
is_paid_polygon = polygon_plan == "paid"
is_realtime_polygon = polygon_plan == "realtime"


def _get_client() -> RESTClient:
    """Create a Polygon REST client.

    This small helper centralizes client construction for easier testing
    and future customization without changing call sites.
    """
    return RESTClient(polygon_api_key)


def _safe_polygon_call(fn, fallback=None):
    """Run a Polygon call and optionally return a fallback on failure.

    - If a fallback is provided, exceptions are swallowed and the fallback
      return value is used.
    - If no fallback is provided, the exception is propagated.
    """
    try:
        return fn()
    except Exception as e:
        if fallback is not None:
            print(f"Polygon API error: {e}. Using fallback value.")
            return fallback
        raise


def is_market_open() -> bool:
    client = _get_client()
    market_status = _safe_polygon_call(lambda: client.get_market_status(), fallback=None)
    if market_status is None:
        # Conservatively assume closed if status cannot be retrieved
        return False
    return market_status.market == "open"


def get_all_share_prices_polygon_eod() -> dict[str, float]:
    """Return a mapping of ticker -> close price from the latest EOD batch.

    Timezone handling uses UTC to match Polygon timestamps.
    """
    client = _get_client()

    probe = _safe_polygon_call(lambda: client.get_previous_close_agg("SPY")[0])
    last_close = datetime.fromtimestamp(probe.timestamp / 1000, tz=timezone.utc).date()

    results = _safe_polygon_call(
        lambda: client.get_grouped_daily_aggs(last_close, adjusted=True, include_otc=False)
    )
    return {result.ticker: result.close for result in results}


@lru_cache(maxsize=2)
def get_market_for_prior_date(today):
    market_data = read_market(today)
    if not market_data:
        market_data = get_all_share_prices_polygon_eod()
        write_market(today, market_data)
    return market_data


def get_share_price_polygon_eod(symbol) -> float:
    today = datetime.now().date().strftime("%Y-%m-%d")
    market_data = get_market_for_prior_date(today)
    return float(market_data.get(symbol, 0.0))


def get_share_price_polygon_min(symbol) -> float:
    client = _get_client()
    result = _safe_polygon_call(lambda: client.get_snapshot_ticker("stocks", symbol))
    price = result.min.close or result.prev_day.close
    return float(price)


def get_share_price_polygon(symbol) -> float:
    if is_paid_polygon:
        return get_share_price_polygon_min(symbol)
    else:
        return get_share_price_polygon_eod(symbol)


def get_share_price(symbol) -> float:
    if polygon_api_key:
        try:
            return get_share_price_polygon(symbol)
        except Exception as e:
            print(f"Polygon call failed for {symbol}: {e}. Falling back to random price.")
    # Random fallback range made continuous and scaled for readability
    return float(round(random.uniform(1.0, 100.0), 2))
