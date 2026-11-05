from .traders import Trader
from typing import List
import asyncio
from .tracers import LogTracer, SpanStore
from datetime import datetime, timezone
from agents import add_trace_processor
from .market import is_market_open
from .review import review
from dotenv import load_dotenv
import os
from local_llm import MODEL_NAME

load_dotenv(override=True)

RUN_EVERY_N_MINUTES = int(os.getenv("RUN_EVERY_N_MINUTES", "60"))
RUN_EVEN_WHEN_MARKET_IS_CLOSED = (
    os.getenv("RUN_EVEN_WHEN_MARKET_IS_CLOSED", "false").strip().lower() == "true"
)

names = ["Warren", "George", "Ray", "Cathie"]
lastnames = ["Patience", "Bold", "Systematic", "Crypto"]

model_names = [MODEL_NAME] * 4
short_model_names = ["Qwen2.5 Coder 32B"] * 4


def create_traders() -> List[Trader]:
    traders = []
    for name, lastname, model_name in zip(names, lastnames, model_names):
        traders.append(Trader(name, lastname, model_name))
    return traders


async def run_every_n_minutes():
    add_trace_processor(LogTracer())
    add_trace_processor(SpanStore())
    traders = create_traders()
    while True:
        if RUN_EVEN_WHEN_MARKET_IS_CLOSED or is_market_open():
            cycle_id = f"cycle_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}"
            await asyncio.gather(*[trader.run(cycle_id) for trader in traders])
            # Review past decisions that are 3 or 10 days old into lessons (plan §11.4).
            try:
                print(f"Review wrote {await review(names, cycle_id)} lessons")
            except Exception as e:
                print(f"Review failed: {type(e).__name__}: {e}")
        else:
            print("Market is closed, skipping run")
        await asyncio.sleep(RUN_EVERY_N_MINUTES * 60)


if __name__ == "__main__":
    print(f"Starting scheduler to run every {RUN_EVERY_N_MINUTES} minutes")
    asyncio.run(run_every_n_minutes())
