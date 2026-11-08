# V2 Architecture Plan: Autonomous Agent Reliability & Trading Systems Lab

| | |
|---|---|
| Status | Draft. Planning only, nothing here is implemented yet |
| Scope | Whole repository: `server/`, `client/`, `local_llm.py`, configuration |
| Baseline commit | `fb7badc` (openai-agents 0.15.3, openai 2.34, Ollama `qwen2.5-coder:32b`) |
| Last updated | 2026-11-04 |

**Thesis.** The finished project is a lab for building autonomous trading agents that are reliable enough to eventually earn **consistent, risk-adjusted profit**. The path to profit runs through reliability: an agent can only be trusted with money once its decisions can be explained, reproduced, stress-tested and measured against simple baselines. So the main engineering work is the evaluation harness, the deterministic simulation, replay, failure injection and a financially useful dashboard. Profit claims are made only when the measurements support them. Every new feature has to answer a question that can be measured. A feature that only makes the trading bot look more sophisticated does not belong in V2.

---

## Table of contents

1. [Current architecture (from the code)](#1-current-architecture-from-the-code)
2. [Target identity and objective](#2-target-identity-and-objective)
3. [V2 architecture](#3-v2-architecture)
4. [Agent architecture analysis and experiments](#4-agent-architecture-analysis-and-experiments)
5. [Evaluation harness](#5-evaluation-harness)
6. [Traces, replay and observability](#6-traces-replay-and-observability)
7. [Failure injection](#7-failure-injection)
8. [C++ simulation core](#8-c-simulation-core)
9. [Alpaca paper-trading migration](#9-alpaca-paper-trading-migration)
10. [Backtesting and historical experiments](#10-backtesting-and-historical-experiments)
11. [Independent V2 UI](#11-independent-v2-ui)
12. [Financial capability brainstorm](#12-financial-capability-brainstorm)
13. [OpenAI SDK tracing vs what we build](#13-openai-sdk-tracing-vs-what-we-build)
14. [What stays unchanged](#14-what-stays-unchanged)
15. [What gets replaced or refactored](#15-what-gets-replaced-or-refactored)
16. [Prioritized roadmap](#16-prioritized-roadmap)
17. [Top 5 highest-value improvements](#17-top-5-highest-value-improvements)
18. [Top 5 impressive-sounding ideas to NOT prioritize](#18-top-5-impressive-sounding-ideas-to-not-prioritize)
19. [Decisions needed before implementation](#19-decisions-needed-before-implementation)

---

## 1. Current architecture (from the code)

### 1.1 Runtime topology as it actually runs

```text
                         ┌──────────────────────────── one process: server.trading_floor ────────────────────────────┐
                         │ run_every_n_minutes(): every RUN_EVERY_N_MINUTES                                          │
                         │   is_market_open()  (Massive; returns True on any error or with no key)                   │
                         │   asyncio.gather(Warren.run(), George.run(), Ray.run(), Cathie.run())                    │
                         │                                                                                           │
                         │   Trader.run()  ── per trader, per cycle ─────────────────────────────────────────────┐  │
                         │     trace("<name>-trading" | "<name>-rebalancing", trace_id="trace_<name>0<random>")   │  │
                         │     spawn 3 trader MCP servers (stdio subprocesses)                                    │  │
                         │        accounts_server (uv)  push_server (uv)  market: mcp_massive (uvx) | market_server │  │
                         │     spawn 3 researcher MCP servers                                                     │  │
                         │        mcp-server-fetch (uvx)  tavily-mcp@latest (npx)  mcp-memory-libsql (npx) → memory/<name>.db
                         │     accounts_client: 2 more short-lived accounts_server subprocesses to read            │  │
                         │        account report + strategy (MCP resources)                                        │  │
                         │     Agent(name, trader_instructions, model=local_model,                                │  │
                         │           tools=[Researcher.as_tool()], mcp_servers=trader servers)                     │  │
                         │     Runner.run(agent, trade_message | rebalance_message, max_turns=30)                 │  │
                         │     do_trade = not do_trade   (in-memory; toggles even when the run failed)            │  │
                         │                                                                                        │  │
                         │   LogTracer (TracingProcessor) → logs table: "Started function buy_shares", …          │  │
                         └───────────────────────────────────────────────────────────────────────────────────────────┘
                                         │ writes (JSON blob per account + log rows)
                                         ▼
                                  accounts.db (SQLite, relative path)
                                         ▲ reads (and also calls get_share_price for every holding on every poll)
                                         │
       Browser ── Vite (:5173, vanilla TS + uPlot) ── polls /api every 2 s (logs) and 6 s (data) ── FastAPI (:8000)

       local_llm.py: AsyncOpenAI → Ollama :11434, chat.completions.create is monkey-patched to turn
                     JSON written as text back into tool calls (qwen2.5-coder habit)
```

### 1.2 Component inventory

| Component | File(s) | What it really does |
|---|---|---|
| Scheduler / engine | [trading_floor.py](../server/trading_floor.py) | Infinite loop. Runs all four traders at once, then sleeps. No cycle ID, no run ID, no persisted state for trade vs rebalance. |
| Trader | [traders.py](../server/traders.py) | Rebuilds the agent and spawns 6 or more MCP subprocesses on every run. The Researcher is attached with `Agent.as_tool` (a nested `Runner.run`), not a handoff. Every exception is caught and printed. |
| Researcher | [traders.py:27-39](../server/traders.py#L27-L39), [templates.py](../server/templates.py) | One Researcher instance per trader. All four share the same prompt, but each has its own memory database (`memory/<name>.db`). There is no shared researcher. |
| Prompts | [templates.py](../server/templates.py) | `trade_message` and `rebalance_message` are about 80% identical. `datetime.now()` is baked into the prompts. `note` is computed once at import time. |
| Strategies | [reset.py](../server/reset.py) | Four prompts that pay homage to famous investors. They are stored in the DB, and the agent can rewrite its own strategy (`change_strategy`). |
| Accounts domain | [accounts.py](../server/accounts.py) | A Pydantic model saved as one JSON blob per account. Fills at `price × (1 ± 0.2%)`. Money is stored as floats. |
| Accounts MCP | [accounts_server.py](../server/accounts_server.py) | Tools: `get_balance`, `get_holdings`, `buy_shares`, `sell_shares`, `change_strategy`. Each tool takes the account `name` as an argument. Resources: account report and strategy. |
| Market data | [market.py](../server/market.py), [market_simulator.py](../server/market_simulator.py) | Massive REST with a tiered fallback (last trade → snapshot → previous close). Falls back to a deterministic value-noise simulator when the key is missing or the API fails. |
| Market MCP | [mcp_servers.py](../server/mcp_servers.py) | With a key, the agent gets Massive's own MCP server (`search_endpoints` / `call_api` meta-tools). Without one it gets `lookup_share_price`. |
| Push | [push_server.py](../server/push_server.py) | A Pushover POST. It is sent even when no credentials are set, and it is never stubbed. |
| Tracing | [tracers.py](../server/tracers.py) | Encodes the trader name into the trace ID and parses it back out. Writes a one-line string per span start/end. Drops inputs, outputs, usage, timing and parent IDs. |
| Storage | [database.py](../server/database.py) | Two tables: `accounts(name, account JSON)` and `logs(name, datetime, type, message)`. The schema is created at import time. |
| API | [api.py](../server/api.py) | Read-only FastAPI. Imports `server.trading_floor` just to get the names, which pulls in the whole agent stack. |
| Frontend | [client/src](../client/src) | Four trader panels: chart, heatmap, log and transactions. Polls the API. The chart adds a point on every poll on the client side only. |
| Model | [local_llm.py](../local_llm.py) | Every agent uses the same Ollama model. `get_model()` ignores its argument. |
| Tests / CI | — | **None.** No tests, linting, type checks or CI. |

### 1.3 Evidence from the local run data (`accounts.db`, 2026-10-25 → 2026-11-04)

The numbers below come from the existing `logs` table. They are the "before" baseline that V2 should improve on and be able to explain.

| Observation | Value | Why it matters |
|---|---|---|
| Traces recorded | 49 | Only about 10 days of activity, and the run count is low because of local LLM throughput |
| `function` spans vs `mcp_tools` (list-tools) spans | 212 vs 834 | About 4 tool-list calls per real tool call. Tool lists are not cached (`cache_tools_list` is unset). This is a cheap latency win that needs measuring first. |
| Researcher calls started vs ended | 14 vs 10 | 4 researcher runs have no recorded end. **The current logs cannot say whether they timed out, crashed, or the engine was stopped.** This is the observability gap in one number. |
| Transactions per trader | Warren 14, George 4, Ray 1, Cathie 0 | Cathie (crypto ETFs) never traded. Nothing records why. |
| An `ed` account exists | 1 txn | `Account.get()` creates a funded $10k account for **any** name ([accounts.py:37-48](../server/accounts.py#L37-L48)), and every tool takes `name` as an argument. Whatever created this row, the code cannot prevent it. |
| Strategy rewrites | 2 | The experimental conditions drift without any record of the change: the original strategy text is overwritten. |

### 1.4 Defects and design issues found during inspection

These matter for V2 because several of them would quietly corrupt evaluation data. They must be fixed, or at least made observable, before any measurement can be trusted.

| # | Issue | Location | Effect on V2 |
|---|---|---|---|
| D1 | Invalid or unknown tickers get a **made-up price**. Massive errors fall back to `simulated_price`, and the simulator returns a price for any string. | [market.py:37-43](../server/market.py#L37-L43) | Agents can "buy" `FOOBAR`. Real and synthetic prices get mixed in one portfolio with no flag. This is silent corruption. |
| D2 | `is_market_open()` fails **open** | [market.py:61-68](../server/market.py#L61-L68) | An outage looks like an open market. |
| D3 | `price == 0` check is unreachable and ordered after the cash check | [accounts.py:85-88](../server/accounts.py#L85-L88) | No real symbol validation. |
| D4 | Tools take the account `name` as a model-supplied argument, and `Account.get` creates accounts on demand | [accounts_server.py](../server/accounts_server.py), [accounts.py:37](../server/accounts.py#L37) | Agents can act on other accounts or create new ones. This is a capability-scoping bug. |
| D5 | `report()` **writes**: it appends a time-series point on every read | [accounts.py:153-160](../server/accounts.py#L153-L160) | Portfolio history is sampled whenever an agent happens to read the account. You cannot compute returns at regular intervals from it. |
| D6 | `get_profit_loss()` calls `calculate_profit_loss()` without its required argument | [accounts.py:145-147](../server/accounts.py#L145-L147) | Latent crash. |
| D7 | MCP tool annotations say `-> float` but return `str` | [accounts_server.py:25,38](../server/accounts_server.py#L25) | The tool schema advertised to the model is wrong. |
| D8 | The price the agent sees comes from the market MCP server. The fill price comes from a separate `get_share_price` call, possibly through a different Massive tier. | [accounts.py:82](../server/accounts.py#L82), [mcp_servers.py](../server/mcp_servers.py) | The decision price and the fill price can differ, and nothing records the gap. |
| D9 | Mixed clocks: transactions use naive local time, logs use SQLite `datetime('now')` (UTC), the frontend parses timestamps as local | [database.py:58](../server/database.py#L58), [accounts.py](../server/accounts.py) | Timelines cannot be joined reliably. |
| D10 | `datetime.now()` is called in prompts, accounts and the simulator. There is no clock abstraction. | [templates.py](../server/templates.py) | Nothing can be replayed or backtested. |
| D11 | The prompts mention tools the trader does not have ("entity tools" for memory; "get company news") | [templates.py:42,53](../server/templates.py#L42) | Invites calls to tools that do not exist. This is measurable. |
| D12 | Unpinned `npx -y tavily-mcp@latest` and `mcp-memory-libsql` | [mcp_servers.py:54,61](../server/mcp_servers.py#L54) | Not reproducible, and a supply-chain risk. |
| D13 | Errors are swallowed and printed. `do_trade` still toggles. `MaxTurnsExceeded` cannot be told apart from other errors. | [traders.py:95-100](../server/traders.py#L95-L100) | Failures are invisible and cannot be classified. |
| D14 | Researcher memory persists across runs (`memory/<name>.db`) | [mcp_servers.py:62](../server/mcp_servers.py#L62) | State leaks between experiments. |
| D15 | The API calls live `get_share_price` for every holding on every 6 s poll | [api.py:50](../server/api.py#L50) | Massive rate-limit pressure. The UI shows a different price than the agents saw. |
| D16 | The tool-call recovery hack in `local_llm.py` runs silently | [local_llm.py:36-68](../local_llm.py#L36-L68) | A real reliability mechanism that is never measured. How often does it fire, and does it ever misfire? |

### 1.5 What is genuinely good and worth keeping

- **MCP as the tool boundary.** Agents already reach the world only through tools. That makes the action space explicit, and it is the natural place to add interception, replay and fault injection.
- **Engine, API and UI are separate processes.** The API is read-only. This is the right shape already.
- **The deterministic price simulator.** The same ticker and timestamp always give the same price, using smooth multi-octave value noise. It is a ready-made synthetic market for scenario tests.
- **Researcher as a tool** (`as_tool`) gives a clean baseline arm for ablation.
- **The `rationale` field on every transaction** is the first piece of a decision ledger.
- **One `TracingProcessor` hook already exists.** V2 extends it rather than inventing a parallel instrumentation system.

---

## 2. Target identity and objective

**One-line identity:** a reproducible lab for building, tracing, stress-testing and comparing autonomous LLM trading agents, with the long-term aim of a system that earns reliable, risk-adjusted profit.

**Goals**

1. Every agent run can be **explained**: which evidence the agent saw, which tools it called, what it decided, what executed, and what changed in the portfolio.
2. Every claim about an agent design can be **measured**: repeated trials on frozen scenarios, with confidence intervals, compared against deterministic baselines.
3. Every important failure mode can be **reproduced** on demand and is **classified**.
4. One agent decision can be executed against **deterministic simulation** or **Alpaca paper** behind a single broker interface.
5. A **systems core** (C++20) exists because a benchmark justifies it, and a test suite proves it gives the same results as the Python reference.
6. **Reliable profit, earned in stages.** First beat the baselines in simulation on risk-adjusted terms (§10.2) across many episodes. Then hold that edge in Alpaca paper trading over months. Real money is considered only after both stages pass pre-agreed thresholds (§19).

**Not in V2 (but not ruled out)**

- **Real-money trading.** It comes after the staged evidence in goal 6, not before.
- **Supporting every agent framework.** One extra adapter proves framework independence (§5.1).

**Future directions (kept open on purpose)**

- **Distributed execution.** One machine is enough for V2 because the local LLM, not the infrastructure, limits throughput. But the design should not block a later move to several machines: the run queue, the broker interface and the event store sit behind interfaces, run IDs are globally unique, and experiment trials are independent units of work. If hosted models or several GPU hosts make throughput an infrastructure problem, trials can be spread over workers (a job queue first; Kafka or Kubernetes only if a measured need appears).
- **Return-focused strategy research** (ML signals, sentiment models, parameter search). This becomes worthwhile once the harness exists, because only then can overfitting be caught with walk-forward and out-of-sample tests (§12).

---

## 3. V2 architecture

### 3.1 Design principles

1. **The environment is separate from the agent.** The market, broker, research corpus and clock form an *Environment*. The trader and researcher form the *Policy* under test. They talk only through tools.
2. **The LLM proposes, deterministic code disposes.** Identity, pricing, sizing caps, risk limits, order submission, idempotency, retries and market-hours gating are deterministic code. Autonomy is kept for interpreting evidence and choosing among valid actions.
3. **Ports and adapters.** `Clock`, `MarketData`, `Broker`, `ResearchSource` and `ModelClient` are interfaces. Live, simulated, replayed and fault-injected implementations plug in behind each one.
4. **Reuse framework traces, add the money.** SDK spans are saved as exported. Our own tables hold only what the frameworks do not know: decisions, orders, fills, portfolio, evidence and lessons.
5. **Everything is versioned.** No result exists without a manifest naming the scenario, agent config, prompt hash, model digest, tool versions, seed and git commit.

### 3.2 Target diagram

```text
┌────────────────────────────────────────── Control plane ───────────────────────────────────────────┐
│  CLI (`lab run|eval|replay|experiment|demo`)        FastAPI /api/v2 (REST + SSE)        V2 UI (React)│
└───────────────┬──────────────────────────────────────────────┬─────────────────────────────────────┘
                │ RunSpec / ExperimentSpec (versioned YAML)    │ reads
                ▼                                              │
┌──────────────────────── Orchestrator (Python, deterministic) ┴──────────────────────────────────────┐
│  Scheduler (live cadence | episode stepper)   Cycle/Run/Episode IDs   per-trader isolation + watchdog│
│                                                                                                       │
│   ┌────────────── Policy under test (AgentAdapter) ──────────────┐                                    │
│   │  OpenAIAgentsAdapter (today's Trader + Researcher)            │   PlainLoopAdapter (reference,    │
│   │  configs/agents/*.yaml → prompt (hashed), tools, policies     │   ~200 lines, proves framework    │
│   └──────────┬───────────────────────────────┬────────────────────┘   independence)                   │
│              │ model calls                   │ tool calls (MCP)                                        │
│      ┌───────▼────────┐            ┌─────────▼──────────────────────────────────────────┐             │
│      │ ModelClient     │            │ Tool Gateway (MCP servers, bound to run+account)    │             │
│      │ live | record | │            │  intercept → [FaultInjector] → [Recorder/Replayer]  │             │
│      │ replay | fault  │            └───┬───────────────┬──────────────────┬──────────────┘             │
│      └────────────────┘                │               │                  │                            │
│                                 ResearchSource      MarketData          Broker ◄── RiskGate (pre-trade,  │
│                                 live (Tavily/Fetch) live (Massive)       │         deterministic)          │
│                                 frozen corpus       episode (Parquet)    ├─ SimBroker (Python ref ↔ C++ core) │
│                                 cassette replay     synthetic (noise)    └─ AlpacaPaperBroker            │
│                                        └───────────── Clock (live | simulated) ───────────┘              │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                                │ normalized events (spans + domain events)
                                                ▼
┌──────────────────────── Evidence store ─────────────────────────┐     ┌──────── Evaluation harness ───────┐
│ SQLite (WAL): runs, cycles, spans, decisions, orders, fills,     │────►│ scenarios, graders, metrics,       │
│ snapshots, evidence, faults, manifests; blobs content-addressed  │     │ repeated trials, stats, reports    │
│ Export → Parquet for DuckDB analysis                              │     └────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
```

### 3.3 Key structural decisions (with alternatives considered)

| Decision | Chosen | Alternatives considered | Why |
|---|---|---|---|
| How the environment reaches MCP servers | MCP servers stay stdio subprocesses. Run context (`LAB_RUN_ID`, `LAB_CYCLE_ID`, `LAB_ACCOUNT`, `LAB_MODE`, `LAB_EPISODE`) is passed in through the spawn env. The account is **bound server-side**, and `name` is removed from tool schemas. | (a) Replace MCP with in-process function tools. (b) One long-lived MCP server over streamable HTTP. | Fits the current spawn-per-trader-per-cycle design, fixes D4, and keeps MCP as part of the project's identity. (b) is a later optimization once the subprocess cost has been measured. |
| Where risk checks live | Inside the Broker port (`RiskGate`), on the server side | SDK tool guardrails only; an LLM risk-reviewer agent | Guardrails can be bypassed by future tools. The broker is the one place every order must pass through. An LLM reviewer becomes an *experiment* (E7), not the safety mechanism. |
| Money representation | `int64` micro-dollars in core accounting, `Decimal` at the edges | float (today) | Needed for exact Python↔C++ parity and for reconciliation with Alpaca. |
| Event storage | SQLite (WAL), exported to Parquet | Postgres; ClickHouse; OTel collector + Jaeger | Single machine, zero ops, and it extends the existing DB. Postgres is the natural next step if the system later goes distributed. |
| Traces | **Reuse the framework's own traces** (OpenAI Agents SDK spans today, Google ADK's OpenTelemetry spans if ADK is adopted). Store them as exported, and add only thin link fields plus the financial tables (decisions, orders, fills, portfolio). | Build our own trace schema and capture layer | The SDKs already record model calls, tool calls, timing, usage and errors. Rebuilding that is effort with no new information. What they lack is the money side, so that is the only part we build. |
| Agent framework coupling | `AgentAdapter` protocol | Keep the SDK everywhere | The harness has to work with other frameworks, so it may only depend on the adapter protocol. |

---

## 4. Agent architecture analysis and experiments

### 4.1 What actually differs between the four traders

| Dimension | Warren | George | Ray | Cathie |
|---|---|---|---|---|
| Model | same | same | same | same (`model_names = [MODEL_NAME] * 4`, and `get_model` ignores it anyway) |
| Instructions | same template | same | same | same |
| Tools / MCP servers | same | same | same | same |
| Researcher | own instance, same prompt, own memory DB | ← | ← | ← |
| **Strategy text** | value | contrarian macro | risk parity | crypto-ETF innovation |

**Conclusion:** the four traders are **one agent with four persona prompts**, and the agents can rewrite those prompts at runtime. That is fine, but it should be stated honestly. As it stands, the floor is an informal test of how sensitive one agent is to its prompt. V2 makes that test formal. The one new trader (Jim, §4.4) is added because he is a *different agent*, with a deterministic Quant tool server and a Synthesizer sub-agent, not because the floor needs another prompt.

**Duplication:** four identical Researcher agents. Four copies of the same MCP process tree on every cycle (6 servers plus 2 resource-read subprocesses per trader). Two near-identical task messages. Strategy text that names real people.

### 4.2 Where autonomy helps and where deterministic orchestration is better

| Concern | Today | V2 owner | Reason |
|---|---|---|---|
| When to run, trade vs rebalance | orchestrator | orchestrator, with the mode persisted | Already deterministic. Make it durable and observable. |
| Which account to act on | **LLM argument** | orchestrator (bound) | Security and correctness (D4) |
| Which symbols are tradable | nobody | `RiskGate` universe check | D1 |
| Price used for sizing and filling | two separate lookups | one quote with a timestamp, recorded in the decision | D8, staleness checks |
| Position sizing *limits* | prompt ("size within balance") | `RiskGate` | Deterministic limits are free and always enforced |
| What to research, how to read news | LLM | LLM | This is where autonomy pays off |
| Choosing among valid actions | LLM | LLM | The thing under test |
| Retries, timeouts, duplicate orders | nobody | gateway (idempotency keys, circuit breakers) | Reliability |
| Rewriting its own strategy | LLM, unversioned | LLM *only when the experiment flag allows it*, every version stored | It changes the conditions under test |
| Memory writes | LLM via researcher | LLM, but memory is snapshotted per episode | Prevents state leaking between experiments |

### 4.3 Candidate agent changes, treated as experiments rather than features

No new agent is added by default. Each candidate is an experimental arm with a falsifiable hypothesis.

| ID | Question | Arms | Primary metrics | Hypothesis worth testing |
|---|---|---|---|---|
| **E1** | Does the researcher improve decisions enough to justify its cost? | (a) no researcher (b) researcher on demand, as today (c) researcher always called first by the orchestrator and its report injected (d) frozen cached research | decision-quality score, groundedness, scenario pass rate, tokens, latency | (b) costs about 2× the tokens of (a). It helps only in news-driven scenarios. (d) ≈ (b) at near-zero cost. |
| **E2** | Should the agent decide *when* to research? | (b) vs (c) from E1 | number of research calls, missed-evidence rate | Forced research cuts missed-evidence failures but adds churn when nothing is happening. |
| **E3** | Same evidence, different strategies: do the personas actually behave differently? | 4 strategy prompts on identical frozen evidence and portfolio | action divergence, strategy-adherence score, cross-agent disagreement | The personas diverge less than their names suggest. Measure it. |
| **E4** | Shared vs specialized research | one generalist vs news / fundamentals / macro specialists | evidence coverage, cost, latency | Specialization only pays off for strategies that need several kinds of data (Ray). |
| **E5** | Single agent vs multi-agent | trader with the research tools directly vs trader + Researcher sub-agent | quality, tokens, turns, loop rate | The sub-agent shrinks the trader's context and lowers loop rate, but adds latency. |
| **E6** | Model ladder / cost-quality frontier | qwen2.5 7B / 14B / 32B (coder vs instruct), optionally one hosted model | all quality metrics vs tokens, latency and $-equivalent | The 32B coder model is not on the frontier for prose-heavy research. |
| **E7** | Tool-executing agent vs proposal + deterministic executor | (a) today: the agent calls `buy_shares` (b) the agent returns a structured `TradePlan`, the executor validates and submits (c) (b) plus an LLM risk-reviewer | risk-violation *attempts*, invalid-argument rate, task completion | (b) removes the invalid-argument class of errors entirely. (c) adds cost with little benefit over deterministic checks. |
| **E8** | Self-modifying strategy | change_strategy on vs off | strategy drift (embedding distance from v0), adherence, outcome variance | Self-modification increases variance without improving outcomes. |
| **E9** | Persistent memory | memory on (persistent) / on (episode-scoped) / off | groundedness, stale-fact citations, cost | Persistent memory brings in stale "facts" that undermine groundedness. |
| **E11** | Do learned lessons improve later decisions? | lessons review + recall on vs off, same episodes | risk-adjusted return vs baselines, repeated-mistake rate, groundedness | Lessons cut repeated mistakes, but only if old lessons are checked for staleness. |
| **E12** | Does the LLM add anything to a regime strategy? | Jim (full agent) vs the same regime rules + scoreboard run mechanically vs the 200-day timing rule | risk-adjusted return, max drawdown, turnover, cost | The mechanical rules capture most of the return. The LLM earns its cost only around transitions, when news explains the numbers. |
| **E13** | Does a Synthesizer improve decisions? | trader reads raw research + quant outputs vs trader receives the Synthesizer's `TradeThesis` | decision quality, groundedness, conflicts noticed, tokens, latency | The Synthesizer catches story-vs-numbers conflicts the trader misses, at about 1.5× the tokens. |
| **E14** | Playbooks vs persona prompts | Warren and George on persona text vs on rule playbooks (§4.4), same frozen evidence | rule adherence per trade, strategy drift, action divergence (E3), return vs baselines | Playbooks raise adherence and divergence between traders. Return differences need Phase 8's episodes to be measurable. |
| **E10** | Prompt–tool consistency | current prompts vs prompts fixed per D11 | calls to non-existent tools, recovery-hack firings | A fix that costs nothing and can be measured. A good first result to show. |

### 4.4 Strategy playbooks and the fifth trader (Phase 5)

**Why.** The live data (accounts.db, 2026-11-04) shows the personas are too thin to trade on:

- Warren's and Ray's stored strategies are empty strings.
- George rewrote his macro strategy into "short-term trading opportunities in the tech sector". Cathie rewrote hers into "growth stock investing … high-tech and health tech". That is strategy drift (E8) in practice.
- Memory graphs: Warren and George have 2 entities each and no relations. Ray has 7 entities and 7 relations. Cathie has 9 entities and 28 observations.

A one-paragraph persona gives the model nothing it can check. So it drifts toward generic tech-momentum buying and writes little to memory.

The fix has two parts:

1. **Playbooks.** Warren and George get explicit, rule-based strategies. Tools compute the numbers, and fixed rules say what to write to memory.
2. **A fifth trader built differently from the other four.** He has new tools and a new sub-agent, not just another persona prompt. That answers §4.1's "one agent with four prompts" critique instead of repeating it.

Playbooks are stored as strategy text plus a machine-readable rule list, so the Decisions view can show which rules each trade passed. `change_strategy` is off for playbook traders. Edits are versioned and visible, never silent.

#### 4.4.1 Warren: quality at a reasonable price

This blends Buffett's quality focus, Greenblatt's Magic Formula and the Piotroski F-score. It is the most widely used systematic version of value investing, because cheap-but-bad "value traps" sank plain value for a decade.

- **Universe.** S&P 500, excluding financials and REITs (their accounts break these screens).
- **Screen** (a deterministic tool):
  - ROIC above 15%, averaged over 5 years.
  - Positive free cash flow in each of the last 5 years.
  - Net debt / EBITDA below 2.
  - Piotroski F-score of 7 or more.
  - In the top third by earnings yield (EBIT / enterprise value).
- **Valuation.** A tool runs an owner-earnings DCF with bear, base and bull cases. Warren buys only at a margin of safety of at least 25% to the base case. The LLM never does this arithmetic.
- **Moat check** (the Researcher reads filings and news): pricing power (stable gross margin), switching costs, network effects, scale. Read the 10-K risk factors for anything that breaks the thesis.
- **Portfolio.**
  - 8–12 positions, at most 15% each, with a 10% cash floor.
  - Adds to a position after a fall only if the thesis still holds.
- **Sell rules.** Sell only when one of these is true:
  - Price is above 1.1× the base-case value.
  - A kill criterion written at purchase is hit.
  - Another candidate offers at least 15 points more margin of safety.
  - Never because the price fell.
- **Memory.** One entity per company. Its observations hold the value range with its date, the moat verdict and the kill criteria. Relations: `competes_with`, `supplies`, `held_by`.

#### 4.4.2 George: global macro with trend confirmation

This joins Soros-style reflexivity (find the imbalance, size up when it proves right) with time-series momentum, the core of managed-futures funds. Long-only, so it trades through ETFs.

- **Universe.**
  - Equity indices: SPY, QQQ, IWM, EFA, EEM.
  - The 11 sector SPDRs.
  - Rates: TLT, IEF, SHY. Credit: HYG, LQD.
  - Dollar UUP, gold GLD, oil USO.
  - SH (inverse S&P) only as a hedge, held 5 days or less.
- **Macro dashboard** (a deterministic tool). It places the market in a growth × inflation quadrant (Goldilocks, Reflation, Stagflation, Deflation) using market proxies:
  - credit: HYG/IEF trend
  - dollar: UUP trend
  - breakevens: TIP/IEF
  - growth vs safety: copper/gold
  - curve shape: SHY/IEF
- **Events.** The Researcher compares expected with actual results for FOMC, CPI and payrolls, because the surprise is what moves prices.
- **Entry.**
  - A macro thesis needs trend confirmation: 12-1 month momentum above zero and price above its 100-day average.
  - A contrarian entry is allowed only at extremes: RSI(14) below 25, plus a volatility spike, plus a named catalyst.
- **Sizing.**
  - Risk 1% of equity per idea at an ATR-based stop of 2 ATR.
  - Add 50% after a move of +1 ATR in his favour (reflexivity: press winners).
  - At most 5 themes at once. Gross exposure at most 100%.
- **Memory.** One entity per macro theme ("Fed cutting cycle", "dollar weakness"). Observations hold the evidence. Each theme links to ETFs via `expressed_via`, and its status and P&L update when it closes.

#### 4.4.3 Jim, the regime quant (the fifth trader)

Jim is named in homage to Jim Simons, following the floor's convention (§19.6). If personas are renamed, his archetype is "Regime quant".

His colour is peacock teal: `--t-jim: #00798c` in light mode (4.8:1 on the surface) and `#22d3c5` in dark mode (9.7:1). The hue sits between the positive green and Ray's blue, so neither is confused with it.

**The financial idea.** Markets switch between regimes, and which strategies pay depends on the regime:

- Trend and momentum pay in calm, trending markets, then crash at reversals.
- Short-term mean reversion pays in choppy, range-bound markets.
- Low-volatility and quality defend in corrections.
- Cash, short Treasuries and gold carry a portfolio through stress.

Jim does not try to predict prices. His edge has three parts:

1. Knowing which regime the market is in, measured.
2. Knowing which signals have paid in each regime, measured on this year's data and checked against ten years.
3. Sizing by volatility, so no single regime change can blow him up.

**Learning the year: the Market Year pipeline.** Deterministic Python that runs once a day after the close.

1. **Data.** Daily adjusted bars from 2026-01-02 to today, plus 2016–2025 as a longer prior. Symbols: SPY, QQQ, IWM, the 11 sector SPDRs, TLT, IEF, SHY, HYG, LQD, UUP, GLD, USO, VIXY (as a volatility proxy) and the 20 largest S&P 500 names. Cached in a `bars` table.
2. **Daily features.**
   - 20- and 60-day realized volatility, and its percentile against ten years.
   - SPY against its 50- and 200-day averages, and the 200-day slope.
   - Drawdown from the 52-week high.
   - Breadth: the share of sectors above their 50-day average.
   - Average 60-day correlation between sectors (when it is high, the market is risk-off).
   - The trends in credit (HYG/IEF), the dollar and rates.
3. **Two regime models, shown side by side.**
   - *Rules* (transparent): trend × volatility gives four regimes. Calm bull, Volatile bull, Calm chop, Stress.
   - *Learned*: a 3–4 state Gaussian HMM on return, log volatility, credit and breadth. It is fitted on 2016–2025 and run **forward-filtered** on 2026: each day's label uses only data up to that day.
4. **Episodes.** Runs of one regime, with hysteresis (at least 5 days). These are the year's risk-on and risk-off swings. Each episode records its dates, SPY return, maximum drawdown, volatility, and the sectors that led and lagged.
5. **Signal scoreboard.** A fixed, pre-registered menu of eight well-known signals, scored per regime on return, hit rate and Sharpe:
   - 12-1 cross-sectional momentum (top 3 sectors)
   - time-series trend (price above its 200-day average)
   - short-term mean reversion (RSI(2) below 10, Connors-style)
   - low volatility (lowest-volatility third)
   - post-earnings drift (positive surprise and gap up, hold 20 days)
   - 55-day breakout (Turtle rule)
   - defensive rotation (XLU, XLP, TLT, GLD)
   - buy and hold

   Scores are computed for the year to date and for ten years. Ten years is the prior; this year updates it with weight n_ytd / (n_ytd + k).
6. **Memory.** The pipeline writes into Jim's memory graph:
   - entities: regime episodes, signals, sectors, events
   - relations: `followed_by`, `led_by`, `signal_worked_in`, `signal_failed_in`, `triggered_by`

   An event comes from the Researcher's news on the transition dates. This gives the floor its richest graph: the year as a chain of regimes.

**Jim's agent team.** Each member appears as nested spans in the Decisions view, so no new tracing is needed.

- **Researcher** (existing). Asked only what the numbers cannot answer: why did the market flip on that date, and what is scheduled this week?
- **Quant** (new; a deterministic MCP server `quant_server.py`, no LLM):
  - `regime_now()`
  - `regime_history(from, to)`
  - `signal_scoreboard(regime)`
  - `signal_scan(signal)`: today's candidates
  - `portfolio_risk(weights)`: volatility, beta to SPY, correlation, 95% CVaR, historical worst drawdown
  - `size_positions(target_weights, target_vol)`: quantities

  Warren and George use the same server for their screens and dashboard.
- **Synthesizer** (new; an LLM sub-agent through `Agent.as_tool`, returning a structured `TradeThesis`). It takes the research report, the Quant's outputs and the lessons Jim recalls. It returns:
  - the regime and its confidence
  - the signals for and against
  - each conflict between story and numbers, and which side wins and why (for example, "news is bullish, but breadth is collapsing and correlation is spiking")
  - target weights
  - what would invalidate the thesis
  - the holding horizon

  Every claim must cite a tool call or a source. Claims without one are flagged in the UI (groundedness).
- **Risk limits** (deterministic):
  - 12% annualized volatility target
  - at most 25% per ETF and 10% per stock
  - at most 3 regime-driven switches a month
  - halve exposure at −8% from peak; move to SHY or cash at −12%

**Jim's cycle.**

1. Call `regime_now`.
2. On a regime change or the weekly rebalance, read the scoreboard and scan the signals that work in this regime.
3. Ask the Researcher for catalysts only.
4. The Synthesizer writes the thesis.
5. `size_positions` turns it into quantities.
6. Trade only positions more than 2% away from target.
7. Write the thesis and its regime to memory.

Cycles in between check only stops and the drawdown brake.

**Baselines Jim must beat.** If Jim does not beat these, the LLM layer adds nothing:

- SPY buy and hold
- 60/40 SPY/IEF
- the 200-day timing rule on SPY (Faber)
- volatility-targeted SPY
- the rules regime model with the same scoreboard, run mechanically with no LLM (E12)

#### 4.4.4 Complications to handle when implementing

| Complication | Why it bites | How we handle it |
|---|---|---|
| **Look-ahead bias** | "Learn the whole year, then trade it" is the classic backtest lie. Smoothed HMM labels, a scoreboard built on the full year, and today's index members all leak the future. | Compute everything as of date *t* (`as_of` parameter everywhere). Use a forward-filtered HMM only. Use a point-in-time universe. Run the masked-ticker look-ahead check (§10). |
| **Tiny sample** | One year is about 210 trading days and perhaps 3–6 regime episodes. Per-regime signal statistics rest on a handful of them. | Use the ten-year prior with shrinkage. Show n and confidence intervals on every score. Keep the signal menu pre-registered (no searching for winners). Use a deflated Sharpe ratio if the menu ever grows. |
| **Regime lag and whipsaw** | Every detector confirms late. Flip-flopping near a boundary pays costs both ways. | Hysteresis and a minimum dwell time. A turnover budget. Scale exposure with regime probability instead of all-in switches. |
| **Data access** | The Massive plan tier may not include ten years of daily bars or fundamentals (Warren's screen needs them). Rate limits, split and dividend adjustment, and VIX itself is not tradable. | Backfill once into `bars`, using adjusted closes. Use VIXY as the volatility proxy. Fall back to Alpaca historical (IEX) (§19.4). **Never** fall back to the simulator (D1 must be fixed first). If fundamentals are missing, Warren's screen says so in the UI instead of guessing. |
| **Long-only** | There are no shorts in V2 (§12), so risk-off means cash, SHY/TLT, GLD and defensive sectors. Leveraged and inverse ETFs decay. | Exclude leveraged ETFs. Allow SH as a hedge only, held 5 days or less. |
| **Local model limits** | qwen2.5-coder 32B has about 32k of context, and its tool calls are unreliable (needs the `local_llm.py` fix-up). Three sub-agents add minutes to every cycle. | Tools return compact tables (≤ 30 rows). `TradeThesis` is structured output. Call the Synthesizer only on a regime change or the weekly rebalance. Try qwen3:32b for the Synthesizer (E6). |
| **Correlated traders** | Jim, George and Ray all hold ETFs and react to the same regime, so the desk can become one big bet. | A correlation panel for trader returns on the Money view, and a desk-level exposure panel. |
| **Cadence mismatch** | The floor runs every few minutes; Jim's model uses daily bars. | The pipeline runs once a day. Intraday cycles only check stops and the drawdown brake. |
| **Judging honestly** | A regime trader looks brilliant on the year it was designed on. | Freeze Jim's rules and signal menu on a set date. Judge only on days after the freeze (live, then Phase 8's held-out episodes). Always against all five baselines. |
| **Memory bloat** | A daily regime write would create thousands of observations. | Write episodes and transitions only. Deduplicate. At most one scoreboard observation per signal, per regime, per week. |
| **Playbook data and drift** | Playbooks are useless if the model ignores them or rewrites them. | Turn `change_strategy` off for playbook traders. Measure rule adherence per trade (E14). |
| **Plumbing** | A fifth trader touches every place that assumes four. | Places to update: `names` / `lastnames` / `model_names` in `trading_floor.py`, `reset.py`, `traders.ts`, `PERSONA` in `lab.ts`, the Shell logo bars, `--t-jim` in both themes, `mcp_servers.py` (quant server), `runs.py` (Synthesizer spans; Quant calls as market calls). New tables: `bars` and `regimes`. They hold market data, not traces. |

---

## 5. Evaluation harness

> **Component card**
> - **Why it exists:** without measurement, every design discussion is opinion.
> - **Problem solved:** "is configuration B better than A?" gets answered with numbers, confidence intervals and cost.
> - **What it teaches:** evaluation methodology for nondeterministic systems, statistics over repeated trials, grader design, LLM-as-judge calibration.
> - **How we know it works:** a known-bad config (no researcher on a news scenario; a prompt that encourages over-trading) scores measurably worse. Rerunning the same config gives overlapping CIs. Graders agree with a hand-labeled set (κ ≥ 0.6).
> - **Dependencies:** normalized traces (§6), deterministic environment (episodes + research cassettes), agent configs.
> - **Complexity / risk:** Medium-high. The main risk is graders that reward the wrong thing. Mitigation: start with deterministic trace-based graders and add judges only where needed.

### 5.1 Architecture

```text
ScenarioSpec (YAML, versioned)  ─┐
AgentConfig (YAML, hashed)      ─┼─► Harness ─► N trials × (scenario × config) ─► AgentAdapter.run()
ExperimentSpec (arms, k, seed)  ─┘                    │                                │
                                                     ▼                                ▼
                                             Environment (sim/replay/faults)   normalized events
                                                                                      │
                                    Graders (deterministic → assertion → LLM-judge) ◄─┘
                                                      │
                                     Metrics + stats (bootstrap CI, paired tests) → report.md / UI
```

**Framework independence.** The harness depends only on:

```python
class AgentAdapter(Protocol):
    name: str
    def describe(self) -> AgentManifest: ...            # prompt hashes, model, tools, policies
    async def run(self, task: TaskInput, env: EnvHandle, budget: Budget) -> RunResult: ...
```

Graders read the saved SDK spans through a small per-framework reader (a few dozen lines each, mapping "model call", "tool call" and "usage" fields), plus our financial tables. A second adapter (`PlainLoopAdapter`, a hand-written chat-completions tool loop) is the proof that the harness is framework-independent.

### 5.2 Scenario specification

```yaml
id: news-earnings-miss-held-position
version: 3
task: rebalance                         # trade | rebalance
clock: { start: "2025-08-06T14:30:00Z", step: none }
market: { source: episode, dataset: eq-2025q3@sha256:…, universe: [ACME, SPY, QQQ] }
ticker_masking: true                    # ACME is a synthetic alias, which blocks pretraining look-ahead
portfolio: { cash: 4000, positions: { ACME: 60 } }
research: { mode: frozen_corpus, corpus: corpora/acme-miss@v2 }
faults: []
expectations:
  must_call_any: [research, quote]
  must_not: [trade_outside_universe, exceed_position_limit]
  acceptable_actions: [{ sell: ACME, min_qty: 10 }, { hold: ACME, requires_rationale_citing: [ev:acme-guidance-cut] }]
  max_turns: 20
graders: [task_completion, tool_args, groundedness, policy_compliance, action_acceptability, efficiency]
```

**Scenario families (first suite: about 25 scenarios):**

| Family | Example | What it isolates |
|---|---|---|
| Evidence-driven | earnings miss on a held name; positive guidance on a watchlist name | research use, groundedness |
| No-op | quiet market with no news | over-trading / churn; does the agent hold when it should? |
| Constraint | insufficient cash; position over the concentration limit; symbol outside the universe | sizing, rule compliance, argument correctness |
| Strategy adherence | the same evidence shown to 4 strategies | persona sensitivity (E3) |
| Conflicting evidence | two sources that disagree | calibration, uncertainty in the rationale |
| Fault | everything in §7 | reliability |
| Long-horizon | 10-step episode | consistency, drift, memory |

**Fair grading of nondeterministic decisions.** A scenario defines a **set of acceptable actions** with required justification, never a single "correct" trade. Grades are pass / partial / fail, with reasons.

### 5.3 Metrics catalogue

| Category | Metric | How computed | Grader type |
|---|---|---|---|
| Task | completion | final output present, required steps done, no uncaught error | deterministic |
| Task | turns used, max-turns hits | count turn spans | deterministic |
| Tools | selection precision / recall | tools called vs expected and forbidden sets | deterministic |
| Tools | argument validity | schema-valid, symbol in universe, quantity > 0, notional ≤ cash | deterministic |
| Tools | unnecessary calls | duplicate (tool, canonical args) within a run; calls whose output is never referenced afterwards | deterministic |
| Tools | loop rate | repeated n-gram of (tool, args) ≥ 3 | deterministic |
| Tools | recovered tool calls | `local_llm` recovery hook firings (instrumented) | deterministic |
| Research | relevance | does the report address the trader's request and the tickers at stake? | LLM-judge (calibrated) |
| Research | groundedness | share of claims in the report and rationale that point to an evidence item actually retrieved in this trace | deterministic linkage + judge for paraphrase |
| Research | researcher usefulness | change in decision-quality score between E1 arms on the same scenario (paired) | statistical |
| Decision | acceptability | action ∈ acceptable set | assertion |
| Decision | consistency | agreement rate of the action class across k reruns (same inputs) | statistical |
| Decision | strategy adherence | rationale vs strategy rubric | LLM-judge |
| Risk | violation attempts / violations executed | `RiskGate` rejections vs fills that broke a rule (must be 0) | deterministic |
| Efficiency | latency p50/p95 (cycle, trader, tool, model) | span timings | deterministic |
| Efficiency | tokens in/out, $-equivalent | generation-span usage × price table (local model: GPU-seconds + hosted-equivalent price) | deterministic |
| Reliability | fault outcome class | §7.3 taxonomy | assertion |
| Outcome | risk-adjusted return vs baselines (Sharpe, max drawdown), turnover, costs paid | simulator / broker ledger | deterministic; aggregated over many episodes (see below) |

**P&L is the long-term target, measured carefully.** Over a single short episode it is mostly noise, so it is never read from one run. It is reported as risk-adjusted return (Sharpe, max drawdown, return vs each baseline) aggregated over many episodes with confidence intervals. An agent design "earns reliable profit" only when that interval stays above the baselines in simulation *and* the edge holds in paper trading.

### 5.4 Statistical protocol

- At least k = 5 trials per (scenario, arm). The model temperature is pinned and recorded. Seeds are recorded for everything else.
- Arms are compared **paired** on the same scenarios. Report the mean difference with a 95% bootstrap CI and a sign test or Wilcoxon test.
- **Pre-register** each experiment in its `ExperimentSpec` (hypothesis, primary metric, decision rule) before running it, so there is no metric shopping afterwards.
- **LLM-judge hygiene:** the judge model and its prompt are pinned and versioned. Calibrate against about 50 hand-labeled items, report agreement, and re-check on every judge change. The judge never sees which arm produced the output.
- Report cost (tokens, wall-clock) next to quality for every arm. The output is a **cost/quality frontier** plot, not a single leaderboard.

---

## 6. Traces, replay and observability

**Principle: reuse the framework's traces, build only the money side.** The OpenAI Agents SDK already records every agent run as a span tree: model calls with inputs, outputs and token usage, tool calls with arguments and results, MCP tool listings, timing and errors. Google ADK does the same through OpenTelemetry if it is adopted later. We do **not** write a new tracing system. We keep those spans as the frameworks export them, tag them with a few IDs, and add the financial records the frameworks know nothing about: decisions, orders, fills, portfolio value and research evidence.

> **Component card**
> - **Why it exists:** today's log line "Started function buy_shares" cannot answer *why* anything happened, or what it did to the money.
> - **Problem solved:** from any trade you can go back to the research and tool calls behind it, and forward to its fill and its effect on the portfolio.
> - **What it teaches:** using framework tracing well (group IDs, metadata, custom processors), linking agent traces to business data, record/replay.
> - **How we know it works:** 100% of orders link back to a decision, a trace and evidence. Any recorded run can be replayed in deterministic mode with identical results (golden test). Every span has an end, or an explicit `abandoned` status written by a watchdog, which closes the gap shown by the 4 unfinished researcher calls in §1.3.
> - **Dependencies:** run/cycle IDs, the bound MCP spawn env, the `Clock` port.
> - **Complexity / risk:** Low-medium, because the span capture is already done by the SDK. Main risk: leaking secrets into stored payloads (redaction is required).

### 6.1 Linking traces to trades

```text
run_id ─► cycle_id ─► SDK trace_id (one per trader per cycle) ─► SDK spans (unchanged)
                          └─► decision_id ─► order_id (= broker client_order_id) ─► fill ─► portfolio snapshot
```

- Use what the SDK already offers: `trace(..., group_id=cycle_id, metadata={run_id, trader, mode, config_hash})`. This replaces the "name encoded in the trace ID" hack in [tracers.py](../server/tracers.py), and `group_id` makes the OpenAI trace UI show the four traders of one cycle together.
- MCP subprocesses receive `LAB_RUN_ID` / `LAB_CYCLE_ID` / `LAB_TRACE_ID` in their spawn env, so every order and fill they record carries the trace it came from.

### 6.2 What we store

| Record | Source | Built by us? |
|---|---|---|
| Spans (model calls, tool calls, MCP listings, timing, usage, errors) | SDK `span.export()` through a `TracingProcessor` that replaces `LogTracer` and simply saves the export as JSON | **No.** Stored as-is |
| Research evidence: queries, sources, snippets, which trader asked | Researcher tool calls (already in the spans), plus a structured `ResearchReport` the researcher returns | Thin layer |
| `Decision`: action, evidence used, tools used, risk state, portfolio before. **No chain-of-thought.** | Trader output | Yes |
| `OrderEvent`, `Fill`: state, price, fees, slippage vs the decision quote | Broker | Yes |
| `PortfolioSnapshot`: cash, positions, value, P&L, before and after each decision plus periodic mark-to-market (fixes D5) | Ledger | Yes |
| `MarketContext`: quotes used, quote age, source, `synthetic` flag | `MarketData` | Yes |
| `Lesson`: a post-trade review of what worked or failed and why, linked to the trades | Review step after each cycle (§11.4) | Yes |
| Memory graph: entities, relations, observations | Already stored by `mcp-memory-libsql` in `memory/<name>.db` | **No.** Read directly |

Writes go through a small async queue so storage never slows an agent. API keys and tokens are scrubbed before anything is saved.

### 6.3 Replay: three levels

| Level | What is frozen | What runs live | Use |
|---|---|---|---|
| **R1 Re-score** | the whole stored trace | nothing; graders run again | metric definitions changed |
| **R2 Deterministic replay** | market, clock, tool responses *and model responses* | orchestrator, gateway, broker, ledger | demo mode with no LLM, debugging a past run step by step |
| **R3 Counterfactual replay** | market, clock, research corpus, initial portfolio, faults | **new** model / prompt / strategy / framework | the main experiment mode: "rerun Tuesday's cycle with model X" |

**Tool cassettes.** Each response is keyed by `(tool, canonical_args, sequence)`. In R3 the new agent will ask *different* research questions, so exact-key cassettes miss. The policy for misses is:

1. **Frozen research corpus (recommended default).** Live Tavily results and fetched pages from the original run, plus curated scenario documents, are indexed into a local BM25 corpus. In R3 the researcher's search and fetch tools query this corpus. The agent's behavior varies, but the information it can reach is fixed.
2. *Fail closed*: return "no results" and flag `evidence_unavailable`.
3. *Live fallback*: allowed, but it marks the run `contaminated=true` and excludes it from comparisons.

**Look-ahead contamination (important for credibility).** On historical episodes the LLM may already *know* what happened, for example NVDA in 2024. Mitigations: ticker masking with synthetic aliases in evaluation scenarios; preferring episodes after the model's knowledge cutoff; a "date-masked" prompt variant; and reporting masked and unmasked results side by side so the leakage effect itself is measured.

### 6.4 Where traces are viewed

Detailed span debugging (one run's model and tool calls) can stay in the OpenAI trace viewer, or in any OpenTelemetry viewer if ADK is adopted. Our own UI does not try to be a generic trace viewer. It shows the trace *next to the money*: the research, the decision, the order, the fill and the portfolio change on one screen (§11). See §13 for the full split.

### 6.5 Experiment manifest (every run writes one)

```text
scenario_id@version   agent_config_hash   prompt_hashes{trader,researcher,task}   strategy_version
model_id + Ollama model digest + temperature   tool servers + pinned versions   tool_filter
sim_config_hash (fill model, fees, slippage)   dataset id + sha256   seed   clock mode
git commit + dirty flag   uv.lock hash   harness version   judge model + prompt hash
```

---

## 7. Failure injection

> **Component card**
> - **Why it exists:** the current system's failures are silent (D1, D2, D13). The goal is not to hide failures, but to make them *observable, reproducible, classifiable* and, where appropriate, *recoverable*.
> - **Problem solved:** "what happens when X breaks?" becomes a test with a recorded expected outcome.
> - **What it teaches:** chaos engineering applied to agents, error taxonomies, idempotency, circuit breakers, safety-first defaults.
> - **How we know it works:** each fault scenario has an expected outcome class. The suite runs from the Failure Lab using R2 replay with no LLM.
> - **Dependencies:** Tool Gateway interception, `ModelClient` wrapper, `Broker` port, normalized events.
> - **Complexity / risk:** Medium. The interception points already exist: `local_llm.py` already wraps `create`, and every tool goes through MCP.

### 7.1 Injection points

| Layer | Hook | Faults |
|---|---|---|
| Model | `ModelClient` wrapper (generalizes the existing monkey-patch in `local_llm.py`) | timeout, 5xx, malformed or truncated JSON tool call, empty response, tool call to a non-existent tool |
| MCP / tools | `FaultyMCPServer` wrapper around `MCPServerStdio` (`call_tool`/`list_tools`) | server unavailable at startup, crash mid-run, latency, malformed result, error result, schema drift |
| Research | `ResearchSource` | timeout, empty results, partial results, contradictory documents, rate limit |
| Market data | `MarketData` | unavailable, stale quote (age > threshold), missing symbol, price spike / bad tick, market closes mid-cycle |
| Broker | `Broker` | reject (insufficient buying power, halted symbol), partial fill, delayed ack, duplicate submit, connection drop after submit (unknown order state) |
| Storage | ledger repository | `database is locked`, write failure mid-transaction |
| Orchestration | scheduler | one trader task raises or hangs while the others continue; the engine restarts mid-cycle |
| Agent behavior | (detected, not injected) | repeated identical tool calls, max-turns exhaustion, runaway token use |

**Fault spec:** `{id, target, trigger: {nth_call | probability+seed | at_time}, effect, expected_outcome}`. Faults are deterministic given the seed, so every failure can be reproduced.

### 7.2 Deterministic recovery mechanisms (built alongside the faults)

- **Idempotent orders:** `client_order_id = hash(run_id, decision_id, leg)`. The broker deduplicates, which makes duplicate-order bugs impossible by construction in both sim and Alpaca.
- **Order state machine** with an `unknown` state, resolved by a reconciliation query instead of a blind retry.
- Per-tool timeouts. Retries with exponential backoff and jitter **only for idempotent reads**.
- A **circuit breaker** per MCP server and data source. When open, the tool returns a structured `service_unavailable` the agent can reason about.
- **Staleness guard:** quotes carry `as_of`. `RiskGate` rejects orders priced on quotes older than N seconds, or on data marked `synthetic` in a non-synthetic run (fixes D1).
- The market clock **fails closed** in paper/live mode (fixes D2).
- **Loop detector:** the same (tool, args) 3 times triggers a structured warning to the agent. The 5th time aborts the run with `LOOP_ABORT`.
- **Budgets:** max turns, max tokens, max wall-clock per trader per cycle. A watchdog marks hung spans `abandoned`.
- **Isolation:** one trader failing never affects the others. Trade/rebalance mode only advances on success, and is persisted (fixes D13).

### 7.3 Outcome taxonomy

| Class | Meaning | Acceptable? |
|---|---|---|
| `RECOVERED` | fault handled transparently (retry or fallback), task completed | ✅ |
| `DEGRADED_OK` | completed with less information, *and the degradation is stated in the decision* | ✅ |
| `SAFE_ABORT` | stopped without side effects, with a clear error recorded | ✅ |
| `NOOP_CORRECT` | correctly decided not to act (e.g. the market closed) | ✅ |
| `SILENT_DEGRADATION` | completed on bad inputs without noticing (today's D1 behavior) | ❌ |
| `UNSAFE_ACTION` | an order violated a rule or duplicated an earlier order | ❌ (must be 0) |
| `CRASH` | uncontained exception, lost state, or orphaned spans | ❌ |

**Baseline expectation for the current code** (to be confirmed by the first suite run): market API down → `SILENT_DEGRADATION`. Duplicate order → `UNSAFE_ACTION`. Researcher timeout → `CRASH`-ish, swallowed and printed. That "before" table, next to the V2 "after" table, is one of the strongest artifacts this project can produce.

---

## 8. C++ simulation core

> **Component card**
> - **Why it exists:** a deterministic, fast, bit-reproducible execution and accounting kernel that runs **large baseline sweeps, Monte Carlo robustness tests and fill-model calibration**.
> - **Problem solved:** the agent experiments are LLM-bound (seconds per call), so C++ will **not** speed them up. Honestly stated. What C++ does speed up is running thousands of deterministic-baseline episodes and bootstrap resamples over long minute-bar datasets. Those give the agent results their statistical context.
> - **What it teaches:** C++20 API design, deterministic numerics, fixed-point accounting, pybind11 bindings, CMake/scikit-build-core packaging, sanitizers, cross-language parity testing, benchmarking methodology.
> - **How we know it works:** (1) parity: identical event streams, fills and ledgers to the Python reference on 10k+ property-based random order streams and on all golden episodes, compared exactly on integer micro-dollars; (2) benchmark: ≥ 10× episode throughput over the *optimized* Python reference on the sweep workload. If Python + NumPy gets within 3×, document the result and keep Python as the default engine.
> - **Dependencies:** a stable Python reference simulator and its golden tests (Phase 4), frozen datasets.
> - **Complexity / risk:** High. Risks: parity drift, toolchain and packaging friction on macOS, building C++ for show. Mitigation: a deliberately tiny scope.

### 8.1 Scope: the smallest component where C++ adds real value

**In the C++ core:**

- Event-driven replay loop over bar/quote events (`int64` ns timestamps, `int64` micro-dollar prices)
- Order types: market, limit (day). Time-in-force: day.
- Fill model: next-event fill (no look-ahead), bid/ask from quote or `close ± spread/2`, configurable slippage (fixed bps, or volume-participation impact `k·σ·√(q/ADV)`), partial fills by max participation rate
- Fees (per share / per notional / min fee)
- Ledger: cash, positions, average cost, realized and unrealized P&L, exact mark-to-market
- Pre-trade risk checks: universe, cash, max position %, max order notional, max orders per step
- Deterministic PRNG: **our own SplitMix64/PCG32, implemented identically in Python and C++**. `std::normal_distribution` and friends are implementation-defined and differ across standard libraries, so they would break parity.

**Stays in Python:** agent orchestration, tools, MCP, data loading (Parquet → Arrow buffers handed over zero-copy), metrics/reporting, Alpaca.

### 8.2 API boundary

```cpp
// sim/include/lab/engine.hpp  (sketch)
struct SimConfig { FeeModel fees; SlippageModel slippage; RiskLimits risk; uint64_t seed; };
class Engine {
 public:
  explicit Engine(SimConfig cfg, Portfolio initial);
  void load_events(std::span<const MarketEvent> events);   // zero-copy from Arrow via pybind11 buffer protocol
  OrderAck submit(const OrderRequest& req);                 // risk-checked, idempotent on client_order_id
  StepResult step_until(int64_t ts_ns);                     // advance clock, produce fills
  PortfolioView portfolio() const;  std::vector<Fill> drain_fills();
};
```

```python
class SimBroker(Broker):            # one Python interface, two engines
    def __init__(self, cfg, engine: Literal["py", "cpp"] = "py"): ...
```

**Binding choice:** pybind11, as requested. Nanobind (smaller, faster to compile) is the alternative, see §19. Build with CMake + scikit-build-core so `uv sync` builds the extension. C++20, `-Wall -Wextra -Werror`, ASan/UBSan builds, clang-tidy, GoogleTest for native unit tests, Google Benchmark for microbenchmarks.

### 8.3 Benchmark methodology

- Workloads: (W1) one agent episode, which we expect to show no meaningful difference; (W2) 1,000 baseline-strategy episodes × 1 year of minute bars × 50 symbols; (W3) 10k bootstrap resamples of a recorded agent episode.
- Report median and p95 over ≥ 10 runs, warm cache, pinned CPU governor where possible, with hardware and compiler flags recorded in the manifest.
- Compare against three references: naive Python, optimized Python (NumPy-vectorized ledger), and C++.

---

## 9. Alpaca paper-trading migration

> **Component card**
> - **Why it exists:** real brokerage semantics: order lifecycle, rejections, partial fills, latency, market clock, buying power.
> - **Problem solved:** today "execution" is `price × 1.002` written to a JSON blob. Alpaca paper turns the same decision into an order on a real API, and makes simulated vs paper execution comparable.
> - **What it teaches:** brokerage APIs, async order-state reconciliation, idempotency against a remote system, websockets, credential handling.
> - **How we know it works:** reconciliation passes (local ledger ≡ Alpaca positions/cash after every cycle). The sim-vs-paper comparison report exists for N ≥ 30 orders.
> - **Dependencies:** `Broker` port, order state machine, `RiskGate`, normalized events.
> - **Complexity / risk:** Medium. Risks: market-hours-only testing, account sharing between traders (see below), API limits. Note that Alpaca *paper* fills are themselves simulated by Alpaca against quotes. They are realistic, but they are not real execution, and the docs will say so.

### 9.1 Responsibilities by provider

| Capability | Massive (today) | Alpaca | V2 owner |
|---|---|---|---|
| Live quotes / last trade | ✅ (tiered by plan) | ✅ (free tier: IEX feed only; SIP is paid) | `MarketData`: Massive by default, Alpaca as an option |
| Fundamentals, news, reference data, rich endpoints via MCP | ✅ (`mcp_massive`) | limited (news API) | **Massive stays** as the research-side data source |
| Historical bars for episodes | ✅ (aggregates, plan-dependent) | ✅ | Decided by plan limits, see §19 |
| Market clock / calendar | ✅ (status) | ✅ (`/clock`, `/calendar`) | Alpaca in paper mode, Massive or `SimClock` otherwise |
| Orders, positions, buying power, fills | ❌ (we simulate) | ✅ paper | `Broker`: `SimBroker` or `AlpacaPaperBroker` |

**Conclusion:** they coexist. Massive is the research and market-data source. Alpaca is the broker (and clock in paper mode). Both sit behind ports, and the agent's tools do not change between modes.

### 9.2 Broker abstraction

```text
Decision ─► RiskGate ─► Broker.submit(OrderRequest{client_order_id, symbol, side, qty, type, limit?, tif})
                          ├─ SimBroker      (Python ref | C++ core)  → deterministic fills
                          └─ AlpacaPaperBroker                       → REST submit + trade_updates websocket
                                    ▼
                          OrderEvent stream (same state machine) ─► Ledger ─► PortfolioSnapshot
```

- **Shadow mode** (the key experiment): every decision is sent to Alpaca paper **and** to the SimBroker with the same quote snapshot. Compare fill price, latency, rejections, slippage vs decision quote, and the resulting portfolio. This calibrates the simulator's fill model against something external.
- **Four traders, one brokerage reality.** One Alpaca paper account is one portfolio. The options are (a) separate paper accounts per trader, each with its own key pair, if the account limits allow it, or (b) one paper account plus local **sub-ledgers**, with orders attributed by `client_order_id` prefix and a reconciliation invariant `Σ sub-ledger positions == Alpaca positions`. (b) is the more interesting engineering problem, but traders then share buying power. Decision in §19.

### 9.3 Configuration (not implemented yet)

```dotenv
LAB_BROKER=sim                      # sim | alpaca_paper | shadow
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
ALPACA_BASE_URL=https://paper-api.alpaca.markets   # never default to the live URL; refuse to start if it is not "paper"
ALPACA_DATA_FEED=iex                # iex (free) | sip (paid)
ALPACA_ACCOUNT_MODE=subledger       # subledger | per_trader  (per_trader → ALPACA_<TRADER>_KEY_ID/SECRET)
```

Configuration moves to a typed `pydantic-settings` object that is validated at startup and fails fast. The "live trading URL" guard is a hard check.

---

## 10. Backtesting and historical experiments

> **Component card**
> - **Why it exists:** live forward runs cannot be repeated. Agent evaluation needs the *same* market episode for every arm.
> - **Problem solved:** deterministic episodes with a frozen market, frozen research, a fixed initial portfolio and costs, so E1–E10 are fair comparisons.
> - **What it teaches:** event-driven simulation, look-ahead bias, dataset versioning, benchmarking against baselines.
> - **How we know it works:** the same episode + config + seed + recorded model responses produces a byte-identical ledger. Deterministic baselines reproduce known results (e.g. buy-and-hold SPY matches the index return within fee tolerance).
> - **Dependencies:** `Clock` + `MarketData` ports, Python reference simulator, dataset tooling.
> - **Complexity / risk:** Medium. The real constraint is **LLM compute**: a 1-year daily backtest for 4 traders is about 1,000 trader-turns at 1–3 minutes each on a local 32B model, which is days of compute. So agent episodes are **short and chosen on purpose** (5–20 decision points around events), while long horizons are reserved for deterministic baselines.

### 10.1 Episode definition

```yaml
episode: earnings-season-2025q3-week2@v1
dataset: eq-bars-1m@sha256:…          # Parquet + manifest (source, plan tier, symbols, range, checksum)
universe: [SPY, QQQ, TLT, GLD, AAPL, NVDA, …]
decision_points: daily@15:30ET        # or explicit timestamps around events
fill: next_bar_open                    # decision at t never fills at t's price
costs: { spread: quote|bps:10, slippage: bps:5, fee_per_share: 0 }
initial_portfolio: { cash: 10000 }
research: frozen_corpus@acme-…        # documents timestamped ≤ each decision point (no future news)
```

### 10.2 Baselines (every agent is reported against these)

| Baseline | Why |
|---|---|
| Cash (do nothing) | Shows whether the agent adds anything at all |
| Buy-and-hold SPY | The market |
| Equal-weight universe, rebalanced monthly | Naive diversification |
| 60/40 SPY/TLT | Natural benchmark for Ray's risk-parity persona |
| Simple 12-1 momentum | A transparent systematic rule |
| **Random valid agent** (seeded) | Shows whether the LLM beats noise with the same action space and constraints |

### 10.3 Flagship experiment layout

```text
same episode (frozen market + frozen research + same initial portfolio)
├── Trader alone                         (E1a)
├── Trader + researcher on demand        (E1b, today)
├── Trader + forced research             (E1c)
├── Trader + cached research             (E1d)
├── Other strategy prompts               (E3)
├── Other model (7B / 14B / 32B / hosted)(E6)
├── Proposal + deterministic executor    (E7b)
└── Deterministic baselines + random agent
→ outcome metrics + AI-engineering metrics + cost, k trials each, paired CIs
```

---

## 11. Independent V2 UI

> **Component card**
> - **Why it exists:** the current dashboard shows four balances and a log of span names. It should show where the money is, why it moved, what the researcher found, and what the agents have learned.
> - **Problem solved:** understanding and improving the traders without reading SQLite or raw traces by hand.
> - **What it teaches:** financial data visualization, information design, streaming UIs (SSE), graph visualization, typed API contracts.
> - **How we know it works:** a newcomer can answer "why did Warren sell NVDA in cycle 41, and did it make money?" in under a minute, starting from the trade. The demo scenario plays end-to-end in ≤ 5 minutes.
> - **Dependencies:** `/api/v2`, the financial tables (§6.2), the SDK spans, the memory databases, the harness's reports.
> - **Complexity / risk:** Medium. Risk: building UI before the data model is stable. Mitigation: the Money and Trades views ship first (Phase 1), Researcher and Decisions next (Phase 2), the rest as their data appears.

### 11.1 Stack

- **React + TypeScript + Vite** (keep Vite and uPlot for time series). TanStack Query for server state, React Router for views, a generated typed client from FastAPI's OpenAPI schema. The current vanilla-TS panel classes do not scale to many cross-linked views.
- A graph library for the memory view (Cytoscape.js or a force-directed D3 layout).
- **SSE** stream (`/api/v2/stream`) for live events instead of 2 s / 6 s polling.
- The API reads only stored data and **never** calls live market data on a read path (fixes D15).

### 11.2 Views

| View | Main question it answers | Key elements |
|---|---|---|
| **Money** (home) | Where is the money and how is it doing? | Total and per-trader equity curves vs SPY and the other baselines; P&L today / week / all-time (realized and unrealized); drawdown chart; cash vs invested; allocation by position and sector; fees and slippage paid; return-vs-risk scatter (one dot per trader) |
| **Positions & Trades** | What do we hold and what did each trade earn? | Holdings with cost basis, current value, unrealized P&L, weight; trade blotter with entry/exit, holding period, realized P&L per trade, win rate, average win vs average loss; trade markers on the price chart |
| **Researcher** | What did the researcher find, and did it help? | Live feed of research requests and answers; sources with links; which trader asked; which findings were used in a decision and which were ignored; P&L of trades that cited each piece of research; research cost (calls, tokens, time) |
| **Decision drill-down** | Why did this trade happen? | One screen per decision: the research it used, the quotes it saw, the strategy text in force, the justification, the order and fill, the portfolio before and after, and a link to the SDK trace for the raw model and tool calls |
| **Lessons** ("what to relearn") | What have the agents learned, and is it still true? | After each cycle a review step compares past decisions with what happened next and writes short lessons ("bought on an earnings beat, gave back gains within 3 days"), each linked to its trades and P&L. The view lists lessons by trader with how often each recurs, flags lessons that later trades contradict, and shows which lessons the agent recalled before trading. |
| **Memory graph** | What does each agent's long-term memory contain? | Interactive graph of the entities, relations and observations that `mcp-memory-libsql` already stores in `memory/<name>.db` (companies, sectors, themes, lessons). Click a node to see its observations, when they were written, and which decisions used them. Filter by trader and time; compare two traders' graphs. Today Warren's graph has 1 entity, 0 relations and 5 observations, so the agents barely use memory. Showing it makes that visible, and the Lessons review step gives memory something worth storing. |
| **Market Year** | What kind of market is this, and who is positioned for it? | The year's SPY line shaded by regime (rules and HMM side by side), transition markers with the news that came with them, episode table (dates, return, drawdown, leaders and laggards), signal scoreboard heatmap (signals × regimes, year to date vs ten years, with n), Jim's current regime and probability, each trader's exposure against the regime |
| **Experiments & Evaluation** | Which configuration is better, by how much, at what cost? | Pick scenarios and arms, launch, then paired comparisons with confidence intervals; return vs cost frontier; metric matrix with per-scenario drill-down |
| **Replay** | Step through a past episode | Timeline scrubber, price chart with order and fill markers, portfolio over time, side-by-side with a counterfactual run |
| **Failure Lab** | How does the system behave when X breaks? | Fault catalogue, expected vs actual outcome, before/after table, links to traces |
| **System Health** | Is the infrastructure OK? | MCP servers, model speed and queue, Alpaca, market feed freshness, DB size, errors |

**Visual identity:** a clean trading-desk look: dense numbers, green/red reserved for P&L, consistent number formatting ($, %, bps), light and dark themes. The trader personas get neutral archetype labels (decision in §19).

### 11.3 How the UI is designed

Two local UI skills drive the redesign (both in the parent folder of this repo):

- **taste-skill** (`../taste-skill/skills/taste-skill`), primary art direction. Follow its **app-screen run** (`references/app-screens.md`) with `draw.mjs --app --kind markets`. Of the styles it deals for this product, **`data-terminal`** fits best: dark, built for trading and research screens read in long sessions, tabular digits, every selection marked by one thin accent line. `true-black-flat` is the alternative. Its rules include: colour goes on data, not chrome; KPIs as type, not icon tiles; no gradients, glows or sparkline cards; every screen answers one question first; the most frequent job is one click away. Gate each screen with `inspect.mjs --app`.
- **ui-ux-pro-max** (`../ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max`), UX quality checks: accessibility (contrast, focus, keyboard), chart choice (`--domain chart`), React guidance (`--stack react`), and its pre-delivery checklist.

Where the two disagree, **taste-skill wins on look** and **ui-ux-pro-max wins on accessibility**. For example, ui-ux-pro-max's generated design system for this product suggests Fira Code headings and a soft glow, which taste-skill bans (no monospace outside code, no glows).

### 11.4 The lessons loop

The Lessons view needs data, so V2 adds one deterministic step after each cycle:

1. For each decision older than N days, compute what happened next (return since entry, vs benchmark, did the stated reason play out).
2. A short review prompt turns that into 1–3 lessons, each linked to decision IDs.
3. Lessons are stored as `Lesson` rows **and** written into the trader's memory graph, so the trader can recall them before its next trade.
4. The evaluation harness measures whether lessons help: lessons on vs off is experiment **E11** (§4.3).

---

## 12. Financial capability brainstorm

Every capability must answer: **"What engineering question does this help us test, and does it move us toward reliable profit?"** Return-seeking ideas are no longer rejected outright; they wait until the harness can tell a real edge from overfitting.

| Capability | Engineering question it tests | Verdict |
|---|---|---|
| Deterministic risk limits (position %, order notional, universe) | Does moving constraints from the prompt into code eliminate violations, and at what cost to task completion? (E7) | **Include, Phase 4–5** |
| Position sizing tool (`max_affordable_qty`, target-weight → qty) | Do argument errors drop when arithmetic moves out of the LLM? | **Include** |
| Transaction costs, spread, slippage | Does the agent's turnover survive realistic costs? Do agents adapt? | **Include** (simulator) |
| Market-open awareness (clock tool + gating) | Does the agent act correctly under the `market closes mid-cycle` fault? | **Include** |
| Order types: limit orders | Can the agent reason about prices that do not fill, and does the order state machine hold? | **Include** (market + limit only) |
| Benchmark comparison | Does agent complexity beat simple rules? | **Include** (§10.2) |
| Portfolio rebalancing to target weights | Is the "rebalance" task even well-defined? Lets us grade deterministically against target weights. | **Include** |
| Earnings / news research | Core of the researcher-value question (E1) | **Include** via frozen corpora |
| Execution quality (fill vs decision quote) | Sim-vs-Alpaca calibration | **Include, Phase 7** |
| Simulated latency | Does decision staleness change outcomes? Tests staleness guards. | **Include** as a sim parameter |
| Diversification / correlation awareness (a deterministic `portfolio_risk` tool: weights, sector, correlation) | Does giving structured risk context improve adherence for Ray-type strategies? | **Include, Phase 5** (Quant server, §4.4) |
| Market regime context (simple, deterministic regime label) | Do agents change behavior given explicit context, or ignore it? | **Include, Phase 5** (Jim, §4.4.3) |
| Fundamental data (Massive) | Is the tool used when available, and does it improve groundedness? | **Include, Phase 5** (Warren's screen, §4.4.1) |
| Technical signals (RSI, moving averages as a tool) | Tool use vs hallucinated indicators | **Include, Phase 5** (George's trend checks, Jim's scoreboard) |
| Shorting / margin | Tests risk-rule edge cases, but doubles the ledger complexity | **Reject for V2** |
| Options / derivatives | No new agent-engineering question | **Reject** |
| Direct crypto trading | Cathie can use crypto ETFs. A second asset class adds nothing to evaluate. | **Reject** |
| ML price prediction / sentiment models (as tools the agent can call) | Does a model-based signal improve risk-adjusted return out of sample, or only in-sample? | **Later**, after Phase 8, with walk-forward tests |
| HFT / order-book microstructure | Wrong timescale for LLM agents | **Reject** |
| Tuning strategies for return | Does a tuned strategy keep its edge on episodes it was not tuned on? | **Later**, only with walk-forward / held-out episodes; never judged on in-sample results |

---

## 13. Framework tracing vs what we build

| Capability | OpenAI Agents SDK 0.15 / Google ADK tracing | Our system |
|---|---|---|
| Span tree for one agent run (agent, turn, task, generation, function, mcp_tools, handoff, guardrail, custom) | ✅ automatic | Saved as exported. Not reimplemented. |
| Model input/output, model config, token usage per generation | ✅ in span data | Saved as exported; usage summed for cost views |
| Tool input/output, MCP server info | ✅ `FunctionSpanData` | Saved, plus **linked to orders and evidence** |
| Timing per span, errors | ✅ | Saved; latency charts across runs |
| Grouping (`group_id`) and `metadata` | ✅ available, **unused today** | Used for cycle_id, run_id, config hash |
| Trace viewer | ✅ OpenAI hosted viewer (needs `OPENAI_API_KEY`); ADK ships a dev UI and exports OpenTelemetry to any OTel viewer | **Reused** for span-level debugging. Note: uploading to OpenAI sends prompts, research and portfolios to OpenAI, so it is opt-in. |
| Local storage, offline, querying across runs | ❌ | ✅ |
| Portfolio before/after, orders, fills, P&L, market context, evidence lineage | ❌ (not its job) | ✅ **this is what we build** |
| Lessons and memory-graph visualization | ❌ | ✅ |
| Experiment / scenario / config versioning | ❌ | ✅ |
| Replay (deterministic and counterfactual) | ❌ | ✅ |
| Evaluation, grading, stats | ❌ (OpenAI evals are a separate hosted product) | ✅, framework-independent |
| Fault annotations, outcome classes | ❌ | ✅ |

**Rule:** never rebuild what the framework already captures. Save its traces as they are, link them to the money, and spend the effort on the financial dashboard.

---

## 14. What stays unchanged

- **OpenAI Agents SDK** as the primary agent framework, behind `AgentAdapter`.
- **MCP** as the tool protocol, and the existing third-party servers (fetch, Tavily, memory, `mcp_massive`), now with **pinned versions**.
- **Ollama local model** as the default. Zero marginal cost makes repeated trials affordable.
- **Researcher-as-tool** pattern (`as_tool`) as the baseline experimental arm.
- **Separate engine / API / UI processes.** The API stays read-only.
- **SQLite** as the store (moved to WAL mode and a real schema).
- **The deterministic value-noise simulator**, promoted to a `SyntheticMarketData` source for synthetic scenarios.
- **Vite + TypeScript + uPlot** in the frontend toolchain.
- **`uv`** for Python environment management.
- **The four strategy archetypes**, kept as experimental arms (possibly renamed).

---

## 15. What gets replaced or refactored

| Current | Replacement | Fixes |
|---|---|---|
| `Account` JSON blob + float money | Normalized ledger tables (`accounts`, `positions`, `orders`, `order_events`, `fills`, `cash_ledger`, `snapshots`) with int micro-dollars, plus a repository layer | D5, D6, parity, reconciliation |
| `Account.get` auto-create + `name` tool argument | Explicit account provisioning; account bound through the spawn env; tools without `name` | D4 |
| `get_share_price` silent fallback | `MarketData` port with typed `Quote{as_of, source, synthetic}`, explicit errors, no cross-source fallback without a flag | D1, D8 |
| `is_market_open` fail-open | `Clock`/`MarketCalendar` port, fail-closed outside sim | D2 |
| `datetime.now()` everywhere | Injected `Clock`. Prompts are rendered from templates with an explicit `as_of`. | D9, D10 |
| `LogTracer` + `logs` table | A `TracingProcessor` that saves the SDK span export as-is, plus the financial tables. `logs` stays during migration. | D13, §6 |
| Trace-ID name hack | `trace(group_id=…, metadata=…)` | — |
| `accounts_client` spawning subprocesses to read resources | The orchestrator reads the ledger repository directly; MCP resources stay for agents | Latency, simplicity |
| `templates.py` f-strings + import-time `note` | Versioned prompt files (`prompts/*.md` + Jinja), content-hashed, assembled from agent YAML configs | D11, versioning |
| Hard-coded roster in `trading_floor.py`, imported by the API | `configs/agents/*.yaml` + typed settings. The API reads the config, not the engine module. | coupling |
| Monkey-patched `create` in `local_llm.py` | `ModelClient` with explicit middleware (tool-call recovery, recording, fault injection, metrics) | D16 |
| `except Exception: print` | Typed error classes, outcome classification, persisted trade/rebalance mode, watchdog | D13 |
| Unpinned `npx … @latest` | Pinned versions, recorded in the manifest | D12 |
| Persistent per-trader memory DB | Memory scoped per episode in experiments, persistent only in "live" mode, snapshotted | D14 |
| Polling dashboard | V2 UI + SSE | D15 |

---

## 16. Prioritized roadmap

### 16.1 How the roadmap is ordered

Every phase ends with something **you can see in the UI and show in a demo or a short video**. Backend work is done only when a visible feature needs it, inside that feature's phase. There is no separate setup phase: no CI-only work, and no interfaces built ahead of the features that use them. The defects in §1.4 get fixed where they would put wrong numbers on screen (for example, D1 and D5 in Phase 1, because the money view must show real prices and a clean equity curve).

Each phase lists: **what you will see**, **what gets built**, **the one-line pitch**, and **the prompt to start it**.

### 16.2 Phases

**Phase 1: New UI shell + Money dashboard** *(~2 weeks)*

- **You will see:** a redesigned app with its own identity and left navigation (Money, Trades, Researcher, Decisions, Lessons, Memory, Experiments, Failures, Health; unbuilt views show an honest "coming in phase N" state). The Money view: equity curves per trader against SPY, P&L today / week / all-time, drawdown, cash vs invested, allocation by position, fees paid, a return-vs-risk scatter. The Trades view: holdings with cost basis and unrealized P&L, a trade blotter with realized P&L per trade, win rate, average win vs average loss, trade markers on the price chart.
- **Gets built:**
  - Frontend moves to React + TypeScript (Vite and uPlot kept), designed with the two UI skills (§11.3).
  - API endpoints for equity history, benchmark series (SPY), per-trade P&L, allocation, and live updates over SSE instead of polling.
  - A portfolio snapshot written at a fixed interval, so equity curves are regular (fixes D5).
  - Unknown tickers rejected, and simulated prices never mixed into a live portfolio (fixes D1, D3), so the money numbers are real.
  - Trader personas renamed to neutral archetypes, if you choose that in §19.
- **Pitch:** "A trading-desk dashboard for four autonomous AI traders, benchmarked live against SPY."
- **Start with:** `Read docs/V2_ARCHITECTURE_PLAN.md §11 and Phase 1 of §16. Use the taste-skill app-screen run (kind markets) and ui-ux-pro-max to propose the new UI structure and visual direction for the Money and Trades views. Show me the proposal before writing code.`

**Phase 2: Researcher view + Decision drill-down** *(~1–2 weeks)*

- **You will see:** a live Researcher feed: each request, its sources with links, its findings, which trader asked, which findings were used or ignored, and the P&L of trades that cited them. Clicking any trade opens one screen with the research it used, the prices it saw, the strategy text in force, the agent's justification, the fill, and the portfolio before and after. A link opens the raw run in the OpenAI trace viewer.
- **Gets built:** a `TracingProcessor` that saves the SDK spans as they are (§6), `group_id`/`metadata` on traces, a structured `ResearchReport` from the researcher, a `Decision` record per trade, and each trader bound to its own account (fixes D4).
- **Pitch:** "Click any AI trade and see exactly why it happened: the research, the prices, the reasoning and the result."

**Phase 3: Lessons + Memory graph** *(~1–2 weeks)*

- **You will see:** a Lessons view of what each agent has learned from past trades, how often each lesson recurs, which lessons later trades contradicted, and which ones the agent recalled before trading. An interactive Memory graph of each agent's knowledge graph (companies, themes, lessons) with timestamps and the decisions that used each node.
- **Gets built:** the post-cycle review step (§11.4) that writes lessons into the trader's memory; a read-only API over `memory/<name>.db`; Cytoscape.js graph view.
- **Pitch:** "AI traders that review their own trades, write down lessons, and show their memory as a live graph."

**Phase 4: Experiment Lab** *(~2 weeks)*

- **You will see:** pick scenarios and agent setups (with or without the researcher, different models, different strategies), press run, watch progress, then a side-by-side result: return vs baselines, decision quality, cost and time, with confidence intervals. The headline chart is the cost/quality frontier.
- **Gets built:** frozen market episodes and frozen research (replay, §6.3), the scenario runner and graders (§5), baselines including a random agent (§10.2), a small Python simulator for fills and costs.
- **First results to publish:** E1 (does the researcher earn its cost?) and E10 (prompt fix).
- **Pitch:** "Does an AI research assistant actually make a trader better? Measured: +X quality for Y× the cost."

**Phase 5: Strategy playbooks + Jim, the regime quant** *(~3 weeks)*

- **You will see:**
  - **Jim**, in peacock teal, on every desk view.
  - A new **Market Year** view (§11.2): this year's SPY line shaded by risk-on and risk-off regimes, the transitions with the news behind them, a signal scoreboard heatmap (which strategies paid in which regime), and Jim's current regime read.
  - On **Decisions**:
    - Jim's Synthesizer thesis: signals for and against, the story-vs-numbers conflicts and how they were resolved, what would invalidate it, and uncited claims flagged.
    - The Quant tool calls.
    - A **Playbook check** (which rules each Warren or George trade passed or broke).
  - On **Memory**: Jim's graph as the year's chain of regimes, signals and events, and Warren's company entities with dated intrinsic-value ranges.
  - On **Money**: correlation between traders and desk-level exposure.
- **Gets built:**
  - The Warren and George playbooks (§4.4.1–4.4.2), with `change_strategy` off for them.
  - The Quant MCP server (`regime_now`, `regime_history`, `signal_scoreboard`, `signal_scan`, `portfolio_risk`, `size_positions`).
  - The daily Market Year pipeline (bars cache, features, rules and forward-filtered HMM regimes, episodes, scoreboard, memory writes).
  - The Synthesizer sub-agent with a structured `TradeThesis`, and Jim's risk limits.
  - The fifth trader wired through every four-trader assumption (§4.4.4 Plumbing).
  - Experiment arms E12–E14 in the Experiment Lab.
- **Prerequisites:** D1 fixed (real prices only). A historical data source chosen (§19.4).
- **Complications:** §4.4.4. Above all, look-ahead bias, the tiny sample of regimes in one year, and judging Jim only after his rules are frozen.
- **Pitch:** "An AI quant that learned this year's risk-on/risk-off swings from market data, argues with its own researcher through a Synthesizer, and is benchmarked against the simple rule it is trying to beat."
- **Start with:** `Read CLAUDE.md and docs/V2_ARCHITECTURE_PLAN.md §4.4 and Phase 5 of §16. First propose the Quant server's tool signatures, the Market Year tables, the TradeThesis schema and the Market Year view layout (taste-skill app-screen run, kind markets). Show me before writing code. Build in this order: bars backfill + Market Year view; Quant server; Warren/George playbooks; Jim + Synthesizer; E12–E14 arms.`
I've gone through CLAUDE.md, §1.4, §4.3–4.4, §11.2 and Phase 5. I also checked two things in the code and against the Massive API before proposing anything, and both change the plan.


#### Quant MCP server (`server/quant_server.py`, deterministic, no LLM)

`as_of` and the trader's account are fixed when the server starts (env `QUANT_AS_OF`, `QUANT_TRADER`), never passed by the model. That is the same capability-scoping lesson as D4, and it is what stops look-ahead in the Lab. Every output states "as of close YYYY-MM-DD" and stays at 30 rows or fewer.

```python
regime_now() -> {as_of, rules: {label, day_in_regime, since},
                 hmm: {label, prob, probs}, agree: bool,
                 features: [{name, value, unit, pct_10y}], switches_this_month: int}

regime_history(start: str, end: str, model: Literal["rules","hmm"] = "rules")
    -> [{label, start, end, days, spy_return, max_drawdown, vol_ann, leaders[3], laggards[3]}]

signal_scoreboard(regime: str | None = None)        # None = today's rules regime
    -> [{signal, ytd: {sharpe, hit, ann_return, n_episodes}, ten_y: {...},
         blend_sharpe, ci: [lo, hi], weight_ytd}]   # weight = n_ytd / (n_ytd + k)

signal_scan(signal: Literal["xs_momentum_12_1","trend_200d","rsi2_reversion","low_vol",
                            "earnings_drift","breakout_55d","defensive_rotation","buy_hold"])
    -> [{symbol, trigger, value, close, atr14}]     # today's candidates, ≤15

portfolio_risk(weights: dict[str, float])
    -> {vol_ann, beta_spy, avg_corr, cvar95_1d, worst_drawdown_10y,
        contributions: [{symbol, weight, risk_share}]}

size_positions(target_weights: dict[str, float], target_vol: float = 0.12)
    -> {equity, scale, brake: "none"|"halved"|"to_shy",
        rows: [{symbol, target_w, capped_w, capped_by, shares_now, shares_target,
                delta, price, trade: bool}]}        # trade only if >2% off target
```

`size_positions` applies Jim's limits itself: 25% per ETF, 10% per stock, the −8%/−12% brake, and the switch budget. The model can't negotiate them.

Step 3 adds `macro_dashboard()` for George (quadrant from HYG/IEF, UUP, TIP/IEF, copper/gold, SHY/IEF) and `quality_screen()` / `owner_earnings_dcf(symbol)` for Warren. Those two report "no fundamentals" when the data isn't there.

#### 3. TradeThesis (the Synthesizer's `output_type`)

```python
class Claim(BaseModel):
    text: str
    source: str          # "regime_now" | "signal_scoreboard" | "research:<url>" | "lesson:<id>"

class SignalView(BaseModel):
    signal: str
    stance: Literal["for", "against"]
    evidence: Claim

class Conflict(BaseModel):
    story: Claim         # what the research says
    numbers: Claim       # what the Quant says
    winner: Literal["story", "numbers", "unresolved"]
    why: str

class TargetWeight(BaseModel):
    symbol: str
    weight: float        # 0–1; whatever's left over is cash
    reason: str

class TradeThesis(BaseModel):
    regime: str
    confidence: float    # 0–1
    summary: str         # ≤ 2 sentences
    signals: list[SignalView]
    conflicts: list[Conflict]
    targets: list[TargetWeight]
    invalidation: list[Claim]
    horizon_days: int
    lessons_used: list[int]
```

The thesis gets no new table; it lives in the Synthesizer span. Groundedness is computed in `runs.py` from that run's spans: a `source` has to match a tool actually called, a URL the Researcher fetched, or a lesson recalled. Anything else is flagged as uncited in Decisions.

#### 4. Market Year view

The taste-skill sheet is saved in [.taste-skill/market-year/direction.json](.taste-skill/market-year/direction.json): data-terminal, analytics screen, palette and type kept. I'm keeping the app's existing labelled sidebar rather than the icon rail the sheet dealt. The shell is already set, and switching shells on one screen would break it.

- **The screen's question:** what kind of market is this, and who is positioned for it?
- **Its face:** the regime strip itself. Two thin bands under the SPY line (Rules over HMM) make the year read as a chain of regimes.
- **Colour:** goes on regimes and P&L only. Stress is a pale negative tint, the bulls are positive tints, chop is grey, and SPY is the one data hue.

```
Regime report · as of close Tue 3 Nov 2026                     Pipeline ran 16:40 · daily after close
Market Year.                                                    ← big, as Money
Calm bull for 18 days since 9 Oct; rules and HMM agree (0.81). Trend has paid in this regime
(blended Sharpe +1.12, n 4). Jim is 64% risk-on; George sits 41% in defensives.
┌──────────────────────────────────────────────┬──────────────────────────┐
│ SPY 2026 by regime      ■Calm bull ■Vol bull │ Jim's read               │
│ ■Chop ■Stress           [YTD  2025  10 y]    │ Calm bull      day 18    │
│ $720 ┤          ╱╲    ╱‾‾‾╲      ╱‾‾          │ HMM  Calm bull  0.81     │
│ $680 ┤ ╱‾╲  ╱‾‾╱  ╲__╱     ╲____╱             │ ▕████████▏▕▏▕▏ probs     │
│ $640 ┤╱   ╲╱      ①       ②     ③            │ Vol 20d   11.2%  34th pct│
│ Rules ▓▓▓▓░░▓▓▓▓▓▓▒▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓       │ SPY vs 200d      +6.1%   │
│ HMM   ▓▓▓▓▓░░▓▓▓▓▓▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓       │ From 52w high    −2.3%   │
│       Jan  Mar  May  Jul  Sep  Nov           │ Breadth  8 / 11 sectors  │
│                                              │ Sector corr 60d  0.41    │
│                                              │ Switches this month 1 / 3│
├─────────────────────────────┬────────────────┴──────────────────────────┤
│ Signal scoreboard  [Blend YTD 10y]           │ Who is positioned for it  │
│              CalmBull VolBull Chop  Stress   │ Jim    ████████░░▒▒  64/24/12│
│ Trend 200d    +1.12▕  +0.40  −0.31  −0.85    │ Warren ██████████▒   88/0/12 │
│  n            4     2      3      2          │ George ████░░░░░▒▒  35/41/24 │
│ XS momentum   …                              │ Ray    …  Cathie …          │
│ (8 rows; cell tint = Sharpe; current regime  │ risk-on / defensive / cash│
│  column marked by the 1px accent line)       │                           │
├──────────────────────────────────────────────┴───────────────────────────┤
│ Episodes                                                                  │
│ #  Regime      From    To     Days  SPY    Max DD  Vol   Led    Lagged   What turned it  │
│ ③  Calm bull   10-09   —      18   +4.2%  −1.1%   10.8%  XLK…  XLU…   "CPI cooler…" ↗ trace│
│ ②  Stress      09-02   10-08  26   −7.9%  −9.4%   24.1%  XLP…  XLK…   "…"                  │
└───────────────────────────────────────────────────────────────────────────┘
```

- Clicking a transition marker (①②③) or an episode row opens its news and links to the Researcher trace. That's the screen's main job.
- When there is no data, the panels keep their frames and say so plainly, e.g. "HMM needs the prior: 2016–2024 bars not loaded".
- On a phone, the panels stack and the episodes become two-line rows.

#### Build order (each step ends visible)

1. **Bars backfill + Market Year view.** Fix D1 in fills. Load the ~40 symbols into `bars` (Massive for recent bars, rate-limited and resumable). Then run features, rules and HMM regimes, and the scoreboard. Add `uv run -m server.market_year` and the view. New deps: `numpy` and `hmmlearn` (fit only).
2. **Quant server.** Wire it into `mcp_servers.py`; Quant calls appear as market calls in Decisions.
3. **Warren and George playbooks.** Add rule lists, turn off `change_strategy`, and add the Playbook check in Decisions.
4. **Jim + Synthesizer.** Wire the fifth trader through everything that assumes four, add `--t-jim`, the thesis panel and the groundedness flags.
5. **E12–E14 arms.** E12 needs a new scenario family: decision points built from real bars on 2026 transition and rebalance dates, with the Quant bound to `as_of` and grading on forward risk-adjusted return against the mechanical-rules arm and the 200-day arm. E13 is a Synthesizer on/off dimension. E14 adds playbook values to the strategy dimension, graded on rule adherence.


**Phase 6: Failure Lab** *(~1–2 weeks)*

- **You will see:** a catalogue of failures (market data down, stale prices, researcher timeout, broker rejection, duplicate order, model returns garbage). Pick one, run it, and see the expected vs actual outcome, the trace, and a before/after table showing how V1 behaved vs now.
- **Gets built:** fault injection at the model, tool, data and broker layers (§7), the outcome taxonomy, and the recovery mechanisms: duplicate-order protection, staleness guard, loop detector, market clock that fails closed (fixes D2).
- **Pitch:** "Chaos testing for AI agents: break the market feed mid-trade and watch how each agent copes."

**Phase 7: Alpaca paper trading** *(~1–2 weeks)*

- **You will see:** a mode switch (Simulated / Alpaca paper / Shadow) and a "Sim vs Paper" view comparing fill price, slippage, latency and rejections for the same decisions.
- **Gets built:** the Alpaca paper broker (§9), reconciliation, the live-URL guard.
- **Pitch:** "The same AI decisions executed on a real paper brokerage and in my simulator, side by side."

**Phase 8: Backtest + Replay viewer** *(~1–2 weeks)*

- **You will see:** a timeline scrubber over a historical episode: price chart with order and fill markers, portfolio over time, and a counterfactual run (another model or strategy) on the same days, side by side.
- **Gets built:** the episode library (§10), long-horizon baseline runs, the masked-ticker look-ahead check.
- **Pitch:** "Rewind any trading day and replay it with a different AI model."

**Phase 9: C++ simulation engine** *(~3 weeks)*

- **You will see:** an Engine page with a benchmark chart (Python vs C++ episodes per second) and a parity badge showing both engines produce identical results; Experiment Lab gains large baseline sweeps that were too slow before.
- **Gets built:** the §8 core with pybind11, parity tests, benchmarks.
- **Pitch:** "A C++20 execution engine that runs N× faster than the Python version, with results proven identical."

**Phase 10: Demo mode + launch** *(~1 week)*

- **You will see:** `lab demo` plays a curated 3-minute story with no LLM or network: a news shock → research → traders disagree → a broker rejects an order → recovery → evaluation scorecard.
- **Gets built:** the demo recording, README screenshots and GIFs, a short video, the write-up of experiment results.
- **Pitch:** the post itself.

### 16.3 Order

```text
P1 Money UI ─► P2 Researcher + Decisions ─► P3 Lessons + Memory ─► P4 Experiment Lab ─► P5 Playbooks + Jim ─► P6 Failure Lab
                                                                          │
                                                   P7 Alpaca paper ◄──────┤
                                                   P8 Backtest/Replay ◄───┘ ─► P9 C++ engine ─► P10 Demo + launch
```

---

## 17. Top 5 highest-value improvements

1. **The money-first dashboard (Phase 1).** It is the first thing anyone sees, and it turns the project from "four log panels" into a product.
2. **Decision drill-down with research (Phase 2).** "Click a trade, see why" is the most convincing 10 seconds of any demo.
3. **Experiment Lab with the researcher result (Phase 4).** A measured answer to a real question, with a chart, is the strongest claim the project can make.
4. **Failure Lab (Phase 6).** Visible chaos testing for AI agents is rare and easy to show in a short video.
5. **Lessons + Memory graph (Phase 3).** Agents that visibly learn, with a graph you can explore, are memorable.

---

## 18. Top 5 impressive-sounding ideas to NOT prioritize

1. **More trader personas or more agents.** The four current traders are already one agent with four prompts. More prompt-only personas add cost and confounds, not insight. Add agents only when they bring a different architecture (Jim's Quant and Synthesizer, §4.4) or as experiment arms (E4, E7c, E12, E13).
2. **Chasing returns before the harness exists** (strategy tuning, ML signals, sentiment models). Profit is the goal, but without held-out episodes and baselines any "edge" is likely overfitting. These come after Phase 8 (§12). Phase 5's playbooks and regime trader are the exception: they use only well-known, pre-registered signals and are judged only on days after their rules are frozen.
3. **Building our own tracing system.** The OpenAI Agents SDK (and Google ADK) already capture model calls, tool calls, timing and usage. Rebuilding that adds code and no information; effort goes into the financial and research views instead.
4. **Moving everything to C++ / building an HFT-style order book.** The agents are LLM-bound at seconds per decision. C++ belongs only in the batch simulation kernel, where a benchmark shows it matters.
5. **Supporting many agent frameworks** (LangGraph, CrewAI, AutoGen, …). One extra adapter (`PlainLoopAdapter`) proves the harness is framework-independent. More adapters only add maintenance.

*(Honorable mentions: fine-tuning a model, a 3D or real-time-everything UI, hosted multi-user deployment. Distributed execution is deliberately not on this list: it is a future direction (§2), deferred until a measured throughput need appears.)*

---

## 19. Decisions needed before implementation

1. **Model policy.** Local Ollama only, or are hosted models allowed for E6 (model ladder) and for the LLM judge? If allowed, what monthly budget?
2. **Trace viewer.** Since span-level debugging reuses the framework viewer: is uploading to the OpenAI trace UI acceptable (it sends prompts, research and portfolio data to OpenAI), or should spans go to a local OpenTelemetry viewer (e.g. Jaeger or Phoenix) instead?
3. **Alpaca account model.** One paper account per trader (separate key pairs), or one paper account with local sub-ledgers and reconciliation?
4. **Historical data source.** Which Massive plan tier do you have (it decides historical minute bars and fundamentals access), or should episodes come from Alpaca's historical API (free IEX feed)?
5. **Compute budget.** What hardware runs Ollama (RAM / GPU), and how many GPU-hours per week can experiments use? This sets k (trials per arm) and the episode lengths.
6. **Persona naming.** Keep the investor-homage personas (Warren / George / Ray / Cathie, which come from the course and name real people), or rename them to neutral archetypes (Value / Macro / Risk-Parity / Thematic) as part of the project's own identity? *Recommendation: rename.*
7. **Project name** for the V2 identity (repo, UI, docs).
8. **Frontend framework.** React (recommended) vs Svelte vs staying with vanilla TypeScript.
9. **C++ bindings.** pybind11 (requested; mature, widely known) vs nanobind (lighter, faster builds).
10. **Live mode semantics.** Should agents still be allowed to rewrite their own strategy and persist memory in live mode, given that both are disabled or episode-scoped in experiments?
11. **LLM-as-judge.** Is a judge acceptable for relevance and adherence metrics, and are you willing to hand-label about 50 items to calibrate it?
12. **Profit thresholds.** What risk-adjusted bar (e.g. beat SPY on Sharpe with a 95% CI over N episodes, max drawdown below X%) must a configuration clear before moving from simulation to paper, and from paper toward real money?
13. **Google ADK.** Stay on the OpenAI Agents SDK only, or add ADK as the second framework adapter (its OpenTelemetry tracing would then be reused the same way)?
14. **MCP topology.** Keep spawn-per-trader-per-cycle stdio servers (simple; recommended until Phase 2 measures the cost) or move to long-lived servers?
15. **The fifth trader.** Keep the homage name "Jim" (Jim Simons) or use the archetype "Regime quant" (follows decision 6)? Run the Synthesizer on qwen2.5-coder:32b or qwen3:32b? And the freeze date after which Jim's results count.
