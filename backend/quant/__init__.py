"""The Market Year pipeline (plan §4.4.3) and, from it, the Quant server's numbers.

Deterministic Python, no LLM except the Researcher run that explains each regime
transition. Everything is computed as of a date: a value for day t uses bars up to
and including t only, so nothing here can leak the future into a decision.

    uv run -m backend.quant          # backfill bars, then features, regimes, scoreboard, news
"""
