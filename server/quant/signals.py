"""The signal scoreboard (plan §4.4.3, step 5): a fixed, pre-registered menu of eight
well-known signals, scored per regime. The menu does not grow by searching for winners;
if it ever does, the Sharpe ratios need deflating.

Each signal turns closes up to day t into target weights decided at t's close and held
over t+1, so a score never uses a price the signal could not have seen. Weights sum to
at most 1; the rest is cash at zero return. A day's return is credited to the regime
in force when the weights were decided.

Windows: "ytd" is the as-of year, "10y" the years before it (the prior), and "blend"
shrinks the year toward the prior with weight n_ytd / (n_ytd + K).
"""

import math
from dataclasses import dataclass
from typing import Callable

import numpy as np

from .bars import Panel
from .features import YEAR, log_returns, rolling, sma
from .regimes import LABELS
from .universe import BENCHMARK, LARGE_CAPS, SECTORS

K = 63  # a quarter of trading days: the year counts as much as the prior once it has this many
Z95 = 1.96


@dataclass
class Signal:
    id: str
    label: str
    rule: str
    universe: list[str]
    weights: Callable[[Panel], tuple[np.ndarray, np.ndarray]]  # (weights, trigger value), days × universe


def _month_starts(days: list[str]) -> np.ndarray:
    return np.array([i == 0 or days[i][:7] != days[i - 1][:7] for i in range(len(days))])


def _top(score: np.ndarray, n: int, highest: bool, rebalance: np.ndarray) -> np.ndarray:
    """Equal weights on the n best scores, reset only on rebalance days."""
    w = np.zeros_like(score)
    cur = np.zeros(score.shape[1])
    for t in range(len(score)):
        if rebalance[t]:
            row = score[t]
            ok = np.flatnonzero(~np.isnan(row))
            cur = np.zeros(score.shape[1])
            if len(ok) >= n:
                pick = ok[np.argsort(-row[ok] if highest else row[ok])[:n]]
                cur[pick] = 1 / n
        w[t] = cur
    return w


def _hold(entry: np.ndarray, exit_: np.ndarray, max_days: int | None = None) -> np.ndarray:
    """In from an entry day until an exit day (or max_days), per column; equal weights over what is held."""
    held = np.zeros(entry.shape, dtype=bool)
    age = np.zeros(entry.shape[1], dtype=int)  # days held, counting the entry day as 1
    on = np.zeros(entry.shape[1], dtype=bool)
    for t in range(len(entry)):
        on &= ~exit_[t]
        if max_days:
            on &= age < max_days
        on |= entry[t]
        age = np.where(entry[t], 1, np.where(on, age + 1, 0))
        held[t] = on
    n = held.sum(axis=1, keepdims=True)
    return np.where(n > 0, held / np.maximum(n, 1), 0.0)


def rsi(close: np.ndarray, n: int) -> np.ndarray:
    d = np.diff(close, axis=0, prepend=np.nan)
    up, down = np.clip(d, 0, None), np.clip(-d, 0, None)
    au, ad = rolling(up, n, np.mean), rolling(down, n, np.mean)
    with np.errstate(divide="ignore", invalid="ignore"):
        return 100 - 100 / (1 + au / ad)


def xs_momentum(p: Panel):
    c = p.cols(SECTORS)
    score = np.full_like(c, np.nan)
    score[YEAR:] = c[YEAR - 21:-21] / c[:-YEAR] - 1
    return _top(score, 3, True, _month_starts(p.days)), score


def trend_200d(p: Panel):
    c = p.cols([BENCHMARK])
    gap = c / sma(c, 200) - 1
    return np.where(gap > 0, 1.0, 0.0), gap


def rsi2_reversion(p: Panel):
    c = p.cols([BENCHMARK] + SECTORS)
    r2 = rsi(c, 2)
    entry = (r2 < 10) & (c > sma(c, 200))
    exit_ = c > sma(c, 5)
    return _hold(entry, exit_), r2


def low_vol(p: Panel):
    c = p.cols(SECTORS)
    vol = rolling(log_returns(c), 60, lambda w, axis: np.std(w, axis=axis, ddof=1)) * math.sqrt(YEAR)
    return _top(vol, 4, False, _month_starts(p.days)), vol


def earnings_drift(p: Panel):
    c, o, v = p.cols(LARGE_CAPS), p.cols(LARGE_CAPS, "open"), p.cols(LARGE_CAPS, "volume")
    prev = np.vstack([np.full((1, c.shape[1]), np.nan), c[:-1]])
    gap = o / prev - 1
    avg_v = np.vstack([np.full((1, c.shape[1]), np.nan), rolling(v, 20, np.mean)[:-1]])
    entry = (gap >= 0.03) & (c > o) & (v >= 2 * avg_v)
    return _hold(entry, np.zeros_like(entry), max_days=20), gap


def breakout_55d(p: Panel):
    syms = [BENCHMARK] + SECTORS
    c, h, lo = p.cols(syms), p.cols(syms, "high"), p.cols(syms, "low")
    hi55 = np.vstack([np.full((1, c.shape[1]), np.nan), rolling(h, 55, np.max)[:-1]])
    lo20 = np.vstack([np.full((1, c.shape[1]), np.nan), rolling(lo, 20, np.min)[:-1]])
    return _hold(c > hi55, c < lo20), c / hi55 - 1


DEFENSIVE_BASKET = ["XLU", "XLP", "TLT", "GLD"]


def defensive_rotation(p: Panel):
    c = p.cols(DEFENSIVE_BASKET)
    return np.where(np.isnan(c), 0.0, 0.25), np.zeros_like(c)


def buy_hold(p: Panel):
    c = p.cols([BENCHMARK])
    return np.where(np.isnan(c), 0.0, 1.0), np.zeros_like(c)


SIGNALS = [
    Signal("xs_momentum_12_1", "12-1 sector momentum", "Top 3 of the 11 sector SPDRs by 12-month return skipping the last month; rebalanced monthly", SECTORS, xs_momentum),
    Signal("trend_200d", "Trend, 200-day", "SPY while it closes above its 200-day average, else cash", [BENCHMARK], trend_200d),
    Signal("rsi2_reversion", "RSI(2) mean reversion", "Buy SPY or a sector when RSI(2) < 10 above its 200-day average; sell when it closes above its 5-day average", [BENCHMARK] + SECTORS, rsi2_reversion),
    Signal("low_vol", "Low volatility", "The 4 calmest sectors by 60-day volatility; rebalanced monthly", SECTORS, low_vol),
    Signal("earnings_drift", "Post-earnings drift (gap proxy)", "A large cap that gaps up 3%+ on twice its volume and holds the gap; held 20 days. No earnings calendar: a gap stands in for the report", LARGE_CAPS, earnings_drift),
    Signal("breakout_55d", "55-day breakout", "Buy SPY or a sector on a close above its 55-day high; sell on a close below its 20-day low", [BENCHMARK] + SECTORS, breakout_55d),
    Signal("defensive_rotation", "Defensive basket", "XLU, XLP, TLT and GLD, a quarter each, always held", DEFENSIVE_BASKET, defensive_rotation),
    Signal("buy_hold", "Buy and hold", "SPY, always held", [BENCHMARK], buy_hold),
]
BY_ID = {s.id: s for s in SIGNALS}


def daily_returns(p: Panel, s: Signal) -> tuple[np.ndarray, np.ndarray]:
    """(return on day t+1 from weights decided at t, exposure at t), indexed by decision day t."""
    w, _ = s.weights(p)
    c = p.cols(s.universe)
    nxt = np.full_like(c, np.nan)
    nxt[:-1] = c[1:] / c[:-1] - 1
    ret = np.nansum(np.where(np.isnan(nxt), 0.0, w * nxt), axis=1)
    ret[-1] = np.nan  # the last decision has no next day yet
    return ret, w.sum(axis=1)


def _stats(r: np.ndarray, exposure: np.ndarray, episodes: np.ndarray) -> dict:
    n = len(r)
    if n < 2:
        return {"n_days": n, "n_episodes": int(len(set(episodes.tolist()))), "ann_return": None, "hit_rate": None,
                "sharpe": None, "ci_lo": None, "ci_hi": None}
    sd = float(np.std(r, ddof=1))
    sr_d = float(np.mean(r)) / sd if sd > 0 else 0.0
    se = math.sqrt((1 + 0.5 * sr_d ** 2) / n)  # Lo (2002), iid
    invested = r[exposure > 0]
    a = math.sqrt(YEAR)
    return {
        "n_days": n,
        "n_episodes": int(len(set(episodes.tolist()))),
        "ann_return": float(np.mean(r) * YEAR),
        "hit_rate": float(np.mean(invested > 0)) if len(invested) else None,
        "sharpe": sr_d * a,
        "ci_lo": (sr_d - Z95 * se) * a,
        "ci_hi": (sr_d + Z95 * se) * a,
    }


def _blend(y: dict, t: dict) -> dict:
    w = y["n_days"] / (y["n_days"] + K)
    mix = lambda k: None if y[k] is None and t[k] is None else (t[k] if y[k] is None else y[k] if t[k] is None else w * y[k] + (1 - w) * t[k])  # noqa: E731
    return {"n_days": y["n_days"] + t["n_days"], "n_episodes": y["n_episodes"] + t["n_episodes"],
            **{k: mix(k) for k in ("ann_return", "hit_rate", "sharpe", "ci_lo", "ci_hi")}}


def scoreboard(p: Panel, regime_rows: list[dict], as_of: str) -> list[dict]:
    """Every signal × regime (and "All") × window, using decisions up to as_of whose next
    day has also closed by as_of."""
    label_at = {r["day"]: r["label"] for r in regime_rows}
    end = p.index(as_of)  # last decision day counted is end - 1: its return closes at end
    days = p.days[:end]
    labels = np.array([label_at.get(d) or "" for d in days])
    episode = np.cumsum(np.r_[1, labels[1:] != labels[:-1]]) if len(labels) else np.array([])
    year = as_of[:4]
    ytd = np.array([d[:4] == year for d in days])
    prior = np.array([d[:4] < year for d in days])
    out = []
    for s in SIGNALS:
        ret, exp = daily_returns(p, s)
        ret, exp = ret[:end], exp[:end]
        ok = ~np.isnan(ret) & (labels != "")
        for regime in LABELS + ["All"]:
            m = ok & ((labels == regime) if regime != "All" else True)
            y = _stats(ret[m & ytd], exp[m & ytd], episode[m & ytd])
            t = _stats(ret[m & prior], exp[m & prior], episode[m & prior])
            for window, st in (("ytd", y), ("10y", t), ("blend", _blend(y, t))):
                out.append({"signal": s.id, "regime": regime, "window": window, **st})
    return out


def scan(p: Panel, signal_id: str, as_of: str, limit: int = 15) -> list[dict]:
    """Today's candidates: what the signal holds as of the day, with its trigger value."""
    s = BY_ID[signal_id]
    w, trig = s.weights(p)
    t = p.index(as_of)
    c = p.cols(s.universe)
    rows = [{"symbol": sym, "weight": float(w[t, j]), "trigger": None if np.isnan(trig[t, j]) else float(trig[t, j]),
             "close": float(c[t, j])} for j, sym in enumerate(s.universe) if w[t, j] > 0]
    return sorted(rows, key=lambda r: -r["weight"])[:limit]
