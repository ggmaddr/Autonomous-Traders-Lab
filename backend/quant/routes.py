"""The Market Year endpoint: everything the view draws, read from the tables the daily
pipeline writes. Nothing here calls a model or a data API; holdings are valued at the
last stored close (D15), or at their last fill when the symbol has no bars.
"""

import bisect
from datetime import date

from fastapi import APIRouter, HTTPException

from ..accounts import Account
from . import bars, store
from .features import FEATURES
from .regimes import DWELL, LABELS, RISK, episodes, sma_line
from .signals import SIGNALS
from .universe import DEFENSIVE

router = APIRouter()
RANGES = {"ytd": None, "2y": 2, "10y": 10}


def _start(as_of: str, rng: str) -> str:
    years = RANGES[rng]
    if years is None:
        return f"{as_of[:4]}-01-01"
    d = date.fromisoformat(as_of)
    return d.replace(year=d.year - years).isoformat()


def _since(rows: list[dict]) -> dict:
    """The current label, the day it was confirmed and how many trading days it has held."""
    last = rows[-1]
    n = 0
    for r in reversed(rows):
        if r["label"] != last["label"]:
            break
        n += 1
    return {"label": last["label"], "since": rows[-n]["day"], "days": n, "risk": RISK[last["label"]]}


def _raw_run(rows: list[dict]) -> int:
    """How many trading days the latest raw (unconfirmed) label has held."""
    n = 0
    for r in reversed(rows):
        if r["raw_label"] != rows[-1]["raw_label"]:
            break
        n += 1
    return n


def _read(rows: dict[str, list[dict]]) -> dict:
    rules, hmm = rows["rules"], rows.get("hmm") or []
    f = rules[-1]["features"]
    month = rules[-1]["day"][:7]
    switches = sum(1 for a, b in zip(rules, rules[1:]) if b["day"][:7] == month and a["label"] != b["label"])
    return {
        "day": rules[-1]["day"],
        "rules": _since(rules),
        "hmm": {**_since(hmm), "prob": hmm[-1]["prob"], "probs": hmm[-1]["probs"]} if hmm else None,
        "agree": bool(hmm) and hmm[-1]["label"] == rules[-1]["label"],
        "raw": {"rules": rules[-1]["raw_label"], "hmm": hmm[-1]["raw_label"] if hmm else None},
        # Days each model's raw label has held: a raw label that differs from the
        # confirmed one becomes confirmed after DWELL days.
        "raw_days": {"rules": _raw_run(rules), "hmm": _raw_run(hmm) if hmm else 0},
        "dwell": DWELL,
        "switches_this_month": switches,
        "features": [{"key": k, "label": FEATURES[k][0], "unit": FEATURES[k][1], "value": f.get(k)} for k in FEATURES],
    }


def _exposure(as_of: str) -> list[dict]:
    from ..trading_floor import names  # the roster; imported late to keep the API's import order

    out = []
    for name in names:
        account = Account.get(name)
        closes = store.last_closes(list(account.holdings))
        positions = []
        for symbol, qty in account.holdings.items():
            if symbol in closes:
                price, priced = closes[symbol][1], f"close {closes[symbol][0]}"
            else:
                price = next(t.price for t in reversed(account.transactions) if t.symbol == symbol)
                priced = "last fill"
            positions.append({"symbol": symbol, "quantity": qty, "value": price * qty, "priced": priced,
                              "bucket": "defensive" if symbol in DEFENSIVE else "risk_on"})
        invested = {b: sum(p["value"] for p in positions if p["bucket"] == b) for b in ("risk_on", "defensive")}
        equity = account.balance + sum(invested.values())
        out.append({"trader": name.lower(), "equity": equity, "cash": account.balance, **invested,
                    "positions": sorted(positions, key=lambda p: -p["value"])})
    return out


@router.get("/api/market-year")
def market_year(range: str = "ytd") -> dict:
    if range not in RANGES:
        raise HTTPException(status_code=400, detail=f"range must be one of {', '.join(RANGES)}")
    rows = {m: store.read_regimes(m) for m in ("rules", "hmm")}
    if not rows["rules"]:
        return {"ready": False, "bars": store.bar_stats()}
    as_of = rows["rules"][-1]["day"]
    start = _start(as_of, range)
    p = bars.panel(as_of, ["SPY"])
    i0 = bisect.bisect_left(p.days, start)
    sma200 = sma_line(p)
    by_day = {m: {r["day"]: r for r in rs} for m, rs in rows.items()}
    days = p.days[i0:]
    full = bars.panel(as_of)
    eps = {}
    for m, rs in rows.items():
        events = {e["day"]: e for e in store.read_events(m)}
        eps[m] = [{**e, "event": events.get(e["start"])} for e in episodes(full, rs, start)] if rs else []
    scores = {}
    for m in rows:
        day, cells = store.read_scores(m)
        scores[m] = {"as_of": day, "cells": cells}
    return {
        "ready": True,
        "as_of": as_of,
        "range": range,
        "start": days[0],
        "computed_at": rows["rules"][-1]["computed_at"],
        "versions": {m: rs[-1]["version"] for m, rs in rows.items() if rs},
        "bars": {**store.bar_stats(), "source": "Alpaca SIP, split and dividend adjusted"},
        "labels": LABELS,
        "risk": RISK,
        "series": {
            "days": days,
            "spy": [float(x) for x in p.col("SPY")[i0:]],
            "sma200": [None if x != x else float(x) for x in sma200[i0:]],
            "rules": [by_day["rules"].get(d, {}).get("label") for d in days],
            "hmm": [by_day["hmm"].get(d, {}).get("label") for d in days],
            "hmm_prob": [by_day["hmm"].get(d, {}).get("prob") for d in days],
        },
        "read": _read(rows),
        "episodes": eps,
        "signals": [{"id": s.id, "label": s.label, "rule": s.rule} for s in SIGNALS],
        "scores": scores,
        "exposure": _exposure(as_of),
        "notes": [
            "The 20 large caps are today's largest S&P 500 names, so stock signals carry survivorship bias.",
            "HMM labels before the as-of year are in-sample (fitted on those years); labels in it are not.",
            "Post-earnings drift uses a gap-up on heavy volume as a stand-in for an earnings report.",
        ],
    }
