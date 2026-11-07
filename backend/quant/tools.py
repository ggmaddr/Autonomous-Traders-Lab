"""The Quant's numbers as plain functions of an as-of day (plan §4.4.3, Jim's agent
team). quant_server.py serves them over MCP to the live traders, bound to today and
to one account; the Experiment Lab will hand the same functions to a trial as SDK
function tools, bound to the scenario's day. The model never chooses the day, so it
cannot ask for the future.

Every result says which close it is as of and stays at 30 rows or fewer.
"""

import math

import numpy as np

from . import bars, fundamentals, signals, store
from .features import FEATURES, YEAR, log_returns, rolling, sma
from .regimes import LABELS, RISK, episodes
from .signals import rsi
from .universe import BENCHMARK, LARGE_CAPS, MACRO_UNIVERSE, QUALITY, SYMBOLS

MAX_ROWS = 30
ETF_CAP = 0.25
STOCK_CAP = 0.10
TRADE_BAND = 0.02
HALVE_AT = -0.08
TO_SHY_AT = -0.12
MAX_SWITCHES = 3
RISK_WINDOW = YEAR

# Warren's screen (§4.4.1)
MIN_ROIC = 0.15
MAX_NET_DEBT_EBITDA = 2.0
MIN_PIOTROSKI = 7


class Quant:
    def __init__(self, as_of: str | None = None):
        rules = store.read_regimes("rules", until=as_of)
        if not rules:
            raise RuntimeError("No regimes computed. Run uv run -m backend.quant first.")
        self.as_of = rules[-1]["day"]
        self.rows = {"rules": rules, "hmm": store.read_regimes("hmm", until=self.as_of)}
        self._panel: bars.Panel | None = None

    @property
    def panel(self) -> bars.Panel:
        if self._panel is None:
            self._panel = bars.panel(self.as_of)
        return self._panel

    def _since(self, model: str) -> dict | None:
        rows = self.rows[model]
        if not rows:
            return None
        n = 0
        for r in reversed(rows):
            if r["label"] != rows[-1]["label"]:
                break
            n += 1
        return {"label": rows[-1]["label"], "risk": RISK[rows[-1]["label"]], "since": rows[-n]["day"], "trading_days": n}

    # --- tools ---------------------------------------------------------------

    def regime_now(self) -> dict:
        rules, hmm = self.rows["rules"], self.rows["hmm"]
        month = self.as_of[:7]
        switches = sum(1 for a, b in zip(rules, rules[1:]) if b["day"][:7] == month and a["label"] != b["label"])
        f = rules[-1]["features"]
        return {
            "as_of_close": self.as_of,
            "rules": self._since("rules"),
            "hmm": {**self._since("hmm"), "probability": hmm[-1]["prob"], "probabilities": hmm[-1]["probs"]} if hmm else None,
            "models_agree": bool(hmm) and hmm[-1]["label"] == rules[-1]["label"],
            "regime_switches_this_month": switches,
            "switch_budget_per_month": MAX_SWITCHES,
            "features": {k: {"label": FEATURES[k][0], "value": f.get(k)} for k in FEATURES},
        }

    def regime_history(self, start: str, end: str | None = None, model: str = "rules") -> dict:
        if model not in self.rows or not self.rows[model]:
            return {"error": f"model must be one of: {', '.join(m for m in self.rows if self.rows[m])}"}
        end = min(end or self.as_of, self.as_of)
        eps = episodes(self.panel, self.rows[model], start, end)[-MAX_ROWS:]
        return {
            "as_of_close": self.as_of,
            "model": model,
            "episodes": [{
                "regime": e["label"], "start": e["start"], "end": None if e["open"] else e["end"], "trading_days": e["days"],
                "spy_return": round(e["spy_return"], 4), "max_drawdown": round(e["max_drawdown"], 4),
                "volatility": None if e["vol"] is None else round(e["vol"], 4),
                "led": [f"{x['symbol']} {x['return']:+.1%}" for x in e["leaders"]],
                "lagged": [f"{x['symbol']} {x['return']:+.1%}" for x in e["laggards"]],
            } for e in eps],
        }

    def _scores(self, model: str) -> list[dict]:
        day, cells = store.read_scores(model, self.as_of)
        if day == self.as_of:
            return cells
        return signals.scoreboard(self.panel, self.rows[model], self.as_of)

    def signal_scoreboard(self, regime: str | None = None, model: str = "rules") -> dict:
        regime = regime or self.rows[model][-1]["label"]
        if regime not in LABELS + ["All"]:
            return {"error": f"regime must be one of: {', '.join(LABELS + ['All'])}"}
        cells = [c for c in self._scores(model) if c["regime"] == regime]
        r2 = lambda v: None if v is None else round(v, 2)  # noqa: E731
        rows = []
        for s in signals.SIGNALS:
            by = {c["window"]: c for c in cells if c["signal"] == s.id}
            rows.append({
                "signal": s.id, "rule": s.rule,
                "sharpe_this_year": r2(by["ytd"]["sharpe"]), "days_this_year": by["ytd"]["n_days"],
                "sharpe_prior_10y": r2(by["10y"]["sharpe"]), "days_prior_10y": by["10y"]["n_days"],
                "sharpe_blend": r2(by["blend"]["sharpe"]),
                "blend_95ci": [r2(by["blend"]["ci_lo"]), r2(by["blend"]["ci_hi"])],
                "hit_rate_blend": r2(by["blend"]["hit_rate"]),
            })
        rows.sort(key=lambda r: -(r["sharpe_blend"] if r["sharpe_blend"] is not None else -99))
        return {"as_of_close": self.as_of, "model": model, "regime": regime,
                "note": "Annualized Sharpe on days this regime was in force; blend weights this year n/(n+63) against the prior ten.",
                "signals": rows}

    def signal_scan(self, signal: str) -> dict:
        if signal not in signals.BY_ID:
            return {"error": f"signal must be one of: {', '.join(signals.BY_ID)}"}
        return {"as_of_close": self.as_of, "signal": signal, "rule": signals.BY_ID[signal].rule,
                "holds": [{**r, "weight": round(r["weight"], 3), "trigger": None if r["trigger"] is None else round(r["trigger"], 4)}
                          for r in signals.scan(self.panel, signal, self.as_of)]}

    def _returns(self, symbols: list[str]) -> tuple[np.ndarray, list[str]]:
        p = self.panel
        known = [s for s in symbols if s in p.symbols]
        return log_returns(p.cols(known)), known

    def portfolio_risk(self, weights: dict[str, float]) -> dict:
        weights = {s.upper(): float(w) for s, w in weights.items() if w}
        r, known = self._returns(list(dict.fromkeys([*weights, BENCHMARK])))
        missing = [s for s in weights if s not in known]
        syms = [s for s in known if s in weights]
        if not syms:
            return {"as_of_close": self.as_of, "error": "No price history for any of these symbols", "no_data": missing}
        w = np.array([weights[s] for s in syms])
        R = np.nan_to_num(r[:, [known.index(s) for s in syms]])
        spy = np.nan_to_num(r[:, known.index(BENCHMARK)])
        port = R @ w
        recent, recent_spy, recent_R = port[-RISK_WINDOW:], spy[-RISK_WINDOW:], R[-RISK_WINDOW:]
        cov = np.cov(recent_R, rowvar=False).reshape(len(syms), len(syms))
        vol = float(np.sqrt(w @ cov @ w * YEAR))
        contrib = (w * (cov @ w)) / max(float(w @ cov @ w), 1e-12)
        tail = np.sort(recent)[: max(1, int(len(recent) * 0.05))]
        growth = np.exp(np.cumsum(port[~np.isnan(port)]))
        corr = np.corrcoef(recent_R, rowvar=False) if len(syms) > 1 else np.array([[1.0]])
        return {
            "as_of_close": self.as_of,
            "window": f"last {RISK_WINDOW} trading days; worst drawdown over all history since {self.panel.days[0]}",
            "volatility_annual": round(vol, 4),
            "beta_to_spy": round(float(np.cov(recent, recent_spy)[0, 1] / np.var(recent_spy, ddof=1)), 3),
            "average_correlation": round(float((corr.sum() - len(syms)) / (len(syms) * (len(syms) - 1))), 3) if len(syms) > 1 else None,
            "cvar_95_one_day": round(float(np.mean(tail)), 4),
            "worst_drawdown": round(float(np.min(growth / np.maximum.accumulate(growth) - 1)), 4),
            "cash_weight": round(1 - float(w.sum()), 4),
            "risk_share": [{"symbol": s, "weight": round(float(w[i]), 4), "risk_share": round(float(contrib[i]), 3)}
                           for i, s in enumerate(syms)],
            "no_data": missing,
        }

    def size_positions(self, target_weights: dict[str, float], target_vol: float, holdings: dict[str, int],
                       cash: float, peak_equity: float | None = None, other_prices: dict[str, float] | None = None) -> dict:
        """Quantities for target weights after the limits: per-ETF and per-stock caps, a
        volatility target, and the drawdown brake. Trade only what is more than 2% of
        equity away from target. Prices are the as-of closes; other_prices fills in
        holdings the pipeline does not load (their last fill, say)."""
        targets = {s.upper(): max(0.0, float(w)) for s, w in target_weights.items()}
        closes = {s: c for s in set(targets) | set(holdings) if (c := self.close_of(s)) is not None}
        price = {**(other_prices or {}), **closes}
        unpriced = [s for s in set(targets) | set(holdings) if s not in price]
        equity = cash + sum(price.get(s, 0) * q for s, q in holdings.items())
        capped = {}
        for s, w in targets.items():
            cap = STOCK_CAP if s in LARGE_CAPS or s not in SYMBOLS else ETF_CAP
            capped[s] = (min(w, cap), "stock cap 10%" if w > cap and cap == STOCK_CAP else "ETF cap 25%" if w > cap else None)
        total = sum(w for w, _ in capped.values())
        if total > 1:
            capped = {s: (w / total, why or "scaled to 100%") for s, (w, why) in capped.items()}
        risk = self.portfolio_risk({s: w for s, (w, _) in capped.items() if s in price}) if capped else {}
        vol = risk.get("volatility_annual") or 0.0
        scale = min(1.0, target_vol / vol) if vol > 0 else 1.0
        drawdown = equity / peak_equity - 1 if peak_equity else 0.0
        brake = "to_shy" if drawdown <= TO_SHY_AT else "halved" if drawdown <= HALVE_AT else "none"
        if brake == "halved":
            scale *= 0.5
        if brake == "to_shy":
            capped, scale = {"SHY": (0.5, "drawdown brake: −12% from peak")}, 1.0
            if "SHY" not in price and (shy := self.close_of("SHY")) is not None:
                price["SHY"] = shy
        rows = []
        for s in sorted(set(capped) | set(holdings)):
            w, why = capped.get(s, (0.0, None))
            final = w * scale
            p = price.get(s)
            now_q = holdings.get(s, 0)
            if not p:
                rows.append({"symbol": s, "error": "no stored close; cannot size"})
                continue
            target_q = math.floor(final * equity / p)
            gap = abs(target_q - now_q) * p / equity if equity else 0
            rows.append({"symbol": s, "target_weight": round(targets.get(s, 0.0), 4), "final_weight": round(final, 4),
                         "limited_by": why, "price": round(p, 2), "shares_now": now_q, "shares_target": target_q,
                         "delta": target_q - now_q, "trade": gap > TRADE_BAND})
        return {"as_of_close": self.as_of, "equity": round(equity, 2), "target_vol": target_vol,
                "portfolio_vol_before_scaling": vol, "scale": round(scale, 4),
                "drawdown_from_peak": round(drawdown, 4), "brake": brake, "rows": rows[:MAX_ROWS], "no_data": unpriced}

    # --- playbook tools: Warren's screen and valuation, George's dashboard ----------

    def close_of(self, symbol: str) -> float | None:
        p = self.panel
        if symbol not in p.symbols:
            return None
        c = p.col(symbol)
        ok = c[~np.isnan(c)]
        return float(ok[-1]) if len(ok) else None

    def quality_screen(self, symbols: list[str] | None = None) -> dict:
        """Warren's five tests on each candidate. A test whose inputs a company does not
        report is "unknown", and a candidate passes only on five known passes."""
        names = [s.upper() for s in symbols] if symbols else QUALITY
        rows = []
        # The earnings-yield third is ranked against the whole standing universe, whatever was asked for.
        for sym in dict.fromkeys(names + QUALITY):
            try:
                rows.append(fundamentals.screen(sym, self.close_of(sym), self.as_of))
            except Exception as e:
                rows.append({"symbol": sym, "error": f"{type(e).__name__}: {e}"})
        yields = sorted(r["earnings_yield"] for r in rows if r.get("earnings_yield") is not None)
        top_third = yields[int(len(yields) * 2 / 3)] if len(yields) >= 3 else None
        out = []
        for r in rows:
            if r["symbol"] not in names:
                continue
            if "error" in r:
                out.append({"symbol": r["symbol"], "passes": False, "error": r["error"]})
                continue
            ey = r["earnings_yield"]
            tests = {
                "roic_5y_above_15pct": None if r["roic_5y_avg"] is None else r["roic_5y_avg"] > MIN_ROIC,
                "fcf_positive_5y": r["fcf_all_positive"],
                "net_debt_ebitda_below_2": None if r["net_debt_to_ebitda"] is None else r["net_debt_to_ebitda"] < MAX_NET_DEBT_EBITDA,
                "piotroski_7_plus": None if r["piotroski"] is None else r["piotroski"] >= MIN_PIOTROSKI,
                "earnings_yield_top_third": None if ey is None or top_third is None else ey >= top_third,
            }
            out.append({
                "symbol": r["symbol"], "passes": all(v is True for v in tests.values()),
                "failed": [k for k, v in tests.items() if v is False], "unknown": [k for k, v in tests.items() if v is None],
                "roic_5y": r["roic_5y_avg"], "net_debt_ebitda": r["net_debt_to_ebitda"], "piotroski": r["piotroski"],
                "earnings_yield": ey, "fiscal_year_end": r["fiscal_year_end"],
            })
        out.sort(key=lambda r: (not r["passes"], len(r.get("failed", [])) + len(r.get("unknown", [])) if "error" not in r else 99,
                                -(r.get("earnings_yield") or 0)))
        return {"as_of_close": self.as_of, "source": "SEC EDGAR 10-K figures filed by the as-of day",
                "earnings_yield_top_third_from": top_third, "passed": sum(r["passes"] for r in out),
                "screened": len(out), "candidates": out[:MAX_ROWS]}

    def owner_earnings_dcf(self, symbol: str) -> dict:
        symbol = symbol.upper()
        price = self.close_of(symbol)
        return {"as_of_close": self.as_of, **fundamentals.owner_earnings_dcf(symbol, price, self.as_of),
                **({} if price is not None else {"note": "no stored close for this symbol; price and margin of safety unknown"})}

    def macro_dashboard(self) -> dict:
        """George's growth × inflation quadrant from market proxies, and trend and stretch
        for each ETF in his universe."""
        f = self.rows["rules"][-1]["features"]
        growth = (f.get("copper_gold") or 0) + (f.get("credit") or 0)
        inflation = f.get("breakevens") or 0
        quadrant = {(True, False): "Goldilocks", (True, True): "Reflation", (False, True): "Stagflation",
                    (False, False): "Deflation"}[(growth > 0, inflation > 0)]
        p = self.panel
        syms = [s for s in MACRO_UNIVERSE if s in p.symbols]
        c, h, lo = p.cols(syms), p.cols(syms, "high"), p.cols(syms, "low")
        prev = np.vstack([np.full((1, c.shape[1]), np.nan), c[:-1]])
        tr = np.fmax(h - lo, np.fmax(np.abs(h - prev), np.abs(lo - prev)))
        atr = rolling(tr, 14, np.mean)[-1]
        avg100 = sma(c, 100)[-1]
        rsi14 = rsi(c, 14)[-1]
        r = log_returns(c)
        vol20 = rolling(r, 20, lambda w, axis: np.std(w, axis=axis, ddof=1))[-1]
        vol_med = np.nanmedian(rolling(r, 20, lambda w, axis: np.std(w, axis=axis, ddof=1))[-YEAR:], axis=0)
        mom = c[-22] / c[-YEAR] - 1 if len(c) > YEAR else np.full(len(syms), np.nan)
        rnd = lambda v, n=4: None if v is None or np.isnan(v) else round(float(v), n)  # noqa: E731
        rows = []
        for j, s in enumerate(syms):
            rows.append({
                "symbol": s, "close": rnd(c[-1, j], 2), "momentum_12_1": rnd(mom[j]),
                "above_100d": bool(c[-1, j] > avg100[j]) if not np.isnan(avg100[j]) else None,
                "trend_confirmed": bool(mom[j] > 0 and c[-1, j] > avg100[j]) if not np.isnan(mom[j]) and not np.isnan(avg100[j]) else None,
                "rsi14": rnd(rsi14[j], 1), "atr14": rnd(atr[j], 2), "atr_pct": rnd(atr[j] / c[-1, j]),
                "vol_spike": bool(vol20[j] > 1.5 * vol_med[j]) if not np.isnan(vol_med[j]) else None,
            })
        return {
            "as_of_close": self.as_of,
            "quadrant": quadrant,
            "growth_proxy": {"copper_vs_gold_60d": f.get("copper_gold"), "credit_hyg_vs_ief_60d": f.get("credit"), "sum": round(growth, 4)},
            "inflation_proxy": {"tip_vs_ief_60d": f.get("breakevens")},
            "dollar_uup_60d": f.get("dollar"), "curve_shy_vs_ief_60d": f.get("curve"),
            "rules": "Trend confirmed = 12-1 month momentum > 0 and close above the 100-day average. Contrarian entry only "
                     "when RSI(14) < 25 with a volatility spike and a named catalyst. Risk 1% of equity per idea at a 2-ATR stop.",
            "etfs": rows,
        }
