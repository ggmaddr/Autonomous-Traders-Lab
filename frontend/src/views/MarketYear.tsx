// Market Year: what kind of market is this, and who is positioned for it? SPY over the
// year leads, its background shaded by the chosen regime model, with both models as
// strips underneath so they can be compared day by day; then today's read, which
// signals have paid in each regime, each trader's exposure, and the episodes with the
// news that turned them. Everything comes from the daily pipeline (backend/quant).

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getMarketYear,
  type Episode,
  type MarketYear as Year,
  type RegimeLabel,
  type RegimeModel,
  type ScoreCell,
  type YearRange,
} from "../api";
import { Failed, Loading, PageHeader, Panel, TraderName } from "../components/bits";
import { ViewToggle, useViewMode } from "../charts";
import { PositionGauge, ProbRibbon } from "../components/RegimeCharts";
import { MarketStory } from "./MarketStory";
import { niceTicks, useWidth } from "../components/charts";
import { host, money, pct, price, signedPct, time } from "../lib/format";
import { MONTHS, bestSignal, dayLabel, deskRiskOn, fill, hmmPhrase, longDay } from "../lib/regime";

const MODEL_NAME: Record<RegimeModel, string> = { rules: "Rules", hmm: "HMM" };
const RANGE_NAME: Record<YearRange, string> = { ytd: "YTD", "2y": "2 y", "10y": "10 y" };
type Window = "blend" | "ytd" | "10y";
const WINDOW_NAME: Record<Window, string> = { blend: "Blend", ytd: "This year", "10y": "Prior 10 y" };

export function MarketYear() {
  const [range, setRange] = useState<YearRange>("ytd");
  const [model, setModel] = useState<RegimeModel>("rules");
  const [view] = useViewMode();
  // The story always tells this year's transitions.
  const shown = view === "story" ? "ytd" : range;
  const q = useQuery({ queryKey: ["market-year", shown], queryFn: () => getMarketYear(shown), refetchInterval: 300_000 });
  const year = q.data?.ready ? q.data : null;

  return (
    <div className="view">
      <PageHeader
        kicker={year ? `Regime report · as of the close on ${longDay(year.as_of)}` : "Regime report"}
        title="Market Year"
        finding={
          year ? (
            <Finding year={year} />
          ) : q.isLoading ? (
            "Reading the regimes…"
          ) : q.data && !q.data.ready ? (
            "No regimes yet. Run uv run -m backend.quant to load the bars and compute them."
          ) : (
            "The regimes could not be read."
          )
        }
        aside={
          <div className="page-aside-stack">
            <ViewToggle />
            {year && <p className="fresh num">Pipeline ran {time(new Date(year.computed_at).getTime())} · daily after the close</p>}
          </div>
        }
      />
      {q.error && !q.data && <Failed what="the market year" error={q.error} />}
      {q.isLoading && <Loading rows={8} />}
      {year &&
        (view === "story" ? (
          <MarketStory year={year} />
        ) : (
          <Body year={year} range={range} setRange={setRange} model={model} setModel={setModel} />
        ))}
    </div>
  );
}

function Finding({ year }: { year: Year }) {
  const { rules } = year.read;
  const best = bestSignal(year, "rules", rules.label);
  const hmmText = hmmPhrase(year);
  return (
    <>
      {rules.label} for <span className="num">{rules.days}</span> trading days since {dayLabel(rules.since)}
      {hmmText && `; ${hmmText}`}.{" "}
      {best && (
        <>
          In this regime {best.label.toLowerCase()} has paid best, Sharpe <span className="num">{signed(best.sharpe!)}</span> over{" "}
          <span className="num">{best.n_days}</span> days.{" "}
        </>
      )}
      The desk is <span className="num">{pct(deskRiskOn(year))}</span> risk-on.
    </>
  );
}

function signed(v: number, digits = 2): string {
  const r = Number(v.toFixed(digits));
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toFixed(digits);
}

function Body(props: {
  year: Year;
  range: YearRange;
  setRange: (r: YearRange) => void;
  model: RegimeModel;
  setModel: (m: RegimeModel) => void;
}) {
  const { year, model } = props;
  const [picked, setPicked] = useState<string | null>(null);
  const episodes = year.episodes[model] ?? [];
  const models = (Object.keys(MODEL_NAME) as RegimeModel[]).filter((m) => year.versions[m]);

  return (
    <>
      <div className="grid-lead">
        <Panel
          title="SPY by regime"
          id="spy"
          className="lead"
          meta={
            <div className="my-controls">
              <div className="segmented" role="group" aria-label="Regime model shading the chart">
                {models.map((m) => (
                  <button key={m} aria-pressed={model === m} onClick={() => props.setModel(m)}>
                    {MODEL_NAME[m]}
                  </button>
                ))}
              </div>
              <div className="segmented" role="group" aria-label="Range">
                {(Object.keys(RANGE_NAME) as YearRange[]).map((r) => (
                  <button key={r} aria-pressed={props.range === r} onClick={() => props.setRange(r)}>
                    {RANGE_NAME[r]}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <RegimeLegend labels={year.labels} risk={year.risk} />
          <RegimeChart year={year} model={model} episodes={episodes} picked={picked} onPick={setPicked} />
          <ProbRibbon year={year} under={{ l: 64, r: 12 }} height={46} />
          <p className="note">
            Shading: the {MODEL_NAME[model]} model. Strips: both models, day by day. Dashed: the 200-day average. Numbered marks are
            transitions; pick one to see its episode and the news. Labels change only after the new regime has held 5 trading days, so every
            turn is confirmed late.
          </p>
        </Panel>
        <RegimeNow year={year} />
      </div>

      <div className="grid-lead">
        <Scoreboard year={year} model={model} />
        <Positioned year={year} />
      </div>

      <Episodes year={year} model={model} episodes={episodes} picked={picked} onPick={setPicked} />

      <Panel title="How these numbers are made" id="method">
        <ul className="my-notes">
          <li>
            Bars: <span className="num">{year.bars.n.toLocaleString("en-US")}</span> daily bars for{" "}
            <span className="num">{year.bars.symbols}</span> symbols, {year.bars.first} to {year.bars.last}, from {year.bars.source}. Every
            value for a day uses bars up to that day only.
          </li>
          {models.map((m) => (
            <li key={m}>
              {MODEL_NAME[m]}: {year.versions[m]}
            </li>
          ))}
          {year.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

// --- Legend -------------------------------------------------------------------

function RegimeDefs() {
  return (
    <defs>
      <pattern id="rg-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--rg-volatile-bull)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--rg-volatile-line)" strokeWidth="2" />
      </pattern>
    </defs>
  );
}

function RegimeSwatch({ label }: { label: string }) {
  return (
    <svg width="14" height="10" aria-hidden="true" className="rg-swatch">
      <RegimeDefs />
      <rect width="14" height="10" rx="2" fill={fill(label)} />
    </svg>
  );
}

function RegimeLegend({ labels, risk }: { labels: RegimeLabel[]; risk: Record<string, string> }) {
  return (
    <ul className="rg-legend">
      {labels.map((l) => (
        <li key={l}>
          <RegimeSwatch label={l} />
          {l} <span className="muted">{risk[l]}</span>
        </li>
      ))}
    </ul>
  );
}

// --- The chart ----------------------------------------------------------------

function runsOf(labels: (string | null)[]) {
  const out: { label: string; a: number; b: number }[] = [];
  labels.forEach((l, i) => {
    if (!l) return;
    const last = out[out.length - 1];
    if (last && last.label === l && last.b === i - 1) last.b = i;
    else out.push({ label: l, a: i, b: i });
  });
  return out;
}

function xTicks(days: string[], range: YearRange): number[] {
  const out: number[] = [];
  days.forEach((d, i) => {
    const prev = days[i - 1];
    if (!prev) return;
    if (
      range === "10y"
        ? d.slice(0, 4) !== prev.slice(0, 4)
        : range === "2y"
          ? d.slice(0, 7) !== prev.slice(0, 7) && ["01", "04", "07", "10"].includes(d.slice(5, 7))
          : d.slice(0, 7) !== prev.slice(0, 7)
    )
      out.push(i);
  });
  return out;
}

function RegimeChart(props: {
  year: Year;
  model: RegimeModel;
  episodes: Episode[];
  picked: string | null;
  onPick: (start: string | null) => void;
}) {
  const { year, model } = props;
  const { days, spy, sma200 } = year.series;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotH = 330;
  const strip = 12;
  const pad = { l: 64, r: 12, t: 46, b: 26 };
  const stripsTop = pad.t + plotH + 10;
  const height = stripsTop + strip * 2 + 6 + pad.b;
  const w = Math.max(0, width - pad.l - pad.r);
  const values = [...spy, ...sma200.filter((v): v is number => v !== null)];
  const yt = niceTicks(Math.min(...values), Math.max(...values), 4);
  const x = (i: number) => pad.l + (days.length > 1 ? (i / (days.length - 1)) * w : 0);
  const y = (v: number) => pad.t + plotH - ((v - yt[0]) / (yt[yt.length - 1] - yt[0])) * plotH;
  const step = days.length > 1 ? w / (days.length - 1) : w;
  const index = useMemo(() => new Map(days.map((d, i) => [d, i])), [days]);
  const line = spy.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const avg = sma200
    .map((v, i) => (v === null ? "" : `${i && sma200[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .join("");
  const marks = props.episodes
    .map((e, n) => ({ e, n, i: index.get(e.start) }))
    .filter((m): m is { e: Episode; n: number; i: number } => m.i !== undefined && m.i > 0);
  // Marks closer than a mark's width step up a row, so neighbours never overlap.
  const markRow: number[] = [];
  const rowEnd = [-Infinity, -Infinity];
  marks.forEach(({ i }, k) => {
    const row = x(i) - rowEnd[0] >= 20 ? 0 : x(i) - rowEnd[1] >= 20 ? 1 : 0;
    rowEnd[row] = x(i);
    markRow[k] = row;
  });
  const ticks = xTicks(days, year.range);

  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const i = Math.round((ev.clientX - r.left - pad.l) / Math.max(step, 1e-9));
    setHover(i >= 0 && i < days.length ? i : null);
  };
  const h = hover !== null ? hover : null;
  const last = days.length - 1;

  return (
    <div ref={ref} className="svg-chart my-chart">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`SPY from ${days[0]} to ${days[last]}, ${price(spy[0])} to ${price(spy[last])}, shaded by the ${MODEL_NAME[model]} regime model`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <RegimeDefs />
          {runsOf(year.series[model]).map((r) => (
            <rect
              key={`${r.label}-${r.a}`}
              x={x(r.a) - step / 2}
              width={Math.max(1, (r.b - r.a + 1) * step)}
              y={pad.t}
              height={plotH}
              fill={fill(r.label)}
              className="rg-band"
            />
          ))}
          {yt.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="grid" />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="tick">
                ${Math.round(v).toLocaleString("en-US")}
              </text>
            </g>
          ))}
          <path d={avg} className="my-sma" />
          <path d={line} className="my-spy" />
          {(["rules", "hmm"] as RegimeModel[]).map((m, k) => (
            <g key={m}>
              <text x={pad.l - 8} y={stripsTop + k * (strip + 6) + 10} textAnchor="end" className="tick">
                {MODEL_NAME[m]}
              </text>
              {runsOf(year.series[m]).map((r) => (
                <rect
                  key={`${m}-${r.a}`}
                  x={x(r.a) - step / 2}
                  width={Math.max(1, (r.b - r.a + 1) * step)}
                  y={stripsTop + k * (strip + 6)}
                  height={strip}
                  fill={fill(r.label)}
                />
              ))}
              {m === model && (
                <line
                  x1={pad.l}
                  x2={width - pad.r}
                  y1={stripsTop + k * (strip + 6) + strip + 2}
                  y2={stripsTop + k * (strip + 6) + strip + 2}
                  className="my-strip-pick"
                />
              )}
            </g>
          ))}
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className="tick">
              {year.range === "10y"
                ? days[i].slice(0, 4)
                : year.range === "2y"
                  ? `${MONTHS[Number(days[i].slice(5, 7)) - 1]} ${days[i].slice(2, 4)}`
                  : MONTHS[Number(days[i].slice(5, 7)) - 1]}
            </text>
          ))}
          {marks.map(({ e, n, i }, k) => (
            <g
              key={e.start}
              className="my-mark"
              data-picked={props.picked === e.start}
              transform={`translate(${x(i)},${pad.t - 13 - markRow[k] * 20})`}
              role="button"
              tabIndex={0}
              aria-label={`Transition to ${e.label} on ${e.start}`}
              onClick={() => props.onPick(props.picked === e.start ? null : e.start)}
              onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && props.onPick(e.start)}
            >
              <line x1={0} x2={0} y1={9} y2={13 + markRow[k] * 20 + plotH} className="my-mark-line" />
              <circle r={9} />
              <text y={4} textAnchor="middle">
                {n + 1}
              </text>
            </g>
          ))}
          {h !== null && (
            <g pointerEvents="none">
              <line x1={x(h)} x2={x(h)} y1={pad.t} y2={stripsTop + strip * 2 + 6} className="my-cursor" />
              <circle cx={x(h)} cy={y(spy[h])} r={3.5} className="my-dot" />
            </g>
          )}
        </svg>
      )}
      <p className="my-readout num" aria-live="polite">
        {h !== null ? (
          <>
            <span className="strong">{longDay(days[h])}</span>
            <span>SPY {price(spy[h])}</span>
            <span>Rules {year.series.rules[h] ?? "—"}</span>
            <span>
              HMM {year.series.hmm[h] ?? "—"}
              {year.series.hmm_prob[h] !== null && ` ${pct(year.series.hmm_prob[h]!)}`}
            </span>
          </>
        ) : (
          <>
            <span className="strong">{longDay(days[last])}</span>
            <span>SPY {price(spy[last])}</span>
            <span>
              {signedPct(spy[last] / spy[0] - 1)} since {longDay(days[0])}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

// --- Today's read --------------------------------------------------------------

const KEY_FEATURES: Record<string, string> = {
  vol20: "Volatility, 20 days",
  vol_pct: "Volatility percentile, 10 years",
  spy_vs_200: "SPY against 200-day average",
  dd_52w: "SPY from its 52-week high",
  breadth50: "Sectors above 50-day average",
  corr60: "Sector correlation, 60 days",
  credit: "Credit, HYG vs IEF, 60 days",
  dollar: "Dollar, UUP, 60 days",
  rates: "Long bonds, TLT, 60 days",
};

function featureValue(unit: string, v: number | null, key: string): string {
  if (v === null) return "—";
  if (key === "breadth50") return `${Math.round(v * 11)} of 11`;
  if (unit === "ann") return pct(v, 1);
  if (unit === "pct") return `${Math.round(v * 100)}th pct`;
  if (unit === "corr") return v.toFixed(2);
  return signedPct(v, 1);
}

function RegimeNow({ year }: { year: Year }) {
  const { rules, hmm, agree, switches_this_month, raw, raw_days, dwell } = year.read;
  const hmmTurning = !!hmm && !!raw.hmm && raw.hmm !== hmm.label;
  const rulesTurning = !!raw.rules && raw.rules !== rules.label;
  const features = Object.keys(KEY_FEATURES)
    .map((k) => year.read.features.find((f) => f.key === k)!)
    .filter(Boolean);
  return (
    <Panel title="Jim's regime read" id="now" meta={<span className="num">close {dayLabel(year.read.day)}</span>}>
      <div className="answer my-answer">
        <RegimeSwatch label={rules.label} />
        <span className="answer-figure">{rules.label}</span>
      </div>
      <p className="answer-sub my-answer-sub">
        Rules · <span className="num">{rules.days}</span> trading days since {dayLabel(rules.since)} · {rules.risk}
        {rulesTurning && (
          <>
            {" "}
            · daily read <span className="strong">{raw.rules}</span> for <span className="num">{raw_days.rules}</span> of{" "}
            <span className="num">{dwell}</span> days
          </>
        )}
      </p>
      {hmm && (
        <div className="my-hmm">
          <p>
            HMM <span className="strong">{hmm.label}</span>{" "}
            {hmmTurning ? <span className="muted">confirmed</span> : <span className="num">{pct(hmm.prob)}</span>}{" "}
            <span className={agree ? "tag" : "tag my-disagree"}>{agree ? "agrees" : "disagrees"}</span>
            {hmmTurning && (
              <span
                className="tag my-disagree"
                title="The raw daily label differs from the confirmed one; it confirms after it holds for the dwell period."
              >
                turning
              </span>
            )}
          </p>
          {hmmTurning && (
            <p className="my-hmm-raw">
              Daily read <span className="strong">{raw.hmm}</span> <span className="num">{pct(hmm.probs[raw.hmm!] ?? 0)}</span> for{" "}
              <span className="num">{raw_days.hmm}</span> of <span className="num">{dwell}</span> days needed to switch.
            </p>
          )}
          <div className="my-probs" role="img" aria-label={year.labels.map((l) => `${l} ${pct(hmm.probs[l] ?? 0)}`).join(", ")}>
            <svg width="100%" height="10" preserveAspectRatio="none" viewBox="0 0 100 10" aria-hidden="true">
              <RegimeDefs />
              {(() => {
                let at = 0;
                return year.labels.map((l) => {
                  const p = (hmm.probs[l] ?? 0) * 100;
                  const r = <rect key={l} x={at} width={p} height={10} fill={fill(l)} />;
                  at += p;
                  return r;
                });
              })()}
            </svg>
          </div>
          <p className="my-probs-key num">
            {year.labels.map((l) => (
              <span key={l}>
                {l} {pct(hmm.probs[l] ?? 0)}
              </span>
            ))}
          </p>
        </div>
      )}
      <table className="table kv">
        <tbody>
          {features.map((f) => (
            <tr key={f.key}>
              <th scope="row" title={f.label}>
                {KEY_FEATURES[f.key]}
              </th>
              <td className="num">{featureValue(f.unit, f.value, f.key)}</td>
            </tr>
          ))}
          <tr className="kv-break">
            <th scope="row">Regime switches this month</th>
            <td className="num">{switches_this_month}</td>
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}

// --- Scoreboard ----------------------------------------------------------------

function cellTint(sharpe: number | null): string | undefined {
  if (sharpe === null) return undefined;
  const k = Math.min(Math.abs(sharpe) / 2, 1) * 32;
  return `color-mix(in srgb, var(${sharpe >= 0 ? "--positive" : "--negative"}) ${k.toFixed(0)}%, transparent)`;
}

function cellTitle(c: ScoreCell, signal: string): string {
  if (c.sharpe === null) return `${signal}, ${c.regime}: no days`;
  return [
    `${signal} in ${c.regime} (${c.window})`,
    `Sharpe ${signed(c.sharpe)}, 95% CI ${signed(c.ci_lo!)} to ${signed(c.ci_hi!)}`,
    `Annual return ${c.ann_return === null ? "—" : signedPct(c.ann_return, 1)}`,
    `Invested days up ${c.hit_rate === null ? "—" : pct(c.hit_rate)}`,
    `${c.n_days} days in ${c.n_episodes} episodes`,
  ].join("\n");
}

function Scoreboard({ year, model }: { year: Year; model: RegimeModel }) {
  const [win, setWin] = useState<Window>("blend");
  const cells = year.scores[model].cells.filter((c) => c.window === win);
  const at = (s: string, r: string) => cells.find((c) => c.signal === s && c.regime === r);
  const cols: (RegimeLabel | "All")[] = [...year.labels, "All"];
  const now = year.read[model]?.label;
  return (
    <Panel
      title="Signal scoreboard"
      id="scoreboard"
      meta={
        <div className="segmented" role="group" aria-label="Scoring window">
          {(Object.keys(WINDOW_NAME) as Window[]).map((w) => (
            <button key={w} aria-pressed={win === w} onClick={() => setWin(w)}>
              {WINDOW_NAME[w]}
            </button>
          ))}
        </div>
      }
    >
      <div className="table-wrap">
        <table className="table my-board">
          <thead>
            <tr>
              <th scope="col">Signal · Sharpe, n days</th>
              {cols.map((c) => (
                <th key={c} scope="col" className="num" data-now={c === now}>
                  {c === "All" ? "All days" : c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {year.signals.map((s) => (
              <tr key={s.id}>
                <th scope="row" title={s.rule}>
                  {s.label}
                </th>
                {cols.map((r) => {
                  const c = at(s.id, r);
                  return (
                    <td
                      key={r}
                      className="num my-cell"
                      data-now={r === now}
                      style={{ background: cellTint(c?.sharpe ?? null) }}
                      title={c ? cellTitle(c, s.label) : undefined}
                    >
                      {c?.sharpe === null || !c ? (
                        <span className="dash">—</span>
                      ) : (
                        <>
                          <span className="my-cell-sharpe">{signed(c.sharpe)}</span>
                          <span className="my-cell-n">{c.n_days}</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Annualized Sharpe of each signal on the days each regime was in force ({MODEL_NAME[model]} model); small grey figures are trading
        days. Blend shrinks this year toward the prior ten with weight n / (n + 63). Hover a cell for its 95% interval; a regime with a few
        dozen days says little. The column marked is today's regime.
      </p>
    </Panel>
  );
}

// --- Who is positioned for it --------------------------------------------------

function Positioned({ year }: { year: Year }) {
  const risk = year.read.rules.risk;
  return (
    <Panel title="Who is positioned for it" id="positioned" meta={<span>Regime is {risk}</span>}>
      <PositionGauge year={year} />
      <ul className="my-exposure">
        {year.exposure.map((e) => {
          const on = e.equity ? e.risk_on / e.equity : 0;
          const def = e.equity ? e.defensive / e.equity : 0;
          const cash = e.equity ? e.cash / e.equity : 0;
          return (
            <li key={e.trader}>
              <div className="my-exp-line">
                <TraderName name={e.trader} />
                <span className="num muted">{money(e.equity)}</span>
              </div>
              <div className="split" role="img" aria-label={`Risk-on ${pct(on)}, defensive ${pct(def)}, cash ${pct(cash)}`}>
                <span className="split-bar" style={{ width: `${on * 100}%`, background: `var(--t-${e.trader})` }} />
                <span className="split-bar my-def" style={{ width: `${def * 100}%`, background: `var(--t-${e.trader})` }} />
              </div>
              <p className="split-legend num">
                <span>Risk-on {pct(on)}</span>
                <span>Defensive {pct(def)}</span>
                <span>Cash {pct(cash)}</span>
              </p>
              <p className="my-holdings">
                {e.positions.length
                  ? e.positions.map((p) => `${p.symbol} ${money(p.value)}${p.priced === "last fill" ? "*" : ""}`).join(" · ")
                  : "All cash"}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="note">
        Defensive: utilities, staples, health care, Treasuries, investment-grade credit, gold and the inverse S&P fund. Valued at the last
        stored close; * at the last fill, for symbols the pipeline does not load.
      </p>
    </Panel>
  );
}

// --- Episodes ------------------------------------------------------------------

function Episodes(props: {
  year: Year;
  model: RegimeModel;
  episodes: Episode[];
  picked: string | null;
  onPick: (start: string | null) => void;
}) {
  const rows = useRef<Record<string, HTMLTableRowElement | null>>({});
  useEffect(() => {
    if (props.picked) rows.current[props.picked]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [props.picked]);
  const numbered = props.episodes.map((e, n) => ({ e, n })).reverse();
  return (
    <Panel title="Episodes" id="episodes" meta={<span>{MODEL_NAME[props.model]} model · newest first</span>}>
      <div className="table-wrap">
        <table className="table my-episodes">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Regime</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col" className="num">
                Days
              </th>
              <th scope="col" className="num">
                SPY
              </th>
              <th scope="col" className="num">
                Max DD
              </th>
              <th scope="col" className="num">
                Vol
              </th>
              <th scope="col">Led · lagged</th>
              <th scope="col">What turned it</th>
            </tr>
          </thead>
          <tbody>
            {numbered.map(({ e, n }) => (
              <tr
                key={e.start}
                ref={(el) => (rows.current[e.start] = el)}
                aria-selected={props.picked === e.start}
                onClick={() => props.onPick(props.picked === e.start ? null : e.start)}
              >
                <td className="num">{n + 1}</td>
                <td className="nowrap">
                  <RegimeSwatch label={e.label} /> {e.label}
                </td>
                <td className="num nowrap">{dayLabel(e.start)}</td>
                <td className="num nowrap">{e.open ? <span className="muted">holding</span> : dayLabel(e.end)}</td>
                <td className="num">{e.days}</td>
                <td className="num">
                  <span className="change" data-tone={e.spy_return > 0 ? "good" : e.spy_return < 0 ? "bad" : "flat"}>
                    {signedPct(e.spy_return, 1)}
                  </span>
                </td>
                <td className="num">{signedPct(e.max_drawdown, 1)}</td>
                <td className="num">{e.vol === null ? "—" : pct(e.vol, 1)}</td>
                <td className="nowrap my-sectors">
                  {e.leaders
                    .slice(0, 2)
                    .map((l) => `${l.symbol} ${signedPct(l.return, 1)}`)
                    .join(", ")}
                  <br />
                  <span className="muted">
                    {e.laggards
                      .slice(0, 2)
                      .map((l) => `${l.symbol} ${signedPct(l.return, 1)}`)
                      .join(", ")}
                  </span>
                </td>
                <td className="my-news">
                  {n === 0 ? (
                    <span className="muted">Start of the range</span>
                  ) : e.event ? (
                    <>
                      <span className="strong">{e.event.headline}</span>
                      {props.picked === e.start && <p className="my-news-summary">{e.event.summary}</p>}
                      <span className="my-sources">
                        {e.event.sources.slice(0, props.picked === e.start ? 5 : 2).map((s) => (
                          <a
                            key={s.url}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-link"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            {host(s.url)}
                          </a>
                        ))}
                      </span>
                    </>
                  ) : (
                    <span className="muted">Not researched yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        SPY return runs from the close before the episode to its last close. Led and lagged: the best and worst two sector funds over the
        episode. The news comes from one Researcher run per transition, searching the days around it; pick a row for the full summary.
      </p>
    </Panel>
  );
}
