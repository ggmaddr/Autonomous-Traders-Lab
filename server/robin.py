"""Robin, the regime quant (plan §4.4.3): a trader built differently from the other four.
Robin does not predict prices. The Quant measures the regime and which signals have paid in
it; the Researcher is asked only what the numbers cannot say; the Synthesizer weighs the
two and returns a structured TradeThesis; size_positions turns it into quantities under
limits Robin cannot override.

Each cycle is gated deterministically: a full thesis run on the first run, on a regime
change (at most three a month), or once a week; every other cycle only checks the
drawdown brake and stops.
"""

from datetime import datetime, timedelta, timezone
from typing import Literal

from agents import Agent, RunResult, Tool
from pydantic import BaseModel, Field

from . import memory
from .database import read_runs
from .quant import store

NAME = "Robin"
MAX_REGIME_SWITCHES = 3
REBALANCE_DAYS = 7


class Claim(BaseModel):
    text: str = Field(description="One factual claim")
    source: str = Field(description='Where it comes from: a Quant tool name such as "regime_now" or '
                                    '"signal_scoreboard", "research:<url>" for a page in the research, or "lesson:<id>"')


class SignalView(BaseModel):
    signal: str
    stance: Literal["for", "against"]
    evidence: Claim


class Conflict(BaseModel):
    story: Claim = Field(description="What the research says")
    numbers: Claim = Field(description="What the Quant says")
    winner: Literal["story", "numbers", "unresolved"]
    why: str


class TargetWeight(BaseModel):
    symbol: str
    weight: float = Field(description="Fraction of equity, 0 to 0.25; the rest is cash")
    reason: str


class TradeThesis(BaseModel):
    regime: str
    confidence: float = Field(description="0 to 1")
    summary: str = Field(description="At most two sentences")
    signals: list[SignalView]
    conflicts: list[Conflict]
    targets: list[TargetWeight]
    invalidation: list[Claim] = Field(description="What would prove the thesis wrong")
    horizon_days: int
    lessons_used: list[int]


SYNTHESIZER_INSTRUCTIONS = """You are the Synthesizer on Robin's desk. You receive the Quant's outputs (the regime, the
signal scoreboard, signal scans, risk), the Researcher's report and any lessons Robin recalled. Weigh them and return a
trade thesis.

Rules:
- Every claim cites exactly where it came from: the Quant tool name it came from (regime_now, signal_scoreboard,
  signal_scan, portfolio_risk, regime_history), "research:<url>" for a page in the research, or "lesson:<id>". If you
  cannot cite a claim, leave it out.
- Name every conflict between the story (the research) and the numbers (the Quant), and say which wins and why. The
  numbers win unless the story names a specific, dated catalyst the numbers cannot show yet.
- Target weights favour the signals that have paid in this regime (highest blended Sharpe with enough days behind it).
  At most 25% per ETF and 10% per stock; weights sum to at most 1, the rest is cash. In Stress, prefer SHY, TLT, GLD and
  defensive sectors.
- Say what would invalidate the thesis, and the holding horizon in days.
- Use only figures that appear in what you were given."""

SYNTHESIZER_TOOL = ("Weighs the Quant's numbers against the Researcher's story and returns a structured trade thesis "
                    "with target weights. Give it, verbatim, the Quant outputs you gathered, the research report and "
                    "any lessons you recalled.")


async def thesis_json(result: RunResult) -> str:
    out = result.final_output
    return out.model_dump_json() if isinstance(out, BaseModel) else str(out)


def synthesizer_tool(model) -> Tool:
    agent = Agent(name="Synthesizer", instructions=SYNTHESIZER_INSTRUCTIONS, model=model, output_type=TradeThesis)
    return agent.as_tool(tool_name="Synthesizer", tool_description=SYNTHESIZER_TOOL, custom_output_extractor=thesis_json)


# --- The cycle gate ---------------------------------------------------------------

def _label_on(day: str) -> str | None:
    rows = store.read_regimes("rules", until=day)
    return rows[-1]["label"] if rows else None


def cycle_mode(now: datetime | None = None) -> str:
    """thesis-first, thesis-regime, thesis-weekly or check."""
    now = now or datetime.now(timezone.utc)
    current = _label_on(now.date().isoformat())
    theses = [r for r in read_runs(NAME, 1000) if (r["mode"] or "").startswith("thesis") and not r["error"]]
    if not theses:
        return "thesis-first"
    last = max(theses, key=lambda r: r["started_at"])
    last_at = datetime.fromisoformat(last["started_at"])
    month = now.strftime("%Y-%m")
    switches = sum(1 for r in theses if r["mode"] == "thesis-regime" and r["started_at"][:7] == month)
    if current and current != _label_on(last_at.date().isoformat()) and switches < MAX_REGIME_SWITCHES:
        return "thesis-regime"
    if now - last_at >= timedelta(days=REBALANCE_DAYS):
        return "thesis-weekly"
    return "check"


def thesis_message(strategy: str, account: str, trigger: str) -> str:
    why = {"thesis-first": "This is your first thesis run.", "thesis-regime": "The regime has changed since your last thesis.",
           "thesis-weekly": "It is a week since your last thesis: the weekly rebalance."}[trigger]
    return f"""{why} Run your full cycle:
1. Call regime_now.
2. Call signal_scoreboard for today's regime, then signal_scan for the two or three signals with the best blended Sharpe.
3. Ask the Researcher only for what the numbers cannot tell you: what is scheduled this week (central bank, inflation,
   jobs, earnings) and what news explains the latest regime turn. Ask it to recall any lessons on the regime and symbols.
4. Call the Synthesizer, passing it the outputs of steps 1-3 verbatim. It returns your thesis with target weights.
5. Call size_positions with the thesis's target weights.
6. Place only the orders size_positions marks trade=true: sell first, then buy, using its share deltas.
7. Ask the Researcher to store the thesis in your memory: an entity "Thesis {datetime.now(timezone.utc):%Y-%m-%d}" with
   the regime, the target weights, and what would invalidate it.
Your playbook:
{strategy}
Your account:
{account}
The current datetime is {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}."""


def check_message(strategy: str, account: str) -> str:
    return f"""This is a check cycle, not a thesis cycle: do not research and do not build a new thesis.
1. Call regime_now.
2. Call size_positions with your current weights (each holding's value / equity) to see the drawdown brake.
3. If the brake is "halved" or "to_shy", place the orders it marks trade=true. Otherwise place no orders.
Reply with one sentence on the regime and the brake.
Your playbook:
{strategy}
Your account:
{account}"""


# --- Memory -----------------------------------------------------------------------

def remember_thesis(thesis: dict, trace_id: str):
    """The thesis as an entity in Robin's graph, linked to the regime episode it was made in."""
    day = datetime.now(timezone.utc).date().isoformat()
    name = f"Thesis {day}"
    rows = store.read_regimes("rules", until=day)
    episode_start = rows[-1]["day"]
    for r in reversed(rows):
        if r["label"] != rows[-1]["label"]:
            break
        episode_start = r["day"]
    episode = f"Regime {episode_start} {rows[-1]['label']}" if rows else None
    weights = ", ".join(f"{t['symbol']} {t['weight']:.0%}" for t in thesis.get("targets", []))
    obs = [
        f"{thesis.get('regime')} at confidence {thesis.get('confidence')}: {thesis.get('summary')}",
        f"Targets: {weights or 'all cash'}; horizon {thesis.get('horizon_days')} days.",
        *[f"Invalidated if: {c['text']}" for c in thesis.get("invalidation", [])],
        f"Trace {trace_id}.",
    ]
    memory.write_graph(NAME, [(name, "Thesis")] + ([(episode, "Regime episode")] if episode else []),
                       [(name, o) for o in obs], [(name, episode, "made_in")] if episode else [])
