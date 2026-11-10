"""Annual fundamentals from SEC EDGAR's XBRL company facts, for Jinbe's screen and the
owner-earnings DCF (plan §4.4.1). Free and official; the Massive plan does not include
fundamentals. SEC asks every client to name itself with a contact in the User-Agent:
set SEC_USER_AGENT in .env ("Your Name you@example.com").

Only 10-K figures are used: flow items over a fiscal year (330-400 days), balance-sheet
items at the fiscal year end, the latest filing for each year. A figure a company does
not report under the tags below stays missing, and the screen says "unknown" for any
test that needs it rather than guessing. Refreshed at most weekly.
"""

import json
import os
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone

import requests
from dotenv import load_dotenv

from ..database import DB
from . import store

load_dotenv(override=True)

USER_AGENT = os.getenv("SEC_USER_AGENT") or "Antimat Lab research admin@gtsupermarket.dev"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
STALE = timedelta(days=7)
YEARS = 7

with sqlite3.connect(DB) as conn:
    conn.execute('CREATE TABLE IF NOT EXISTS fundamentals (symbol TEXT PRIMARY KEY, cik INTEGER, fetched_at TEXT, years TEXT)')

FLOW = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
                "RevenueFromContractWithCustomerIncludingAssessedTax"],
    "gross_profit": ["GrossProfit"],
    "ebit": ["OperatingIncomeLoss"],
    "pretax": ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
               "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
    "tax": ["IncomeTaxExpenseBenefit"],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "cfo": ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "da": ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet",
           "Depreciation"],
    "shares": ["WeightedAverageNumberOfDilutedSharesOutstanding"],
}
INSTANT = {
    "assets": ["Assets"],
    "current_assets": ["AssetsCurrent"],
    "current_liabilities": ["LiabilitiesCurrent"],
    "lt_debt_total": ["LongTermDebt"],
    "lt_debt_noncurrent": ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"],
    "lt_debt_current": ["LongTermDebtCurrent", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
    "short_debt": ["CommercialPaper", "ShortTermBorrowings"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    "equity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
}

_ciks: dict[str, int] = {}


def _get(url: str) -> dict:
    r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    time.sleep(0.15)  # SEC allows 10 requests a second
    return r.json()


def refresh(symbols: list[str]) -> int:
    """Fill the cache for these symbols (the pipeline does this, so tool calls stay fast)."""
    n = 0
    for sym in symbols:
        try:
            n += bool(_years(sym))
        except Exception as e:
            print(f"No fundamentals for {sym}: {type(e).__name__}: {e}")
    return n


def cik(symbol: str) -> int | None:
    if not _ciks:
        _ciks.update({v["ticker"].upper(): int(v["cik_str"]) for v in _get(TICKERS_URL).values()})
    return _ciks.get(symbol.upper().replace(".", "-"))


def _annual(facts: dict, tags: list[str], flow: bool) -> dict[str, float]:
    """Fiscal-year-end date → value, from the first tag that reports each year."""
    out: dict[str, tuple[str, float]] = {}  # end → (filed, value)
    gaap = facts.get("facts", {}).get("us-gaap", {})
    for tag in tags:
        mine: dict[str, tuple[str, float]] = {}
        for entries in gaap.get(tag, {}).get("units", {}).values():
            for e in entries:
                if not str(e.get("form", "")).startswith("10-K"):
                    continue
                if flow:
                    if not e.get("start"):
                        continue
                    days = (date.fromisoformat(e["end"]) - date.fromisoformat(e["start"])).days
                    if not 330 <= days <= 400:
                        continue
                elif e.get("start"):
                    continue
                if e["end"] not in mine or mine[e["end"]][0] < e["filed"]:
                    mine[e["end"]] = (e["filed"], float(e["val"]))
        for end, v in mine.items():
            out.setdefault(end, v)  # an earlier tag in the list wins the year
    return {end: v for end, (_, v) in out.items()}


def extract(facts: dict) -> list[dict]:
    """The last YEARS fiscal years, oldest first, keyed by fiscal year end."""
    series = {k: _annual(facts, tags, True) for k, tags in FLOW.items()}
    series |= {k: _annual(facts, tags, False) for k, tags in INSTANT.items()}
    ends = sorted(set(series["revenue"]) | set(series["ebit"]) | set(series["cfo"]))
    # Fiscal years are named by their end; drop stub ends that are not a year apart.
    years = [e for i, e in enumerate(ends) if i == 0 or (date.fromisoformat(e) - date.fromisoformat(ends[i - 1])).days > 300]
    rows = []
    for end in years[-YEARS:]:
        row = {"fiscal_year_end": end}
        for k in series:
            row[k] = series[k].get(end)
        lt = row.pop("lt_debt_total")
        if lt is None and row["lt_debt_noncurrent"] is not None:
            lt = row["lt_debt_noncurrent"] + (row["lt_debt_current"] or 0)
        row["debt"] = None if lt is None else lt + (row["short_debt"] or 0)
        for k in ("lt_debt_noncurrent", "lt_debt_current", "short_debt"):
            row.pop(k)
        rows.append(row)
    return rows


REPORT_LAG = timedelta(days=75)  # a 10-K is due within 60-90 days of the year end


def years(symbol: str, as_of: str | None = None) -> list[dict]:
    """A symbol's annual figures, from the cache when it is under a week old. With
    as_of, only the years whose 10-K would have been filed by then."""
    rows = _years(symbol)
    if as_of:
        cutoff = (date.fromisoformat(as_of) - REPORT_LAG).isoformat()
        rows = [r for r in rows if r["fiscal_year_end"] <= cutoff]
    return rows


def _years(symbol: str) -> list[dict]:
    symbol = symbol.upper()
    with sqlite3.connect(DB) as conn:
        hit = conn.execute('SELECT fetched_at, years FROM fundamentals WHERE symbol = ?', (symbol,)).fetchone()
    if hit and datetime.now(timezone.utc) - datetime.fromisoformat(hit[0]) < STALE:
        return json.loads(hit[1])
    c = cik(symbol)
    if c is None:
        return []
    rows = extract(_get(FACTS_URL.format(cik=c)))
    with sqlite3.connect(DB) as conn:
        conn.execute('INSERT OR REPLACE INTO fundamentals VALUES (?, ?, ?, ?)', (symbol, c, store.now(), json.dumps(rows)))
    return rows


# --- Metrics ---------------------------------------------------------------------

def _div(a, b):
    return None if a is None or b in (None, 0) else a / b


def roic(y: dict) -> float | None:
    rate = _div(y["tax"], y["pretax"])
    rate = min(max(rate, 0.0), 0.35) if rate is not None else 0.21
    invested = None if y["equity"] is None or y["debt"] is None else y["equity"] + y["debt"] - (y["cash"] or 0)
    return _div(None if y["ebit"] is None else y["ebit"] * (1 - rate), invested) if invested and invested > 0 else None


def fcf(y: dict) -> float | None:
    return None if y["cfo"] is None or y["capex"] is None else y["cfo"] - y["capex"]


def piotroski(prev: dict, y: dict) -> tuple[int | None, dict]:
    """The nine F-score tests on two consecutive years; None if any input is missing."""
    roa, roa0 = _div(y["net_income"], y["assets"]), _div(prev["net_income"], prev["assets"])
    lev, lev0 = _div(y["debt"], y["assets"]), _div(prev["debt"], prev["assets"])
    cr, cr0 = _div(y["current_assets"], y["current_liabilities"]), _div(prev["current_assets"], prev["current_liabilities"])
    gm, gm0 = _div(y["gross_profit"], y["revenue"]), _div(prev["gross_profit"], prev["revenue"])
    at, at0 = _div(y["revenue"], y["assets"]), _div(prev["revenue"], prev["assets"])
    tests = {
        "positive ROA": None if roa is None else roa > 0,
        "positive operating cash flow": None if y["cfo"] is None else y["cfo"] > 0,
        "ROA rising": None if roa is None or roa0 is None else roa > roa0,
        "cash flow above net income": None if y["cfo"] is None or y["net_income"] is None else y["cfo"] > y["net_income"],
        "leverage falling": None if lev is None or lev0 is None else lev <= lev0,
        "current ratio rising": None if cr is None or cr0 is None else cr > cr0,
        "no new shares": None if y["shares"] is None or prev["shares"] is None else y["shares"] <= prev["shares"] * 1.005,
        "gross margin rising": None if gm is None or gm0 is None else gm > gm0,
        "asset turnover rising": None if at is None or at0 is None else at > at0,
    }
    known = [v for v in tests.values() if v is not None]
    # Missing tests count as failed for the score but are reported, so a gap is visible.
    return (sum(known) if len(known) >= 7 else None), tests


def screen(symbol: str, price: float | None, as_of: str | None = None) -> dict:
    ys = years(symbol, as_of)
    if len(ys) < 2:
        return {"symbol": symbol, "error": "no annual 10-K figures found on SEC EDGAR"}
    last5 = ys[-5:]
    r = [roic(y) for y in last5]
    f = [fcf(y) for y in last5]
    y = ys[-1]
    ebitda = None if y["ebit"] is None or y["da"] is None else y["ebit"] + y["da"]
    net_debt = None if y["debt"] is None else y["debt"] - (y["cash"] or 0)
    score, tests = piotroski(ys[-2], y)
    cap = None if price is None or y["shares"] is None else price * y["shares"]
    ev = None if cap is None or net_debt is None else cap + net_debt
    known_r = [x for x in r if x is not None]
    return {
        "symbol": symbol,
        "fiscal_year_end": y["fiscal_year_end"],
        "years": len(last5),
        "roic_5y_avg": round(sum(known_r) / len(known_r), 4) if len(known_r) >= 3 else None,
        "fcf_positive_years": f"{sum(1 for x in f if x is not None and x > 0)} of {len(f)}",
        "fcf_all_positive": None if any(x is None for x in f) else all(x > 0 for x in f),
        "net_debt_to_ebitda": None if net_debt is None or not ebitda else round(net_debt / ebitda, 2),
        "piotroski": score,
        "piotroski_tests": {k: v for k, v in tests.items()},
        "earnings_yield": None if not ev or y["ebit"] is None or ev <= 0 else round(y["ebit"] / ev, 4),
    }


def owner_earnings_dcf(symbol: str, price: float | None, as_of: str | None = None) -> dict:
    """Owner earnings (net income + D&A − capex, averaged over three years) grown for ten
    years, fading to a terminal rate, in bear, base and bull cases."""
    ys = years(symbol, as_of)
    if len(ys) < 3:
        return {"symbol": symbol, "error": "fewer than three annual 10-K years on SEC EDGAR"}
    oe = [None if y["net_income"] is None or y["da"] is None or y["capex"] is None else y["net_income"] + y["da"] - y["capex"]
          for y in ys[-3:]]
    if any(v is None for v in oe):
        return {"symbol": symbol, "error": "owner earnings need net income, D&A and capex for three years"}
    base_oe = sum(oe) / 3
    rev = [y["revenue"] for y in ys[-6:] if y["revenue"]]
    cagr = (rev[-1] / rev[0]) ** (1 / (len(rev) - 1)) - 1 if len(rev) >= 3 and rev[0] > 0 else 0.03
    g0 = min(max(cagr, 0.0), 0.12)
    y = ys[-1]
    shares, net_cash = y["shares"], (y["cash"] or 0) - (y["debt"] or 0)
    if not shares or base_oe <= 0:
        return {"symbol": symbol, "error": "owner earnings are not positive" if base_oe <= 0 else "no diluted share count"}
    cases = {"bear": (g0 * 0.5, 0.02, 0.10), "base": (g0, 0.025, 0.09), "bull": (min(g0 * 1.3, 0.15), 0.03, 0.085)}
    values = {}
    for name, (g, term, r) in cases.items():
        cash, pv = base_oe, 0.0
        for t in range(1, 11):
            cash *= 1 + g + (term - g) * (t - 1) / 9
            pv += cash / (1 + r) ** t
        pv += cash * (1 + term) / (r - term) / (1 + r) ** 10
        values[name] = round((pv + net_cash) / shares, 2)
    if values["base"] <= 0:
        return {"symbol": symbol, "error": "base-case value is not positive: debt outweighs the owner earnings", "value_per_share": values}
    return {
        "symbol": symbol,
        "fiscal_year_end": y["fiscal_year_end"],
        "owner_earnings_3y_avg": round(base_oe),
        "revenue_growth_used": round(g0, 4),
        "value_per_share": values,
        "price": price,
        "margin_of_safety_vs_base": None if price is None else round(1 - price / values["base"], 4),
        "price_to_base": None if price is None else round(price / values["base"], 3),
        "assumptions": "10 years fading to terminal growth; bear half growth at 10%, base at 9%, bull 1.3× growth at 8.5%",
    }
