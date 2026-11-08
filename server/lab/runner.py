"""Runs one trial: one arm on one scenario in a fresh sandbox, as an ordinary SDK trace
grouped under its experiment. Then it grades the trial from the sandbox ledger and
the saved spans.
"""

import asyncio
import json
import subprocess
from datetime import datetime
from pathlib import Path

from agents import Agent, ModelSettings, OpenAIChatCompletionsModel, Runner, trace

from local_llm import ollama_client
from ..database import read_spans
from ..tracers import make_trace_id
from . import prompts, store
from ..jim import synthesizer_tool
from .arms import JIM_AGENTS, JIM_STRATEGY, STRATEGIES, arm_id, combinations, model_digests
from .env import Environment
from .grading import grade_trial
from .scenarios import Scenario, load_all, scenario_hash

MAX_TURNS = 20
TEMPERATURE = 0.7  # pinned, so repeated trials differ only by sampling
TRIAL_TIMEOUT_S = 15 * 60
TRACE_TAG = "lab"


def manifest(spec: dict) -> dict:
    """Everything that could change a result (plan §6.5)."""
    scenarios = load_all()
    def git(*args: str) -> str:
        try:
            return subprocess.run(["git", *args], capture_output=True, text=True, timeout=5,
                                  cwd=Path(__file__).resolve().parents[2]).stdout.strip()
        except Exception:
            return ""
    digests = model_digests()
    return {
        "scenarios": {sid: f"v{scenarios[sid].version}@{scenario_hash(scenarios[sid])}" for sid in spec["scenarios"]},
        "models": {m: digests.get(m, "") for m in spec["arms"]["model"]},
        "prompts": {p: prompts.prompt_hash(p) for p in spec["arms"]["prompt"]},
        "temperature": TEMPERATURE,
        "max_turns": MAX_TURNS,
        "git_commit": git("rev-parse", "--short", "HEAD"),
        "git_dirty": bool(git("status", "--porcelain")),
    }


def plan_trials(spec: dict) -> list[dict]:
    """Trial order interleaves arms and scenarios, round by round, so a half-finished
    experiment already compares every arm on the same footing."""
    arms = combinations(spec["arms"])
    return [
        {"scenario_id": sid, "arm": arm, "arm_id": arm_id(arm), "trial": k}
        for k in range(spec["trials"])
        for sid in spec["scenarios"]
        for arm in arms
    ]


def _model(name: str) -> OpenAIChatCompletionsModel:
    return OpenAIChatCompletionsModel(model=name, openai_client=ollama_client)


async def run_trial(s: Scenario, arm: dict, experiment_id: str, trial_no: int) -> dict:
    env = Environment(s)
    model = _model(arm["model"])
    settings = ModelSettings(temperature=TEMPERATURE)
    agent = arm.get("agent", "trader")
    name, _, strategy = ("Jim", "", JIM_STRATEGY) if agent in JIM_AGENTS else STRATEGIES[arm["strategy"]]
    researcher = Agent(name="Researcher", instructions=prompts.RESEARCHER, model=model,
                       model_settings=settings, tools=env.research_tools())
    tools = env.trade_tools()
    if s.family == "regime":
        tools += env.quant_tools()  # real bars: the Quant answers as of the scenario's close
    if arm["researcher"] == "on_demand":
        tools.append(researcher.as_tool(tool_name="Researcher", tool_description=prompts.RESEARCH_TOOL))
    if agent == "jim":
        tools.append(synthesizer_tool(model))
    trace_id = make_trace_id(TRACE_TAG)
    metadata = {"experiment_id": experiment_id, "scenario": s.id, "trial": str(trial_no),
                **{k: str(v) for k, v in arm.items()}}
    output, error = None, None
    with trace(f"lab-{s.id}", trace_id=trace_id, group_id=experiment_id, metadata=metadata):
        try:
            research = None
            if arm["researcher"] == "forced":
                report = await Runner.run(researcher, prompts.FORCED_REQUEST.format(symbols=", ".join(s.symbols)),
                                          max_turns=MAX_TURNS)
                research = str(report.final_output)
            elif arm["researcher"] == "digest":
                research = env.digest()
            account = json.dumps(env.account())
            if agent in JIM_AGENTS:
                instructions, message = prompts.jim(strategy, account, s.as_of, research, synthesizer=agent == "jim",
                                                    has_researcher=arm["researcher"] == "on_demand")
            elif arm["prompt"] == "original":
                instructions, message = prompts.original(name, strategy, account, s.as_of, s.task, research)
            else:
                instructions, message = prompts.fixed(name, strategy, account, s.as_of, s.task, research,
                                                      has_researcher=arm["researcher"] == "on_demand")
            trader = Agent(name=name, instructions=instructions, model=model, model_settings=settings, tools=tools)
            result = await Runner.run(trader, message, max_turns=MAX_TURNS)
            output = str(result.final_output)
        except Exception as e:
            error = f"{type(e).__name__}: {e}"
    return {"trace_id": trace_id, "output": output, "error": error, **env.result()}


async def run_next() -> bool:
    """Run the next queued trial, if any. False when the queue is empty."""
    t = store.next_trial()
    if not t:
        return False
    exp = store.experiment(t["experiment_id"])
    if exp["status"] == "queued":
        store.set_experiment(exp["id"], status="running", started_at=store.now())
    scenarios = load_all()
    s = scenarios.get(t["scenario_id"])
    started = store.now()
    store.set_trial(t["id"], status="running", started_at=started)
    if not s:
        store.set_trial(t["id"], status="error", ended_at=store.now(), error=f"Scenario {t['scenario_id']} is gone")
        return True
    try:
        out = await asyncio.wait_for(run_trial(s, t["arm"], exp["id"], t["trial"]), TRIAL_TIMEOUT_S)
    except asyncio.TimeoutError:
        out = {"trace_id": None, "output": None, "error": f"TimeoutError: over {TRIAL_TIMEOUT_S} s",
               "orders": [], "lookups": [], "cash": s.cash, "positions": s.positions}
    ended = store.now()
    seconds = (datetime.fromisoformat(ended) - datetime.fromisoformat(started)).total_seconds()
    spans = read_spans([out["trace_id"]]) if out["trace_id"] else []
    grades = grade_trial(s, out, spans, out["output"], out["error"], seconds, t["arm"])
    store.set_trial(t["id"], status="done", trace_id=out["trace_id"], ended_at=ended, error=out["error"],
                    result={k: out[k] for k in ("orders", "lookups", "cash", "positions", "output")}, grades=grades)
    current = store.experiment(exp["id"])
    if current and current["status"] == "running":
        store.finish_if_done(exp["id"])
    return True
