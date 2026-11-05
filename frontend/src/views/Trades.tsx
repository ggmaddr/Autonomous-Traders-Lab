// Trades: what do we hold, and what did each trade earn? Holdings with their FIFO
// cost basis lead, beside the record of closing sells; under them every fill, and
// for the selected fill its symbol's fills against the price now and the agent's
// reason in its own words.

import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Change, Failed, Loading, PageHeader, Panel, TraderName } from "../components/bits";
import { FillsChart } from "../components/charts";
import { useDesk, type Desk } from "../lib/desk";
import { tradeRecord, type Fill } from "../lib/ledger";
import { count, duration, longDate, money, pct, price, shortDay, signedMoney, stamp, time, tone } from "../lib/format";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Trades() {
  const { desk, error, loading } = useDesk();
  const now = desk?.updatedAt ?? Date.now();
  return (
    <div className="view">
      <TradesBody desk={desk} now={now} />
      {error && !desk && <Failed what="the trades" error={error} />}
      {loading && <Loading rows={8} />}
    </div>
  );
}

function TradesBody({ desk, now }: { desk: Desk | null; now: number }) {
  const [params, setParams] = useSearchParams();
  const fillParam = params.get("fill");
  const traderParam = params.get("trader") ?? (fillParam ? fillParam.split("-")[0] : null);
  const trader = desk?.books.some((b) => b.trader.name.toLowerCase() === traderParam) ? traderParam : null;

  const view = useMemo(() => {
    if (!desk) return null;
    const books = trader ? desk.books.filter((b) => b.trader.name.toLowerCase() === trader) : desk.books;
    const fills = desk.fills.filter((f) => !trader || f.trader === trader);
    const positions = books.flatMap((b) => b.positions).sort((a, b) => b.value - a.value);
    const equityOf = new Map(desk.books.map((b) => [b.trader.name.toLowerCase(), b.equity]));
    return { books, fills, positions, equityOf, record: tradeRecord(fills) };
  }, [desk, trader]);

  const setTrader = (t: string | null) => setParams(t ? { trader: t } : {});
  const select = (id: string) => setParams(trader ? { trader, fill: id } : { fill: id });

  const selected = view?.fills.find((f) => f.id === fillParam) ?? view?.fills[0] ?? null;

  let findingText: React.ReactNode = "Reading the fills…";
  if (view) {
    const r = view.record;
    const scope = trader ? cap(trader) : "The desk";
    findingText = !view.fills.length ? (
      `${scope} has not traded yet.`
    ) : (
      <>
        {scope} made {count(view.fills.length)} fills since {shortDay(view.fills[view.fills.length - 1].time)}.{" "}
        {r.closes ? (
          <>
            {r.wins} of {r.closes} closing sells made money, for <Change value={r.realized} /> realized.
          </>
        ) : (
          "Nothing has been sold yet, so nothing is realized."
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        kicker={`Positions and fills · ${longDate(now)}`}
        title="Trades"
        finding={findingText}
        aside={desk && <p className="fresh num">Updated {time(desk.updatedAt)} · every 6 s</p>}
      />
      {desk && view && (
        <>
          <div className="segmented filter" role="group" aria-label="Trader">
            <button aria-pressed={!trader} onClick={() => setTrader(null)}>
              Whole desk <span className="num seg-count">{desk.fills.length}</span>
            </button>
            {desk.books.map((b) => {
              const n = b.trader.name.toLowerCase();
              return (
                <button key={n} aria-pressed={trader === n} onClick={() => setTrader(n)}>
                  <TraderName name={n} /> <span className="num seg-count">{b.fills.length}</span>
                </button>
              );
            })}
          </div>

          <div className="grid-lead">
            <Panel
              title="Holdings"
              id="holdings"
              meta={
                <span className="num">
                  {view.positions.length} open · {money(view.positions.reduce((s, p) => s + p.value, 0))}
                </span>
              }
            >
              {view.positions.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Symbol</th>
                        <th scope="col">Trader</th>
                        <th scope="col" className="num">Shares</th>
                        <th scope="col" className="num">Avg cost</th>
                        <th scope="col" className="num">Price</th>
                        <th scope="col" className="num">Value</th>
                        <th scope="col" className="num">Unrealized</th>
                        <th scope="col" className="num">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.positions.map((p) => (
                        <tr key={`${p.trader}-${p.symbol}`}>
                          <td className="ident">{p.symbol}</td>
                          <td>
                            <TraderName name={p.trader} />
                          </td>
                          <td className="num">{count(p.quantity)}</td>
                          <td className="num">{price(p.avgCost)}</td>
                          <td className="num">{price(p.price)}</td>
                          <td className="num strong money-tone" data-tone={tone(p.unrealized)}>{money(p.value)}</td>
                          <td className="num">
                            <Change value={p.unrealized} ratio={p.unrealized / p.costBasis} />
                          </td>
                          <td className="num muted">{pct(p.value / (view.equityOf.get(p.trader) ?? 1), 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row" colSpan={5}>
                          {view.positions.length} {view.positions.length === 1 ? "position" : "positions"}
                        </th>
                        <td className="num strong">{money(view.positions.reduce((s, p) => s + p.value, 0))}</td>
                        <td className="num">
                          <Change value={view.positions.reduce((s, p) => s + p.unrealized, 0)} />
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="empty">No open positions. All of it is in cash.</p>
              )}
              <p className="note">Cost basis is first in, first out, spread included. Weight is the share of that trader's equity.</p>
            </Panel>

            <Panel title="Record on closing sells" id="record">
              <Record fills={view.fills} />
            </Panel>
          </div>

          <div className="grid-lead list-detail">
            <Panel title="Every fill" id="blotter" meta={<span className="num">{count(view.fills.length)} fills, newest first</span>}>
              {view.fills.length ? (
                <div className="table-wrap">
                  <table className="table blotter">
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Trader</th>
                        <th scope="col">Order</th>
                        <th scope="col" className="num">Shares</th>
                        <th scope="col" className="num">Fill</th>
                        <th scope="col" className="num">Notional</th>
                        <th scope="col" className="num">Realized</th>
                        <th scope="col" className="num">Held</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.fills.map((f) => (
                        <tr
                          key={f.id}
                          aria-selected={f.id === selected?.id}
                          tabIndex={0}
                          onClick={() => select(f.id)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(f.id))}
                        >
                          <td className="tnum muted">{stamp(f.time)}</td>
                          <td>
                            <TraderName name={f.trader} />
                          </td>
                          <td className="ident">
                            <span className="side" data-side={f.side}>
                              {f.side === "buy" ? "Buy" : "Sell"}
                            </span>{" "}
                            {f.symbol}
                          </td>
                          <td className="num">{count(f.quantity)}</td>
                          <td className="num">{price(f.price)}</td>
                          <td className="num muted">{money(f.quantity * f.price)}</td>
                          <td className="num">
                            {f.realized !== undefined ? <Change value={f.realized} /> : <span className="dash">—</span>}
                          </td>
                          <td className="num muted">
                            {f.heldMs !== undefined ? duration(f.heldMs) : <span className="dash">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty">
                  No fills{trader ? ` for ${cap(trader)}` : ""}. <Link to="/" className="text-link">Back to Money</Link>
                </p>
              )}
            </Panel>

            <Panel
              title={selected ? `${selected.symbol}, ${cap(selected.trader)}` : "Selected fill"}
              id="selected"
              className="sticky"
              meta={selected && <span className="num">{stamp(selected.time)}</span>}
            >
              {selected ? <Selected desk={desk} fill={selected} onSelect={select} /> : <p className="empty">Pick a fill.</p>}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

function Record({ fills }: { fills: Fill[] }) {
  const r = tradeRecord(fills);
  if (!r.closes) {
    return <p className="empty">No closing sells yet, so there is no win rate. Open lots show under Holdings.</p>;
  }
  const scale = Math.max(Math.abs(r.avgWin ?? 0), Math.abs(r.avgLoss ?? 0), 1);
  return (
    <div className="record">
      <p className="answer">
        <span className="answer-figure num">{pct(r.winRate!)}</span>
        <span className="answer-sub">
          {r.wins} of {r.closes} closing sells made money
        </span>
      </p>
      <div className="winloss" role="img" aria-label={`Average win ${signedMoney(r.avgWin ?? 0)}, average loss ${signedMoney(r.avgLoss ?? 0)}`}>
        <div className="wl-row">
          <span className="wl-label">Average win</span>
          <span className="wl-track">
            <span className="wl-bar" data-tone="good" style={{ width: `${((r.avgWin ?? 0) / scale) * 100}%` }} />
          </span>
          <span className="num wl-value money-tone" data-tone="good">{r.avgWin !== null ? signedMoney(r.avgWin) : "—"}</span>
        </div>
        <div className="wl-row">
          <span className="wl-label">Average loss</span>
          <span className="wl-track">
            <span className="wl-bar" data-tone="bad" style={{ width: `${(Math.abs(r.avgLoss ?? 0) / scale) * 100}%` }} />
          </span>
          <span className="num wl-value money-tone" data-tone="bad">{r.avgLoss !== null ? signedMoney(r.avgLoss) : "—"}</span>
        </div>
      </div>
      <table className="table kv">
        <tbody>
          <tr>
            <th scope="row">Realized</th>
            <td className="num">
              <Change value={r.realized} />
            </td>
          </tr>
          <tr>
            <th scope="row">Average holding</th>
            <td className="num">{r.avgHeldMs !== null ? duration(r.avgHeldMs) : "—"}</td>
          </tr>
          <tr>
            <th scope="row">Best sell</th>
            <td className="num">
              {r.best ? (
                <>
                  <span className="muted">{r.best.symbol}</span> <Change value={r.best.realized!} />
                </>
              ) : (
                "—"
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">Worst sell</th>
            <td className="num">
              {r.worst ? (
                <>
                  <span className="muted">{r.worst.symbol}</span> <Change value={r.worst.realized!} />
                </>
              ) : (
                "—"
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Selected({ desk, fill, onSelect }: { desk: Desk; fill: Fill; onSelect: (id: string) => void }) {
  const same = desk.fills.filter((f) => f.trader === fill.trader && f.symbol === fill.symbol);
  const position = desk.books
    .find((b) => b.trader.name.toLowerCase() === fill.trader)
    ?.positions.find((p) => p.symbol === fill.symbol);
  return (
    <div className="selected">
      <FillsChart fills={same} now={position?.price ?? null} selected={fill.id} onSelect={onSelect} />
      <p className="fills-key">
        <span className="key-mark" data-side="buy" aria-hidden="true" /> Buy
        <span className="key-mark" data-side="sell" aria-hidden="true" /> Sell
        {position ? "" : <span className="muted"> · No longer held, so no price now</span>}
      </p>
      <p className="decision-head">
        <TraderName name={fill.trader} /> {fill.side === "buy" ? "bought" : "sold"} <span className="num">{count(fill.quantity)}</span>{" "}
        {fill.symbol} at <span className="num">{price(fill.price)}</span>
      </p>
      <blockquote className="decision-quote small">{fill.rationale}</blockquote>
      <p className="note">
        <Link className="text-link" to={`/decisions?fill=${fill.id}`}>
          {fill.traceId ? "Why? See the research, prices and orders behind it" : "Open the decision"}
        </Link>
      </p>
      {fill.side === "sell" && fill.costBasis !== undefined ? (
        <p className="lot-math num">
          Proceeds {money(fill.quantity * fill.price)} − cost {money(fill.costBasis)} = <Change value={fill.realized!} />
          {fill.heldMs !== undefined && <span className="muted"> · held {duration(fill.heldMs)}</span>}
        </p>
      ) : (
        <p className="lot-math num">
          Cost {money(fill.quantity * fill.price)} · spread paid {money(fill.spread)}
        </p>
      )}
    </div>
  );
}
