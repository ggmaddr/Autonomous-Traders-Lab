"""Jim's memory graph from the Market Year (plan §4.4.3, step 6): the year as a chain of
regimes. Episodes of the rules model linked in order, the sectors that led them, the
news that turned them, and which signals worked or failed in each.

Only what is settled is written: a closed episode's figures once, an open one's start
only, and at most one scoreboard observation per signal, regime and week, so a daily
run does not bloat the graph.
"""

from datetime import date, timedelta

import numpy as np

from .. import memory
from . import signals, store
from .bars import Panel
from .regimes import episodes
from .universe import SECTOR_NAMES

TRADER = "Jim"


def episode_name(e: dict) -> str:
    return f"Regime {e['start']} {e['label']}"


def write(p: Panel, rules_rows: list[dict], as_of: str) -> int:
    start = f"{as_of[:4]}-01-01"
    eps = episodes(p, rules_rows, start)
    events = {e["day"]: e for e in store.read_events("rules", start)}
    returns = {s.id: signals.daily_returns(p, s)[0] for s in signals.SIGNALS}
    ents, obs, rels = [], [], []
    for k, e in enumerate(eps):
        name = episode_name(e)
        ents.append((name, "Regime episode"))
        obs.append((name, f"Began {e['start']} as {e['label']} ({e['risk']})."))
        if not e["open"]:
            obs.append((name, (f"Ended {e['end']} after {e['days']} trading days: SPY {e['spy_return']:+.1%}, max drawdown "
                               f"{e['max_drawdown']:+.1%}, volatility {e['vol'] or 0:.1%}. Led by "
                               f"{', '.join(x['symbol'] for x in e['leaders'])}; lagged {', '.join(x['symbol'] for x in e['laggards'])}.")))
            # A signal worked in an episode when its decisions inside it made money.
            a, b = p.index(e["start"]), p.index(e["end"])
            for s in signals.SIGNALS:
                r = returns[s.id][a:b]
                total = float(np.nansum(r))
                sig = f"Signal {s.label}"
                ents.append((sig, "Signal"))
                rels.append((sig, name, "signal_worked_in" if total > 0 else "signal_failed_in"))
        if k:
            rels.append((episode_name(eps[k - 1]), name, "followed_by"))
        for x in e["leaders"][:2]:
            sector = f"{x['symbol']} {SECTOR_NAMES[x['symbol']]}"
            ents.append((sector, "Sector"))
            rels.append((name, sector, "led_by"))
        ev = events.get(e["start"])
        if ev and k:
            ev_name = f"Event {ev['day']}: {ev['headline']}"
            ents.append((ev_name, "Event"))
            obs.append((ev_name, ev["summary"]))
            obs += [(ev_name, f"Source: {s['url']}") for s in ev["sources"][:3]]
            rels.append((name, ev_name, "triggered_by"))

    # Scoreboard: one observation per signal, regime and week.
    monday = (date.fromisoformat(as_of) - timedelta(days=date.fromisoformat(as_of).weekday())).isoformat()
    regime = rules_rows[-1]["label"]
    _, cells = store.read_scores("rules", as_of)
    for s in signals.SIGNALS:
        c = next((c for c in cells if c["signal"] == s.id and c["regime"] == regime and c["window"] == "blend"), None)
        sig = f"Signal {s.label}"
        prefix = f"Week of {monday}, {regime}:"
        if c and c["sharpe"] is not None and not memory.has_observation(TRADER, sig, prefix):
            ents.append((sig, "Signal"))
            obs.append((sig, f"{prefix} blended Sharpe {c['sharpe']:+.2f} over {c['n_days']} days (95% CI {c['ci_lo']:+.2f} to {c['ci_hi']:+.2f})."))
    memory.write_graph(TRADER, list(dict.fromkeys(ents)), obs, list(dict.fromkeys(rels)))
    return len(eps)
