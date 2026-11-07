# Trading Floor

Five autonomous AI traders (Warren, George, Ray, Cathie and Jim, the regime quant) that research the market, buy and sell stocks, and report to a live web dashboard. The agents run on a **local Ollama model** (no model API costs) and use [MCP](https://modelcontextprotocol.io) servers as their tools.

## Architecture

```
 Browser ── Frontend (Vite, :5173) ──/api──► API (FastAPI, :8000)
                                                │ read-only
                                                ▼
 Engine (trading_floor) ──writes──►  accounts.db (SQLite) ◄── Market Year pipeline (daily, after the close)
   every N minutes, 5 traders                                  bars · regimes · scoreboard · news
        │
        ▼ each trader = one agent on Ollama (OpenAI Agents SDK)
   Researcher (sub-agent as a tool)       MCP servers it can call
     Fetch · Tavily search · Memory         Accounts · Market prices · Push · Quant (Warren, George, Jim)
   Synthesizer (Jim only)
```

- **Engine** (`backend/trading_floor.py`): loops forever. Each cycle runs every trader, then the post-cycle review, then sleeps. Once a day after the close it also runs the Market Year pipeline.
- **Traders** (`backend/traders.py`): agents with their own strategy. Warren (quality at a reasonable price) and George (global macro with trend confirmation) trade fixed playbooks (`backend/playbooks.py`) and cannot rewrite them. Ray and Cathie keep persona strategies.
- **Jim** (`backend/jim.py`): the regime quant. He reads the market regime and the signal scoreboard from the Quant, asks the Researcher only for catalysts, and a Synthesizer sub-agent turns both into a structured trade thesis. He runs a full thesis on a regime change or once a week; other cycles only check the drawdown brake.
- **Quant** (`backend/quant_server.py`, `backend/quant/`): a deterministic MCP server with no LLM: regimes, signal scoreboard and scans, portfolio risk, position sizing, Warren's quality screen and DCF, George's macro dashboard.
- **Market Year pipeline** (`backend/quant/pipeline.py`): adjusted daily bars from Alpaca (2016 on), features, two regime models (rules and a forward-filtered HMM), the eight-signal scoreboard, the news behind each regime turn, SEC EDGAR fundamentals, and Jim's memory graph.
- **Experiment Lab** (`backend/lab/`): runs queued experiments on frozen scenarios, including real-bar regime scenarios for E12–E14.
- **Accounts** (`backend/accounts*.py`): balance, holdings, transactions and the portfolio value history, stored in `accounts.db`.
- **Market data** (`backend/market*.py`): live prices through Massive if `MASSIVE_API_KEY` is set, otherwise simulated prices.
- **API + frontend**: the API only reads `accounts.db` (except queueing and cancelling experiments). Views: Money, Trades, Researcher, Decisions (with the playbook check and Jim's thesis), Lessons, Memory, Market Year, Experiments, Health.
- **Model** (`local_llm.py`): one place to set the Ollama model for every agent.

## Requirements

[uv](https://docs.astral.sh/uv/) (installs Python 3.12 for you), Node 18+, [Ollama](https://ollama.com), and git.

## Setup

Run once, from the project root:

```bash
git clone https://github.com/ggmaddr/Autonomous-Traders-Lab.git && cd Autonomous-Traders-Lab
uv sync
npm install --prefix frontend
cp .env.example .env
ollama pull qwen2.5-coder:32b
uv run -m backend.reset
uv run -m backend.quant
uv run -m backend.lab.regime_scenarios
```

In order: install Python and frontend dependencies, create `.env` (then fill in the keys below), pull the local model (about 19 GB), set the strategies and $10,000 for each trader, load the Market Year (bars, regimes, scoreboard, fundamentals, news), and build the Lab's regime scenarios from those bars.

## Run

Use a terminal for each, all from the project root.

The API (docs at http://localhost:8000/docs):

```bash
uv run uvicorn backend.api:app --port 8000
```

The frontend (open http://localhost:5173):

```bash
npm run dev --prefix frontend
```

The traders (Ctrl+C to stop):

```bash
uv run -m backend.trading_floor
```

The Experiment Lab worker, which runs experiments queued from the Experiments view:

```bash
uv run -m backend.lab
```

### By hand

The engine runs these on its own; run them yourself to refresh now.

Market Year pipeline (bars, regimes, scoreboard, fundamentals, news, Jim's memory):

```bash
uv run -m backend.quant
```

The same without the Researcher runs that explain regime turns (no model, no web search):

```bash
uv run -m backend.quant --no-news
```

Rebuild the Lab's regime scenarios after the bars change:

```bash
uv run -m backend.lab.regime_scenarios
```

Review past trades into lessons:

```bash
uv run -m backend.review
```

Reset every account and strategy to the start:

```bash
uv run -m backend.reset
```

State lives in `accounts.db` and `memory/`, so stopping and restarting continues where it left off.

## Configuration

Set in `.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `TAVILY_API_KEY` | **Required.** Web search for the researcher |
| `ALPACA_API_KEY`, `ALPACA_SECRET_KEY` | **Required for the Market Year.** Daily bar history from Alpaca's data API. Use paper keys; nothing trades through them |
| `SEC_USER_AGENT` | For Warren's fundamentals from SEC EDGAR, which asks clients to name themselves: `Your Name you@example.com` |
| `MASSIVE_API_KEY` | Optional. Live prices and the real market-open check; simulated prices without it. Orders for unknown tickers are rejected, never filled at a made-up price |
| `RUN_EVERY_N_MINUTES` | Pause between cycles (default 60) |
| `RUN_EVEN_WHEN_MARKET_IS_CLOSED` | Set `true` to trade outside market hours. With a Massive key and the market closed, the engine skips each cycle |
| `PUSHOVER_USER`, `PUSHOVER_TOKEN` | Optional. Phone notifications from the traders |
| `OPENAI_API_KEY` | Optional. Only used to upload traces to platform.openai.com/traces |

Other settings: the model in `local_llm.py`, starting cash in `backend/accounts.py`, trader names in `backend/trading_floor.py`, persona strategies in `backend/reset.py`, playbooks in `backend/playbooks.py`, the Market Year symbols in `backend/quant/universe.py`.

## Notes

- One local model answers one request at a time, so the five traders take turns and a cycle takes a while. The Market Year's news step runs one Researcher call per regime turn and can take a while the first time.
- `openai` and `openai-agents` are pinned to a tested pair in `pyproject.toml` (`openai` 2.54 breaks `openai-agents` 0.15).
- Run the commands from the project root: the code opens `accounts.db` and `memory/` by relative path.

## License

MIT. Adapted from the MCP capstone of [Ed Donner's agents course](https://github.com/ed-donner/agents).
