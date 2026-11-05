// Researcher: what did the researcher find, and did it help? Every request the
// traders made, read from the saved SDK spans, beside the selected answer with its
// sources and the trades of the same run. Under them, what research costs and which
// sites it leans on.

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getResearch, type ResearchItem } from "../api";
import { Change, Failed, Loading, PageHeader, Panel, TraderName } from "../components/bits";
import { useDesk } from "../lib/desk";
import { outcomes, type FillOutcome } from "../lib/research";
import { count, elapsed, host, longDate, parseIso, pct, price, stamp, time, tokens } from "../lib/format";

const RESEARCH_POLL_MS = 15_000;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Row {
  item: ResearchItem;
  at: number;
  fills: FillOutcome[];
  cited: FillOutcome[];
}

export function Researcher() {
  const [params, setParams] = useSearchParams();
  const trader = params.get("trader");
  const research = useQuery({
    queryKey: ["research", trader],
    queryFn: () => getResearch(trader),
    refetchInterval: RESEARCH_POLL_MS,
  });
  const { desk } = useDesk();

  const rows = useMemo<Row[] | null>(() => {
    if (!research.data || !desk) return null;
    return research.data.map((item) => {
      const fills = outcomes(desk, item);
      return { item, at: parseIso(item.started_at) ?? 0, fills, cited: fills.filter((f) => f.cited) };
    });
  }, [research.data, desk]);

  const selectedId = params.get("id");
  const selected = rows?.find((r) => r.item.id === selectedId) ?? rows?.[0] ?? null;
  const setTrader = (t: string | null) => setParams(t ? { trader: t } : {});
  const select = (id: string) => setParams(trader ? { trader, id } : { id });

  return (
    <div className="view">
      <PageHeader
        kicker={`Research requests · ${longDate(Date.now())}`}
        title="Researcher"
        finding={<Finding rows={rows} trader={trader} />}
        aside={research.dataUpdatedAt > 0 && <p className="fresh num">Updated {time(research.dataUpdatedAt)} · every 15 s</p>}
      />
      {desk && (
        <div className="segmented filter" role="group" aria-label="Trader">
          <button aria-pressed={!trader} onClick={() => setTrader(null)}>
            Whole desk
          </button>
          {desk.books.map((b) => {
            const n = b.trader.name.toLowerCase();
            return (
              <button key={n} aria-pressed={trader === n} onClick={() => setTrader(n)}>
                <TraderName name={n} />
              </button>
            );
          })}
        </div>
      )}
      {research.error && <Failed what="the research" error={research.error as Error} />}
      {!rows && !research.error && <Loading rows={6} />}
      {rows && desk && (
        <>
          <div className="grid-lead list-detail">
            <Panel title="Requests" id="requests" meta={<span className="num">{count(rows.length)}, newest first</span>}>
              {rows.length ? (
                <div className="table-wrap">
                  <table className="table blotter">
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Trader</th>
                        <th scope="col">Asked for</th>
                        <th scope="col" className="num">Sources</th>
                        <th scope="col" className="num">Took</th>
                        <th scope="col" className="num">Tokens</th>
                        <th scope="col">Led to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.item.id}
                          aria-selected={r.item.id === selected?.item.id}
                          tabIndex={0}
                          onClick={() => select(r.item.id)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(r.item.id))}
                        >
                          <td className="tnum muted">{stamp(r.at)}</td>
                          <td>{r.item.trader ? <TraderName name={r.item.trader} /> : <span className="dash">—</span>}</td>
                          <td className="clip">{r.item.request}</td>
                          <td className="num">{r.item.sources.length}</td>
                          <td className="num muted">{elapsed(r.item.duration_ms)}</td>
                          <td className="num muted">{tokens(r.item.input_tokens + r.item.output_tokens)}</td>
                          <td>
                            <LedTo row={r} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty">
                  No research saved yet{trader ? ` for ${cap(trader)}` : ""}. Requests show here from the first cycle the
                  traders run with span saving on: uv run -m backend.trading_floor.
                </p>
              )}
            </Panel>
            <Panel
              title={selected ? "Answer" : "Selected request"}
              id="answer"
              className="sticky"
              meta={selected && <span className="num">{stamp(selected.at)}</span>}
            >
              {selected ? <Answer row={selected} /> : <p className="empty">Pick a request.</p>}
            </Panel>
          </div>
          {rows.length > 0 && (
            <div className="grid-halves">
              <Panel title="What research costs" id="cost">
                <Cost rows={rows} />
              </Panel>
              <Panel title="Sites it reads most" id="sites" meta={<span className="num">by requests that used them</span>}>
                <Sites rows={rows} />
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Finding({ rows, trader }: { rows: Row[] | null; trader: string | null }) {
  if (!rows) return <>Reading the saved runs…</>;
  const scope = trader ? `${cap(trader)}'s researcher` : "The researcher";
  if (!rows.length) return <>{scope} has no saved requests yet. Runs from before span saving began were not kept.</>;
  const fed = rows.filter((r) => r.cited.length);
  const pnl = fed.flatMap((r) => r.cited).reduce((s, o) => s + (o.pnl ?? 0), 0);
  return (
    <>
      {scope} answered {count(rows.length)} requests. {fed.length ? (
        <>
          {count(fed.length)} of them named a stock that was then traded in the same run, and those trades stand at{" "}
          <Change value={pnl} />.
        </>
      ) : (
        "None of them named a stock the trader went on to trade."
      )}
    </>
  );
}

function LedTo({ row }: { row: Row }) {
  if (row.item.error) return <span className="tag" data-tone="bad">Failed</span>;
  if (row.cited.length)
    return (
      <span className="tag" data-tone="good">
        {row.cited.length} {row.cited.length === 1 ? "trade" : "trades"}
      </span>
    );
  if (row.fills.length) return <span className="tag">Traded other names</span>;
  return <span className="muted">No trade</span>;
}

function Answer({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const { item } = row;
  return (
    <div className="selected">
      <p className="decision-head">
        {item.trader && <TraderName name={item.trader} />} asked{item.mode ? ` while ${item.mode === "trade" ? "trading" : "rebalancing"}` : ""}:
      </p>
      <blockquote className="decision-quote small">{item.request}</blockquote>
      {item.error ? (
        <p className="failed">The researcher failed: {String((item.error as { message?: string }).message ?? "no message")}</p>
      ) : (
        <>
          <div className="answer-text" data-open={open}>
            {item.answer || "No answer recorded."}
          </div>
          {item.answer.length > 600 && (
            <button className="btn-ghost" onClick={() => setOpen((o) => !o)}>
              {open ? "Show less" : "Show the whole answer"}
            </button>
          )}
        </>
      )}

      <h3 className="sub-head">Sources</h3>
      {item.sources.length ? (
        <ul className="sources">
          {item.sources.slice(0, 8).map((s) => (
            <li key={s.url}>
              <a className="text-link" href={s.url} target="_blank" rel="noreferrer">
                {s.title ?? host(s.url)}
              </a>
              <span className="muted"> · {host(s.url)}{s.via === "fetch" ? " · read in full" : ""}</span>
            </li>
          ))}
          {item.sources.length > 8 && <li className="muted">and {item.sources.length - 8} more</li>}
        </ul>
      ) : (
        <p className="muted">No sources: answered from memory or the model alone.</p>
      )}
      {item.searches.length > 0 && (
        <p className="note">Searched for {item.searches.filter(Boolean).map((q) => `“${q}”`).join(", ")}</p>
      )}

      <h3 className="sub-head">Trades in the same run</h3>
      {row.fills.length ? (
        <table className="table kv">
          <tbody>
            {row.fills.map((o) => (
              <tr key={o.fill.id}>
                <th scope="row">
                  <Link className="text-link" to={`/decisions?fill=${o.fill.id}`}>
                    {o.fill.side === "buy" ? "Bought" : "Sold"} {count(o.fill.quantity)} {o.fill.symbol}
                  </Link>{" "}
                  <span className="muted">at {price(o.fill.price)}</span>
                  {!o.cited && <span className="muted"> · not in the answer</span>}
                </th>
                <td className="num">{o.pnl !== null ? <Change value={o.pnl} /> : <span className="dash">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No trade followed in this run.</p>
      )}
      <p className="note num">
        {elapsed(item.duration_ms)} · {item.model_calls} model calls · {tokens(item.input_tokens)} in, {tokens(item.output_tokens)} out ·{" "}
        {item.searches.length} searches, {item.fetches} pages read, {item.memory_calls} memory calls
      </p>
    </div>
  );
}

function Cost({ rows }: { rows: Row[] }) {
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
  const tokensAll = sum((r) => r.item.input_tokens + r.item.output_tokens);
  const timed = rows.filter((r) => r.item.duration_ms !== null);
  const fed = rows.filter((r) => r.cited.length).length;
  return (
    <>
      <p className="answer">
        <span className="answer-figure num">{tokens(tokensAll)}</span>
        <span className="answer-sub">tokens across {count(rows.length)} requests</span>
      </p>
      <table className="table kv">
        <tbody>
          <tr>
            <th scope="row">Average time per request</th>
            <td className="num">{elapsed(timed.length ? sum((r) => r.item.duration_ms ?? 0) / timed.length : null)}</td>
          </tr>
          <tr>
            <th scope="row">Model calls</th>
            <td className="num">{count(sum((r) => r.item.model_calls))}</td>
          </tr>
          <tr>
            <th scope="row">Web searches · pages read</th>
            <td className="num">
              {count(sum((r) => r.item.searches.length))} · {count(sum((r) => r.item.fetches))}
            </td>
          </tr>
          <tr>
            <th scope="row">Requests that fed a trade</th>
            <td className="num">{pct(fed / rows.length)}</td>
          </tr>
          <tr>
            <th scope="row">Failed requests</th>
            <td className="num">{count(rows.filter((r) => r.item.error).length)}</td>
          </tr>
        </tbody>
      </table>
      <p className="note">The model runs locally on Ollama, so tokens cost time rather than money.</p>
    </>
  );
}

function Sites({ rows }: { rows: Row[] }) {
  const byHost = new Map<string, number>();
  for (const r of rows) for (const h of new Set(r.item.sources.map((s) => host(s.url)))) byHost.set(h, (byHost.get(h) ?? 0) + 1);
  const top = [...byHost].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length) return <p className="empty">No sources recorded yet.</p>;
  const max = top[0][1];
  return (
    <div className="alloc">
      {top.map(([h, n]) => (
        <div className="alloc-row" key={h}>
          <div className="alloc-line">
            <span className="alloc-label">{h}</span>
            <span className="alloc-share num">{count(n)}</span>
          </div>
          <span className="alloc-track">
            <span className="alloc-bar" style={{ width: `${(n / max) * 100}%`, background: "var(--accent-data)" }} />
          </span>
        </div>
      ))}
    </div>
  );
}
