"""Two regime models, side by side (plan §4.4.3, step 3), and the episodes they form.

- rules: trend × volatility. SPY above or below its 200-day average, and 20-day
  volatility above or below the 70th percentile of the trailing ten years.
- hmm: a 4-state Gaussian HMM on SPY's 20-day return, log volatility, the credit trend
  and breadth, fitted on the years before the as-of year and run forward-filtered: a
  day's probabilities use observations up to that day only (hmmlearn's predict_proba
  smooths with later days, so it is not used). Its states are named after the rules
  regime their fitted means resemble (the most volatile is Stress, the weakest return
  Calm chop, the calmer of the other two Calm bull), so the two read on one scale.
  Labels for the fitted years themselves are in-sample; for the as-of year they are not.

Both apply the same dwell rule: the label changes only after the new raw label has held
for DWELL days in a row, which damps whipsaw at the cost of confirming late.
"""

import numpy as np
from hmmlearn.hmm import GaussianHMM
from scipy.special import logsumexp
from scipy.stats import multivariate_normal

from .bars import Panel
from .features import change, day_features, sma
from .universe import BENCHMARK, SECTOR_NAMES, SECTORS

LABELS = ["Calm bull", "Volatile bull", "Calm chop", "Stress"]
RISK = {"Calm bull": "risk-on", "Volatile bull": "risk-on", "Calm chop": "neutral", "Stress": "risk-off"}
DWELL = 5
HIGH_VOL_PCT = 0.70
HMM_SEED = 7
RULES_VERSION = f"rules-v1: SPY vs 200-day × 20-day vol vs {HIGH_VOL_PCT:.0%} percentile, dwell {DWELL}"


def rules_raw(f: dict, t: int) -> str | None:
    trend, pct, vol = f["spy_vs_200"][t], f["vol_pct"][t], f["vol20"][t]
    if np.isnan(trend) or np.isnan(vol):
        return None
    high = pct >= HIGH_VOL_PCT if not np.isnan(pct) else vol > 0.20
    if trend > 0:
        return "Volatile bull" if high else "Calm bull"
    return "Stress" if high else "Calm chop"


def dwell(raw: list[str | None]) -> list[str | None]:
    """Confirmed labels: switch to a new label once it has been the raw label DWELL days running."""
    out, cur, run, last = [], None, 0, None
    for r in raw:
        run = run + 1 if r is not None and r == last else (1 if r is not None else 0)
        last = r
        if r is not None and (cur is None or (r != cur and run >= DWELL)):
            cur = r
        out.append(cur)
    return out


def rules(p: Panel, f: dict) -> list[dict]:
    raw = [rules_raw(f, t) for t in range(len(p.days))]
    labels = dwell(raw)
    return [{"day": p.days[t], "label": labels[t], "raw_label": raw[t], "features": day_features(f, t)}
            for t in range(len(p.days)) if labels[t]]


def _observations(f: dict) -> np.ndarray:
    return np.column_stack([change(f["spy"], 20), np.log(f["vol20"]), f["credit"], f["breadth50"]])


def hmm(p: Panel, f: dict, fit_before: str) -> tuple[list[dict], str]:
    """Fit on days before fit_before, then forward-filter every day."""
    X = _observations(f)
    valid = ~np.isnan(X).any(axis=1)
    fit = valid & (np.array(p.days) < fit_before)
    if fit.sum() < 500:
        return [], "hmm: not enough history before the as-of year to fit"
    mu, sd = X[fit].mean(axis=0), X[fit].std(axis=0)
    Z = (X - mu) / sd
    model = GaussianHMM(n_components=len(LABELS), covariance_type="full", n_iter=200, random_state=HMM_SEED)
    model.fit(Z[fit])

    # Forward filter: alpha_t ∝ P(x_t | s) · Σ alpha_{t-1} · A
    idx = np.flatnonzero(valid)
    log_b = np.column_stack([multivariate_normal(model.means_[k], model.covars_[k], allow_singular=True).logpdf(Z[idx])
                             for k in range(model.n_components)])
    log_a = np.log(model.transmat_ + 1e-300)
    alpha = np.empty_like(log_b)
    alpha[0] = np.log(model.startprob_ + 1e-300) + log_b[0]
    alpha[0] -= logsumexp(alpha[0])
    for i in range(1, len(idx)):
        alpha[i] = logsumexp(alpha[i - 1][:, None] + log_a, axis=0) + log_b[i]
        alpha[i] -= logsumexp(alpha[i])
    probs = np.exp(alpha)

    # Name each state by its fitted means: the most volatile is Stress; of the rest, the
    # weakest 20-day return is Calm chop, and the calmer of the last two is Calm bull.
    means = model.means_ * sd + mu
    vol_rank = list(np.argsort(-means[:, 1]))
    stress = vol_rank[0]
    rest = [k for k in range(model.n_components) if k != stress]
    chop = min(rest, key=lambda k: means[k, 0])
    calm, volatile = sorted([k for k in rest if k != chop], key=lambda k: means[k, 1])
    name = {stress: "Stress", chop: "Calm chop", calm: "Calm bull", volatile: "Volatile bull"}
    state = probs.argmax(axis=1)

    raw = [name[s] for s in state]
    labels = dwell(raw)
    rows = []
    for i, t in enumerate(idx):
        by_label = {name[k]: round(float(probs[i, k]), 4) for k in range(model.n_components)}
        rows.append({"day": p.days[t], "label": labels[i], "raw_label": raw[i], "prob": by_label[labels[i]],
                     "probs": by_label, "features": day_features(f, t)})
    version = f"hmm-v1: 4-state Gaussian HMM, fit {p.days[np.flatnonzero(fit)[0]]}..{p.days[np.flatnonzero(fit)[-1]]}, seed {HMM_SEED}, forward-filtered, dwell {DWELL}"
    return rows, version


def episodes(p: Panel, rows: list[dict], start: str | None = None, end: str | None = None) -> list[dict]:
    """Runs of one label, with SPY's return (from the close before the run), max drawdown,
    annualized volatility, and the three sectors that led and lagged over the run."""
    runs: list[list[dict]] = []
    for r in rows:
        if runs and runs[-1][-1]["label"] == r["label"]:
            runs[-1].append(r)
        else:
            runs.append([r])
    spy = p.col(BENCHMARK)
    sectors = p.cols(SECTORS)
    out = []
    for n, run in enumerate(runs):
        first, last = run[0]["day"], run[-1]["day"]
        if (start and last < start) or (end and first > end):
            continue
        a, b = p.index(first), p.index(last)
        base = max(a - 1, 0)
        path = spy[base:b + 1]
        rets = np.diff(np.log(path))
        sector_ret = sectors[b] / sectors[base] - 1
        ranked = [SECTORS[j] for j in np.argsort(-np.nan_to_num(sector_ret, nan=-np.inf)) if not np.isnan(sector_ret[j])]
        out.append({
            "label": run[0]["label"],
            "risk": RISK[run[0]["label"]],
            "start": first,
            "end": last,
            "open": n == len(runs) - 1,
            "days": len(run),
            "spy_return": float(path[-1] / path[0] - 1),
            "max_drawdown": float(np.min(path / np.maximum.accumulate(path) - 1)),
            "vol": float(np.std(rets, ddof=1) * np.sqrt(252)) if len(rets) > 1 else None,
            "leaders": [{"symbol": s, "name": SECTOR_NAMES[s], "return": float(sector_ret[SECTORS.index(s)])} for s in ranked[:3]],
            "laggards": [{"symbol": s, "name": SECTOR_NAMES[s], "return": float(sector_ret[SECTORS.index(s)])} for s in ranked[-3:][::-1]],
        })
    return out


def sma_line(p: Panel, n: int = 200) -> np.ndarray:
    return sma(p.col(BENCHMARK), n)
