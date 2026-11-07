"""Strategy playbooks (plan §4.4.1–4.4.2): Warren's and George's strategies as rules the
Quant computes and a check can verify. Each playbook is strategy text plus a rule list;
the text is what the trader reads, and check() grades every order of a run against the
rules from what the run actually saw (its Quant tool results) and did (its fills).

Playbook traders cannot change their strategy (the change_strategy tool is filtered
out); a new version is a new id here, and every run stores the text it ran under.
"""

import json

from .quant.universe import MACRO_UNIVERSE

WARREN = {
    "id": "warren-qarp-v1",
    "name": "Quality at a reasonable price",
    "text": """Playbook warren-qarp-v1: quality at a reasonable price. You are Warren. You blend Buffett's focus on
quality with Greenblatt's Magic Formula and the Piotroski F-score. These rules are fixed; follow them and name the
rule you act on in every order rationale (for example "W2: margin of safety 31%").

W1 Screen. Call quality_screen. Buy only companies that pass all five tests: 5-year ROIC above 15%, free cash flow
positive in each of the last 5 years, net debt / EBITDA below 2, Piotroski F-score 7 or more, earnings yield in the
top third. The universe is large S&P 500 companies outside financials and REITs.
W2 Value. Call owner_earnings_dcf for each candidate. Buy only at a margin of safety of at least 25% to the base case.
Never do this arithmetic yourself.
W3 Moat. Ask the Researcher about pricing power (stable gross margin), switching costs, network effects, scale, and the
10-K risk factors. Write down the kill criteria: the facts that would break the thesis.
W4 Size. At most 15% of equity in one company.
W5 Cash. Keep at least 10% of equity in cash.
W6 Breadth. Hold 8 to 12 positions over time; never more than 12. Add to a position after a fall only if the thesis
still holds.
W7 Sell only when the price is above 1.1 times the base-case value, a kill criterion is hit, or another candidate
offers at least 15 points more margin of safety. Never sell because the price fell.
W8 Memory. Ask the Researcher to keep one entity per company: observations with the value range and its date, the moat
verdict and the kill criteria; relations competes_with, supplies, held_by.""",
    "rules": {
        "W1": "Bought only names that passed all five screen tests in this run",
        "W2": "Bought only at a margin of safety of 25% or more to the base-case value",
        "W4": "No position above 15% of equity after the trade",
        "W5": "At least 10% of equity in cash after the trade",
        "W6": "No more than 12 positions after the trade",
        "W7": "Sold only above 1.1× base value, on a kill criterion, or to swap for 15+ points more margin",
    },
}

GEORGE = {
    "id": "george-macro-trend-v1",
    "name": "Global macro with trend confirmation",
    "text": """Playbook george-macro-trend-v1: global macro with trend confirmation. You are George. You join Soros-style
reflexivity (find the imbalance, size up when it proves right) with time-series momentum. Long only, through ETFs. These
rules are fixed; follow them and name the rule you act on in every order rationale (for example "G2: trend confirmed").

G1 Universe. Equity indices SPY, QQQ, IWM, EFA, EEM; the 11 sector SPDRs; rates TLT, IEF, SHY; credit HYG, LQD; the
dollar UUP, gold GLD, oil USO. SH (inverse S&P) only as a hedge, held 5 days or less. Nothing else.
G2 Entry. Call macro_dashboard. A macro thesis needs trend confirmation: 12-1 month momentum above zero and price above
its 100-day average (trend_confirmed). A contrarian entry is allowed only at an extreme: RSI(14) below 25, plus a
volatility spike, plus a catalyst you name.
G3 Size. Risk 1% of equity per idea at a stop 2 ATR away: shares = 0.01 × equity / (2 × ATR14). Add 50% more only after
a move of 1 ATR in your favour.
G4 Themes. At most 5 themes at once; gross exposure at most 100%.
G5 Events. Ask the Researcher to compare expected with actual results for FOMC, CPI and payrolls; the surprise is what
moves prices.
G6 Memory. Ask the Researcher to keep one entity per macro theme ("Fed cutting cycle", "dollar weakness") with the
evidence as observations, linked to its ETFs by expressed_via; update its status and P&L when it closes.""",
    "rules": {
        "G1": "Traded only ETFs in the macro universe",
        "G2": "Bought only with trend confirmed, or at an RSI(14) < 25 extreme with a volatility spike",
        "G3": "Risked at most 1% of equity at a 2-ATR stop (1.5% when adding)",
        "G4": "No more than 5 positions after the trade",
    },
}

JIM = {
    "id": "jim-regime-v1",
    "name": "Regime quant",
    "text": """Playbook jim-regime-v1: the regime quant. You are Jim. You do not predict prices. You trade what the
measured regime and the signals that have paid in it say, check the story against the numbers, and size by
volatility so no single regime change can hurt you badly. These rules are fixed; name the rule you act on in every
order rationale (for example "J1: size_positions delta").

J1 Size. Every order comes from size_positions: only rows marked trade=true, in the direction and at most the size of
their delta. Never size a position yourself.
J2 Limits. At most 25% of equity per ETF and 10% per stock; a 12% annual volatility target.
J3 Thesis. Buy only after the Synthesizer has written this cycle's thesis. Full cycles run on a regime change (at most
three a month) or the weekly rebalance; other cycles only check the brake.
J4 Brake. Halve exposure at -8% from peak; at -12% hold only SHY and cash.
J5 Long only. Risk-off means cash, SHY, TLT, GLD and defensive sectors. No leveraged or inverse funds.""",
    "rules": {
        "J1": "Traded only size_positions rows marked trade=true, within their delta",
        "J2": "No ETF above 25% or stock above 10% of equity after the trade",
        "J3": "Bought only after the Synthesizer wrote this run's thesis",
        "J4": "Respected the drawdown brake",
    },
}

PLAYBOOKS = {"Warren": WARREN, "George": GEORGE, "Jim": JIM}
MIN_MARGIN = 0.25


def playbook_of(trader: str | None) -> dict | None:
    return PLAYBOOKS.get((trader or "").capitalize())


def _status(ok: bool | None, evidence: str) -> dict:
    return {"status": "unknown" if ok is None else "pass" if ok else "fail", "evidence": evidence}


def _warren(order: dict, seen: dict, after: dict) -> dict:
    sym, out = order["symbol"], {}
    equity = after.get("equity") or 0
    if order["side"] == "buy":
        screens = [c for r in seen.get("quality_screen", []) for c in r.get("candidates", []) if c.get("symbol") == sym]
        if not seen.get("quality_screen"):
            out["W1"] = _status(False, "bought without calling quality_screen in this run")
        elif not screens:
            out["W1"] = _status(False, f"{sym} was not in the screen's results")
        else:
            last = screens[-1]
            out["W1"] = _status(bool(last.get("passes")), "passed all five tests" if last.get("passes") else
                                f"failed {', '.join(last['failed'])}" if last.get("failed") else
                                f"unknown: {', '.join(last.get('unknown') or [])}")
        dcfs = [r for r in seen.get("owner_earnings_dcf", []) if r.get("symbol") == sym and r.get("margin_of_safety_vs_base") is not None]
        out["W2"] = _status(False, f"no owner_earnings_dcf for {sym} in this run") if not dcfs else \
            _status(dcfs[-1]["margin_of_safety_vs_base"] >= MIN_MARGIN, f"margin of safety {dcfs[-1]['margin_of_safety_vs_base']:+.0%} to base")
        weight = (after["holdings"].get(sym, 0) * order["price"]) / equity if equity and order.get("price") else None
        out["W4"] = _status(None if weight is None else weight <= 0.15 + 1e-9, "position size unknown" if weight is None else f"{sym} is {weight:.1%} of equity")
        cash = after.get("cash") / equity if equity and after.get("cash") is not None else None
        out["W5"] = _status(None if cash is None else cash >= 0.10 - 1e-9, "cash unknown" if cash is None else f"cash {cash:.1%} of equity")
        n = len([s for s, q in after["holdings"].items() if q])
        out["W6"] = _status(n <= 12, f"{n} positions")
    else:
        dcfs = [r for r in seen.get("owner_earnings_dcf", []) if r.get("symbol") == sym and r.get("price_to_base") is not None]
        rich = bool(dcfs) and dcfs[-1]["price_to_base"] >= 1.1
        text = (order.get("rationale") or "").lower()
        cited = any(k in text for k in ("kill", "w7", "swap", "more margin"))
        out["W7"] = _status(rich or cited, f"price {dcfs[-1]['price_to_base']:.2f}× base value" if dcfs else
                            "rationale cites a kill criterion or a swap" if cited else "no valuation in this run and no kill criterion or swap named")
    return out


def _george(order: dict, seen: dict, after: dict, before: dict) -> dict:
    sym, out = order["symbol"], {}
    out["G1"] = _status(sym in MACRO_UNIVERSE, f"{sym} is {'in' if sym in MACRO_UNIVERSE else 'outside'} the macro universe")
    if order["side"] != "buy":
        return out
    rows = [e for r in seen.get("macro_dashboard", []) for e in r.get("etfs", []) if e.get("symbol") == sym]
    if not rows:
        out["G2"] = _status(False, "bought without a macro_dashboard reading for it in this run")
    else:
        e = rows[-1]
        contrarian = (e.get("rsi14") or 100) < 25 and e.get("vol_spike")
        out["G2"] = _status(bool(e.get("trend_confirmed") or contrarian),
                            "trend confirmed" if e.get("trend_confirmed") else "contrarian extreme" if contrarian else
                            f"trend not confirmed (12-1 momentum {e.get('momentum_12_1')}, above 100-day {e.get('above_100d')})")
        equity = after.get("equity") or 0
        limit = 0.015 if before["holdings"].get(sym) else 0.01
        risk = order["quantity"] * 2 * (e.get("atr14") or 0) / equity if equity and e.get("atr14") else None
        out["G3"] = _status(None if risk is None else risk <= limit + 1e-9, "risk unknown" if risk is None else f"risk {risk:.2%} of equity at 2 ATR (limit {limit:.1%})")
    n = len([s for s, q in after["holdings"].items() if q])
    out["G4"] = _status(n <= 5, f"{n} positions")
    return out


def _jim(order: dict, seen: dict, after: dict) -> dict:
    sym, out = order["symbol"], {}
    sizing = seen.get("size_positions", [])
    rows = [r for s in sizing for r in s.get("rows", []) if r.get("symbol") == sym]
    want = -1 if order["side"] == "sell" else 1
    if not rows:
        out["J1"] = _status(False, f"no size_positions row for {sym} in this run")
    else:
        r = rows[-1]
        ok = bool(r.get("trade")) and (r.get("delta") or 0) * want > 0 and order["quantity"] <= abs(r.get("delta") or 0)
        out["J1"] = _status(ok, f"size_positions said trade={r.get('trade')}, delta {r.get('delta')}; order {want * order['quantity']:+d}")
    equity = after.get("equity") or 0
    weight = (after["holdings"].get(sym, 0) * order["price"]) / equity if equity and order.get("price") else None
    from .quant.universe import LARGE_CAPS, SYMBOLS
    cap = 0.10 if sym in LARGE_CAPS or sym not in SYMBOLS else 0.25
    out["J2"] = _status(None if weight is None else weight <= cap + 0.01, "size unknown" if weight is None else f"{sym} is {weight:.1%} of equity (cap {cap:.0%})")
    if order["side"] == "buy":
        out["J3"] = _status(bool(seen.get("Synthesizer")), "thesis written in this run" if seen.get("Synthesizer") else "no Synthesizer thesis in this run")
        brake = sizing[-1].get("brake") if sizing else None
        out["J4"] = _status(None if brake is None else brake == "none" or sym == "SHY",
                            "brake unknown" if brake is None else f"brake {brake}")
    return out


def check(trader: str, orders: list[dict], seen: dict[str, list[dict]], before: dict, after: dict) -> list[dict]:
    """Grade each filled order against the trader's playbook.

    orders: [{side, symbol, quantity, price, rationale}] that filled, in order.
    seen: the run's Quant tool results by tool name, parsed.
    before/after: {holdings, cash, equity} around the run.
    """
    pb = playbook_of(trader)
    if not pb:
        return []
    out = []
    for o in orders:
        res = _warren(o, seen, after) if pb is WARREN else _george(o, seen, after, before) if pb is GEORGE else _jim(o, seen, after)
        out.append({"order": {k: o.get(k) for k in ("side", "symbol", "quantity", "price")},
                    "rules": [{"id": k, "text": pb["rules"][k], **v} for k, v in res.items()]})
    return out


def parse_json(text: str) -> dict | None:
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else None
    except (TypeError, ValueError):
        return None
