// Money: where is the money, and how is it doing? The desk's equity leads, each
// trader's curve beside the others with the desk drawdown underneath; then the
// latest decision in the agent's own words, the P&L by period, the four traders
// side by side, where the money sits, and return against risk.

import { useState } from "react";
import { Link } from "react-router-dom";
import { Change, Failed, Loading, PageHeader, Panel, Ratio, TraderName } from "../components/bits";
import { EquityChart, type Mode } from "../components/EquityChart";
import { AllocationList, RiskScatter, type AllocationRow } from "../components/charts";
import { useDesk, type Desk } from "../lib/desk";
import { INITIAL_BALANCE, maxDrawdown, tradeRecord, valueAt } from "../lib/ledger";
import { count, longDate, money, pct, price, signedPct, stamp, time, tone } from "../lib/format";
import { archetype } from "../lib/traders";

const DAY = 86_400_000;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function finding(desk: Desk) {
  const funded = INITIAL_BALANCE * desk.books.length;
  const change = desk.books.reduce((s, b) => s + b.change, 0);
  const ranked = [...desk.books].sort((a, b) => b.change - a.change);
  const lead = ranked[0];
  const last = ranked[ranked.length - 1];
  return (
    <>
      The desk is {change >= 0 ? "up" : "down"} <Change value={change} ratio={change / funded} /> on its{" "}
      <span className="num">{money(funded)}</span> stake. {cap(lead.trader.name)} leads at{" "}
      <Ratio value={lead.change / INITIAL_BALANCE} />; {cap(last.trader.name)} trails at{" "}
      <Ratio value={last.change / INITIAL_BALANCE} />.
    </>
  );
}

export function Money() {
  const { desk, error, loading } = useDesk();
  const [mode, setMode] = useState<Mode>("traders");
  const now = desk?.updatedAt ?? Date.now();

  return (
    <div className="view">
      <PageHeader
        kicker={`Desk report · ${longDate(now)}`}
        title="Money"
        finding={desk ? finding(desk) : loading ? "Reading the books…" : "The books could not be read."}
        aside={desk && <p className="fresh num">Updated {time(desk.updatedAt)} · every 6 s</p>}
      />
      {error && !desk && <Failed what="the desk" error={error} />}
      {loading && <Loading rows={6} />}
      {desk && <MoneyBody desk={desk} mode={mode} setMode={setMode} />}
    </div>
  );
}

function MoneyBody({ desk, mode, setMode }: { desk: Desk; mode: Mode; setMode: (m: Mode) => void }) {
  const { books, curves } = desk;
  const traders = books.map((b) => b.trader.name.toLowerCase());
  const funded = INITIAL_BALANCE * books.length;
  const equity = books.reduce((s, b) => s + b.equity, 0);
  const change = equity - funded;
  const realized = books.reduce((s, b) => s + b.realized, 0);
  const unrealized = books.reduce((s, b) => s + b.unrealized, 0);
  const spreadPaid = books.reduce((s, b) => s + b.spreadPaid, 0);
  const cash = books.reduce((s, b) => s + b.cash, 0);

  const nowS = desk.updatedAt / 1000;
  const startOfToday = new Date(desk.updatedAt).setHours(0, 0, 0, 0) / 1000;
  const today = equity - valueAt(curves.times, curves.desk, startOfToday, funded);
  const week = equity - valueAt(curves.times, curves.desk, nowS - (7 * DAY) / 1000, funded);

  const latest = desk.fills[0];
  const allocation: AllocationRow[] = [
    ...books.flatMap((b) =>
      b.positions.map((p) => ({
        key: `${p.trader}-${p.symbol}`,
        label: p.symbol,
        sub: `${cap(p.trader)} · ${count(p.quantity)} sh`,
        value: p.value,
        trader: p.trader,
      })),
    ),
    { key: "cash", label: "Cash", sub: "all four traders", value: cash },
  ].sort((a, b) => b.value - a.value);

  return (
    <>
      <div className="grid-lead">
        <Panel
          title="Desk equity"
          id="equity"
          className="lead"
          meta={
            <div className="segmented" role="group" aria-label="Lines on the chart">
              <button aria-pressed={mode === "traders"} onClick={() => setMode("traders")}>
                By trader
              </button>
              <button aria-pressed={mode === "desk"} onClick={() => setMode("desk")}>
                Desk total
              </button>
            </div>
          }
        >
          <div className="answer">
            <span className="answer-figure num money-tone" data-tone={tone(change)}>{money(equity)}</span>
            <span className="answer-sub">
              <Change value={change} ratio={change / funded} /> since funded with {money(funded)}
            </span>
          </div>
          <EquityChart curves={curves} traders={traders} mode={mode} />
          <p className="note">
            Dashed vertical lines mark days the engine was off, folded to a short break. Dashed level: the{" "}
            {mode === "traders" ? `${money(INITIAL_BALANCE)} each trader` : `${money(funded)} the desk`} started with. SPY is
            not drawn yet; its series starts with the fixed-interval snapshots of Phase 1.
            {curves.suspect.length > 0 && (
              <>
                {" "}
                Left out as one-sample jumps from mixed price sources (D1):{" "}
                {curves.suspect.map((x) => `${cap(x.trader)} ${money(x.value)} (${stamp(x.time)})`).join(", ")}.
              </>
            )}
          </p>
        </Panel>

        <div className="stack">
          <Panel
            title="Latest decision"
            id="latest"
            meta={latest && <span className="num">{stamp(latest.time)}</span>}
          >
            {latest ? (
              <div className="decision">
                <p className="decision-head">
                  <TraderName name={latest.trader} /> {latest.side === "buy" ? "bought" : "sold"}{" "}
                  <span className="num">{count(latest.quantity)}</span> {latest.symbol} at{" "}
                  <span className="num">{price(latest.price)}</span>
                </p>
                <blockquote className="decision-quote">{latest.rationale}</blockquote>
                <p className="decision-foot">
                  {latest.realized !== undefined ? (
                    <span>
                      Closed lots for <Change value={latest.realized} />
                    </span>
                  ) : (
                    <span className="muted">Position still open</span>
                  )}
                  <Link to={`/trades?fill=${latest.id}`} className="text-link">
                    See the trade
                  </Link>
                </p>
              </div>
            ) : (
              <p className="empty">No trades yet. The first fill will appear here with the agent's reason.</p>
            )}
          </Panel>

          <Panel title="Profit and loss" id="pnl" className="grow">
            <table className="table kv">
              <tbody>
                <tr>
                  <th scope="row">Funded</th>
                  <td className="num">{money(funded)}</td>
                </tr>
                <tr>
                  <th scope="row">Today</th>
                  <td className="num">
                    <Change value={today} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Past 7 days</th>
                  <td className="num">
                    <Change value={week} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">All time</th>
                  <td className="num">
                    <Change value={change} />
                  </td>
                </tr>
                <tr className="kv-break">
                  <th scope="row">Realized on closed lots</th>
                  <td className="num">
                    <Change value={realized} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Unrealized on open lots</th>
                  <td className="num">
                    <Change value={unrealized} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Spread paid, 0.2% a fill</th>
                  <td className="num">{money(spreadPaid)}</td>
                </tr>
              </tbody>
            </table>
          </Panel>
        </div>
      </div>

      <Panel title="The four traders" id="traders" className="desk-panel">
        <div className="desk">
          {books.map((b) => {
            const name = b.trader.name.toLowerCase();
            const rec = tradeRecord(b.fills);
            const investedShare = b.equity > 0 ? b.invested / b.equity : 0;
            return (
              <article className="desk-col" key={name}>
                <h3>
                  <TraderName name={name} />
                </h3>
                <p className="desk-arch">{archetype(name)}</p>
                <p className="desk-figure num money-tone" data-tone={tone(b.change)}>{money(b.equity)}</p>
                <p className="desk-change">
                  <Ratio value={b.change / INITIAL_BALANCE} /> <Change value={b.change} />
                </p>
                <div
                  className="split"
                  role="img"
                  aria-label={`Invested ${pct(investedShare)}, cash ${pct(1 - investedShare)}`}
                >
                  <span className="split-bar" style={{ width: `${investedShare * 100}%`, background: `var(--t-${name})` }} />
                </div>
                <p className="split-legend num">
                  <span>Invested {pct(investedShare)}</span>
                  <span>Cash {money(b.cash)}</span>
                </p>
                <dl className="desk-stats">
                  <div>
                    <dt>Positions</dt>
                    <dd className="num">{b.positions.length}</dd>
                  </div>
                  <div>
                    <dt>Fills</dt>
                    <dd className="num">{b.fills.length}</dd>
                  </div>
                  <div>
                    <dt>Winning sells</dt>
                    <dd className="num">{rec.closes ? `${rec.wins} of ${rec.closes}` : <span className="dash">—</span>}</dd>
                  </div>
                  <div>
                    <dt>Worst drawdown</dt>
                    <dd className="num">{signedPct(maxDrawdown(curves.byTrader[name]), 2)}</dd>
                  </div>
                </dl>
                <Link className="text-link" to={`/trades?trader=${name}`}>
                  {b.fills.length ? `${cap(name)}'s trades` : `Why no trades yet`}
                </Link>
              </article>
            );
          })}
        </div>
      </Panel>

      <div className="grid-halves">
        <Panel title="Where the money sits" id="alloc" meta={<span className="num">{money(equity)}</span>}>
          <div className="split split-lg" role="img" aria-label={`Invested ${pct(1 - cash / equity)}, cash ${pct(cash / equity)}`}>
            {books.map((b) => (
              <span
                key={b.trader.name}
                className="split-bar"
                style={{ width: `${(b.invested / equity) * 100}%`, background: `var(--t-${b.trader.name.toLowerCase()})` }}
              />
            ))}
          </div>
          <p className="split-legend num">
            <span>
              Invested {money(equity - cash)} · {pct(1 - cash / equity, 1)}
            </span>
            <span>
              Cash {money(cash)} · {pct(cash / equity, 1)}
            </span>
          </p>
          <AllocationList rows={allocation} total={equity} />
        </Panel>
        <Panel title="Return against worst drawdown" id="risk" meta="Since funded">
          <RiskScatter
            points={traders.map((t) => ({
              trader: t,
              ret: books.find((b) => b.trader.name.toLowerCase() === t)!.change / INITIAL_BALANCE,
              drawdown: maxDrawdown(curves.byTrader[t]),
            }))}
          />
          <p className="note">
            Return up, worst drawdown right; up and left is better. Ten days of samples is too few to call it skill.
          </p>
        </Panel>
      </div>
    </>
  );
}
