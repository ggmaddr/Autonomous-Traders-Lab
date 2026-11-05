# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

Four autonomous AI traders (Warren, George, Ray, Cathie) that research the market, trade stocks and report to a web dashboard. They run on a local Ollama model through the OpenAI Agents SDK, and use MCP servers as their tools.

It is being upgraded into an **Autonomous Traders Lab**, a lab for building, explaining, stress-testing and comparing AI trading agents, aiming over time at reliable, risk-adjusted profit. The plan is [docs/V2_ARCHITECTURE_PLAN.md](docs/V2_ARCHITECTURE_PLAN.md). Work follows its roadmap (§16), one phase at a time.

## Run it

All commands run from the project root. The code opens `accounts.db` and `memory/` by relative path.

```bash
uv sync                                          # Python deps
npm install --prefix frontend                    # frontend deps
uv run -m backend.reset                          # first run only: strategies + $10,000 each
uv run uvicorn backend.api:app --port 8000       # API (docs at :8000/docs)
npm run dev --prefix frontend                    # UI at http://localhost:5173
uv run -m backend.trading_floor                  # the traders (Ctrl+C to stop)
```

Needs Ollama with `qwen2.5-coder:32b` pulled, and `TAVILY_API_KEY` in `.env`. `MASSIVE_API_KEY` is optional (simulated prices without it).

## Layout

- `backend/trading_floor.py`: the scheduler loop; runs all traders each cycle.
- `backend/traders.py`: builds each trader agent, its Researcher sub-agent (`Agent.as_tool`) and its MCP servers.
- `backend/templates.py`, `backend/reset.py`: prompts and the four strategies.
- `backend/accounts.py`, `accounts_server.py`, `accounts_client.py`: the account model and its MCP server.
- `backend/market.py`, `market_server.py`, `market_simulator.py`: prices from Massive, or the deterministic simulator.
- `backend/mcp_servers.py`: which MCP servers each agent gets (fetch, Tavily, memory, market, accounts, push).
- `backend/tracers.py`: SDK trace processors: `LogTracer` writes the activity log, `SpanStore` saves every SDK trace and span as exported.
- `backend/runs.py`: reads the saved spans back as research requests, prices looked up, orders tried and run timelines (`/api/research`, `/api/runs`).
- `backend/database.py`: SQLite (`accounts.db`): `accounts` (JSON per account), `logs`, `traces` and `spans` (SDK exports as-is), `runs` (strategy and portfolio before/after per trader run).
- `backend/api.py`: read-only FastAPI for the frontend.
- `frontend/`: React + TypeScript + Vite, TanStack Query, uPlot for time series. `src/lib/ledger.ts` computes the books (FIFO P&L, aligned equity curves, drawdown); `src/views/` holds one file per view.
- `local_llm.py`: the Ollama model, and a fix-up that turns JSON-as-text into real tool calls.
- `memory/<name>.db`: each researcher's knowledge graph (entities, relations, observations).

## How to work here

- **Every phase must end in something visible in the UI.** Do backend work only when a visible feature needs it, inside that feature's phase. Don't add CI-only, tooling-only or "interfaces for later" work unless asked.
- **Reuse framework tracing.** Save OpenAI Agents SDK spans as they are (and Google ADK's, if adopted). Don't build a custom tracing system. New storage is only for the money side: decisions, orders, fills, portfolio snapshots, research reports, lessons.
- **Keep the pinned pair** `openai` 2.34.x and `openai-agents` 0.15.x in `pyproject.toml`. Newer `openai` breaks this SDK version.
- **Never send money to a live broker.** Alpaca work uses the paper URL only.
- Before changing behavior, check the known defects in §1.4 of the plan (D1–D16). Some put wrong numbers on screen, for example the made-up price for unknown tickers (D1).
- Match the surrounding code style. The frontend is React (Phase 1); unbuilt views are listed in `frontend/src/nav.ts` with their phase.

## UI work

Two UI skills live next to this repo. Use them for any frontend change:

- **taste-skill** (`../taste-skill/skills/taste-skill/SKILL.md`): primary art direction. This is an app screen, so follow `references/app-screens.md` and deal a style with `node ../taste-skill/skills/taste-skill/scripts/draw.mjs --app --kind markets ...`. Preferred style: `data-terminal`. Check screens with `scripts/inspect.mjs --app`.
- **ui-ux-pro-max** (`../ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max/SKILL.md`): accessibility, chart choice and React guidance, via `python3 ../ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>`.
- When they disagree, taste-skill decides the look and ui-ux-pro-max decides accessibility. No monospace outside code, no glows, gradients or icon-tile KPIs.
- Put colour on data, especially P&L, not on chrome. Every screen answers one question first.
- Page titles stay big (the owner wants them even bigger, never smaller). Ignore taste-skill's `app-title-size` warning.
