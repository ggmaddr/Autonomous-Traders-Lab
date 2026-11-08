"""The daily Market Year run: bars, features, both regime models, the scoreboard as of
the last close, and the news behind new transitions. Safe to rerun; each step replaces
what it computed before.
"""

import asyncio

from . import bars, events, features, fundamentals, regimes, signals, store, year_graph
from .universe import QUALITY

MODELS = ("rules", "hmm")


def compute(as_of: str | None = None) -> dict:
    """Everything but the news, from the bars already loaded."""
    p = bars.panel(as_of)
    as_of = p.days[-1]
    f = features.compute(p)
    rows = {"rules": regimes.rules(p, f)}
    store.write_regimes("rules", regimes.RULES_VERSION, rows["rules"])
    hmm_rows, hmm_version = regimes.hmm(p, f, f"{as_of[:4]}-01-01")
    if hmm_rows:
        store.write_regimes("hmm", hmm_version, hmm_rows)
        rows["hmm"] = hmm_rows
    for model, r in rows.items():
        store.write_scores(as_of, model, signals.scoreboard(p, r, as_of))
    return {"as_of": as_of, "panel": p, "rows": rows}


def spy_detail(p: bars.Panel):
    spy = p.col("SPY")

    def detail(day: str) -> str:
        t = p.index(day)
        a = max(t - regimes.DWELL - 3, 0)
        return f"{p.days[a]} close ${spy[a]:,.2f} → {p.days[t]} close ${spy[t]:,.2f} ({spy[t] / spy[a] - 1:+.1%})"
    return detail


async def run(news: bool = True) -> dict:
    loaded = bars.backfill()
    print(f"Bars: {loaded['n']:,} for {loaded['symbols']} symbols, {loaded['first']} to {loaded['last']}")
    out = compute()
    print(f"Regimes and scoreboard as of {out['as_of']}")
    print(f"Fundamentals for {fundamentals.refresh(QUALITY)} of {len(QUALITY)} screen candidates")
    explained = 0
    if news:
        explained = await events.explain_all(out["rows"], f"{out['as_of'][:4]}-01-01", spy_detail(out["panel"]))
        print(f"Explained {explained} transitions")
    episodes = year_graph.write(out["panel"], out["rows"]["rules"], out["as_of"])
    print(f"Robin's memory: {episodes} regime episodes this year")
    return {"as_of": out["as_of"], "bars": loaded, "explained": explained}


if __name__ == "__main__":
    asyncio.run(run())
