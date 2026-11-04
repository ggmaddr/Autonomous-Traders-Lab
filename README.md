# Trading Floor

Four autonomous AI traders (Warren, George, Ray, Cathie) that research the market, buy and sell stocks, and report to a live web dashboard. The agents run on a **local Ollama model** (no model API costs) and use [MCP](https://modelcontextprotocol.io) servers as their tools.

## Architecture

```
 Browser ── Frontend (Vite, :5173) ──/api──► API (FastAPI, :8000)
                                                │ read-only
                                                ▼
 Engine (trading_floor) ──writes──►  accounts.db (SQLite)
   every N minutes, 4 traders in parallel
        │
        ▼ each trader = one agent on Ollama (OpenAI Agents SDK)
   Researcher (sub-agent as a tool)       MCP servers it can call
     Fetch · Tavily search · Memory         Accounts (buy/sell/balance) · Market prices · Push
```

- **Engine** (`backend/trading_floor.py`): loops forever. Each cycle runs every trader, alternating *trade* and *rebalance*, then sleeps.
- **Trader** (`backend/traders.py`): an agent with its own strategy. It asks a Researcher sub-agent for news, checks prices, and trades through the Accounts MCP server.
- **Accounts** (`backend/accounts*.py`): balance, holdings, transactions and the portfolio value history, stored in `accounts.db`.
- **Market data** (`backend/market*.py`): live prices through Massive if `MASSIVE_API_KEY` is set, otherwise simulated prices.
- **API + frontend**: the API only reads `accounts.db`; the frontend polls it and draws charts, holdings, transactions and each trader's live log.
- **Model** (`local_llm.py`): one place to set the Ollama model for every agent.

## Requirements

[uv](https://docs.astral.sh/uv/) (installs Python 3.12 for you), Node 18+, [Ollama](https://ollama.com), and git.

## Setup

```bash
git clone https://github.com/ggmaddr/Autonomous-Traders-Lab.git && cd Autonomous-Traders-Lab
uv sync                              # Python dependencies into .venv
npm install --prefix frontend        # frontend dependencies
cp .env.example .env                 # then add your TAVILY_API_KEY
ollama pull qwen2.5-coder:32b        # the local model (about 19 GB)
uv run -m backend.reset              # first run only: set strategies and $10,000 each
```

## Run

Use three terminals, all from the project root:

```bash
uv run uvicorn backend.api:app --port 8000       # 1. API (docs at :8000/docs)
npm run dev --prefix frontend                    # 2. frontend, open http://localhost:5173
uv run -m backend.trading_floor                  # 3. the traders (Ctrl+C to stop)
```

State lives in `accounts.db` and `memory/`, so stopping and restarting continues where it left off. `uv run -m backend.reset` wipes it back to the start.

## Configuration

Set in `.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `TAVILY_API_KEY` | **Required.** Web search for the researcher |
| `MASSIVE_API_KEY` | Optional. Live prices and the real market-open check; simulated prices without it |
| `RUN_EVERY_N_MINUTES` | Pause between cycles (default 60) |
| `RUN_EVEN_WHEN_MARKET_IS_CLOSED` | Set `true` to trade outside market hours. With a Massive key and the market closed, the engine skips each cycle |
| `PUSHOVER_USER`, `PUSHOVER_TOKEN` | Optional. Phone notifications from the traders |
| `OPENAI_API_KEY` | Optional. Only used to upload traces to platform.openai.com/traces |

Other settings: the model in `local_llm.py`, starting cash in `backend/accounts.py`, trader names in `backend/trading_floor.py`, strategies in `backend/reset.py`.

## Notes

- One local model answers one request at a time, so the four traders take turns and a cycle takes a while.
- `openai` and `openai-agents` are pinned to a tested pair in `pyproject.toml` (`openai` 2.54 breaks `openai-agents` 0.15).
- Run the commands from the project root: the code opens `accounts.db` and `memory/` by relative path.

## License

MIT. Adapted from the MCP capstone of [Ed Donner's agents course](https://github.com/ed-donner/agents).
