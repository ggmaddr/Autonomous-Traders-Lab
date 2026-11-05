// Decisions: why did this trade happen? Every fill on the left; for the selected
// one, the whole run behind it on one screen: the agent's reason, the research it
// had, the prices it looked up, every order it tried, the strategy in force, the
// portfolio before and after, and the SDK's span timeline with a link to the raw
// trace.

import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRun, type AccountState, type RunDetail, type TimelineSpan, type ToolCall } from "../api";
import { Change, Failed, Loading, PageHeader, Panel, TraderName } from "../components/bits";
import { useDesk, type Desk } from "../lib/desk";
import type { Fill } from "../lib/ledger";
import { fillPnl, mentions } from "../lib/research";
import { count, duration, elapsed, host, longDate, money, price, stamp, time, tokens } from "../lib/format";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Decisions() {
  const { desk, error, loading } = useDesk();
  const [params, setParams] = useSearchParams();
  const traced = useMemo(() => desk?.fills.filter((f) => f.traceId) ?? [], [desk]);
  const selected = desk?.fills.find((f) => f.id === params.get("fill")) ?? traced[0] ?? desk?.fills[0] ?? null;
  const select = (id: string) => setParams({ fill: id });

  let finding: React.ReactNode = "Reading the fills…";
  if (desk) {
    finding = !desk.fills.length
      ? "No trades yet, so there is nothing to explain."
      : traced.length
        ? `${count(traced.length)} of ${count(desk.fills.length)} fills have their full run saved: the research, the prices, every order tried and the portfolio before and after.`
        : "None of the fills have a saved run yet; they came before span saving began. The next cycle's trades will.";
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
        <div className="grid-detail list-detail">
          <Panel title="Fills" id="fills" className="sticky" meta={<span className="num">{count(desk.fills.length)}, newest first</span>}>
            {desk.fills.length ? (
              <div className="table-wrap scroll-list">
                <table className="table blotter">
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Time</th>
                      <th scope="col" className="num">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {desk.fills.map((f) => {
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
                            {stamp(f.time)}
                            {f.traceId && <span className="traced"> · run saved</span>}
                          </td>
                          <td className="num">{pnl !== null ? <Change value={pnl} /> : <span className="dash">—</span>}</td>
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
          {selected ? <Decision desk={desk} fill={selected} /> : <p className="empty">Pick a fill.</p>}
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

  return (
    <div className="stack">
      <Panel
        title={`${cap(fill.trader)} ${fill.side === "buy" ? "bought" : "sold"} ${fill.symbol}`}
        id="decision"
        meta={<span className="num">{stamp(fill.time)}</span>}
      >
        <p className="decision-head">
          <TraderName name={fill.trader} /> {fill.side === "buy" ? "bought" : "sold"} <span className="num">{count(fill.quantity)}</span>{" "}
          {fill.symbol} at <span className="num">{price(fill.price)}</span> for{" "}
          <span className="num">{money(fill.quantity * fill.price)}</span>
        </p>
        <blockquote className="decision-quote small">{fill.rationale}</blockquote>
        <p className="lot-math num">
          {fill.side === "sell" && fill.costBasis !== undefined ? (
            <>
              Proceeds {money(fill.quantity * fill.price)} − cost {money(fill.costBasis)} = <Change value={fill.realized!} />
              {fill.heldMs !== undefined && <span className="muted"> · held {duration(fill.heldMs)}</span>}
            </>
          ) : pnl !== null ? (
            <>
              Worth <Change value={pnl} /> against its cost now · spread paid {money(fill.spread)}
            </>
          ) : (
            <>No longer held · spread paid {money(fill.spread)}</>
          )}
        </p>
      </Panel>

      {!fill.traceId ? (
        <p className="empty">
          This fill came before runs were saved, so only the agent's reason above was recorded. Fills from the next cycle on
          show their research, prices, orders and portfolio here.
        </p>
      ) : run.error ? (
        <Failed what="the run behind this fill" error={run.error as Error} />
      ) : !run.data ? (
        <Loading rows={4} />
      ) : (
        <RunPanels run={run.data} fill={fill} desk={desk} />
      )}
    </div>
  );
}

function RunPanels({ run, fill, desk }: { run: RunDetail; fill: Fill; desk: Desk }) {
  const otherFills = desk.fills.filter((f) => f.traceId === run.trace_id && f.id !== fill.id);
  return (
    <>
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
                    <span className="tag" data-tone="good">Names {fill.symbol}</span>
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

      <div className="grid-lead rows-start">
        <Panel title="Portfolio before and after this run" id="portfolio">
          <BeforeAfter before={run.before} after={run.after} />
        </Panel>
        <Panel title="Strategy in force" id="strategy" meta={run.mode && <span>{run.mode === "trade" ? "Trading run" : "Rebalancing run"}</span>}>
          {run.strategy?.trim() ? <p className="strategy-text">{run.strategy.trim()}</p> : <p className="muted">Not recorded.</p>}
        </Panel>
      </div>

      <Panel
        title="Run timeline"
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
        <Timeline spans={run.timeline} />
        <p className="note num">
          {run.usage.model_calls} model calls · {tokens(run.usage.input_tokens)} tokens in, {tokens(run.usage.output_tokens)} out ·{" "}
          {run.mcp_listings} MCP tool listings
          {run.error && <span className="money-tone" data-tone="bad"> · Run ended with {run.error}</span>}
        </p>
        {run.output && <blockquote className="decision-quote small">{run.output}</blockquote>}
      </Panel>
    </>
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
  const symbols = [...new Set([...Object.keys(before.holdings), ...Object.keys(after?.holdings ?? {})])].sort();
  const delta = (a: number | null | undefined, b: number | null | undefined) =>
    a !== null && a !== undefined && b !== null && b !== undefined ? <Change value={b - a} /> : <span className="dash">—</span>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col" />
          <th scope="col" className="num">Before</th>
          <th scope="col" className="num">After</th>
          <th scope="col" className="num">Change</th>
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
            <tr key={s}>
              <th scope="row" className="ident">{s} shares</th>
              <td className="num">{count(a)}</td>
              <td className="num">{after ? count(b) : "—"}</td>
              <td className="num">{after && b !== a ? (b > a ? "+" : "−") + count(Math.abs(b - a)) : <span className="dash">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const KIND: Record<string, string> = {
  agent: "Agent",
  generation: "Model",
  function: "Tool",
  handoff: "Handoff",
  guardrail: "Guardrail",
  task: "Task",
  turn: "Turn",
  custom: "Step",
};

function Timeline({ spans }: { spans: TimelineSpan[] }) {
  const shown = spans.filter((s) => s.type !== "task" && s.type !== "turn");
  if (!shown.length) return <p className="muted">No spans saved for this run.</p>;
  const total = Math.max(1, ...shown.map((s) => (s.offset_ms ?? 0) + (s.duration_ms ?? 0)));
  return (
    <ol className="waterfall" aria-label="Spans in the order they started">
      {shown.map((s) => (
        <li key={s.id} data-type={s.type} data-failed={!!s.error}>
          <span className="wf-name" style={{ paddingLeft: `${Math.min(s.depth, 6) * 14}px` }}>
            <span className="muted">{KIND[s.type] ?? s.type}</span> {s.name}
          </span>
          <span className="wf-track">
            <span
              className="wf-bar"
              style={{
                left: `${((s.offset_ms ?? 0) / total) * 100}%`,
                width: `${Math.max(0.4, ((s.duration_ms ?? 0) / total) * 100)}%`,
              }}
            />
          </span>
          <span className="wf-time num muted">{elapsed(s.duration_ms)}</span>
        </li>
      ))}
    </ol>
  );
}
