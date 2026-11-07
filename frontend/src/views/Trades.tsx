// Trades: what do we hold, and what did each trade earn? Holdings with their FIFO
// cost basis lead, beside the record of closing sells; under them every fill, and
// for the selected fill its symbol's fills against the price now and the agent's
// reason in its own words.

import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Change, Failed, Loading, PageHeader, Panel, TraderName } from "../components/bits";
import { FillsChart } from "../components/charts";
import { DotPlot, Treemap, type Dot, type TileGroup } from "../charts";
import { hueVar } from "../lib/traders";
import { useDesk, type Desk } from "../lib/desk";
import { TraderPills, useTraderFilter } from "../lib/filter";
import type { Record_ } from "../lib/ledger";
import { tradeRecord, type Fill } from "../lib/ledger";
import { count, duration, longDate, money, pct, price, shortDay, signedMoney, signedPct, stamp, time, tone } from "../lib/format";

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

  const [, setFocus] = useTraderFilter();
  const setTrader = (t: string | null) => setFocus(t);
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
            Only <span className="strong">{r.wins} of {r.closes}</span> closing sells made money, yet {trader ? "they" : "the desk"} banked{" "}
            <Change value={r.realized} />.
            {payoff(r) !== null && (
              <>
                {" "}
                The average win is <span className="num strong">{payoff(r)!.toFixed(1)}×</span> the average loss.
              </>
            )}
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
          <TraderPills
            value={trader}
            onChange={setTrader}
            traders={desk.books.map((b) => b.trader.name.toLowerCase())}
            counts={Object.fromEntries(desk.books.map((b) => [b.trader.name.toLowerCase(), b.fills.length]))}
            total={desk.fills.length}
          />

          <div className="grid-lead">
            <Panel
              title="What the desk holds"
              id="exposure"
              meta={
                <span className="num">
                  {desk.books.reduce((n, b) => n + b.positions.length, 0)} open ·{" "}
                  {money(desk.books.reduce((n, b) => n + b.invested, 0))} · area = value
                </span>
              }
            >
              <Treemap
                groups={exposureGroups(desk)}
                label="Treemap of open positions by trader, area is value, colour is unrealized return"
                focus={trader}
                onPickGroup={(id) => setTrader(id)}
              />
              <ShadeKey />
            </Panel>
            <Panel title="Record on closing sells" id="record">
              <Record fills={view.fills} />
            </Panel>
          </div>

          <Panel
            title="Every closing sell, by P&L"
            id="payoff"
            meta={<span>one dot per sell · colour = trader · outlined = a win</span>}
          >
            <Payoff desk={desk} record={view.record} focus={trader} onSelect={select} />
          </Panel>

          <Panel
            title={`${count(desk.fills.length)} fills since ${desk.fills.length ? shortDay(desk.fills[desk.fills.length - 1].time) : "—"}`}
            id="rhythm"
            meta={<span>● buy · ○ sell, outline = its P&amp;L · size = notional</span>}
          >
            <FillTimeline desk={desk} focus={trader} onSelect={select} />
          </Panel>

          <div className="holdings-row">
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
                          <td className="num muted">
                            <span className="weight-cell">
                              <span className="weight-track" aria-hidden="true">
                                <span
                                  className="weight-bar"
                                  data-heavy={p.value / (view.equityOf.get(p.trader) ?? 1) > 0.4 || undefined}
                                  style={{ width: `${Math.min(100, (p.value / (view.equityOf.get(p.trader) ?? 1)) * 100)}%` }}
                                />
                              </span>
                              {pct(p.value / (view.equityOf.get(p.trader) ?? 1), 1)}
                            </span>
                          </td>
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
      <div className="hits" role="img" aria-label={`${r.wins} wins and ${r.losses} losses`}>
        {fills
          .filter((f) => f.side === "sell" && f.realized !== undefined)
          .sort((a, b) => (b.realized ?? 0) - (a.realized ?? 0))
          .map((f) => (
            <span key={f.id} className="hit" data-tone={tone(f.realized!)} title={`${f.symbol} ${signedMoney(f.realized!)}`} />
          ))}
      </div>
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
      {payoff(r) !== null && (
        <p className="payoff-line">
          <span className="num">{payoff(r)!.toFixed(1)}×</span> payoff
          <span className="muted">{r.winRate! < 0.5 ? "a low hit rate carried by big winners" : "more wins than losses"}</span>
        </p>
      )}
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

/** Average win over the size of the average loss; null without both. */
function payoff(r: Record_): number | null {
  return r.avgWin !== null && r.avgLoss !== null && r.avgLoss < 0 ? r.avgWin / Math.abs(r.avgLoss) : null;
}

/** Unrealized return as a tile shade: red below, stone flat, green to the signal colour above. */
function shade(ret: number): { fill: string; text: string } {
  if (ret > 0.2) return { fill: "var(--accent-data)", text: "var(--ground)" };
  if (ret > 0.005) return { fill: "color-mix(in srgb, var(--positive) 45%, var(--surface))", text: "var(--text)" };
  if (ret >= -0.005) return { fill: "var(--raised)", text: "var(--text)" };
  if (ret >= -0.03) return { fill: "color-mix(in srgb, var(--negative) 30%, var(--surface))", text: "var(--text)" };
  return { fill: "color-mix(in srgb, var(--negative) 62%, var(--surface))", text: "var(--text)" };
}

const SHADES: [string, number][] = [
  ["below −3%", -0.05],
  ["−3 to −0.5%", -0.01],
  ["flat", 0],
  ["+0.5 to +20%", 0.05],
  ["above +20%", 0.3],
];

function ShadeKey() {
  return (
    <ul className="kit-legend">
      <li>Unrealized</li>
      {SHADES.map(([label, v]) => (
        <li key={label}>
          <span className="kit-legend-mark" style={{ background: shade(v).fill }} />
          {label}
        </li>
      ))}
    </ul>
  );
}

function exposureGroups(desk: Desk): TileGroup[] {
  return desk.books.map((b) => {
    const name = b.trader.name.toLowerCase();
    return {
      id: name,
      label: cap(name),
      color: hueVar(name),
      meta: money(b.invested),
      tiles: b.positions.map((p) => {
        const ret = p.costBasis ? p.unrealized / p.costBasis : 0;
        const weight = b.equity ? p.value / b.equity : 0;
        return {
          id: `${name}-${p.symbol}`,
          label: p.symbol,
          value: p.value,
          shade: shade(ret),
          lines: [money(p.value), signedPct(ret)],
          flag: weight > 0.4 ? `${pct(weight)} of account · concentrated` : Math.abs(p.unrealized) > 500 ? signedMoney(p.unrealized) : undefined,
          tip: (
            <>
              <p className="kit-tip-head">
                {cap(name)} · {p.symbol}
              </p>
              <p className="num">
                {count(p.quantity)} @ {price(p.avgCost)} → {price(p.price)}
              </p>
              <p className="num">
                {money(p.value)} · {pct(weight, 1)} of account
              </p>
              <p>
                <Change value={p.unrealized} ratio={ret} />
              </p>
            </>
          ),
        };
      }),
    };
  });
}

function Payoff({ desk, record, focus, onSelect }: { desk: Desk; record: Record_; focus: string | null; onSelect: (id: string) => void }) {
  const sells = desk.fills.filter((f) => f.side === "sell" && f.realized !== undefined);
  const total = sells.reduce((s, f) => s + f.realized!, 0);
  const best = [...sells].sort((a, b) => b.realized! - a.realized!)[0];
  const dots: Dot[] = sells.map((f) => ({
    id: f.id,
    value: f.realized!,
    color: hueVar(f.trader),
    group: f.trader,
    stroke: f.realized! > 0.005 ? "var(--positive)" : undefined,
    tip: (
      <>
        <p className="kit-tip-head">
          {cap(f.trader)} sold {f.symbol} · {stamp(f.time)}
        </p>
        <p>
          <Change value={f.realized!} />
          {f.heldMs !== undefined && <span className="muted"> · held {duration(f.heldMs)}</span>}
        </p>
      </>
    ),
  }));
  const refs = [
    record.avgWin !== null && { value: record.avgWin, label: `avg win ${signedMoney(record.avgWin)}`, tone: "good" as const },
    record.avgLoss !== null && { value: record.avgLoss, label: `avg loss ${signedMoney(record.avgLoss)}`, tone: "bad" as const },
  ].filter(Boolean) as { value: number; label: string; tone: "good" | "bad" }[];
  const share = best && total > 0 ? best.realized! / total : null;
  return (
    <DotPlot
      dots={dots}
      label={`Dot plot of ${sells.length} closing sells by realized P&L`}
      format={(v) => signedMoney(v).replace(".00", "").replace(/\.\d\d$/, "")}
      zero={0}
      refs={refs}
      focus={focus}
      onPick={(d) => onSelect(d.id)}
      minHeight={150}
      notes={
        best && best.realized! > 0
          ? [
              {
                id: best.id,
                text: `${best.symbol} ${signedMoney(best.realized!)}`,
                sub: share !== null && share > 0.25 ? `${pct(share)} of all realized` : `${cap(best.trader)}'s best sell`,
                dir: "nw",
              },
            ]
          : []
      }
    />
  );
}

function FillTimeline({ desk, focus, onSelect }: { desk: Desk; focus: string | null; onSelect: (id: string) => void }) {
  const notional = desk.fills.map((f) => f.quantity * f.price);
  const max = Math.max(1, ...notional);
  const dots: Dot[] = desk.fills.map((f) => {
    const n = f.quantity * f.price;
    const pnl = f.realized;
    return {
      id: f.id,
      value: f.time,
      group: f.trader,
      color: hueVar(f.trader),
      ring: f.side === "sell",
      stroke: undefined,
      r: 3.5 + Math.sqrt(n / max) * 9,
      ...(f.side === "sell" && pnl !== undefined
        ? { color: pnl > 0.005 ? "var(--positive)" : pnl < -0.005 ? "var(--negative)" : "var(--muted)" }
        : {}),
      tip: (
        <>
          <p className="kit-tip-head">
            {cap(f.trader)} · {stamp(f.time)}
          </p>
          <p>
            {f.side === "buy" ? "Bought" : "Sold"} {count(f.quantity)} {f.symbol} · <span className="num">{money(n)}</span>
          </p>
          {pnl !== undefined && (
            <p>
              <Change value={pnl} />
            </p>
          )}
        </>
      ),
    };
  });
  return (
    <DotPlot
      dots={dots}
      time
      label="Fill timeline: one lane per trader, dot size is notional"
      format={(v) => shortDay(v)}
      lanes={desk.books.map((b) => {
        const n = b.trader.name.toLowerCase();
        return { id: n, label: cap(n), color: hueVar(n) };
      })}
      focus={focus}
      onPick={(d) => onSelect(d.id)}
    />
  );
}
