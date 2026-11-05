"""Summaries over finished trials (plan §5.4): a mean with a 95% bootstrap interval per
arm, and paired effects. An effect compares two values of one dimension inside cells
that match on everything else (same scenario, same other options), so a difference
comes from that dimension alone. The bootstrap resamples cells, seeded, so the
numbers repeat.
"""

import random
from statistics import mean

RESAMPLES = 2000
METRICS = ["score", "edge", "return", "tokens", "seconds", "research_calls", "violations", "recovered", "loops"]
RATES = {"violated": lambda g: g["violations"] > 0, "completed": lambda g: g["completed"],
         "cited": lambda g: g["evidence_cited"]}


def interval(values: list[float]) -> dict:
    if not values:
        return {"mean": None, "lo": None, "hi": None, "n": 0}
    m = mean(values)
    if len(values) < 2:
        return {"mean": m, "lo": None, "hi": None, "n": 1}
    rng = random.Random(0)
    boots = sorted(mean(rng.choices(values, k=len(values))) for _ in range(RESAMPLES))
    return {"mean": m, "lo": boots[int(0.025 * RESAMPLES)], "hi": boots[int(0.975 * RESAMPLES) - 1], "n": len(values)}


def _done(trials: list[dict]) -> list[dict]:
    return [t for t in trials if t["status"] == "done" and t.get("grades")]


def by_arm(trials: list[dict]) -> list[dict]:
    arms: dict[str, list[dict]] = {}
    for t in _done(trials):
        arms.setdefault(t["arm_id"], []).append(t)
    out = []
    for aid, ts in arms.items():
        gs = [t["grades"] for t in ts]
        out.append({
            "arm_id": aid,
            "arm": ts[0]["arm"],
            "n": len(ts),
            **{m: interval([float(g[m]) for g in gs]) for m in METRICS},
            **{r: sum(1 for g in gs if f(g)) / len(gs) for r, f in RATES.items()},
            "grades": {k: sum(1 for g in gs if g["grade"] == k) for k in ("pass", "partial", "fail")},
        })
    return out


def effects(trials: list[dict], chosen: dict[str, list[str]]) -> list[dict]:
    """For each dimension with two or more values: each value against the first."""
    done = _done(trials)
    out = []
    for dim, values in chosen.items():
        if len(values) < 2:
            continue
        ref = values[0]
        cells: dict[tuple, dict[str, list[dict]]] = {}
        for t in done:
            key = (t["scenario_id"], *sorted((k, v) for k, v in t["arm"].items() if k != dim))
            cells.setdefault(key, {}).setdefault(t["arm"][dim], []).append(t["grades"])
        for v in values[1:]:
            pairs = [(c[ref], c[v]) for c in cells.values() if c.get(ref) and c.get(v)]
            row = {"dimension": dim, "value": v, "reference": ref, "cells": len(pairs)}
            for m in ("score", "edge", "seconds", "tokens", "violations"):
                row[m] = interval([mean(g[m] for g in b) - mean(g[m] for g in a) for a, b in pairs])
            ref_tokens = sum(mean(g["tokens"] for g in a) for a, _ in pairs)
            row["token_ratio"] = (sum(mean(g["tokens"] for g in b) for _, b in pairs) / ref_tokens) if ref_tokens else None
            out.append(row)
    return out


def by_scenario(trials: list[dict]) -> dict[str, dict[str, dict]]:
    """Per scenario and arm: the mean score and edge, and each trial's action."""
    out: dict[str, dict[str, dict]] = {}
    for t in _done(trials):
        cell = out.setdefault(t["scenario_id"], {}).setdefault(t["arm_id"], {"trials": []})
        cell["trials"].append({"id": t["id"], "trial": t["trial"], **{k: t["grades"][k] for k in
                               ("grade", "score", "action", "edge", "return", "violations", "tokens", "seconds", "error_kind")}})
    for arms in out.values():
        for cell in arms.values():
            cell["score"] = mean(x["score"] for x in cell["trials"])
            cell["edge"] = mean(x["edge"] for x in cell["trials"])
    return out
