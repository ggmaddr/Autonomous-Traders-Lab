// Money: where is the money, and how is it doing? Four key numbers, then each
// trader's return since funding (indexed, so the lines separate) over the desk's
// drawdown, beside a waterfall of where today's equity comes from and each
// trader's contribution. Under them one small multiple per trader on a shared
// scale, return against risk, the latest decision, correlation and exposure.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as d3 from "d3";
import { Change, Failed, Loading, PageHeader, Panel, Ratio, TraderName } from "../components/bits";
import { RiskScatter } from "../components/charts";
import {
  CountUp,
  DivergingBars,
  LineChart,
  Scrolly,
  ViewToggle,
  Waterfall,
  useViewMode,
  type DataNote,
  type LineSeries,
  type StoryStep,
} from "../charts";
import { useDesk, type Desk } from "../lib/desk";
import { INITIAL_BALANCE, drawdownOf, maxDrawdown, tradeRecord, valueAt, type Book } from "../lib/ledger";
import { useQuery } from "@tanstack/react-query";
import { getMarketYear } from "../api";
import { count, longDate, money, pct, price, shortDay, signedMoney, signedPct, stamp, time, tone } from "../lib/format";
import { archetype, hueVar } from "../lib/traders";
import { Crew, ICONS, TraderMark, crewRole } from "../components/Crew";
import { TraderPills, cap, useTraderFilter } from "../lib/filter";

const DAY = 86_400_000;
const IDLE = 6 * 3600; // seconds; longer gaps between samples are the engine being off

function finding(desk: Desk) {
  const funded = INITIAL_BALANCE * desk.books.length;
  const change = desk.books.reduce((s, b) => s + b.change, 0);
  const ranked = [...desk.books].sort((a, b) => b.change - a.change);
  const lead = ranked[0];
  const last = ranked[ranked.length - 1];
  const rest = change - lead.change;
  return (
    <>
      Desk <Change value={change} ratio={change / funded} /> on <span className="num">{money(funded)}</span> capital.{" "}
      {change > 0 && rest < 0 ? (
        <>
          <span className="strong">{cap(lead.trader.name)}</span> <Ratio value={lead.change / INITIAL_BALANCE} /> leads; rest <Change value={rest} />.
        </>
      ) : (
        <>
          Top {cap(lead.trader.name)} <Ratio value={lead.change / INITIAL_BALANCE} />; bottom {cap(last.trader.name)}{" "}
          <Ratio value={last.change / INITIAL_BALANCE} />.
        </>
      )}
    </>
  );
}

export function Money() {
  const { desk, error, loading } = useDesk();
  const [view] = useViewMode();
  const now = desk?.updatedAt ?? Date.now();

  return (
    <div className="view">
      <PageHeader
        kicker={`Desk report · ${longDate(now)}`}
        title="Money"
        finding={desk ? finding(desk) : loading ? "Reading the books…" : "The books could not be read."}
        aside={
          <div className="page-aside-stack">
            <ViewToggle />
            {desk && <p className="fresh num">Updated {time(desk.updatedAt)} · every 6 s</p>}
          </div>
        }
      />
      {error && !desk && <Failed what="the desk" error={error} />}
      {loading && <Loading rows={6} />}
      {desk && (view === "story" ? <MoneyStory desk={desk} /> : <MoneyBody desk={desk} />)}
    </div>
  );
}

// --- The time axis -------------------------------------------------------------

/** Idle stretches folded into short breaks so the sessions where traders acted get the width. */
export interface Fold {
  xs: number[]; // folded position per sample, in "ms"
  breaks: { from: number; to: number }[];
  ticks: number[];
  labelOf: (v: number) => string;
  at: (ms: number) => number; // folded position of a real time
}

export function foldTimes(times: number[]): Fold {
  const active = times.slice(1).reduce((s, t, i) => s + (t - times[i] <= IDLE ? t - times[i] : 0), 0);
  const brk = Math.max(active * 0.05, 1200);
  const xs = [0];
  const breaks: { from: number; to: number }[] = [];
  const starts = [0];
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1];
    if (dt > IDLE) {
      breaks.push({ from: xs[i - 1] * 1000, to: (xs[i - 1] + brk) * 1000 });
      starts.push(i);
    }
    xs.push(xs[i - 1] + (dt > IDLE ? brk : dt));
  }
  const ms = xs.map((v) => v * 1000);
  const real = times.map((t) => t * 1000);
  const labelOf = (v: number) => {
    const i = Math.max(0, d3.bisectLeft(ms, v) - (ms[d3.bisectLeft(ms, v)] === v ? 0 : 1));
    return shortDay(real[Math.min(i, real.length - 1)]);
  };
  // One tick per session start, plus day changes inside a session.
  const ticks: number[] = [];
  let lastDay = "";
  real.forEach((t, i) => {
    const d = shortDay(t);
    if (starts.includes(i) || d !== lastDay) ticks.push(ms[i]);
    lastDay = d;
  });
  const at = (t: number) => {
    const i = d3.bisectRight(real, t) - 1;
    if (i < 0) return ms[0];
    if (i >= real.length - 1) return ms[ms.length - 1];
    const span = real[i + 1] - real[i];
    const fspan = ms[i + 1] - ms[i];
    return ms[i] + (span > 0 ? ((t - real[i]) / span) * fspan : 0);
  };
  return { xs: ms, breaks, ticks, labelOf, at };
}

// --- Dashboard -----------------------------------------------------------------

type Scale = "pct" | "usd" | "log";

function MoneyBody({ desk }: { desk: Desk }) {
  const { books, curves } = desk;
  const [scale, setScale] = useState<Scale>("pct");
  const [trader, setTrader] = useTraderFilter();
  const traders = books.map((b) => b.trader.name.toLowerCase());
  const funded = INITIAL_BALANCE * books.length;
  const equity = books.reduce((s, b) => s + b.equity, 0);
  const change = equity - funded;
  const realized = books.reduce((s, b) => s + b.realized, 0);
  const unrealized = books.reduce((s, b) => s + b.unrealized, 0);
  const spreadPaid = books.reduce((s, b) => s + b.spreadPaid, 0);

  const nowS = desk.updatedAt / 1000;
  const startOfToday = new Date(desk.updatedAt).setHours(0, 0, 0, 0) / 1000;
  const today = equity - valueAt(curves.times, curves.desk, startOfToday, funded);
  const week = equity - valueAt(curves.times, curves.desk, nowS - (7 * DAY) / 1000, funded);
  const worstDD = Math.min(0, ...curves.drawdown);
  const worstAt = curves.times[curves.drawdown.indexOf(worstDD)];
  const fold = useMemo(() => foldTimes(curves.times), [curves.times]);
  const lead = [...books].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0]?.trader.name.toLowerCase() ?? null;

  const series: LineSeries[] = traders.map((t) => {
    const v = curves.byTrader[t];
    const last = v[v.length - 1];
    return {
      id: t,
      label: cap(t),
      color: hueVar(t),
      values: scale === "pct" ? v.map((e) => e / INITIAL_BALANCE - 1) : v,
      endText: signedPct(last / INITIAL_BALANCE - 1, 1),
    };
  });
  const yFormat = scale === "pct" ? (v: number) => signedPct(v, 0) : (v: number) => "$" + d3.format(".3~s")(v).replace("k", "k");
  const notes = useMemo(() => moneyNotes(desk, fold, scale, lead), [desk, fold, scale, lead]);
  const banked = realized >= 0 && unrealized >= 0 && realized + unrealized > 0 ? realized / (realized + unrealized) : null;

  return (
    <>
      <section className="kpis" aria-label="Key numbers">
        <div className="kpi">
          <Crew icon={ICONS.chest} motion="bob" corner />
          <p className="kpi-label">Equity</p>
          <p className="kpi-value num money-tone" data-tone={tone(change)}>
            <CountUp value={equity} format={(v) => money(v).replace(/\.\d\d$/, "")} />
          </p>
          <Spark values={curves.desk} />
          <p className="kpi-sub num money-tone" data-tone={tone(change)}>
            {signedPct(change / funded)} since inception
          </p>
        </div>
        <div className="kpi">
          <Crew icon={ICONS.spyglass} motion="rock" corner delay={400} />
          <p className="kpi-label">Day P&amp;L</p>
          <p className="kpi-value num money-tone" data-tone={tone(today)}>
            <CountUp value={today} format={signedMoney} />
          </p>
          <p className="kpi-sub">
            7D <Change value={week} />
          </p>
        </div>
        <div className="kpi">
          <Crew icon={ICONS.map} motion="wave" corner delay={800} />
          <p className="kpi-label">Realized P&amp;L</p>
          {banked !== null ? (
            <>
              <p className="kpi-value num">
                {Math.round(banked * 100)}
                <span className="muted"> / </span>
                {100 - Math.round(banked * 100)}
              </p>
              <div className="kpi-split" aria-hidden="true">
                <span style={{ flex: banked }} data-part="real" />
                <span style={{ flex: 1 - banked }} data-part="open" />
              </div>
              <p className="kpi-sub">% of gain realized</p>
            </>
          ) : (
            <>
              <p className="kpi-value num">
                <Change value={realized} />
              </p>
              <p className="kpi-sub">
                Unrealized <Change value={unrealized} />
              </p>
            </>
          )}
        </div>
        <div className="kpi">
          <Crew icon={ICONS.anchor} motion="swing" corner delay={1200} />
          <p className="kpi-label">Max drawdown</p>
          <p className="kpi-value num money-tone" data-tone={worstDD < -0.0001 ? "bad" : "flat"}>
            {signedPct(worstDD)}
          </p>
          <p className="kpi-sub">{worstAt ? `Trough ${stamp(worstAt * 1000)}` : "None"}</p>
        </div>
      </section>

      <TraderPills value={trader} onChange={setTrader} traders={traders} />

      <div className="grid-lead">
        <Panel
          title="Performance"
          id="equity"
          meta={
            <div className="segmented" role="group" aria-label="Scale">
              <button aria-pressed={scale === "pct"} onClick={() => setScale("pct")}>
                Return
              </button>
              <button aria-pressed={scale === "usd"} onClick={() => setScale("usd")}>
                Equity
              </button>
              <button aria-pressed={scale === "log"} onClick={() => setScale("log")}>
                Log
              </button>
            </div>
          }
        >
          <LineChart
            x={fold.xs}
            series={series}
            label={`Return since funding by trader. ${traders.map((t) => `${cap(t)} ${signedPct(curves.byTrader[t].at(-1)! / INITIAL_BALANCE - 1, 1)}`).join(", ")}.`}
            height={340}
            yFormat={yFormat}
            log={scale === "log"}
            zero={scale === "pct" ? 0 : INITIAL_BALANCE}
            xTicks={fold.ticks}
            xFormat={fold.labelOf}
            focus={trader}
            lead={lead}
            onPick={setTrader}
            bands={fold.breaks.map((b) => ({ ...b, fill: "var(--raised)", label: "data gap" }))}
            notes={notes}
            tooltip={(i) => (
              <>
                <p className="kit-tip-head">{stamp(curves.times[i] * 1000)}</p>
                {traders.map((t) => (
                  <p key={t} className="kit-tip-row" style={{ opacity: trader && trader !== t ? 0.5 : 1 }}>
                    <span className="kit-tip-swatch" style={{ background: hueVar(t) }} />
                    {cap(t)}
                    <span className="num">
                      {money(curves.byTrader[t][i])} · {signedPct(curves.byTrader[t][i] / INITIAL_BALANCE - 1, 1)}
                    </span>
                  </p>
                ))}
              </>
            )}
          />
          <LineChart
            x={fold.xs}
            series={[
              {
                id: trader ?? "desk",
                label: "Drawdown",
                color: "var(--negative)",
                values: trader ? drawdownOf(curves.byTrader[trader]) : curves.drawdown,
                area: true,
                width: 1,
                endText: signedPct(Math.min(0, ...(trader ? drawdownOf(curves.byTrader[trader]) : curves.drawdown))),
              },
            ]}
            label="Drawdown from the running peak"
            height={96}
            yFormat={(v) => signedPct(v, 0)}
            zero={0}
            xTicks={fold.ticks}
            xFormat={fold.labelOf}
            yDomain={[Math.min(-0.01, ...curves.drawdown, ...(trader ? drawdownOf(curves.byTrader[trader]) : [])) * 1.1, 0]}
            bands={fold.breaks.map((b) => ({ ...b, fill: "var(--raised)" }))}
          />
          <ul className="note">
            <li>Shaded: data gaps over 6h, compressed.</li>
            {lead && !trader && <li>Bold: {cap(lead)}, top mover.</li>}
            <li>Select an agent to highlight.</li>
            {curves.suspect.length > 0 && <li>{curves.suspect.length} outlier points omitted.</li>}
          </ul>
        </Panel>

        <div className="stack">
          <Panel title="Equity bridge" id="waterfall">
            <WaterfallPanel funded={funded} realized={realized} unrealized={unrealized} equity={equity} spread={spreadPaid} />
          </Panel>
          <Panel title="P&amp;L" id="contribution" meta="By agent, since inception">
            <DivergingBars
              rows={[...books]
                .sort((a, b) => b.change - a.change)
                .map((b) => ({
                  id: b.trader.name.toLowerCase(),
                  label: cap(b.trader.name),
                  value: b.change,
                  color: hueVar(b.trader.name),
                }))}
              label="Each trader's dollar contribution to the desk's change"
              format={(v) => signedMoney(v).replace(/\.\d\d$/, "")}
              focus={trader}
              onPick={setTrader}
            />
          </Panel>
        </div>
      </div>

      <Panel title="Agents" id="multiples" className="multiples-panel" meta="Common scale">
        <SmallMultiples desk={desk} focus={trader} />
      </Panel>

      <div className="grid-halves">
        <Panel title="Risk / return" id="risk" meta="Since inception">
          <RiskScatter
            points={traders.map((t) => ({
              trader: t,
              ret: books.find((b) => b.trader.name.toLowerCase() === t)!.change / INITIAL_BALANCE,
              drawdown: maxDrawdown(curves.byTrader[t]),
            }))}
          />
          <p className="note">Return vs max drawdown; top-left is best. Short sample.</p>
        </Panel>
        <LatestDecision desk={desk} />
      </div>

      {/* Hidden for now: correlation ("Are the traders one bet?") and desk exposure.
          To bring them back, restore traderCorrelation in the ledger import and uncomment:
      <div className="grid-halves">
        <Panel title="Correlation" id="correlation" meta="Equity changes">
          <CorrelationTable traders={traders} matrix={traderCorrelation(curves, traders)} />
        </Panel>
        <DeskExposure />
      </div>
      */}
    </>
  );
}

/** Two notes for the return chart, from the books: the lead's best open lot, the desk's worst sell. */
function moneyNotes(desk: Desk, fold: Fold, scale: Scale, lead: string | null): DataNote[] {
  const notes: DataNote[] = [];
  const val = (t: string, ms: number) => {
    const v = valueAt(desk.curves.times, desk.curves.byTrader[t], ms / 1000, INITIAL_BALANCE);
    return scale === "pct" ? v / INITIAL_BALANCE - 1 : v;
  };
  const leadBook = desk.books.find((b) => b.trader.name.toLowerCase() === lead);
  if (leadBook) {
    // Where the lead's line moved most in one step, explained by its best open lot.
    const v = desk.curves.byTrader[lead!];
    let best = 0;
    let at = -1;
    for (let i = 1; i < v.length; i++) {
      const d = Math.abs(v[i] - v[i - 1]);
      if (d > best) [best, at] = [d, i];
    }
    const lot = [...leadBook.positions].sort((a, b) => Math.abs(b.unrealized) - Math.abs(a.unrealized))[0];
    if (at > 0 && best > INITIAL_BALANCE * 0.05) {
      const ms = desk.curves.times[at] * 1000;
      notes.push({
        x: fold.xs[at],
        y: scale === "pct" ? v[at] / INITIAL_BALANCE - 1 : v[at],
        text: `${shortDay(ms)} · ${cap(lead!)} ${v[at] > v[at - 1] ? "breaks away" : "drops"}`,
        sub: lot ? `${lot.symbol} lot bought at ${price(lot.avgCost)}, now ${signedPct(lot.unrealized / lot.costBasis, 0)}` : undefined,
        dir: v[at] > v[at - 1] ? "se" : "ne",
        len: 40,
      });
    }
  }
  const worst = desk.fills.filter((f) => f.realized !== undefined && f.realized < 0).sort((a, b) => a.realized! - b.realized!)[0];
  if (worst && Math.abs(worst.realized!) > 50) {
    notes.push({
      x: fold.at(worst.time / 1000),
      y: val(worst.trader, worst.time),
      text: `${cap(worst.trader)} sells ${worst.symbol} at a loss`,
      sub: signedMoney(worst.realized!),
      dir: "s",
      len: 26,
    });
  }
  return notes;
}

function WaterfallPanel(props: { funded: number; realized: number; unrealized: number; equity: number; spread: number }) {
  const { funded, realized, unrealized, equity } = props;
  const lo = Math.min(funded, funded + realized, equity);
  const span = Math.max(Math.abs(realized), Math.abs(unrealized), Math.abs(equity - funded), 1);
  const floor = Math.max(0, Math.floor((lo - span * 1.2) / 1000) * 1000);
  return (
    <Waterfall
      steps={[
        { id: "funded", label: "Capital", value: funded, kind: "total" },
        { id: "realized", label: "Realized", value: realized, kind: "delta", note: `Realized on closed lots: ${signedMoney(realized)}` },
        {
          id: "unrealized",
          label: "Unrealized",
          value: unrealized,
          kind: "delta",
          note: `Unrealized on open lots: ${signedMoney(unrealized)}`,
        },
        { id: "now", label: "Equity", value: equity, kind: "total" },
      ]}
      label={`Waterfall: funded ${money(funded)}, realized ${signedMoney(realized)}, unrealized ${signedMoney(unrealized)}, now ${money(equity)}`}
      format={(v) => money(v).replace(/\.\d\d$/, "")}
      signed={(v) => signedMoney(v).replace(/\.\d\d$/, "")}
      floor={floor}
      note={`Axis from ${money(floor).replace(/\.\d\d$/, "")} · net of ${money(props.spread).replace(/\.\d\d$/, "")} spread`}
    />
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="kpi-spark" viewBox="0 0 140 28" aria-hidden="true" />;
  const x = d3
    .scaleLinear()
    .domain([0, values.length - 1])
    .range([1, 139]);
  const y = d3
    .scaleLinear()
    .domain(d3.extent(values) as [number, number])
    .range([26, 2]);
  const d =
    d3
      .line<number>()
      .x((_, i) => x(i))
      .y((v) => y(v))
      .curve(d3.curveStepAfter)(values) ?? "";
  return (
    <svg className="kpi-spark" viewBox="0 0 140 28" width="100%" height="28" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** One card per trader: equity line and drawdown on the same y scale for all. */
function SmallMultiples({ desk, focus }: { desk: Desk; focus: string | null }) {
  const { curves } = desk;
  const all = desk.books.flatMap((b) => curves.byTrader[b.trader.name.toLowerCase()].map((v) => v / INITIAL_BALANCE - 1));
  const lo = Math.min(-0.02, ...all);
  const hi = Math.max(0.02, ...all);
  const w = 200;
  const h = 64;
  const y = d3
    .scaleLinear()
    .domain([lo, hi])
    .range([h - 2, 2]);
  const x = d3
    .scaleLinear()
    .domain([0, Math.max(1, curves.times.length - 1)])
    .range([0, w]);
  return (
    <div className="multiples">
      {desk.books.map((b: Book) => {
        const name = b.trader.name.toLowerCase();
        const v = curves.byTrader[name].map((e) => e / INITIAL_BALANCE - 1);
        const dd = drawdownOf(curves.byTrader[name]);
        const line =
          d3
            .line<number>()
            .x((_, i) => x(i))
            .y((r) => y(r))
            .curve(d3.curveStepAfter)(v) ?? "";
        const ddArea =
          d3
            .area<number>()
            .x((_, i) => x(i))
            .y0(h + 4)
            .y1((r) => h + 4 + Math.min(18, -r * 60))
            .curve(d3.curveStepAfter)(dd) ?? "";
        const rec = tradeRecord(b.fills);
        const top = b.positions.slice(0, 3).map((p) => p.symbol);
        return (
          <Link
            key={name}
            to={`/trades?trader=${name}`}
            className="multiple"
            style={{ opacity: !focus || focus === name ? 1 : 0.35 }}
            aria-label={`${cap(name)} ${signedPct(b.change / INITIAL_BALANCE, 1)}, open ${cap(name)}'s trades`}
          >
            <span className="multiple-head">
              <span className="multiple-who" title={`${cap(name)}, ${crewRole(name)}`}>
                <TraderName name={name} />
                <TraderMark name={name} size={30} />
              </span>
              <span className="num money-tone" data-tone={tone(b.change)}>
                {signedPct(b.change / INITIAL_BALANCE, 1)}
              </span>
            </span>
            <span className="multiple-arch">{archetype(name)}</span>
            <span className="multiple-holds num">{top.length ? top.join(" · ") : "Cash"}</span>
            <svg viewBox={`0 0 ${w} ${h + 24}`} width="100%" aria-hidden="true">
              <line x1={0} x2={w} y1={y(0)} y2={y(0)} className="kit-zero" />
              <path d={line} className="kit-line" style={{ stroke: hueVar(name), strokeWidth: 1.6 }} />
              <path d={ddArea} className="kit-area" style={{ fill: "var(--negative)" }} />
            </svg>
            <span className="multiple-foot num">
              <span>{money(b.equity).replace(/\.\d\d$/, "")}</span>
              <span>
                {count(b.fills.length)} trades · MDD {signedPct(maxDrawdown(curves.byTrader[name]), 1)}
                {rec.closes ? ` · ${Math.round((rec.wins / rec.closes) * 100)}% win` : ""}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function LatestDecision({ desk }: { desk: Desk }) {
  const latest = desk.fills[0];
  return (
    <Panel title="Latest trade" id="latest" meta={latest && <span className="num">{stamp(latest.time)}</span>}>
      {latest ? (
        <div className="decision">
          <p className="decision-head">
            <TraderName name={latest.trader} /> {latest.side === "buy" ? "bought" : "sold"}{" "}
            <span className="num">{count(latest.quantity)}</span> {latest.symbol} at <span className="num">{price(latest.price)}</span>
          </p>
          <blockquote className="decision-serif small">{latest.rationale}</blockquote>
          <p className="decision-foot">
            {latest.realized !== undefined ? (
              <span>
                Realized <Change value={latest.realized} />
              </span>
            ) : (
              <span className="muted">Open position</span>
            )}
            <Link to={`/decisions?fill=${latest.id}`} className="text-link">
              Rationale
            </Link>
          </p>
        </div>
      ) : (
        <p className="empty">No trades yet.</p>
      )}
    </Panel>
  );
}

function signedCorr(v: number): string {
  const r = Number(v.toFixed(2));
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toFixed(2);
}

export function CorrelationTable({ traders, matrix }: { traders: string[]; matrix: (number | null)[][] }) {
  const tint = (v: number | null) =>
    v === null
      ? undefined
      : `color-mix(in srgb, var(${v >= 0 ? "--negative" : "--positive"}) ${Math.round(Math.abs(v) * 30)}%, transparent)`;
  return (
    <div className="table-wrap">
      <table className="table corr-table">
        <thead>
          <tr>
            <th scope="col" />
            {traders.map((t) => (
              <th key={t} scope="col" className="num">
                {cap(t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {traders.map((a, i) => (
            <tr key={a}>
              <th scope="row">
                <TraderName name={a} />
              </th>
              {traders.map((b, j) => {
                const v = i === j ? null : matrix[i][j];
                return (
                  <td key={b} className="num" style={{ background: tint(v) }}>
                    {i === j ? "" : v === null ? <span className="dash">—</span> : signedCorr(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The whole desk's money by what it is positioned for, from the Market Year read. */
export function DeskExposure() {
  const q = useQuery({ queryKey: ["market-year", "ytd"], queryFn: () => getMarketYear("ytd"), refetchInterval: 300_000 });
  const year = q.data?.ready ? q.data : null;
  if (!year) {
    return (
      <Panel title="Desk exposure" id="exposure">
        <p className="muted">{q.isLoading ? "Reading…" : "No Market Year yet: run uv run -m server.quant."}</p>
      </Panel>
    );
  }
  const total = year.exposure.reduce((s, e) => s + e.equity, 0);
  const parts = [
    { key: "risk_on", label: "Risk-on", value: year.exposure.reduce((s, e) => s + e.risk_on, 0) },
    { key: "defensive", label: "Defensive", value: year.exposure.reduce((s, e) => s + e.defensive, 0) },
    { key: "cash", label: "Cash", value: year.exposure.reduce((s, e) => s + e.cash, 0) },
  ];
  return (
    <Panel
      title="Desk exposure"
      id="exposure"
      meta={
        <Link className="text-link" to="/market-year">
          Regime: {year.read.rules.label}, {year.read.rules.risk}
        </Link>
      }
    >
      <div className="split split-lg" role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.value / total)}`).join(", ")}>
        {year.exposure.map((e) => (
          <span
            key={e.trader}
            className="split-bar"
            style={{ width: `${(e.risk_on / total) * 100}%`, background: `var(--t-${e.trader})` }}
          />
        ))}
        {year.exposure.map((e) => (
          <span
            key={`${e.trader}-d`}
            className="split-bar my-def"
            style={{ width: `${(e.defensive / total) * 100}%`, background: `var(--t-${e.trader})` }}
          />
        ))}
      </div>
      <table className="table kv">
        <tbody>
          {parts.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.label}</th>
              <td className="num">
                {money(p.value)} · {pct(p.value / total, 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        Risk-on: everything that is not cash or a defensive holding (utilities, staples, health care, Treasuries, investment-grade credit,
        gold, the inverse S&amp;P fund). Solid segments are risk-on, faded ones defensive, each in its trader's colour. Valued at the last
        stored close.
      </p>
    </Panel>
  );
}

// --- Story: how the desk got here ------------------------------------------------

function MoneyStory({ desk }: { desk: Desk }) {
  const { books, curves } = desk;
  const traders = books.map((b) => b.trader.name.toLowerCase());
  const fold = useMemo(() => foldTimes(curves.times), [curves.times]);
  const funded = INITIAL_BALANCE * books.length;
  const equity = books.reduce((s, b) => s + b.equity, 0);
  const change = equity - funded;
  const realized = books.reduce((s, b) => s + b.realized, 0);
  const unrealized = books.reduce((s, b) => s + b.unrealized, 0);
  const ranked = [...books].sort((a, b) => b.change - a.change);
  const lead = ranked[0].trader.name.toLowerCase();
  const full: [number, number] = [fold.xs[0], fold.xs[fold.xs.length - 1]];
  // Where the lines first leave $10k: the end of the flat opening.
  const firstMove = curves.times.findIndex((_, i) => traders.some((t) => Math.abs(curves.byTrader[t][i] / INITIAL_BALANCE - 1) > 0.01));
  const openEnd = firstMove > 0 ? fold.xs[Math.min(fold.xs.length - 1, firstMove + 1)] : full[1];
  const worstDD = Math.min(0, ...curves.drawdown);
  const worstI = curves.drawdown.indexOf(worstDD);
  const notes = moneyNotes(desk, fold, "pct", lead);
  const pctOf = (b: Book) => signedPct(b.change / INITIAL_BALANCE, 1);

  const steps: (StoryStep & { kind: "line" | "waterfall" | "split"; domain?: [number, number]; focus?: string | null; dd?: boolean })[] = [
    {
      id: "start",
      mark: <Crew icon={ICONS.sail} motion="rock" corner play="active" />,
      tag: shortDay(curves.times[0] * 1000),
      title: `${books.length} traders, ${money(INITIAL_BALANCE).replace(/\.\d\d$/, "")} each`,
      body: (
        <p>Every account starts in cash, so every line starts flat at 0%. Each trader runs its own strategy on the same local model.</p>
      ),
      kind: "line",
      domain: [full[0], Math.max(openEnd, full[0] + (full[1] - full[0]) * 0.15)],
    },
    {
      id: "lead",
      mark: <TraderMark name={lead} corner play="active" size={40} />,
      tag: notes[0]?.text.split(" · ")[0] ?? "",
      title: `${cap(lead)} ${ranked[0].change >= 0 ? "breaks away" : "falls behind"}`,
      body: (
        <p>
          {cap(lead)} ends up {pctOf(ranked[0])}. {notes[0]?.sub ? `The biggest open lot: ${notes[0].sub}.` : ""}
        </p>
      ),
      kind: "line",
      domain: full,
      focus: lead,
    },
    {
      id: "sink",
      mark: <Crew icon={ICONS.sinking} motion="sink" corner play="active" />,
      tag: worstI >= 0 ? stamp(curves.times[worstI] * 1000) : "",
      title: "The others sink",
      body: (
        <p>
          {ranked
            .slice(1)
            .filter((b) => b.change < 0)
            .map((b) => `${cap(b.trader.name)} ${pctOf(b)}`)
            .join(", ") || "Nobody else lost money"}
          . The desk's worst drawdown from its peak was {signedPct(worstDD)}.
        </p>
      ),
      kind: "line",
      domain: full,
      dd: true,
    },
    {
      id: "waterfall",
      mark: <Crew icon={ICONS.chest} motion="bob" corner play="active" />,
      tag: "now",
      title: "Where the money came from",
      body: (
        <p>
          From {money(funded).replace(/\.\d\d$/, "")} funded: {signedMoney(realized)} banked on closed lots and {signedMoney(unrealized)}{" "}
          still open, for {money(equity).replace(/\.\d\d$/, "")} today.
        </p>
      ),
      kind: "waterfall",
    },
    {
      id: "split",
      mark: <Crew icon={ICONS.flag} motion="wave" corner play="active" />,
      tag: "today",
      title: `Today's split: ${signedPct(change / funded, 1)} for the desk`,
      body: <p>{ranked.map((b) => `${cap(b.trader.name)} ${pctOf(b)}`).join(" · ")}.</p>,
      kind: "split",
    },
  ];

  return (
    <Scrolly
      label="Story steps"
      figureTitle={`How the desk got to ${signedPct(change / funded, 1)}`}
      steps={steps}
      figure={(i) => {
        const s = steps[i];
        if (s.kind === "waterfall")
          return (
            <div className="story-swap" key="wf">
              <WaterfallPanel
                funded={funded}
                realized={realized}
                unrealized={unrealized}
                equity={equity}
                spread={books.reduce((n, b) => n + b.spreadPaid, 0)}
              />
            </div>
          );
        if (s.kind === "split")
          return (
            <div className="story-swap" key="split">
              <DivergingBars
                rows={ranked.map((b) => ({
                  id: b.trader.name.toLowerCase(),
                  label: cap(b.trader.name),
                  value: b.change,
                  color: hueVar(b.trader.name),
                }))}
                label="Each trader's dollar contribution"
                format={(v) => signedMoney(v).replace(/\.\d\d$/, "")}
              />
            </div>
          );
        return (
          <div className="story-swap" key="line">
            <LineChart
              x={fold.xs}
              series={traders.map((t) => ({
                id: t,
                label: cap(t),
                color: hueVar(t),
                values: curves.byTrader[t].map((v) => v / INITIAL_BALANCE - 1),
                endText: signedPct(curves.byTrader[t].at(-1)! / INITIAL_BALANCE - 1, 1),
              }))}
              label="Return since funding by trader"
              height={300}
              yFormat={(v) => signedPct(v, 0)}
              zero={0}
              xTicks={fold.ticks}
              xFormat={fold.labelOf}
              xDomain={s.domain}
              focus={s.focus ?? null}
              bands={fold.breaks.map((b) => ({ ...b, fill: "var(--raised)" }))}
              notes={s.id === "lead" ? notes.slice(0, 1) : []}
            />
            <LineChart
              x={fold.xs}
              series={[
                {
                  id: "dd",
                  label: "Drawdown",
                  color: "var(--negative)",
                  values: curves.drawdown,
                  area: true,
                  width: 1,
                  endText: signedPct(worstDD),
                },
              ]}
              label="Desk drawdown"
              height={90}
              yFormat={(v) => signedPct(v, 0)}
              zero={0}
              xTicks={fold.ticks}
              xFormat={fold.labelOf}
              xDomain={s.domain}
              yDomain={[Math.min(-0.01, worstDD) * 1.1, 0]}
              notes={
                s.dd && worstI >= 0 ? [{ x: fold.xs[worstI], y: worstDD, text: `worst ${signedPct(worstDD)}`, dir: "e", len: 20 }] : []
              }
            />
          </div>
        );
      }}
    />
  );
}
