// Market Year charts built on the kit: SPY shaded by regime (the story's sticky
// figure, which zooms by tweening its x domain), the HMM's four state
// probabilities as a stacked ribbon, and the desk's positioning gauge.

import * as d3 from "d3";
import type { MarketYear as Year, RegimeLabel, RegimeModel } from "../api";
import { LineChart, useSize, type Band, type DataNote } from "../charts";
import { pct, price, shortDay } from "../lib/format";
import { slug } from "../lib/regime";
import { hueVar } from "../lib/traders";

/** ISO day → ms at noon UTC, so the local date never shifts. */
export const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);

const regimeFill = (l: string) => `var(--rg-${slug(l)})`;

export function regimeBands(days: string[], labels: (string | null)[]): Band[] {
  const out: Band[] = [];
  labels.forEach((l, i) => {
    if (!l) return;
    const t = dayMs(days[i]);
    const last = out[out.length - 1];
    if (last && last.label === l) last.to = t + 86_400_000;
    else out.push({ from: t, to: t + 86_400_000, fill: regimeFill(l), label: l, hatch: l === "Volatile bull" });
  });
  // Band labels would crowd the plot; the legend names them.
  return out.map((b) => ({ ...b, label: undefined }));
}

const PAD = { l: 58, r: 16 };

export function SpyRegimeChart(props: { year: Year; model: RegimeModel; xDomain?: [number, number]; notes?: DataNote[]; height?: number }) {
  const { days, spy, sma200 } = props.year.series;
  const x = days.map(dayMs);
  return (
    <LineChart
      x={x}
      series={[
        { id: "sma", label: "200-day", color: "var(--muted)", values: sma200, dashed: true, width: 1 },
        { id: "spy", label: "SPY", color: "var(--text)", values: spy, width: 2 },
      ]}
      label={`SPY from ${shortDay(x[0])} to ${shortDay(x[x.length - 1])}, ${price(spy[0])} to ${price(spy[spy.length - 1])}, shaded by regime`}
      height={props.height ?? 300}
      yFormat={(v) => "$" + Math.round(v)}
      curve="linear"
      endLabels={false}
      pad={PAD}
      bands={regimeBands(days, props.year.series[props.model])}
      xDomain={props.xDomain}
      notes={props.notes}
    />
  );
}

/** The HMM's state probabilities, stacked to 100%, under the price chart. */
export function ProbRibbon(props: {
  year: Year;
  xDomain?: [number, number];
  height?: number;
  /** Line up under a chart that spaces trading days evenly, with these margins. */
  under?: { l: number; r: number };
}) {
  const { year, xDomain, height = 70, under } = props;
  const { days, hmm_probs } = year.series;
  if (!hmm_probs?.some(Boolean)) return null;
  const x = under ? days.map((_, i) => i) : days.map(dayMs);
  // Painter's order: draw the running total from the top down, each over the last.
  const cum = (k: number) =>
    hmm_probs.map((p) => (p ? year.labels.slice(0, k + 1).reduce((s, l) => s + (p[l as RegimeLabel] ?? 0), 0) : null));
  const series = year.labels
    .map((l, k) => ({
      id: l,
      label: l,
      color: l === "Volatile bull" ? "var(--rg-volatile-line)" : regimeFill(l),
      values: cum(k),
      area: true,
      width: 0.5,
    }))
    .reverse();
  return (
    <div className="ribbon">
      <p className="ribbon-label">HMM probability</p>
      <LineChart
        x={x}
        series={series}
        label="HMM state probabilities over time, stacked to 100%"
        height={height}
        yFormat={(v) => pct(v)}
        yDomain={[0, 1]}
        yTicks={[0, 1]}
        zero={0}
        curve="linear"
        endLabels={false}
        pad={{ ...(under ?? PAD), t: 4, b: under ? 4 : 22 }}
        noXAxis={!!under}
        xDomain={xDomain}
        tooltip={(i) => (
          <>
            <p className="kit-tip-head">{shortDay(dayMs(days[i]))}</p>
            {year.labels.map((l) => (
              <p key={l} className="kit-tip-row">
                <span className="kit-tip-swatch" style={{ background: regimeFill(l), height: 8 }} />
                {l}
                <span className="num">{pct(hmm_probs[i]?.[l as RegimeLabel] ?? 0)}</span>
              </p>
            ))}
          </>
        )}
      />
    </div>
  );
}

/** Desk risk-on share on a semicircle, with each trader as a tick at their own share. */
export function PositionGauge({ year }: { year: Year }) {
  const [ref, width] = useSize<HTMLDivElement>();
  const total = year.exposure.reduce((s, e) => s + e.equity, 0);
  const desk = total ? year.exposure.reduce((s, e) => s + e.risk_on, 0) / total : 0;
  const w = Math.min(320, width || 320);
  const r = w / 2 - 16;
  const cx = w / 2;
  const cy = r + 12;
  const arc = d3
    .arc<{ a: number; b: number }>()
    .innerRadius(r - 14)
    .outerRadius(r)
    .startAngle((d) => d.a)
    .endAngle((d) => d.b);
  const ang = (v: number) => -Math.PI / 2 + v * Math.PI;
  return (
    <div ref={ref} className="gauge">
      <svg viewBox={`0 0 ${w} ${cy + 30}`} width="100%" role="img" aria-label={`Desk is ${pct(desk)} risk-on`}>
        <g transform={`translate(${cx},${cy})`}>
          <path d={arc({ a: ang(0), b: ang(1) }) ?? ""} className="gauge-track" />
          <path d={arc({ a: ang(0), b: ang(desk) }) ?? ""} className="gauge-fill" />
          {year.exposure.map((e) => {
            const v = e.equity ? e.risk_on / e.equity : 0;
            const a = ang(v) - Math.PI / 2;
            return (
              <line
                key={e.trader}
                x1={Math.cos(a) * (r - 20)}
                y1={Math.sin(a) * (r - 20)}
                x2={Math.cos(a) * (r + 6)}
                y2={Math.sin(a) * (r + 6)}
                style={{ stroke: hueVar(e.trader) }}
                strokeWidth={3}
              >
                <title>
                  {e.trader} {pct(v)} risk-on
                </title>
              </line>
            );
          })}
          <text className="gauge-value num" y={-8} textAnchor="middle">
            {pct(desk)}
          </text>
          <text className="gauge-sub" y={12} textAnchor="middle">
            risk-on
          </text>
          <text className="kit-tick" x={-r} y={22} textAnchor="middle">
            0%
          </text>
          <text className="kit-tick" x={r} y={22} textAnchor="middle">
            100%
          </text>
        </g>
      </svg>
    </div>
  );
}
