"""The Day-Trade desk: a deterministic MCP server, no LLM, for Luffy's opening range breakout.

The account comes from the environment (server/mcp_servers.py), never from the model:
DAYTRADE_ACCOUNT is the account the setups are sized for.
"""

import json
import os

from mcp.server.fastmcp import FastMCP

from . import orb
from .accounts import Account

mcp = FastMCP("day_trade_server")

ACCOUNT = os.getenv("DAYTRADE_ACCOUNT") or None


@mcp.tool()
async def opening_range(symbols: list[str] | None = None) -> str:
    """The opening range breakout, live: for each symbol the first 5-minute bar's high and low,
    whether that bar closed up, its volume against its 14-day average (in play at 1.5x or more),
    the price now, and the signal: "long" (broke the range high in play, before 14:30), "wait" or
    "none", with why. Long setups carry the share count (1% of equity at risk to the stop, at most
    25% of equity). Held symbols carry an exit: "stop hit" or "flatten: end of day". Also the
    session clock and how many position slots are left (at most 3).

    Args:
        symbols: tickers to check from the universe SPY, QQQ, AAPL, MSFT, NVDA, AMZN, META, GOOGL,
            TSLA, AMD, AVGO, NFLX; omit for all of them. Held symbols are always included.
    """
    if not ACCOUNT:
        return json.dumps({"error": "This server is not bound to an account (DAYTRADE_ACCOUNT is not set)."})
    a = Account.get(ACCOUNT)
    try:
        result = orb.opening_range(symbols or [], dict(a.holdings), a.calculate_portfolio_value(), a.balance)
    except Exception as e:
        result = {"error": f"No intraday data: {type(e).__name__}: {e}"}
    return json.dumps(result, separators=(",", ":"))


if __name__ == "__main__":
    mcp.run(transport="stdio")
