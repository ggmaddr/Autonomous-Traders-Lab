"""The Experiment Lab's endpoints. Everything is a read except two small writes that
only touch the lab's own tables: queueing an experiment and cancelling one. The
worker (uv run -m server.lab) does the running; nothing here calls a model.
"""

import secrets
from datetime import datetime, timezone
from statistics import median

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import runs
from . import store
from .arms import DIMENSION_IDS, JIM_AGENTS, arm_id, combinations, dimensions, validate
from .runner import manifest, plan_trials
from .scenarios import load_all
from .stats import by_arm, by_scenario, effects

router = APIRouter()
WORKER_STALE_S = 30
DEFAULT_TRIAL_S = 150  # a guess until the first trials finish
MAX_TRIALS = 400


def worker_state() -> dict:
    w = store.worker()
    if not w:
        return {"alive": False, "seen_at": None, "busy": None}
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(w["seen_at"])).total_seconds()
    return {"alive": age < WORKER_STALE_S, "seen_at": w["seen_at"], "busy": w["busy"]}


def trial_estimate() -> dict:
    secs = store.trial_seconds()
    return {"seconds": median(secs) if secs else DEFAULT_TRIAL_S, "measured": len(secs)}


@router.get("/api/lab/catalog")
def catalog() -> dict:
    """What can be run: the scenarios with their baselines, the dimensions and their
    values, the worker's state and how long a trial takes."""
    return {
        "scenarios": [s.public() for s in load_all().values()],
        "dimensions": dimensions(),
        "worker": worker_state(),
        "estimate": trial_estimate(),
    }


class ExperimentSpec(BaseModel):
    name: str = Field(default="", max_length=80)
    scenarios: list[str]
    arms: dict[str, list[str]]
    trials: int = Field(ge=1, le=10)


@router.post("/api/experiments")
def create(spec: ExperimentSpec) -> dict:
    scenarios = load_all()
    unknown = [s for s in spec.scenarios if s not in scenarios]
    if not spec.scenarios or unknown:
        raise HTTPException(400, f"Unknown or no scenarios: {', '.join(unknown)}")
    problem = validate(spec.arms)
    if problem:
        raise HTTPException(400, problem)
    arms = {d: spec.arms.get(d) or ["trader"] for d in DIMENSION_IDS}
    synthetic = [sid for sid in spec.scenarios if scenarios[sid].family != "regime"]
    if set(arms["agent"]) & JIM_AGENTS and synthetic:
        raise HTTPException(400, f"Jim trades on real bars; pick only regime scenarios, not {', '.join(synthetic)}")
    body = {"scenarios": spec.scenarios, "arms": arms, "trials": spec.trials}
    planned = plan_trials(body)
    if len(planned) > MAX_TRIALS:
        raise HTTPException(400, f"{len(planned)} trials is more than {MAX_TRIALS}; choose fewer options")
    exp_id = f"exp_{datetime.now(timezone.utc):%Y%m%dT%H%M%S}_{secrets.token_hex(2)}"
    name = spec.name.strip() or f"{len(combinations(body['arms']))} arms × {len(spec.scenarios)} scenarios"
    store.create_experiment(exp_id, name, body, manifest(body), planned)
    return {"id": exp_id, "trials": len(planned)}


@router.post("/api/experiments/{exp_id}/cancel")
def cancel(exp_id: str) -> dict:
    if not store.experiment(exp_id):
        raise HTTPException(404, f"No experiment {exp_id}")
    store.cancel(exp_id)
    return {"id": exp_id, "status": "cancelled"}


@router.get("/api/experiments")
def list_experiments() -> list[dict]:
    return [{k: e[k] for k in ("id", "name", "spec", "status", "created_at", "started_at", "ended_at", "progress")}
            for e in store.experiments()]


@router.get("/api/experiments/{exp_id}")
def get_experiment(exp_id: str) -> dict:
    """One experiment: its spec and manifest, every trial cell (for the progress grid),
    and the summaries: per arm, per scenario, and the paired effects."""
    exp = store.experiment(exp_id)
    if not exp:
        raise HTTPException(404, f"No experiment {exp_id}")
    trials = store.trials(exp_id)
    cells = [
        {"id": t["id"], "seq": t["seq"], "scenario_id": t["scenario_id"], "arm_id": t["arm_id"], "trial": t["trial"],
         "status": t["status"], "started_at": t["started_at"], "ended_at": t["ended_at"],
         "grade": (t["grades"] or {}).get("grade"), "action": (t["grades"] or {}).get("action"),
         "error_kind": (t["grades"] or {}).get("error_kind")}
        for t in trials
    ]
    return {
        **exp,
        "arms": [{"arm_id": arm_id(a), "arm": a} for a in combinations(exp["spec"]["arms"])],
        "cells": cells,
        "summary": by_arm(trials),
        "scenarios": by_scenario(trials),
        "effects": effects(trials, exp["spec"]["arms"]),
        "worker": worker_state(),
        "estimate": trial_estimate(),
    }


@router.get("/api/lab/trials/{trial_id}")
def get_trial(trial_id: int) -> dict:
    """One trial: what it did in the sandbox, its grades, and the run read back from
    its spans (research, tool calls, timeline)."""
    t = store.trial(trial_id)
    if not t:
        raise HTTPException(404, f"No trial {trial_id}")
    detail = runs.run_detail(t["trace_id"]) if t["trace_id"] else None
    return {**t, "run": detail}
