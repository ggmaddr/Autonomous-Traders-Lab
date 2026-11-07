"""The daily Market Year run, after the close:

    uv run -m backend.quant            # bars, regimes, scoreboard, and news for new transitions
    uv run -m backend.quant --no-news  # skip the Researcher runs (no model, no web search)
"""

import asyncio
import sys

from agents import add_trace_processor

from ..tracers import LogTracer, SpanStore
from .pipeline import run

if __name__ == "__main__":
    add_trace_processor(LogTracer())
    add_trace_processor(SpanStore())
    asyncio.run(run(news="--no-news" not in sys.argv))
