from .traders import Trader
from . import luffy
from typing import List
import asyncio
from .tracers import LogTracer, SpanStore
from datetime import datetime, timezone
from agents import add_trace_processor
from .market import is_market_open
from .review import review
from .quant import pipeline as market_year
from .quant.bars import last_closed_session
from .quant.store import read_regimes
from dotenv import load_dotenv
import os
from local_llm import MODEL_NAME

load_dotenv(override=True)

RUN_EVERY_N_MINUTES = int(os.getenv("RUN_EVERY_N_MINUTES", "60"))
RUN_EVEN_WHEN_MARKET_IS_CLOSED = (
    os.getenv("RUN_EVEN_WHEN_MARKET_IS_CLOSED", "false").strip().lower() == "true"
)

# The quant first, then the two steady traders, then the two wild ones.
names = ["Robin", "Nami", "Jinbe", "Law", "Luffy"]
lastnames = ["Regime quant", "All weather", "Value", "Macro", "Day trader"]

model_names = [MODEL_NAME] * len(names)
short_model_names = ["Qwen2.5 Coder 32B"] * len(names)


def create_traders() -> List[Trader]:
    traders = []
    for name, lastname, model_name in zip(names, lastnames, model_names):
        traders.append(Trader(name, lastname, model_name))
    return traders


def flatten_luffy():
    """Luffy never holds overnight: from 15:50 New York sell everything, and at any time
    sell positions carried over from an earlier session."""
    left = None if luffy.in_flatten_window() else luffy.carried_over(luffy.Account.get(luffy.NAME))
    if left is None or left:
        sold = luffy.flatten("M6: flat by the close (sold by the floor, not the agent)", left)
        if sold:
            print(f"Luffy flattened: {', '.join(sold)}")


async def run_every_n_minutes():
    add_trace_processor(LogTracer())
    add_trace_processor(SpanStore())
    traders = create_traders()
    ran_for = None
    while True:
        # The Market Year pipeline runs once a day, after the close (plan §4.4.3); on a
        # weekend or holiday it finds no new bar and only tries once.
        session = last_closed_session()
        latest = read_regimes("rules")[-1:]
        if ran_for != session and (not latest or latest[0]["day"] < session):
            ran_for = session
            try:
                await market_year.run()
            except Exception as e:
                print(f"Market Year pipeline failed: {type(e).__name__}: {e}")
        open_now = is_market_open()
        if open_now:
            flatten_luffy()
        if RUN_EVEN_WHEN_MARKET_IS_CLOSED or open_now:
            cycle_id = f"cycle_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}"
            await asyncio.gather(*[trader.run(cycle_id) for trader in traders])
            # Review past decisions that are 3 or 10 days old into lessons (plan §11.4).
            try:
                print(f"Review wrote {await review(names, cycle_id)} lessons")
            except Exception as e:
                print(f"Review failed: {type(e).__name__}: {e}")
        else:
            print("Market is closed, skipping run")
        # Wake for Luffy's 15:50 flatten when it falls before the next cycle.
        pause = RUN_EVERY_N_MINUTES * 60
        to_flatten = luffy.seconds_to_flatten()
        if to_flatten is not None and to_flatten < pause:
            await asyncio.sleep(to_flatten + 5)
            if is_market_open():
                flatten_luffy()
            pause -= to_flatten + 5
        await asyncio.sleep(max(pause, 0))

if __name__ == "__main__":
    print(f"Starting scheduler to run every {RUN_EVERY_N_MINUTES} minutes")
    asyncio.run(run_every_n_minutes())
