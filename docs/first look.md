# First look: Autonomous Traders Lab

A self-contained brief for writing about this project: explainer posts (LinkedIn, Instagram, X), voice-over scripts, carousels and GIF shot lists. It assumes the reader has **no access to the code**. Everything needed to explain the project to a general audience, from the one-line idea down to how each chart is computed, is on this page. Figures come from the running app on Friday 6 Nov 2026; the app updates every few seconds, so treat numbers as a dated snapshot.

How the brief is laid out:

1. The idea in one minute
2. A primer: every concept a viewer needs, with analogies
3. The cast: five AI traders
4. A day on the trading floor: one cycle, and one real trade followed end to end
5. Architecture in detail
6. The app: look and feel, and a tour of every tab
7. The Money tab, Dashboard mode (in depth)
8. The Money tab, Story mode (in depth), and the twist
9. Snapshot figures from across the app
10. Writing kit: angles, series plan, metaphors, hooks, post outlines, voice-over script, GIF plan, FAQ
11. What's next
12. Glossary

---

## 1. The idea in one minute

**What it is.** Autonomous Traders Lab is a lab for building, explaining, stress-testing and comparing AI trading agents. Five AI agents, each with its own investing style, research the market on the web, look up prices, and buy and sell stocks in paper accounts (pretend money, $10,000 each), on a schedule, with no human pressing a button. Everything they do is recorded, and a web dashboard turns those records into answers.

**The problem it tackles.** AI agents are black boxes. You see the output ("bought 10 NVDA") but not the path: what it read, what it ignored, which tool it called, whether it followed its own rules. Trading is an ideal test bed because every decision ends in a number you can't argue with: money gained or lost.

**What makes it different.**
- **Explainable:** click any trade and see the research, the prices, the orders tried, the portfolio before and after, and a timeline of every step.
- **Measurable:** an Experiment Lab runs agents on frozen market scenarios, repeated many times, against simple baselines including a random trader.
- **Runs on a laptop:** all five agents share one open-weight AI model running locally (no paid AI API).
- **Honest by design:** the dashboard flags its own suspicious numbers. The best example is in section 8: the headline return turned out to be mostly a data error, and the dashboard is how it was caught.

**One-sentence versions:**
- "Five AI traders, $50,000 of paper money, and a dashboard that shows why every trade happened."
- "A flight recorder and a report card for AI agents, tested on the stock market."

---

## 2. Primer: concepts a viewer needs

Each entry: plain meaning, then an analogy you can use on screen.

| Concept | Plain meaning | Analogy |
|---|---|---|
| **LLM (large language model)** | The AI that reads text and writes text. Here: `qwen2.5-coder:32b`, a free, open-weight model. | The brain. |
| **Running locally (Ollama)** | The model runs on the owner's own computer through a program called Ollama, not on a company's servers. No per-use fees, but slow: one request at a time, often minutes per answer. | Cooking at home instead of ordering in: free, private, slower. |
| **AI agent** | An LLM given a goal, a set of tools and permission to act in a loop: think, call a tool, read the result, think again, until done. | An intern with a phone, a browser and a company card. |
| **Tool / tool call** | A function the agent may use, such as "get my balance" or "buy shares". The agent decides when to call it. | Apps on the intern's phone. |
| **MCP (Model Context Protocol)** | An open standard for plugging tools into AI agents. Each tool here is a small MCP server. | USB for AI tools: any tool, one plug. |
| **Sub-agent** | An agent that another agent can call like a tool. Each trader has a **Researcher** sub-agent; Robin also has a **Synthesizer**. | The intern's own research assistant. |
| **Trace / span** | The recorded log of one agent run (trace) and of each step inside it (spans): each model call, tool call, timing, tokens. | The flight recorder. |
| **Paper trading** | Trading with simulated money against real (or simulated) prices. Nothing is really bought. | A flight simulator. |
| **Fill** | An order that executed, at a price. | A receipt. |
| **Spread** | The small cost of trading: here every buy pays 0.2% above the price and every sell receives 0.2% below. | A currency-exchange booth's margin. |
| **Realized / unrealized P&L** | Profit already locked in by selling, versus gain or loss on shares still held. | Cash in your pocket versus the value of the house you still live in. |
| **FIFO** | First in, first out: when you sell, the oldest shares you bought count as sold first. | A queue at a shop. |
| **Drawdown** | How far the account is below its previous peak. | How far you've fallen from the top of the hill. |
| **Indexed return** | Each account shown as % change from its own start, so accounts of the same size can be compared. | Everyone's race starts at the same line. |
| **Market regime** | The market's mood, in four labels here: calm bull, volatile bull, calm chop, stress. | Weather: sunny, windy-but-warm, overcast, storm. |
| **HMM (hidden Markov model)** | A statistical model that infers a hidden state (the regime) from observable data (returns, volatility, credit, breadth), with a probability for each state. | Guessing the weather outside from what people walking in are wearing. |
| **Signal** | A simple, well-known trading rule, such as "buy what has risen most over the past year". | A recipe. |
| **Sharpe ratio** | Return per unit of risk. Higher is better; above 1 is good. | Miles per gallon for investing. |
| **Baseline** | A dumb strategy the agent must beat to matter: do nothing, buy the index, pick at random. | The control group. |
| **Playbook** | A fixed rulebook a trader must follow and cite in every order. | A pilot's checklist. |
| **Cross-filter** | Clicking one trader highlights them on every chart and every tab. | A spotlight that follows you round the building. |
| **Scrollytelling** | A web story where the chart changes as you scroll. | A documentary that advances when you turn the page. |

---

## 3. The cast: five AI traders

All five are named after One Piece characters, chosen by temperament: three steady traders first (Robin, Nami, Jinbe), then two wild ones (Law, Luffy). They run on the same model; what differs is their instructions and tools. Each has a fixed colour used on every chart. (Until 7 Nov the desk was Warren, George, Ray, Cathie and Jim; the history was carried over under the new names, and Cathie's crypto-ETF seat went to Luffy.)

| Trader | One-line character | How it decides | Colour (dark theme / light theme) |
|---|---|---|---|
| **Robin** | The regime quant (steady), the one who reads ten years of market history (built for this lab) | Reads the market regime and a scoreboard of eight signals from a calculator server (no AI involved), asks the Researcher only for upcoming catalysts, then a **Synthesizer** sub-agent writes a structured thesis: signals for and against, conflicts between the news story and the numbers and who wins, target weights, what would prove it wrong, and a cited source for every claim. Claims citing a source the run never saw are flagged. Runs a full thesis only when the regime changes or once a week; otherwise just checks a drawdown brake. As of 6 Nov: all cash, zero trades. | lavender / violet |
| **Nami** | The all-weather navigator (steady) | Free-text persona, the navigator who reads the economic weather: risk parity, broad diversification, watches macro data and central banks. Can rewrite her own strategy. | orange / deep orange |
| **Jinbe** | The patient value investor (steady): the calm helmsman | A fixed playbook, "quality at a reasonable price", blending a Buffett-style focus on quality with Joel Greenblatt's Magic Formula and the Piotroski F-score. Eight numbered rules: screen companies (5-year return on capital above 15%, positive free cash flow every year, low debt, F-score 7+), value them with an owner-earnings discounted-cash-flow model, buy only at a 25% margin of safety, no more than 15% of equity in one company, keep 10% cash, hold 8–12 names, sell only above 1.1× value or when a "kill criterion" breaks. Jinbe must name the rule in every order ("J4: size"). The rules cannot be rewritten. | sky blue / blue |
| **Law** | The global macro trader (wild): the surgeon who cuts in at the imbalance | A fixed playbook, "global macro with trend confirmation": Soros-style reflexivity (find the imbalance, size up when proven right) plus momentum. Long only, through ETFs: stock indices, the 11 sector funds, Treasuries, credit, the dollar, gold, oil. Enters only when the trend confirms (12-month momentum positive, price above its 100-day average); risks 1% of equity per idea. | gold / dark ochre |
| **Luffy** | The day trader (wild), joined 7 Nov | One technique, the most popular intraday setup: the **opening range breakout**. The first 5-minute bar from 9:30 New York sets a range. A stock is "in play" when that bar's volume is at least 1.5× its 14-day average; if the bar closed up and the price breaks its high, Luffy buys, risking 1% of equity to the bar's low, at most 25% of equity per position and 3 positions at once, no entries after 14:30. A calculator server (the Day-Trade desk, no AI) computes every number from real-time minute bars; his own **Day-Trade Researcher** only answers "why is this moving today?" and keeps a session journal. He never holds overnight: whatever is left at 15:50 is sold by the engine itself, not by the model. Rules M1–M7. | magenta / magenta |

Money has its own colours, separate from the traders: **gains in neon green, losses in red**. The palette was tuned so no trader's colour can be mistaken for a gain or a loss.

Story hooks per character:
- Robin: "the quant who hasn't placed a single trade, by design."
- Nami: "0 of 8 winning sells so far."
- Jinbe: "the only one with a checklist, and the one with the wildest chart."
- Law: "won't move until the trend agrees with him."
- Luffy: "in at 9:35, out by 15:50, every single day."

---

## 4. A day on the trading floor

### 4.1 One cycle

The engine runs in cycles, every 60 minutes by default, and only while the market is open (unless told otherwise).

1. **Start.** The engine stamps a cycle ID (like `cycle_20261107T043527Z`) and starts all five traders at the same time.
2. **Tools come online.** Each trader starts its tools: Accounts (balance, holdings, buy, sell), Market prices, Push notifications, and, for Jinbe, Law and Robin, the Quant calculator.
3. **Check the account.** The trader reads its cash and holdings.
4. **Research.** It usually asks its Researcher a question, for example "News and opportunities for AMD, NVDA, DDOG". The Researcher searches the web (Tavily), may read pages in full, may save notes to the trader's memory, and writes back an answer with sources.
5. **Numbers.** Jinbe, Law and Robin ask the Quant for screens, valuations, macro dashboards, the regime and signal scans. The Quant is plain Python maths, so its answers are exact and repeatable.
6. **Orders.** The trader places buy or sell orders. Each fill is stored with the agent's own one-line reason and a link to the run.
7. **Recording.** Every model call, tool call and handoff is saved as a span, exactly as the agent framework produced it.
8. **Review.** When all five finish, a review step looks at decisions now 3 and 10 days old, compares each one's return with the S&P 500 (SPY) over the same days, and writes a lesson into the trader's memory.
9. **Display.** The dashboard picks everything up within seconds.

A cycle is slow: one local model serves all five traders one request at a time, and a single model call can take several minutes. A full trading run often takes 15–35 minutes.

### 4.2 One real trade, end to end

Jinbe, 6 Nov 2026, 21:04: **sold 10 NVDA at $186.27** for $1,862.67.

- **His reason, in his own words:** "Rebalancing to maintain NVDA within 15% allocation, align with J4." (J4 is his position-size rule: at most 15% of equity in one company.)
- **The result:** those shares had cost $701.90 under first-in-first-out matching, so the sell **realized +$1,160.77**. They had been held 2 days 21 hours.
- **The run behind it:** started 20:35, ended 21:07, **31 minutes 52 seconds**, about **115,700 tokens**, 10 model calls, 40 tool listings. The model was "thinking" for almost the whole run.
- **What it looked up:** three Quant calls (a quality screen, a valuation of ADBE, the regime read) and two account reads. No web research in this run.
- **What the run trace flags:** "No memory read before the first order: what it learned before was not consulted." "No research in this run; it decided on prices and its own account."
- **Playbook check:** "Broke 1 of 1 rules": J7 says sell only above 1.1× the base-case value, on a broken kill criterion, or to swap into something with 15+ points more margin of safety, and the run contained no valuation of NVDA. Note the contradiction: the reason cites J4, but the sell rule is J7.
- **Portfolio before → after:** value $17,517.94 → $17,683.04; cash $74.93 → $1,937.60; NVDA 24 → 14 shares.

This single example shows the whole point of the lab: the agent's stated reason, its actual evidence and its own rulebook can be put side by side.

---

## 5. Architecture in detail

### 5.1 The big picture

```
 Browser ── React app (port 5173) ──/api──► FastAPI server (port 8000), read-only
                                                    │
                                                    ▼
 Engine ──writes──►  accounts.db (one SQLite file)  ◄── Market Year pipeline (daily, after the close)
   every N minutes: 5 traders in parallel,                bars · regimes · signal scores · news · company financials
   then the post-cycle review
        │
        ▼ each trader = one agent (OpenAI Agents SDK) on a local model (Ollama)
   Researcher sub-agent                     Tools (each an MCP server)
     web search · read pages · memory        Accounts · Market prices · Push · Quant (Jinbe, Law, Robin)
   Synthesizer sub-agent (Robin only)
```

### 5.2 Each part, in plain terms

| Part | Built with | What it does |
|---|---|---|
| **Engine** | Python, asyncio | Loops forever: run all five traders together, run the review, sleep. Once a day after the market closes, runs the Market Year pipeline. Skips cycles when the market is closed. |
| **Traders** | OpenAI Agents SDK | Each trader is an agent with instructions (persona or fixed playbook), its tools, and the Researcher wired in as a tool. A run is capped at 30 steps. |
| **Model** | Ollama, `qwen2.5-coder:32b` | One local model for all agents, through Ollama's OpenAI-compatible interface. The model sometimes writes a tool call as plain text instead of making the call; a small wrapper spots that, converts it into a real call and records each rescue so it can be counted. |
| **Accounts tool** | MCP server, Python | Balance, holdings, buy, sell. Each trader's copy is locked to its own account by configuration, so an agent cannot touch another trader's money. Every trade is stamped with the run's ID. Buys fill 0.2% above the price, sells 0.2% below. |
| **Market prices tool** | MCP server | Real prices from Massive when a key is set; a built-in simulator otherwise. A failed real-price lookup now rejects the order rather than inventing a price. |
| **Quant tool** | MCP server, Python + numpy, no AI | Regime read, signal scoreboard and scans, portfolio risk, position sizing, Jinbe's quality screen and valuation model, Law's macro dashboard. Deterministic: same inputs, same answer. |
| **Day-Trade desk** | MCP server, Python, no AI | Luffy's opening range breakout from Alpaca's real-time IEX 5-minute bars: the range, relative volume, the signal and the share count, stop and end-of-day exits, the session clock. The engine itself sells Luffy's leftovers at 15:50. | Computes, never guesses; the model only decides which setups to take. |
| **Researcher** | Sub-agent + Tavily search + page fetcher + memory | Answers a trader's question from the web, with sources, and can save notes to that trader's memory graph. |
| **Synthesizer** | Sub-agent with a structured output | Robin's thesis writer: a fixed schema (regime, confidence, signals for/against, story-vs-numbers conflicts, target weights, invalidation, horizon), every claim with a source. |
| **Memory** | A small knowledge graph per trader (entities, relations, observations) in its own database file | What each trader's researcher chose to remember. |
| **Recording** | SDK trace processors | Every trace and span saved exactly as the SDK exports it, into SQLite. No home-made tracing format. A second processor writes a readable activity log. |
| **Review** | Python + one model prompt | Turns 3- and 10-day-old decisions into lessons by comparing each decision's return with SPY's. |
| **Market Year pipeline** | Python, numpy, hmmlearn, Alpaca data, SEC EDGAR | Downloads adjusted daily prices for 82 symbols since 2016, computes features, labels each day with two regime models, scores eight signals per regime, has the Researcher explain each regime change with sources, and reads company financials from SEC filings. |
| **Experiment Lab** | Python worker + queue | Runs AI configurations on frozen scenarios many times, grades them, computes confidence intervals, compares with baselines. |
| **API** | FastAPI | Serves the data to the browser. Read-only, except queueing or cancelling an experiment. |
| **App** | React 18, TypeScript, Vite, TanStack Query, d3, Cytoscape | Ten tabs (section 6). Polls the API every few seconds. |

### 5.3 How the two regime models work

- **Rules model:** two questions per day. Is SPY above its 200-day average (up-trend)? Is 20-day volatility above the 70th percentile of the past ten years (high volatility)? Up-trend + calm = **Calm bull**; up-trend + volatile = **Volatile bull**; down-trend + calm = **Calm chop**; down-trend + volatile = **Stress**.
- **HMM:** a 4-state statistical model fitted on 2016–2025 data (20-day return, volatility, credit spread proxy, sector breadth), then run forward day by day using only data available on that day, giving a probability for each state.
- **Confirmation delay:** both models change their official label only after the new label has held for 5 trading days, so every turn is confirmed late on purpose (fewer false alarms). The app shows when the daily read has already turned but is not yet confirmed.

### 5.4 Design principles (quotable)

- Every agent run can be explained, from the fill back to the evidence.
- Use the framework's own tracing, stored as-is; store separately only the money side (fills, portfolio snapshots, lessons).
- Put arithmetic in code, not in the AI: regimes, signals, sizing and valuations are deterministic.
- Lock capabilities in configuration, not in what the model types (an agent can't name another account).
- Never connect a live broker; price history only, with paper keys.
- Track known defects openly (16 listed in the project plan) and show suspicious numbers on screen rather than hiding them.

### 5.5 The chart system behind every tab

- **One kit for every chart.** React draws the graphics; d3 does the maths (scales, shapes, layouts, smooth transitions). Charts: line chart, dot plot, swimlane/timeline, treemap, waterfall, diverging bars, heatmap, scatter.
- **Charts explain themselves.** A built-in annotation helper draws a thin leader line from a data point to a short label ("4 Nov · Jinbe breaks away").
- **Themes.** Light and dark themes, switched instantly; every colour is a design token.
- **Responsive.** Works down to phone width (about 400 px) with no sideways scrolling.
- **Motion with restraint.** Only real changes animate (about 0.6 s), big numbers count up, and the operating system's "reduce motion" setting turns animation off.
- **Cross-filter.** Click a trader's pill, line or label: that trader comes forward on every chart, the rest fade to about 18% opacity, and the choice is kept in the page address, so it follows you between tabs and can be shared as a link.
- **Story mode.** A Dashboard | Story switch turns a tab into a scrolling story. Steps scroll past on the left; a pinned chart on the right redraws for each step (on a phone the chart pins to the top and steps slide under it).

---

## 6. The app

### 6.1 Look and feel

- **Dark mode:** a near-black, slightly green ground; an acid-lime accent for interface highlights; neon green for gains and red for losses. **Light mode:** cool mineral-grey paper with a cobalt accent.
- **Type:** very large page titles ending in a coloured full stop ("Money."); a geometric sans-serif (Space Grotesk) for words; a monospace (JetBrains Mono) for every number so columns line up like a ledger; an italic serif (Fraunces) for the agents' own words, set like quotations.
- **Rule of colour:** colour lives on data (trader lines, gains and losses), not on decoration. No gradients, no glowing effects.
- **Every screen answers one question first,** in a sentence written from the data under the title.

### 6.2 Tour of every tab

The sidebar groups the tabs by question.

**Desk**

- **Money**, "Where is the money and how is it doing?" Covered in depth in sections 7 and 8.
- **Trades**, "What do we hold and what did each trade earn?"
  - A **treemap** of open positions: one block per trader, one tile per stock, tile size = value, tile colour = gain or loss on the position (deep red below −3%, neon green above +20%). Positions over 40% of an account are flagged "concentrated" (Cathie's INSM at 57%, Nami's QQQ at 56%).
  - A **record card**: hit rate (12 of 37 closing sells won, 32%), one square per sell, average win +$647 vs average loss −$90, a **7.2× payoff**: "a low hit rate carried by big winners."
  - **Every closing sell as a dot** on a dollar axis, with the average win and loss marked and the best sell labelled ("NVDA +$1,943.09, 35% of all realized").
  - A **fill timeline**: one lane per trader, a dot per trade sized by value (filled = buy, ring = sell, ring colour = profit or loss), showing each agent's trading rhythm.
  - The holdings table with weight bars, and every fill with the agent's reason. Has its own **Story mode**, "32% right, still in profit".
**Why it traded**

- **Researcher**, "What did the researcher find, and did it help?"
  - A **funnel**: 61 research requests → 35 named a stock that was then traded in the same run (57%) → those trades stand at **+$3,159**.
  - A **scatter** of research time vs tokens (does longer research pay?).
  - A **researched-vs-traded heatmap** per trader and ticker, flagging stocks researched three or more times and never traded.
  - Each answer rendered as formatted text, with ticker symbols turned into clickable chips that open that stock's trades.
- **Decisions**, "Why did this trade happen?"
  - Every fill, and for the selected one: the agent's reason as a large quote; proceeds, cost, result and holding time.
  - A **run trace**: a timeline of the whole run with lanes for thinking, research, quant tools, price lookups, memory and orders, each bar at its real time. A dashed bar marks a memory read that should have happened before the first order and didn't. A **"Replay this run"** button walks through the steps in order.
  - Automatic flags (gap between research and order, no memory read, research didn't mention the stock, failed orders). For Jinbe and Law, the **playbook check**; for Robin, his thesis with every claim checked against the run's sources.
- **Lessons**, "What have the agents learned, and is it still true?" The review's lessons: each traded decision is judged at 3 and 10 days against SPY. It also shows which lessons were contradicted later and whether they were recalled before trading. Early in the run this tab mostly shows pending reviews.
- **Memory**, "What does each agent's long-term memory contain?" Each trader's knowledge graph. The headline finding: **198 observations written across the five traders, and saved runs read memory back 0 times.** The agents write memory but never use it, shown as paired bars per trader (written vs read). When a graph has no links between its entries, it is drawn as bubbles grouped by kind and sized by how much was written.
- **Market Year**, "What kind of market is this, and who is positioned for it?"
  - SPY over the year shaded by regime, with numbered transitions and the news behind each one.
  - A ribbon of the HMM's probabilities, and both models' readings day by day.
  - A **signal scoreboard** (which of eight strategies paid in which regime).
  - A gauge of how risk-on the desk is, with a tick per trader, and the episodes table.
  - Has a **Story mode**, "the year in transitions" (section 6.3).

**Lab**

- **Experiments**, "Which configuration is better, by how much, at what cost?"
  - Build a run by picking scenarios and settings (agent type, research on/off, model, prompt, strategy). Every combination is an "arm", run several times.
  - 13 frozen scenarios: 7 hand-written ones with made-up tickers, so the model can't know the answer (most of the account in one stock, two sources that disagree, an earnings miss on a held position, a guidance raise on a stock it doesn't own, great news but not enough cash, a hot rumour about a stock it can't trade, a quiet market with nothing to do), and 6 replaying real 2026 regime turns.
  - A heatmap of what simple baselines earn on each scenario, outlined pass/partial/fail. A random trader scores 57% on average: the bar any AI configuration must clear.
- **Failures** (planned, phase 6): chaos testing. Break the price feed or the researcher mid-trade and watch how each agent copes.
- **Health**, "Is the infrastructure OK?"
  - Status tiles: model speed (about 1.9 output tokens per second of model time), lab queue, database size (42 MB), failed spans.
  - A **swimlane per agent** showing every model call, tool call and tool listing as bars over the last 10 minutes to 6 hours; a lane that goes quiet while the others work is a stuck agent.
  - How long each kind of step takes, on a log scale: model calls take minutes, tools take milliseconds.

### 6.3 Market Year story (short)

Steps, one per regime change this year (Rules model): the year opens in a calm bull → 26 Mar, calm chop (US–Iran tensions) → 7 Apr, stress → 14 Apr, volatile bull (rebound, led by tech) → 1 May, calm bull → 24 Jun, volatile bull → 13 Jul, calm bull (84 trading days and counting) → today: SPY $735.29, +8.48% year to date; the 55-day breakout signal has paid best in this regime (Sharpe +0.72); the desk is about 60% risk-on. Each step zooms the SPY chart to that episode, shows the regime shading and the HMM probabilities shifting, and quotes the news the Researcher found for the turn, with sources. Twist for writers: on 6 Nov the HMM's official label was still Calm bull, but its daily read had been Calm chop at 100% for 2 days; it switches officially if that holds 3 more days.

---

## 7. The Money tab, Dashboard mode

**First question answered:** *Where is the money, and how is it doing?* This is the home page. It reads all five accounts every 6 seconds and computes the books in the browser, so the Money and Trades tabs always agree.

### 7.1 How the books are computed

- **First-in, first-out matching:** each sell is matched against that trader's oldest earlier buys of the same stock, giving each sell its profit, cost and holding time.
- **Open positions:** what's left after matching, valued at current prices.
- **The books must balance:** realized + unrealized = equity − $10,000 for each trader; the code checks it.
- **Spread** paid is recovered from each fill price and totalled.
- **One clock for all:** each account's value history is recorded at different moments (whenever that agent checked its account), so the five histories are merged onto a shared timeline, each carrying its last value forward.
- **Spike filter:** a value that jumps more than 20% and immediately comes back is treated as a one-off glitch from mixed price sources, left off the chart, and counted in a note (5 such points on 6 Nov).
- **Drawdown:** at each moment, how far the desk's total is below its highest point so far.

### 7.2 Header

- Title **"Money."** in very large type.
- A sentence written from the data: *"The desk is up +$6,558.50 +13.12% on its $50,000.00 stake. One trader made all of it: Jinbe is +76.39%, and the other 4 together are down $1,080.16."* ("One trader made all of it" appears only when literally true; otherwise it names the leader and the laggard.) Money amounts sit on a soft green or red highlighter tint; the key phrase is underlined in the accent colour.
- A **Dashboard | Story** switch and "Updated 22:43 · every 6 s".

### 7.3 Four key numbers

| Tile | Value (6 Nov) | Meaning |
|---|---|---|
| Desk equity | **$56,558**, with a small line of its history, "+13.12% since funding" | Total cash + holdings. Counts up when it changes. |
| Today | **+$1,525.80**, "Past 7 days +$6,593.63" | Change since midnight and over 7 days. |
| Realized / unrealized | **84 / 16** with a split bar | 84% of the gain is banked by sells, 16% still rides on open positions. |
| Worst desk drawdown | **−16.65%**, "from its peak, at 4 Nov, 16:35" | The deepest fall from a high. |

### 7.4 Trader pills

"Whole desk · Robin · Nami · Jinbe · Law · Luffy", each with its colour; hover for the trader's style. Clicking one spotlights that trader everywhere.

### 7.5 "Return since funding" (main chart)

- One line per trader: % return on their $10,000.
- **Why %, not dollars:** at the start all five dollar lines sit on top of each other; percentages pull them apart. A switch offers `% return`, `$ equity` and `Log`, and the axis animates between them.
- **Folded time:** the engine runs in sessions with days off between them. Gaps over six hours are squeezed into thin shaded columns marked "engine off", so the sessions where agents traded get the space.
- Each line ends in a dot and a label ("Jinbe +76.4%"); labels never overlap.
- With nobody selected, the trader who moved most (Jinbe) is drawn bold, outlined so it stands above the others.
- **Annotations from the data:** at Jinbe's biggest jump, *"4 Nov · Jinbe breaks away / NVDA lot bought at $87.64, now +113%"*; at the desk's worst sell, *"Law sells SMCI at a loss, −$516.03"*.
- Hover shows every trader's value at that moment.
- Underneath, a red **drawdown strip** on the same timeline ("Drawdown −16.65%"), which switches to the spotlighted trader's drawdown.
- **What the chart looked like on 6 Nov:** all lines flat at 0% until 3 Nov; Jinbe spikes, dips to about −20%, then jumps to about +80% on 4 Nov and holds near +76%; the others stay within a few percent of zero (Robin 0.0%, Law −4.3%, Nami −6.9%; the seat Luffy now holds was +0.4%).

### 7.6 "Where the $56,558 comes from" (waterfall)

Funded **$50,000** → Realized **+$5,526** → Unrealized **+$1,032** → Now **$56,558**, as floating bars joined by dashed links. The axis starts at $42,000 (stated in a footnote) so the changes are visible. Fills already include $263 of spread. Reads in about two seconds; it replaced a table of figures.

### 7.7 "Who made the gain" (contribution bars)

Each trader's dollar change either side of zero, sorted: **Jinbe +$7,638, Robin $0, Law −$427, Nami −$693** (plus +$40 from the seat Luffy took over on 7 Nov; Luffy starts at $0).

### 7.8 "Each trader, same scale" (small multiples)

One card per trader on a shared scale: name and return, the trader's style ("Value, patient"), current holdings ("ARKK · APLD · NVDA" or "all cash"), a mini equity line with drawdown shaded red beneath, and a footer ("$17,638 · 27 fills · DD −55.1% · 8/15 won"). At a glance: Jinbe is the volatile one, Law and Nami nearly flat, Robin and Luffy straight lines.

### 7.9 Lower panels

- **Return against worst drawdown:** a dot per trader (up and left is better), with a note that ten days is too few to call it skill.
- **Latest decision:** the newest trade in the agent's own words, with a link to its full explanation.
- **Are the traders one bet?:** how closely the traders' accounts move together.
- **Desk exposure:** how much of the desk is in risk-on assets, defensive assets and cash, linked to the current regime.

### 7.10 Why it matters

- Answers the question within a second (title, sentence, four numbers), then lets you dig.
- Refuses to flatter: percentages separate the lines, glitches are filtered and counted, axis shortcuts are disclosed, and the annotation exposes the suspicious lot.
- One click re-focuses every chart and follows you to every tab.
- Live: new trades appear within 6 seconds.

---

## 8. The Money tab, Story mode, and the twist

### 8.1 "How the desk got to +13.1%"

Switch to Story and scroll. The same data, told in five steps; the pinned chart animates (about 0.6 s) as each step reaches the middle of the screen. All titles, dates and numbers are computed live, so the story rewrites itself as the data changes.

| Step | Tag | Title | Text (6 Nov) | What the chart does |
|---|---|---|---|---|
| 1 | 27 Oct | **5 traders, $10,000 each** | "Every account starts in cash, so every line starts flat at 0%. Each trader runs its own strategy on the same local model." | Zoomed into the opening sessions: five flat lines. |
| 2 | 4 Nov | **Jinbe breaks away** | "Jinbe ends up +76.4%. The biggest open lot: NVDA lot bought at $87.64, now +113%." | Zooms out to the whole run; Jinbe spotlighted, others faded; the annotation appears. |
| 3 | 4 Nov, 16:35 | **The others sink** | "Law −4.3%, Nami −6.9%. The desk's worst drawdown from its peak was −16.65%." | Everyone back in colour; the drawdown strip marks its lowest point. |
| 4 | now | **Where the money came from** | "From $50,000 funded: +$5,526.47 banked on closed lots and +$1,032 still open, for $56,558 today." | The chart turns into the waterfall. |
| 5 | today | **Today's split: +13.1% for the desk** | "Jinbe +76.4% · Robin 0.0% · Law −4.3% · Nami −6.9% · Luffy 0.0%." | The chart turns into the contribution bars. |

### 8.2 The twist: the +76% that wasn't

This is the strongest story in the project.

- Jinbe's gain comes mostly from NVDA. He bought **35 shares at $70.19 on 3 Nov and 14 at about $87.70 on 4 Nov**.
- NVDA's real closing prices those days were **$202.06 (2 Nov), $206.69 (3 Nov) and $200.13 (4 Nov)**.
- His sells later went through at real prices: $199.73, $199.73, $181.24, $186.27.
- **Why:** in an earlier version, when a real price couldn't be fetched, the system quietly fell back to its built-in price simulator, which produced a made-up price. The cheap "buys" were priced by that simulator; the sells by the real market. The difference became paper profit.
- **How it surfaced:** the dashboard's own annotation, "NVDA lot bought at $87.64, now +113%". A blue-chip stock doubling in two days is the tell. The spike filter had also been quietly dropping one-off jumps from mixed price sources.
- **The fix:** a failed real-price lookup now rejects the order instead of inventing a price.
- **The lesson:** the agents did exactly what they were told; the data underneath them was wrong. Explainability isn't just about the AI's reasoning. It's about every number the AI touches.

Sixth beat for posts and videos: after step 5, cut to the Trades tab, show the NVDA buy at $70.19 next to the real ~$206 close, and say: "The story was right about the money and wrong about the reason, and the same dashboard is how I found out."

---

## 9. Snapshot figures (6 Nov 2026, evening)

Captured before the 7 Nov roster change, so desk totals still include the seat Luffy took over (it held $10,040 at +0.4%). Luffy started fresh with $10,000. Re-capture these figures before publishing.

**Desk**

| | |
|---|---|
| Funded | $50,000 (5 × $10,000) |
| Desk equity | $56,558 (+$6,558.50, +13.12%) |
| Today / past 7 days | +$1,525.80 / +$6,593.63 |
| Realized / unrealized | +$5,526 / +$1,032 |
| Spread paid | about $263 |
| Worst desk drawdown | −16.65% (4 Nov, 16:35) |
| Fills | 71 since 27 Oct |

**Traders**

| Trader | Equity | Return | Fills | Winning sells | Worst drawdown |
|---|---|---|---|---|---|
| Jinbe | $17,638 | +76.4% | 27 | 8 of 15 | −55.1% |
| Law | $9,572 | −4.3% | 17 | 3 of 9 | −15.3% |
| Nami | $9,306 | −6.9% | 14 | 0 of 8 | −6.9% |
| Robin | $10,000 | 0.0% | 0 | — | 0.0% |
| Luffy | $10,000 (from 7 Nov) | 0.0% | 0 | — | 0.0% |

**Elsewhere in the app**

| | |
|---|---|
| Closing sells won | 12 of 37 (32%); average win +$647.24, average loss −$89.62, payoff 7.2× |
| Best / worst sell | NVDA +$1,943.09 (35% of all realized) / SMCI −$516.03 |
| Research | 61 requests; 35 named a stock traded in the same run; those trades +$3,159.25 |
| Fills with a full saved run | 44 of 68 |
| Memory | 198 observations written; 0 reads by saved runs |
| Market | SPY $735.29, +8.48% year to date; Calm bull for 84 trading days since 13 Jul |
| Desk positioning | about 60% risk-on |
| Experiment Lab | 13 scenarios; random trader averages 57% |
| Infrastructure | about 1.9 output tokens/s of model time; database 42 MB |

---

## 10. Writing kit

### 10.1 Story angles (each can carry a post on its own)

1. **The bug that looked like genius.** +76% that turned out to be a pricing glitch, caught by the dashboard itself.
2. **Five personalities, one brain.** Same model, same tools, different instructions, wildly different behaviour.
3. **The AI that writes a diary and never reads it.** 198 memories written, zero read.
4. **Wrong 2 out of 3 times, still profitable.** 32% hit rate, 7× payoff (with the caveat that the biggest win is the NVDA glitch).
5. **The quant who refuses to trade.** Robin has placed zero trades because his rules say the evidence isn't there yet.
6. **Show your work.** An AI that must cite a source for every claim, with uncited claims flagged.
7. **A flight recorder for AI.** Click any trade, replay the whole run step by step.
8. **Cooking at home.** A full multi-agent system on one laptop with a free model: what that costs in speed.
9. **The market's weather report.** Two models disagree about the regime; one has already turned.
10. **Beat the monkey.** A random trader scores 57% on the lab's scenarios; any AI has to beat that to matter.
11. **Dashboards that tell stories.** The same data as a dashboard and as a scroll story.

### 10.2 Series plan

| # | Post | Core visual |
|---|---|---|
| 1 | Introduction: five AI traders, one laptop, every decision on record | Money page + spotlighting traders |
| 2 | The Money tab: dashboard and story, and the +76% twist | Story scroll GIF + the annotation |
| 3 | Decisions: replay one trade, step by step | Run trace replay GIF |
| 4 | Trades: wrong most of the time, still up | Dot plot of every sell |
| 5 | Researcher: does research move money? | Funnel + scatter |
| 6 | Memory: written, never read | Written-vs-read bars |
| 7 | Market Year: the year in regimes | Market Year story scroll |
| 8 | Experiments: beat the random trader | Baseline heatmap |
| 9 | Health: watching agents think | Swimlanes |

### 10.3 Metaphors that work on screen

- The engine is a **trading floor** that opens every hour; the traders are **analysts with different temperaments**.
- Traces are a **flight recorder**; Decisions is the **crash investigation**.
- The Quant is a **calculator that can't be sweet-talked**; the Researcher is a **junior analyst who reads the internet**.
- Playbooks are **pilot checklists**; the playbook check is the **co-pilot asking "did you do step 7?"**
- Market regimes are **weather**; the HMM is a **forecaster who gives probabilities**; the 5-day confirmation is **waiting for the storm to be official**.
- Story mode is **a documentary of your data**.
- The spike filter and annotations are **the dashboard raising an eyebrow**.

### 10.4 Hooks

- "I gave five AI agents $10,000 each and let them trade on their own. The most useful thing I built was the dashboard that tells me when not to believe them."
- "One of my AI traders is up 76%. Here's the chart that proves it's a bug."
- "Five AI traders. One laptop. Zero API bills. Every decision on the record."
- "My AI writes notes to itself every day. It has read them zero times."
- "My AI quant hasn't made a single trade. That's the most disciplined thing on the desk."
- "Can an AI trader beat a coin flip? I built a lab to find out."

### 10.5 Post outline: introduction

1. Hook: five AI agents, $10,000 each, no human in the loop.
2. The cast in one line each (section 3 hooks).
3. How it works: one local model, a research assistant per trader, tools plugged in through MCP, maths in a calculator the AI can't fudge, every step recorded.
4. Why: not to get rich; to make AI decisions explainable and measurable, using trading because money keeps score.
5. Visual: GIF of the Money page and clicking through the trader pills.
6. Close: "Next: the number I didn't trust."

### 10.6 Post outline: the Money tab

1. Hook: "One of my AI traders is up 76%. I don't believe it, and my dashboard is why."
2. The dashboard answers "where is the money?" in a sentence and four numbers.
3. Three design choices: percentages instead of dollars, folded time for days the engine was off, glitches filtered and counted.
4. Story mode: scroll and the chart tells how the desk got here in five steps.
5. Twist: "NVDA lot bought at $87.64, now +113%." NVDA was above $200 that week. A silent fallback to a price simulator; now removed.
6. Lesson: "The best dashboard isn't the one that makes the agent look good. It's the one that catches it."
7. Visuals: scale-switch GIF, story-scroll GIF, a still with the annotation circled.

### 10.7 Voice-over script (about 75 seconds)

1. (0–8 s) Money page, dark mode. "Five AI traders. Fifty thousand dollars of paper money. Nobody pressing buy."
2. (8–20 s) Zoom on the sentence and the four tiles. "The dashboard answers one question first: where's the money? Up thirteen percent, and one trader made all of it."
3. (20–32 s) Click Jinbe, then Nami. "Click a trader and the whole app follows: their line comes forward, the rest fade, and it follows you to every tab."
4. (32–50 s) Switch to Story, scroll. "Or switch to Story: a flat start, the break-away, the drawdown, where the money came from, today's split."
5. (50–65 s) Hold on the NVDA note, cut to the trade list. "But look at this note. A lot that doubled in two days. NVDA never traded at eighty-seven dollars that week. That price came from a simulator fallback. It's fixed now: no real price, no order."
6. (65–75 s) Back to the dashboard. "That's the point of the lab. Not to make an AI look smart. To make every number explain itself."

### 10.8 GIF and screenshot shot list

Capture at 1440 × 900 for desktop and 400 × 860 for phone; dark mode shows the neon gains best (the theme switch is at the bottom of the sidebar).

| Clip | Where | Action |
|---|---|---|
| Hero | Money (home page) | Top of page, nobody selected. |
| Spotlight | Money | Click Jinbe, Nami, then Whole desk, pausing 1 s each. |
| Scale switch | Money chart | % return → $ equity → Log → % return. |
| Money story | Money, Story | Slow scroll through the 5 steps, about 2 s each. |
| The clue | Money chart | Close crop of "4 Nov · Jinbe breaks away / NVDA lot bought at $87.64, now +113%". |
| The evidence | Trades, Jinbe, NVDA | NVDA buys at $70.19 and sells near $200. |
| Replay | Decisions | Press "Replay this run" on Jinbe's NVDA sell. |
| Memory | Memory | The "Written, never read" bars. |
| Market story | Market Year, Story | Scroll through the transitions; the chart zooms to each. |
| Phone | Money, Story, 400 px wide | Chart pinned on top while steps slide beneath. |

### 10.9 FAQ (questions viewers ask)

- **Does it make money?** Paper money only. The desk shows +13%, but most of it is the NVDA pricing glitch; ten days of data says nothing about skill. Measuring skill properly is what the Experiment Lab is for.
- **Is real money at risk?** No. No broker is connected; the code only uses market data, with paper-trading keys.
- **Which AI?** One free, open-weight model (`qwen2.5-coder:32b`) running locally through Ollama, shared by all five agents.
- **Why a local model?** No API bills and full privacy. The cost is speed: one request at a time, minutes per model call, 15–35 minutes per trading run.
- **What does an agent actually do?** Reads its account, asks its researcher, checks numbers, places orders, explains each one in a sentence.
- **Can I see why it made a trade?** Yes, every trade links to its full run: research, prices, orders, timeline, rule check.
- **Do the agents learn?** A review writes lessons 3 and 10 days after each decision. But the agents have not read their memory back yet (0 reads), which is itself a finding.
- **What's the hardest part?** Trust: making sure every number is real, and catching it when it isn't.
- **Where did it start?** As an adaptation of the MCP capstone project in Ed Donner's AI agents course, since rebuilt into a full lab.

---

## 11. What's next (roadmap)

Built so far: the dashboard, research and decision drill-down, lessons and memory, the Experiment Lab, playbooks, Robin and the Market Year, and the redesigned charts with story mode. Planned:

| Phase | What | Pitch |
|---|---|---|
| 6 | **Failure Lab** | "Chaos testing for AI agents: break the market feed mid-trade and watch how each agent copes." |
| 7 | **Alpaca paper trading** | "The same AI decisions on a real paper brokerage and in my simulator, side by side." |
| 8 | **Backtest + replay viewer** | "Rewind any trading day and replay it with a different AI model." |
| 9 | **C++ simulation engine** | "A C++20 engine that runs many times faster than the Python version, with results proven identical." |
| 10 | **Demo mode** | A curated 3-minute story that runs with no AI and no network. |

Real money is only considered after the agents beat baselines across many simulated episodes and then hold that edge in paper trading for months.

---

## 12. Glossary

- **Agent:** an AI given tools and a goal, acting in a loop.
- **Arm:** one configuration in an experiment (for example: Robin, research on, model X).
- **Baseline:** a simple strategy every agent must beat.
- **Cycle:** one round of all five traders running.
- **Drawdown:** fall from the previous peak.
- **Fill:** an executed order.
- **FIFO:** oldest shares are sold first.
- **HMM:** hidden Markov model; infers the market regime with probabilities.
- **MCP:** Model Context Protocol, a standard plug for AI tools.
- **Paper trading:** simulated money.
- **Playbook:** a fixed rulebook the trader must cite.
- **Realized / unrealized:** profit locked in by selling / profit on paper on shares still held.
- **Regime:** calm bull, volatile bull, calm chop or stress.
- **Sharpe ratio:** return per unit of risk.
- **Span / trace:** recorded step / recorded run.
- **Spread:** the 0.2% cost on each trade.
- **Sub-agent:** an agent another agent calls as a tool (Researcher, Synthesizer).
