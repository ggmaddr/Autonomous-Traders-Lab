"""Regime decision points for E12–E14 (plan §4.3): scenarios built from real bars at each
of this year's confirmed regime turns, instead of written by hand.

Each one starts in cash on the day a turn was confirmed, prices every symbol at that
close, and plays the next HORIZON real trading days forward. Its research is the news
the Market Year pipeline found for that turn. The tickers are real, which the masked
tickers of the hand-written scenarios avoid; the local model's training ends before
2026, so it cannot recall what came next.

The baselines are weights a rule would hold that day: the mechanical regime rule (E12:
the Quant's regime and scoreboard run with no LLM), Faber's 200-day rule, 60/40 and
volatility-targeted SPY. A trial passes when it beats the mechanical rule over the
horizon, and is partial when it beats the 200-day rule.

    uv run -m server.lab.regime_scenarios     # (re)write scenarios/regime-*.yaml
"""

import math

import numpy as np
import yaml

from ..quant import bars, store
from ..quant.tools import Quant
from .scenarios import SCENARIO_DIR

HORIZON = 20
CASH = 10_000.0
TARGET_VOL = 0.12
UNIVERSE = ["SPY", "QQQ", "IWM", "EFA", "EEM",
            "XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY",
            "TLT", "IEF", "SHY", "GLD", "HYG", "LQD",
            "AAPL", "MSFT", "ADBE", "PG", "KO", "JNJ", "XOM", "COST"]
NAMES = {"SPY": "S&P 500 ETF", "QQQ": "Nasdaq 100 ETF", "IWM": "Russell 2000 ETF", "EFA": "Developed markets ETF",
         "EEM": "Emerging markets ETF", "TLT": "20+ year Treasuries", "IEF": "7-10 year Treasuries", "SHY": "1-3 year Treasuries",
         "GLD": "Gold", "HYG": "High-yield credit", "LQD": "Investment-grade credit", "AAPL": "Apple", "MSFT": "Microsoft",
         "ADBE": "Adobe", "PG": "Procter & Gamble", "KO": "Coca-Cola", "JNJ": "Johnson & Johnson", "XOM": "Exxon Mobil",
         "COST": "Costco"}
MIN_SIGNAL_DAYS = 63


def mechanical(q: Quant) -> dict[str, float]:
    """E12's rule with no LLM: today's regime, the two signals with the best blended Sharpe
    (with at least a quarter of days behind them), each holding half, sized by the Quant."""
    board = q.signal_scoreboard()["signals"]
    best = [r for r in board if r["sharpe_blend"] is not None and r["days_this_year"] + r["days_prior_10y"] >= MIN_SIGNAL_DAYS][:2]
    weights: dict[str, float] = {}
    for r in best:
        for h in q.signal_scan(r["signal"])["holds"]:
            if h["symbol"] in UNIVERSE:
                weights[h["symbol"]] = weights.get(h["symbol"], 0) + h["weight"] / len(best)
    sized = q.size_positions(weights, TARGET_VOL, {}, CASH, CASH)
    return {r["symbol"]: r["final_weight"] for r in sized["rows"] if r.get("final_weight")}


def rule_weights(q: Quant, p: bars.Panel, t: int) -> dict[str, dict[str, float]]:
    spy = p.col("SPY")
    above = spy[t] > np.nanmean(spy[t - 199:t + 1])
    r = np.diff(np.log(spy[t - 20:t + 1]))
    vol = float(np.std(r, ddof=1) * math.sqrt(252))
    v = min(1.0, TARGET_VOL / vol) if vol > 0 else 1.0
    return {
        "mechanical": mechanical(q),
        "trend_200d": {"SPY": 1.0} if above else {"SHY": 1.0},
        "sixty_forty": {"SPY": 0.6, "IEF": 0.4},
        "vol_target": {"SPY": round(v, 4), **({"SHY": round(1 - v, 4)} if v < 1 else {})},
    }


def build() -> list[str]:
    rows = store.read_regimes("rules")
    p = bars.panel()
    year = rows[-1]["day"][:4]
    turns = [(a["label"], b) for a, b in zip(rows, rows[1:]) if b["label"] != a["label"] and b["day"][:4] == year]
    events = {e["day"]: e for e in store.read_events("rules", f"{year}-01-01")}
    written = []
    for before, row in turns:
        day = row["day"]
        t = p.index(day)
        if t + HORIZON >= len(p.days):
            continue  # its horizon has not closed yet
        q = Quant(day)
        universe = {}
        for sym in UNIVERSE:
            c = p.col(sym)
            if np.isnan(c[t]):
                continue
            path = [round(float(c[i + 1] / c[i] - 1), 6) for i in range(t, t + HORIZON)]
            universe[sym] = {"name": NAMES.get(sym, sym), "price": round(float(c[t]), 2), "path": path}
        ev = events.get(day)
        documents = []
        if ev:
            documents.append({"id": f"turn-{day}", "title": ev["headline"], "url": (ev["sources"] or [{"url": f"https://lab.marketyear/{day}"}])[0]["url"],
                              "date": day, "text": ev["summary"]})
        sid = f"regime-{day}"
        spec = {
            "id": sid,
            "version": 1,
            "title": f"{before} to {row['label']}, {day}",
            "family": "regime",
            "question": f"After the turn from {before} to {row['label']}, does the agent beat the mechanical regime rule over the next {HORIZON} trading days?",
            "task": "trade",
            "as_of": f"{day}T20:00:00Z",
            "horizon_days": HORIZON,
            "universe": universe,
            "portfolio": {"cash": CASH, "positions": {}},
            "documents": documents,
            "evidence_terms": [w for w in (ev["headline"].lower().split() if ev else []) if len(w) > 4][:4],
            "baseline_weights": {k: {s: w for s, w in v.items() if s in universe} for k, v in rule_weights(q, p, t).items()},
            "grading": {"pass": [{"min_return_vs": "mechanical", "no_violations": True}],
                        "partial": [{"min_return_vs": "trend_200d"}]},
        }
        (SCENARIO_DIR / f"{sid}.yaml").write_text(yaml.safe_dump(spec, sort_keys=False, width=120))
        written.append(sid)
    return written


if __name__ == "__main__":
    print("Wrote", ", ".join(build()) or "nothing: no turn this year has a closed horizon yet")
