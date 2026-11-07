# Traders Lab: visual upgrade plan, tab by tab

Based on the live app at localhost:5173 (6 Nov 2026). Keep the current look: dark ground, lime accent, mono numbers, one colour per trader. All of these ideas build on that look.

## 0. Shared system (do this first)

- **One chart kit.** Use d3 (scales, shapes, transitions) and wrap it in your own components: `<LineChart>`, `<DotPlot>`, `<Heatmap>`, `<Swimlane>`, `<Treemap>`. Every chart shares the same axis, tooltip, annotation and empty-state style.
- **Annotation layer.** Elegant dashboards explain their charts in place. Add a small `annotate({x, y, text, dir})` helper that draws a thin leader line and a short label. Put 1–3 notes on each main chart, e.g. "NVDA sell +$1,943, the desk's best trade".
- **Cross-filter.** Clicking the trader pills on any tab, or a trader's line or dot in a chart, dims everything else on the page. Keep the selected trader in the URL (`?trader=warren`) so it stays the same across tabs.
- **Story mode.** Each story-worthy tab gets a toggle in the top right: **Dashboard | Story**. Story is the scrollyteller. It shows the same charts in a sticky panel, with steps that scroll past on the left.
  - Tech: `scrollama` (or a 30-line IntersectionObserver hook) plus a sticky `<figure>`. Each step calls `chart.setState({...})` and d3 animates the change over about 600 ms.
  - Respect `prefers-reduced-motion`: jump between states instead of animating.
- **Motion rules.** Animate only when a value changes (the 6 s poll), not on every render. Count-up the big numbers. Flash the changed row lime for about 400 ms.

---

## 1. Money

**Now:** a step-line equity chart where the five traders overlap near $10k, a drawdown strip, a P&L list and trader cards.

**Problems:** at the $10k start the lines pile up and can't be told apart. Warren's jumps squash everyone else's movement. The "left out one-sample jumps" note is a sign of a data-quality issue worth fixing at the source.

**Dashboard upgrades**
- **Indexed return chart (%), not $.** Add a toggle for log scale. Label each line at its right-hand end, which you already do; add a small dot at the latest value too.
- **Small multiples:** one mini equity + drawdown pair per trader, all on the same y scale. This shows who is volatile and who is flat (Jim at 0%) at a glance.
- **P&L waterfall:** $50,000 funded → realized +$3,858 → unrealized +$2,248 → spread −$211 → now. It replaces the P&L list and reads in two seconds.
- **Contribution bar:** each trader's $ contribution to the desk's +$5.6k, diverging from zero.
- **Risk/return scatter:** return on x, worst drawdown on y, one dot per trader, with a line connecting each trader's path over the last 7 days.

**Scrollyteller: "How the desk got to +11%"**
1. Five traders, $10k each, five flat lines.
2. 3 Nov: Warren breaks away. Highlight his line and annotate the fill behind the jump.
3. The others sink. Shade the desk's drawdown, worst −16.65%.
4. The recovery. Morph the chart into the P&L waterfall.
5. End on today's split: Warren +75%, George −10%.

---

## 2. Trades

**Now:** a holdings table and a record card. The record card holds the key insight (27% win rate yet profitable), but it is buried.

**Dashboard upgrades**
- **Exposure treemap:** trader → symbol, area = value, colour = unrealized % (diverging red/lime). Concentration risk stands out at once: Cathie's INSM 59%, Ray's QQQ 55%.
- **Fill timeline (beeswarm):** x = time, one lane per trader, dot size = notional, filled dot = buy, ring = sell, ring colour = P&L. This shows the trading rhythm and the 60 fills in one view.
- **Win/loss payoff chart:** a dot plot of all 30 closing sells on a $ axis. Mark the average win (+$755) and the average loss (−$99). The headline is "wins are 7.6× bigger than losses": low hit rate, positive skew.
- **Holding period vs return scatter:** do longer holds pay?
- Keep the table, but add an inline bar in the Weight column and a sparkline of price since entry in each row.

**Scrollyteller: "27% right, still in profit"**
1. 30 sells appear as dots: 22 red, 8 lime.
2. The dots spread out by size: the lime ones are far bigger.
3. NVDA alone (+$1,943) is half the realized gain.
4. Pull back to the treemap: what's still open and at risk.

---

## 3. Researcher

**Now:** a request table and a pane for the answer text.

**Dashboard upgrades**
- **Sankey/funnel:** 53 requests → named a stock → traded in the same run (31) → winners/losers → +$2,814. This is the tab's headline as a single picture.
- **Cost vs outcome scatter:** x = time taken (minutes), y = tokens, colour = led to trade / no trade / traded other names, size = sources. It shows whether long research is wasted.
- **Source domains bar:** which sites (seekingalpha, youtube, tavily…) feed decisions, split by whether the run made money.
- **Ticker mention heatmap:** trader × ticker, how often each was researched vs traded. It catches "researches NVDA all day, never trades it".
- **Answer pane:** turn the answer's markdown into rendered text, with tickers highlighted as chips that link to Trades.

**Scrollyteller: "Does research move money?"** Walk through the funnel one stage at a time, then zoom into one full request → answer → trade → P&L chain.

---

## 4. Decisions

**Now:** a fill list and a detail view (research, prices, orders, before/after, strategy, run timeline). It has rich data, but all of it is shown as text.

**Dashboard upgrades**
- **Run trace waterfall:** the "Run timeline" as a horizontal Gantt, the way trace viewers like Jaeger show it. Bars for research, each price lookup, each order attempt, the fill, and memory reads. This one chart would make the tab impressive.
- **Before/after portfolio:** a slope chart, or two stacked bars with ribbons linking the symbols, so the change jumps out.
- **Decision card:** keep the quote and make it bigger, in serif, with proceeds/cost/held in a mono strip under it (you already have this; give it more room).
- **Fill list:** add a tiny inline P&L bar and a "run saved" dot instead of the text.

**Scrollyteller (per fill), "Anatomy of a trade":** the steps follow the trace from question → research → data → order → fill → result. The sticky panel highlights each bar of the waterfall in turn. It works as a "replay" button on any saved run.

---

## 5. Lessons

**Now:** the empty state is clear, but it's text.

**Dashboard upgrades**
- **Review calendar:** a strip of the next 14 days with a dot for each pending 3-day and 10-day review, coloured by trader. "First lesson in 1 day" becomes visible.
- **When lessons exist:**
  - a dot plot of each reviewed trade's return minus SPY's (the review's own metric);
  - a lesson timeline per trader, with overturned lessons shown as crossed links.
- **Recall rate gauge:** the share of runs that read a lesson before their first order.

**Story:** wait until there is data.

---

## 6. Memory

**Now:** a force graph, but with 0 relations it collapses into a grid of circles with overlapping labels.

**Problem and insight:** "Saved runs read it no times at all." That is the real story: the traders write memory but never use it. Make it the headline visual, not a sentence.

**Dashboard upgrades**
- **Fallback layout when relations = 0:** packed bubbles grouped by kind (stock / lesson / pattern), sized by observations. Prevent label collisions: put labels outside the bubbles with leader lines, or show them only on hover for small bubbles.
- **Write vs read chart:** two bars per trader, memory writes vs memory reads by runs. The empty read bar makes the point.
- **Comparison mode:** an entity overlap matrix (traders × entities) or a Venn of shared names, instead of two graphs side by side.
- **Observation timeline:** when each fact was written, one lane per entity.

---

## 7. Market Year (already your strongest)

**Now:** 14 SVGs, a regime-shaded SPY chart, Rules/HMM strips and numbered transitions. This page is the template for the rest of the app.

**Check:** the headline says "the HMM agrees (0%)", but the HMM breakdown shows Calm chop 100% and Calm bull 0%. That reads as a contradiction or bug in the agreement text. Verify it.

**Dashboard upgrades**
- **HMM probability ribbon:** a stacked area of the four regime probabilities over time, under the price chart. It shows how sure the model is, not only its label.
- **Signal × regime heatmap:** Sharpe for each signal in each regime, with the current regime's column outlined. This replaces the scoreboard table.
- **Desk positioning gauge:** 72% risk-on on a semicircle, with each trader as a tick mark.
- **Indicator panel:** each row (vol 20d, percentile, vs 200-day…) gets a sparkline plus a marker showing where it sits in its 10-year range.

**Scrollyteller: "The year in 7 transitions"** (the natural fit; the numbered marks are already story steps). Each step zooms the SPY chart to one episode, shades the regime, shows the HMM probabilities shifting and the news you already attach, and ends on "where the desk is positioned now".

---

## 8. Experiments

**Now:** a scenario checklist and a wide baseline table.

**Dashboard upgrades**
- **Scenario × baseline heatmap:** cell = return, outline = Pass/Partial/Fail, plus a random-agent column as the bar to clear. It's far easier to scan than the current table.
- **Arm results (when runs exist):** a dot plot per scenario, with repeated trials as small dots, a mean bar, and the random agent (57%) as a dashed reference line. A wins/draws/losses vs random summary strip.
- **Build-a-run:** show a live "N arms × M trials = K runs, ~T min" estimate as the boxes are ticked.

---

## 9. Failures (phase 6 placeholder)

Plan the visuals now:
- **Fault catalogue matrix:** fault (feed down, stale prices, researcher timeout, broker rejection) × expected/actual outcome, with each cell linked to its trace.
- **V1 vs now:** a paired bar or dumbbell per fault.
- **Incident timeline** across the desk.

---

## 10. Health

**Now:** 40 raw log lines, mostly paired "Started/Ended mcp_tools" noise.

**Dashboard upgrades**
- **Collapse start/end pairs into spans** and draw an **agent activity swimlane:** one lane per trader, bars for turn / generation / tool / function. It shows at a glance what each agent is doing and for how long.
- **Event-rate sparkline** per trader (events/min). A flatline means a stuck agent.
- **Latency distribution:** box or strip plot of span duration by kind (generation, mcp_tools, function).
- **Status tiles** for the planned items: MCP servers, model speed, queue, feed freshness (age of last price in seconds, coloured by threshold), DB size, errors.
- Keep the raw log behind a "Show raw" toggle.

---

## Suggested build order

1. Shared chart kit, annotation helper, cross-filter.
2. Decisions run-trace waterfall and Health swimlane (same component, big impact).
3. Trades treemap and payoff chart; Money waterfall and small multiples.
4. Story mode on Market Year (easiest: the steps already exist), then Money and Trades.
5. Researcher sankey, Memory write-vs-read chart, Experiments heatmap.
