// Decisions: why did this trade happen? Every fill on the left; for the selected
// one, the whole run behind it on one screen: the agent's reason, the research it
// had, the prices it looked up, every order it tried, the strategy in force, the
// portfolio before and after, and the SDK's span timeline with a link to the raw
// trace.

import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getRun,
  type AccountState,
  type Claim,
  type PlaybookCheck,
  type RunDetail,
  type ThesisCheck,
  type TimelineSpan,
  type ToolCall,
} from "../api";
import { Change, Failed, Loading, PageHeader, Panel, TraderName } from "../components/bits";
import { useDesk, type Desk } from "../lib/desk";
import type { Fill } from "../lib/ledger";
import { fillPnl, mentions } from "../lib/research";
import { count, duration, elapsed, host, longDate, money, price, stamp, time, tokens } from "../lib/format";
import { RunTrace, buildTrace, useReplay, type Trace } from "../components/RunTrace";
import { TraderPills, useTraderFilter } from "../lib/filter";

export function Decisions() {
  const { desk, error, loading } = useDesk();
  const [params, setParams] = useSearchParams();
  const [trader, setTrader] = useTraderFilter();
  const fills = useMemo(() => desk?.fills.filter((f) => !trader || f.trader === trader) ?? [], [desk, trader]);
  const traced = useMemo(() => fills.filter((f) => f.traceId), [fills]);
  const selected = desk?.fills.find((f) => f.id === params.get("fill")) ?? traced[0] ?? fills[0] ?? null;
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("fill", id);
    setParams(next);
  };
  const maxPnl = Math.max(1, ...fills.map((f) => Math.abs((desk && fillPnl(desk, f)) ?? 0)));

  let finding: React.ReactNode = "Reading the fills…";
  if (desk) {
    finding = !desk.fills.length
      ? "No trades yet."
      : traced.length
        ? `${count(traced.length)} of ${count(desk.fills.length)} fills with full run saved: research, prices, orders, portfolio before and after.`
        : "No saved runs yet; next cycle's trades will have them.";
  }

  return (
    <div className="view">
      <PageHeader
        kicker={`Every fill and the run behind it · ${longDate(desk?.updatedAt ?? Date.now())}`}
        title="Decisions"
        finding={finding}
        aside={desk && <p className="fresh num">Updated {time(desk.updatedAt)} · every 6 s</p>}
      />
      {error && !desk && <Failed what="the fills" error={error} />}
      {loading && <Loading rows={8} />}
      {desk && (
        <TraderPills
          value={trader}
          onChange={setTrader}
          traders={desk.books.map((b) => b.trader.name.toLowerCase())}
          counts={Object.fromEntries(desk.books.map((b) => [b.trader.name.toLowerCase(), b.fills.length]))}
          total={desk.fills.length}
        />
      )}
      {desk && (
        <div className="grid-detail list-detail">
          <Panel title="Fills" id="fills" className="sticky" meta={<span className="num">{count(fills.length)}, newest first</span>}>
            {fills.length ? (
              <div className="table-wrap scroll-list">
                <table className="table blotter">
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Time</th>
                      <th scope="col" className="num">
                        P&amp;L
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fills.map((f) => {
                      const pnl = fillPnl(desk, f);
                      return (
                        <tr
                          key={f.id}
                          aria-selected={f.id === selected?.id}
                          tabIndex={0}
                          onClick={() => select(f.id)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(f.id))}
                        >
                          <td className="ident">
                            <TraderName name={f.trader} />{" "}
                            <span className="side" data-side={f.side}>
                              {f.side === "buy" ? "buys" : "sells"}
                            </span>{" "}
                            {f.symbol}
                          </td>
                          <td className="tnum muted">
                            {f.traceId && <span className="run-dot" title="Run saved" aria-label="Run saved" />}
                            {stamp(f.time)}
                          </td>
                          <td className="num">
                            {pnl !== null ? <Change value={pnl} /> : <span className="dash">—</span>}
                            {pnl !== null && Math.abs(pnl) >= 0.005 && (
                              <span
                                className="pnl-bar"
                                data-tone={pnl > 0.005 ? "good" : pnl < -0.005 ? "bad" : "flat"}
                                style={{ width: `${Math.max(2, (Math.abs(pnl) / maxPnl) * 56)}px` }}
                                aria-hidden="true"
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">No fills yet.</p>
            )}
          </Panel>
          {selected ? <Decision key={selected.id} desk={desk} fill={selected} /> : <p className="empty">Pick a fill.</p>}
        </div>
      )}
    </div>
  );
}

function Decision({ desk, fill }: { desk: Desk; fill: Fill }) {
  const run = useQuery({
    queryKey: ["run", fill.traceId],
    queryFn: () => getRun(fill.traceId!),
    enabled: !!fill.traceId,
    staleTime: 30_000,
  });
  const pnl = fillPnl(desk, fill);
  const focus = useMemo(() => ({ side: fill.side, symbol: fill.symbol }), [fill.side, fill.symbol]);
  const trace = useMemo(() => (run.data ? buildTrace(run.data.timeline, focus) : null), [run.data, focus]);
  const replay = useReplay(trace?.steps ?? []);

  return (
    <div className="stack">
      <section className="panel decision-card" aria-labelledby="decision">
        <header className="panel-head">
          <h2 id="decision" className="decision-title">
            <TraderName name={fill.trader} /> {fill.side === "buy" ? "bought" : "sold"} <span className="num">{count(fill.quantity)}</span>{" "}
            {fill.symbol} at <span className="num">{price(fill.price)}</span> · <span className="num">{stamp(fill.time)}</span>
          </h2>
          {trace && trace.steps.length > 0 && (
            <button className="btn-primary replay-btn" onClick={replay.toggle} aria-pressed={replay.playing}>
              {replay.playing ? "Stop replay" : "Replay this run"}
            </button>
          )}
        </header>
        <blockquote className="decision-serif">{fill.rationale}</blockquote>
        <p className="decision-strip num">
          {fill.side === "sell" && fill.costBasis !== undefined ? (
            <>
              <span>
                <span className="muted">Proceeds</span> {money(fill.quantity * fill.price)}
              </span>
              <span>
                <span className="muted">Cost</span> {money(fill.costBasis)}
              </span>
              <span>
                <span className="muted">Result</span> <Change value={fill.realized!} />
              </span>
              {fill.heldMs !== undefined && (
                <span>
                  <span className="muted">Held</span> {duration(fill.heldMs)}
                </span>
              )}
            </>
          ) : (
            <>
              <span>
                <span className="muted">Cost</span> {money(fill.quantity * fill.price)}
              </span>
              <span>
                <span className="muted">{pnl !== null ? "Worth now" : "Status"}</span>{" "}
                {pnl !== null ? <Change value={pnl} /> : "no longer held"}
              </span>
              <span>
                <span className="muted">Spread paid</span> {money(fill.spread)}
              </span>
            </>
          )}
        </p>
      </section>

      {!fill.traceId ? (
        <p className="empty">
          This fill came before runs were saved, so only the agent's reason above was recorded. Fills from the next cycle on show their
          research, prices, orders and portfolio here.
        </p>
      ) : run.error ? (
        <Failed what="the run behind this fill" error={run.error as Error} />
      ) : !run.data || !trace ? (
        <Loading rows={4} />
      ) : (
        <RunPanels run={run.data} fill={fill} desk={desk} trace={trace} replay={replay} />
      )}
    </div>
  );
}

/** Things worth a look in a run, found from its trace without reading the log. */
function Flags({ run, fill, trace }: { run: RunDetail; fill: Fill; trace: Trace }) {
  const flags: { tone: "good" | "bad" | "flat"; text: ReactNode }[] = [];
  if (trace.firstOrder !== null && trace.researchEnd !== null) {
    const gap = trace.firstOrder - trace.researchEnd;
    if (gap > 5 * 60_000) flags.push({ tone: "bad", text: <>{elapsed(gap)} passed between the research ending and the first order.</> });
    else if (gap >= 0) flags.push({ tone: "good", text: <>The first order went in {elapsed(gap)} after the research ended.</> });
  }
  if (trace.firstOrder !== null) {
    flags.push(
      trace.memoryReadBeforeOrder
        ? { tone: "good", text: "It read its memory before the first order." }
        : { tone: "bad", text: "No memory read before the first order: what it learned before was not consulted." },
    );
  }
  if (run.research.length) {
    const named = run.research.some((r) => mentions(r.answer, fill.symbol));
    flags.push(
      named
        ? { tone: "good", text: <>The research named {fill.symbol}.</> }
        : { tone: "bad", text: <>None of the research named {fill.symbol}: the order was not backed by it.</> },
    );
  } else {
    flags.push({ tone: "flat", text: "No research in this run; it decided on prices and its own account." });
  }
  if (trace.failedOrders) flags.push({ tone: "bad", text: `${trace.failedOrders} of ${trace.orders} orders failed.` });
  flags.push({
    tone: "flat",
    text: (
      <>
        The model was thinking for {Math.round((trace.thinkMs / trace.total) * 100)}% of the run's {elapsed(trace.total)}.
      </>
    ),
  });
  return (
    <ul className="flags">
      {flags.map((f, i) => (
        <li key={i} data-tone={f.tone}>
          {f.text}
        </li>
      ))}
    </ul>
  );
}

function RunPanels(props: { run: RunDetail; fill: Fill; desk: Desk; trace: Trace; replay: ReturnType<typeof useReplay> }) {
  const { run, fill, desk, trace, replay } = props;
  const otherFills = desk.fills.filter((f) => f.traceId === run.trace_id && f.id !== fill.id);
  const t0 = run.started_at ? new Date(run.started_at).getTime() : null;
  return (
    <>
      <Panel
        title="Run trace"
        id="trace"
        meta={
          <span className="num">
            {t0 ? `${time(t0)} → ${time(t0 + trace.total)} · ` : ""}
            {elapsed(trace.total)} · {tokens(run.usage.input_tokens + run.usage.output_tokens)} tokens
          </span>
        }
      >
        <RunTrace
          spans={run.timeline}
          startedAt={run.started_at}
          focus={{ side: fill.side, symbol: fill.symbol }}
          highlight={replay.step?.id ?? null}
        />
        <p className="replay-caption" aria-live="polite">
          {replay.step ? (
            <>
              <span className="num">
                Step {replay.index! + 1} of {trace.steps.length} · +{elapsed(replay.step.start)}
              </span>{" "}
              {replay.step.label}
            </>
          ) : (
            <span className="muted">
              Each bar is a saved span at its real time in the run. Replay walks them in order: question, research, data, order, fill.
            </span>
          )}
        </p>
      </Panel>

      <div className="grid-halves rows-start">
        <Panel title="Portfolio before → after" id="portfolio">
          <BeforeAfter before={run.before} after={run.after} />
        </Panel>
        <Panel title="What the trace shows" id="flags" className="flags-panel">
          <Flags run={run} fill={fill} trace={trace} />
        </Panel>
      </div>

      {run.thesis && <ThesisPanel check={run.thesis} />}
      {run.playbook && <PlaybookPanel check={run.playbook} fill={fill} />}
      <Panel
        title="Research it had"
        id="research"
        meta={<span className="num">{run.research.length ? `${run.research.length} requests` : "none"}</span>}
      >
        {run.research.length ? (
          <ul className="evidence">
            {run.research.map((r) => (
              <li key={r.id}>
                <p className="evidence-ask">
                  Asked: <span className="muted">{r.request}</span>
                </p>
                <div className="answer-text">{r.answer || "No answer recorded."}</div>
                <p className="note">
                  {mentions(r.answer, fill.symbol) ? (
                    <span className="tag" data-tone="good">
                      Names {fill.symbol}
                    </span>
                  ) : (
                    <span className="tag">Does not name {fill.symbol}</span>
                  )}{" "}
                  {r.sources.slice(0, 4).map((s, i) => (
                    <span key={s.url}>
                      {i > 0 && ", "}
                      <a className="text-link" href={s.url} target="_blank" rel="noreferrer">
                        {host(s.url)}
                      </a>
                    </span>
                  ))}
                  {r.sources.length > 4 && ` and ${r.sources.length - 4} more`} ·{" "}
                  <Link className="text-link" to={`/researcher?id=${r.id}`}>
                    Open in Researcher
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">The trader did not call the researcher in this run; it decided on prices and its own account alone.</p>
        )}
      </Panel>

      <div className="grid-halves rows-start">
        <Panel title="Prices and data it looked up" id="market" meta={<span className="num">{run.market_calls.length} calls</span>}>
          <Calls calls={run.market_calls} empty="No market data calls in this run." />
        </Panel>
        <Panel title="Orders it tried" id="orders" meta={<span className="num">{run.orders.length} orders</span>}>
          <Calls calls={run.orders} empty="No orders in this run." />
          {otherFills.length > 0 && (
            <p className="note">
              Also filled in this run:{" "}
              {otherFills.map((f, i) => (
                <span key={f.id}>
                  {i > 0 && ", "}
                  <Link className="text-link" to={`/decisions?fill=${f.id}`}>
                    {f.side} {f.symbol}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </Panel>
      </div>

      <Panel title="Strategy in force" id="strategy" meta={run.mode && <span>{MODE[run.mode] ?? run.mode}</span>}>
        {run.strategy?.trim() ? <p className="strategy-text">{run.strategy.trim()}</p> : <p className="muted">Not recorded.</p>}
      </Panel>

      <Panel
        title="Run details"
        id="timeline"
        meta={
          run.openai_trace_url ? (
            <a className="text-link" href={run.openai_trace_url} target="_blank" rel="noreferrer">
              Open the raw trace
            </a>
          ) : (
            <span>From the saved SDK spans</span>
          )
        }
      >
        <p className="note num">
          {run.usage.model_calls} model calls · {tokens(run.usage.input_tokens)} tokens in, {tokens(run.usage.output_tokens)} out ·{" "}
          {run.mcp_listings} MCP tool listings
          {run.error && (
            <span className="money-tone" data-tone="bad">
              {" "}
              · Run ended with {run.error}
            </span>
          )}
        </p>
        {run.output && <blockquote className="decision-quote small">{run.output}</blockquote>}
      </Panel>
    </>
  );
}

const MODE: Record<string, string> = {
  trade: "Trading run",
  rebalance: "Rebalancing run",
  "thesis-first": "First thesis run",
  "thesis-regime": "Thesis run: the regime changed",
  "thesis-weekly": "Thesis run: weekly rebalance",
  check: "Brake check",
};

const STATUS: Record<string, string> = { pass: "Passed", fail: "Broke", unknown: "Unknown" };

/** A claim and where it came from; a source the run never had is flagged. */
function Cited({ claim, grounded }: { claim: Claim; grounded: boolean }) {
  return (
    <>
      {claim.text}{" "}
      <span className="tag" data-tone={grounded ? undefined : "bad"} title={grounded ? "Found in this run" : "This run had no such source"}>
        {grounded ? claim.source : `uncited: ${claim.source || "no source"}`}
      </span>
    </>
  );
}

/** Robin's Synthesizer: the thesis it wrote, with every claim checked against the run's own sources. */
function ThesisPanel({ check }: { check: ThesisCheck }) {
  const t = check.thesis;
  const ok = (c: Claim) => check.claims.find((x) => x.text === c.text && x.source === c.source)?.grounded ?? false;
  if (!t) {
    return (
      <Panel title="Synthesizer thesis" id="thesis">
        <p className="muted">The Synthesizer's reply was not a readable thesis.</p>
        {check.raw && <blockquote className="decision-quote small">{check.raw}</blockquote>}
      </Panel>
    );
  }
  return (
    <Panel
      title="Synthesizer thesis"
      id="thesis"
      meta={
        <span className="num">
          {t.regime} · confidence {Math.round(t.confidence * 100)}% · {t.horizon_days} days
        </span>
      }
    >
      <p className="decision-head">
        {check.uncited ? (
          <span className="money-tone" data-tone="bad">
            {check.uncited} of {check.claims.length} claims cite nothing this run had
          </span>
        ) : (
          <span className="money-tone" data-tone="good">
            Every claim cites a source from this run
          </span>
        )}
      </p>
      <blockquote className="decision-quote small">{t.summary}</blockquote>
      <div className="grid-halves rows-start thesis-grid">
        <div>
          <h3 className="sub-head">Signals</h3>
          <ul className="thesis-list">
            {t.signals.map((s, i) => (
              <li key={i}>
                <span className="tag" data-tone={s.stance === "for" ? "good" : "bad"}>
                  {s.stance}
                </span>{" "}
                <span className="strong">{s.signal}</span>: <Cited claim={s.evidence} grounded={ok(s.evidence)} />
              </li>
            ))}
          </ul>
          <h3 className="sub-head">Story against numbers</h3>
          {t.conflicts.length ? (
            <ul className="thesis-list">
              {t.conflicts.map((c, i) => (
                <li key={i}>
                  <p>
                    Story: <Cited claim={c.story} grounded={ok(c.story)} />
                  </p>
                  <p>
                    Numbers: <Cited claim={c.numbers} grounded={ok(c.numbers)} />
                  </p>
                  <p className="muted">
                    <span className="strong">
                      {c.winner === "unresolved" ? "Unresolved" : `${c.winner === "story" ? "Story" : "Numbers"} win`}
                    </span>
                    : {c.why}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No conflict named.</p>
          )}
        </div>
        <div>
          <h3 className="sub-head">Target weights</h3>
          {t.targets.length ? (
            <table className="table">
              <tbody>
                {t.targets.map((w) => (
                  <tr key={w.symbol}>
                    <th scope="row" className="ident">
                      {w.symbol}
                    </th>
                    <td className="num">{(w.weight * 100).toFixed(1)}%</td>
                    <td className="muted">{w.reason}</td>
                  </tr>
                ))}
                <tr className="kv-break">
                  <th scope="row">Cash</th>
                  <td className="num">{(Math.max(0, 1 - t.targets.reduce((s, w) => s + w.weight, 0)) * 100).toFixed(1)}%</td>
                  <td />
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">All cash.</p>
          )}
          <h3 className="sub-head">Invalidated if</h3>
          <ul className="thesis-list">
            {t.invalidation.map((c, i) => (
              <li key={i}>
                <Cited claim={c} grounded={ok(c)} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

/** Which rules of the trader's playbook this order passed or broke, from what the run saw. */
function PlaybookPanel({ check, fill }: { check: PlaybookCheck; fill: Fill }) {
  const mine = check.orders.find((o) => o.order.symbol === fill.symbol && o.order.side === fill.side);
  const others = check.orders.filter((o) => o !== mine);
  const broke = mine?.rules.filter((r) => r.status === "fail").length ?? 0;
  return (
    <Panel
      title="Playbook check"
      id="playbook"
      meta={
        <span>
          {check.name} · <span className="num">{check.id}</span>
        </span>
      }
    >
      {mine ? (
        <>
          <p className="decision-head">
            {broke ? (
              <span className="money-tone" data-tone="bad">
                Broke {broke} of {mine.rules.length} rules
              </span>
            ) : (
              <span className="money-tone" data-tone="good">
                Kept all {mine.rules.length} rules it could be checked on
              </span>
            )}
          </p>
          <div className="table-wrap">
            <table className="table playbook-rules">
              <tbody>
                {mine.rules.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="num">
                      {r.id}
                    </th>
                    <td>{r.text}</td>
                    <td>
                      <span className="tag" data-tone={r.status === "pass" ? "good" : r.status === "fail" ? "bad" : undefined}>
                        {STATUS[r.status]}
                      </span>
                    </td>
                    <td className="muted">{r.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted">This fill's order was not found among the run's completed orders.</p>
      )}
      {others.length > 0 && (
        <p className="note">
          Other orders in this run:{" "}
          {others
            .map((o) => {
              const n = o.rules.filter((r) => r.status === "fail").length;
              return `${o.order.side} ${o.order.symbol} ${n ? `broke ${n}` : "kept all"}`;
            })
            .join(" · ")}
        </p>
      )}
    </Panel>
  );
}

function argText(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([k]) => k !== "rationale")
    .map(([k, v]) => `${k} ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

function Calls({ calls, empty }: { calls: ToolCall[]; empty: string }) {
  if (!calls.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="calls">
      {calls.map((c) => (
        <li key={c.id} data-failed={!!c.error}>
          <p>
            <span className="strong">{c.name}</span> <span className="muted">{argText(c.args)}</span>
          </p>
          <p className="call-result">{c.error ? `Failed: ${c.error.message ?? "error"}` : c.result || "No result"}</p>
        </li>
      ))}
    </ul>
  );
}

function BeforeAfter({ before, after }: { before: AccountState | null; after: AccountState | null }) {
  if (!before) return <p className="muted">Not recorded.</p>;
  const changed = (s: string) => (before.holdings[s] ?? 0) !== (after?.holdings[s] ?? 0);
  const symbols = [...new Set([...Object.keys(before.holdings), ...Object.keys(after?.holdings ?? {})])].sort(
    (a, b) => Number(changed(b)) - Number(changed(a)) || a.localeCompare(b),
  );
  const delta = (a: number | null | undefined, b: number | null | undefined) =>
    a !== null && a !== undefined && b !== null && b !== undefined ? <Change value={b - a} /> : <span className="dash">—</span>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col" className="num">
              Before
            </th>
            <th scope="col" className="num">
              After
            </th>
            <th scope="col" className="num">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Portfolio value</th>
            <td className="num">{before.portfolio_value !== null ? money(before.portfolio_value) : "—"}</td>
            <td className="num strong">{after?.portfolio_value != null ? money(after.portfolio_value) : "—"}</td>
            <td className="num">{delta(before.portfolio_value, after?.portfolio_value)}</td>
          </tr>
          <tr>
            <th scope="row">Cash</th>
            <td className="num">{before.balance !== null ? money(before.balance) : "—"}</td>
            <td className="num">{after?.balance != null ? money(after.balance) : "—"}</td>
            <td className="num">{delta(before.balance, after?.balance)}</td>
          </tr>
          {symbols.map((s) => {
            const a = before.holdings[s] ?? 0;
            const b = after?.holdings[s] ?? 0;
            return (
              <tr key={s} data-changed={!!after && b !== a}>
                <th scope="row" className="ident">
                  {s} shares
                </th>
                <td className="num">{count(a)}</td>
                <td className="num">{after ? count(b) : "—"}</td>
                <td className="num">{after && b !== a ? (b > a ? "+" : "−") + count(Math.abs(b - a)) : <span className="dash">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The Lab's trial sheet shows a trial's spans the same way. */
export function Timeline({ spans, startedAt = null }: { spans: TimelineSpan[]; startedAt?: string | null }) {
  return <RunTrace spans={spans} startedAt={startedAt} />;
}
