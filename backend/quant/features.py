"""Daily market features (plan §4.4.3, step 2). Each value at day t uses closes up to
and including t only; windows that reach before the first bar are NaN.

The 60-day trends are log changes, so a positive value means: credit spreads
tightening (HYG beating IEF), the dollar rising, long bond prices rising (yields
falling), breakevens widening (TIP beating IEF), copper beating gold, and the short end
beating the belly (SHY beating IEF, a flattening of the front of the curve).
"""

import math

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .bars import Panel
from .universe import BENCHMARK, SECTORS

YEAR = 252
TREND_DAYS = 60
VOL_PCT_LOOKBACK = 10 * YEAR

# name: (label, unit) for the UI and the Quant's tables
FEATURES = {
    "vol20": ("Realized volatility, 20 days", "ann"),
    "vol60": ("Realized volatility, 60 days", "ann"),
    "vol_pct": ("20-day volatility percentile, trailing 10 years", "pct"),
    "spy_vs_50": ("SPY against its 50-day average", "ratio"),
    "spy_vs_200": ("SPY against its 200-day average", "ratio"),
    "slope200": ("200-day average, change over 20 days", "ratio"),
    "dd_52w": ("SPY from its 52-week high", "ratio"),
    "breadth50": ("Sectors above their 50-day average", "share"),
    "corr60": ("Average sector correlation, 60 days", "corr"),
    "credit": ("Credit: HYG against IEF, 60 days", "log"),
    "dollar": ("Dollar: UUP, 60 days", "log"),
    "rates": ("Long bonds: TLT, 60 days", "log"),
    "breakevens": ("Breakevens: TIP against IEF, 60 days", "log"),
    "copper_gold": ("Copper against gold, 60 days", "log"),
    "curve": ("Front of the curve: SHY against IEF, 60 days", "log"),
}


def log_returns(close: np.ndarray) -> np.ndarray:
    out = np.full_like(close, np.nan)
    out[1:] = np.log(close[1:] / close[:-1])
    return out


def rolling(x: np.ndarray, n: int, fn) -> np.ndarray:
    """fn over each trailing window of n values ending at t (NaN until there are n)."""
    out = np.full(x.shape, np.nan)
    if len(x) >= n:
        out[n - 1:] = fn(sliding_window_view(x, n, axis=0), axis=-1)
    return out


def sma(x: np.ndarray, n: int) -> np.ndarray:
    return rolling(x, n, np.mean)


def realized_vol(r: np.ndarray, n: int) -> np.ndarray:
    return rolling(r, n, lambda w, axis: np.std(w, axis=axis, ddof=1)) * math.sqrt(YEAR)


def change(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(x.shape, np.nan)
    out[n:] = np.log(x[n:] / x[:-n])
    return out


def trailing_percentile(x: np.ndarray, lookback: int, minimum: int = YEAR) -> np.ndarray:
    """Share of the trailing values (up to lookback, at least minimum) at or below today's."""
    out = np.full(x.shape, np.nan)
    for t in range(len(x)):
        if np.isnan(x[t]):
            continue
        w = x[max(0, t - lookback + 1):t + 1]
        w = w[~np.isnan(w)]
        if len(w) >= minimum:
            out[t] = float(np.mean(w <= x[t]))
    return out


def breadth(p: Panel, n: int = 50) -> np.ndarray:
    c = p.cols(SECTORS)
    above = c > sma(c, n)
    valid = ~np.isnan(sma(c, n))
    count = valid.sum(axis=1)
    return np.where(count > 0, (above & valid).sum(axis=1) / np.maximum(count, 1), np.nan)


def sector_correlation(p: Panel, n: int = 60) -> np.ndarray:
    r = log_returns(p.cols(SECTORS))
    out = np.full(len(p.days), np.nan)
    for t in range(n, len(p.days)):
        w = r[t - n + 1:t + 1]
        w = w[:, ~np.isnan(w).any(axis=0)]
        if w.shape[1] < 3:
            continue
        cm = np.corrcoef(w, rowvar=False)
        k = cm.shape[0]
        out[t] = (cm.sum() - k) / (k * (k - 1))
    return out


def compute(p: Panel) -> dict[str, np.ndarray]:
    spy = p.col(BENCHMARK)
    r = log_returns(spy)
    vol20 = realized_vol(r, 20)
    ratio = lambda a, b: p.col(a) / p.col(b)  # noqa: E731
    return {
        "spy": spy,
        "ret": r,
        "vol20": vol20,
        "vol60": realized_vol(r, 60),
        "vol_pct": trailing_percentile(vol20, VOL_PCT_LOOKBACK),
        "spy_vs_50": spy / sma(spy, 50) - 1,
        "spy_vs_200": spy / sma(spy, 200) - 1,
        "slope200": change(sma(spy, 200), 20),
        "dd_52w": spy / rolling(spy, YEAR, np.max) - 1,
        "breadth50": breadth(p),
        "corr60": sector_correlation(p),
        "credit": change(ratio("HYG", "IEF"), TREND_DAYS),
        "dollar": change(p.col("UUP"), TREND_DAYS),
        "rates": change(p.col("TLT"), TREND_DAYS),
        "breakevens": change(ratio("TIP", "IEF"), TREND_DAYS),
        "copper_gold": change(ratio("CPER", "GLD"), TREND_DAYS),
        "curve": change(ratio("SHY", "IEF"), TREND_DAYS),
    }


def day_features(f: dict[str, np.ndarray], t: int) -> dict:
    """One day's features as plain numbers for JSON (None where not yet defined)."""
    return {k: (None if np.isnan(f[k][t]) else round(float(f[k][t]), 6)) for k in FEATURES}
