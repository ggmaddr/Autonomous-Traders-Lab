"""The lab worker: runs queued experiment trials one at a time on the local model.

    uv run -m server.lab

Experiments are queued from the Experiments view (or POST /api/experiments); this
process picks them up. It shares Ollama with the live trading floor, so trials run
slower while the traders are mid-cycle.
"""

import asyncio
import os

from agents import add_trace_processor

from ..tracers import LogTracer, SpanStore
from . import store
from .runner import run_next

IDLE_POLL_S = 5
HEARTBEAT_S = 10
busy: list[str | None] = [None]


async def beat():
    while True:
        store.heartbeat(os.getpid(), busy[0])
        await asyncio.sleep(HEARTBEAT_S)


async def main():
    add_trace_processor(LogTracer())
    add_trace_processor(SpanStore())
    store.requeue_orphans()
    asyncio.create_task(beat())
    print("Lab worker ready; waiting for queued experiments")
    while True:
        nxt = store.next_trial()
        busy[0] = f"{nxt['scenario_id']} · {nxt['arm_id']} · #{nxt['trial'] + 1}" if nxt else None
        if nxt:
            print(f"Trial {nxt['id']}: {busy[0]}")
            store.heartbeat(os.getpid(), busy[0])
        if not await run_next():
            await asyncio.sleep(IDLE_POLL_S)


if __name__ == "__main__":
    asyncio.run(main())
