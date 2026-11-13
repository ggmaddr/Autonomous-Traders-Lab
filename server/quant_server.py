"""The Quant: a deterministic MCP server, no LLM (plan §4.4.3). It reads the Market Year
tables the daily pipeline writes and answers from the last close.

The day and the account come from the environment (server/mcp_servers.py), never from
the model: QUANT_AS_OF fixes the close it answers from (the latest when unset), and
QUANT_ACCOUNT is the account size_positions sizes for.
"""

import json
import os

from mcp.server.fastmcp import FastMCP

from .accounts import INITIAL_BALANCE, Account
from .quant.tools import Quant

mcp = FastMCP("quant_server")

AS_OF = os.getenv("QUANT_AS_OF") or None
ACCOUNT = os.getenv("QUANT_ACCOUNT") or None


def quant() -> Quant:
    return Quant(AS_OF)


def out(result: dict) -> str:
    return json.dumps(result, separators=(",", ":"))


@mcp.tool()
async def regime_now() -> str:
    """The market regime as of the last close, from two models: transparent rules (SPY against its
    200-day average × volatility against its 10-year range) and a hidden Markov model with its
    probability. Regimes: Calm bull, Volatile bull, Calm chop, Stress. Also the features behind them
    (volatility, trend, drawdown, breadth, sector correlation, credit, dollar, rates) and how many
    regime switches happened this month."""
    return out(quant().regime_now())


@mcp.tool()
async def regime_history(start: str, end: str = "", model: str = "rules") -> str:
    """The regime episodes between two dates (YYYY-MM-DD): each run of one regime with its dates,
    SPY's return, max drawdown, volatility, and the sectors that led and lagged.

    Args:
        start: first day, YYYY-MM-DD
        end: last day, YYYY-MM-DD; empty for the last close
        model: "rules" or "hmm"
    """
    return out(quant().regime_history(start, end or None, model))


@mcp.tool()
async def signal_scoreboard(regime: str = "", model: str = "rules") -> str:
    """How eight fixed signals have paid in one regime: Sharpe this year, over the prior ten years,
    and blended, with a 95% interval and the number of days behind each. Best first.

    Args:
        regime: Calm bull, Volatile bull, Calm chop, Stress or All; empty for today's regime
        model: "rules" or "hmm"
    """
    return out(quant().signal_scoreboard(regime or None, model))


@mcp.tool()
async def signal_scan(signal: str) -> str:
    """What one signal holds as of the last close, with its trigger value: its candidates today.

    Args:
        signal: one of xs_momentum_12_1, trend_200d, rsi2_reversion, low_vol, earnings_drift,
            breakout_55d, defensive_rotation, buy_hold
    """
    return out(quant().signal_scan(signal))


@mcp.tool()
async def portfolio_risk(weights: dict[str, float]) -> str:
    """Risk of a set of portfolio weights (fractions of equity; the rest is cash): annual volatility,
    beta to SPY, average correlation, one-day 95% CVaR over the last year, the worst drawdown over
    ten years, and each position's share of the risk.

    Args:
        weights: symbol to weight, e.g. {"SPY": 0.4, "TLT": 0.2}
    """
    return out(quant().portfolio_risk(weights))


@mcp.tool()
async def size_positions(target_weights: dict[str, float], target_vol: float = 0.12) -> str:
    """Turn target weights into share quantities for your account. Applies the limits you cannot
    override: at most 25% per ETF and 10% per stock, scaling to the volatility target, and the
    drawdown brake (half size at −8% from peak, SHY only at −12%). Marks each row trade=true only
    when it is more than 2% of equity from target; place only those orders.

    Args:
        target_weights: symbol to weight, fractions of equity
        target_vol: annual volatility target, 0.12 by default
    """
    if not ACCOUNT:
        return out({"error": "This Quant server is not bound to an account (QUANT_ACCOUNT is not set)."})
    a = Account.get(ACCOUNT)
    peak = max([INITIAL_BALANCE, *(v for _, v in a.portfolio_value_time_series)])
    q = quant()
    others = {s: a.mark_price(s) for s in a.holdings if q.close_of(s) is None}
    return out(q.size_positions(target_weights, target_vol, dict(a.holdings), a.balance, peak, others))


@mcp.tool()
async def quality_screen(symbols: list[str] | None = None) -> str:
    """Zoro's quality screen on SEC 10-K figures: 5-year average ROIC above 15%, free cash flow
    positive in each of the last 5 years, net debt / EBITDA below 2, Piotroski F-score 7 or more,
    and earnings yield (EBIT / EV) in the top third. A test a company's filings cannot answer is
    "unknown"; only five known passes pass.

    Args:
        symbols: tickers to screen; omit for the standing universe of about 50 large non-financial names
    """
    return out(quant().quality_screen(symbols))


@mcp.tool()
async def owner_earnings_dcf(symbol: str) -> str:
    """Owner-earnings DCF (net income + D&A − capex, 3-year average, grown 10 years) with bear,
    base and bull values per share, and the margin of safety of the last close to the base case.

    Args:
        symbol: the ticker
    """
    return out(quant().owner_earnings_dcf(symbol))


@mcp.tool()
async def macro_dashboard() -> str:
    """Sanji's macro dashboard: the growth × inflation quadrant (Goldilocks, Reflation, Stagflation,
    Deflation) from market proxies, and for each ETF in his universe its 12-1 month momentum, whether
    it is above its 100-day average (trend confirmed), RSI(14), ATR(14) and any volatility spike."""
    return out(quant().macro_dashboard())


if __name__ == "__main__":
    mcp.run(transport="stdio")
