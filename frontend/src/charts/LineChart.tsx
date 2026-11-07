// Time-series lines: one per trader (or one SPY line), labelled at their right
// end with a dot on the latest value, a crosshair tooltip, shaded bands (regimes,
// engine-off gaps), an optional filled area series (drawdown) and annotations.
// A trader in focus is drawn bold and the others dim; clicking a line or its end
// label picks it. xDomain is tweened, so a story step can zoom the chart.

import { useMemo, useState, type ReactNode } from "react";
import * as d3 from "d3";
import { AxisX, AxisY, ChartBox, Frame, Tip, dim, spreadLabels, timeFormatFor, timeTicks, useSize, useTip, useTween } from "./core";
import { annotate, type Dir } from "./annotate";
import { ChartEmpty } from "./states";

export interface LineSeries {
  id: string;
  label: string;
  color: string; // a CSS colour, var() allowed
  values: (number | null)[];
  width?: number;
  dashed?: boolean;
  /** Fill between the line and the zero rule (a drawdown strip). */
  area?: boolean;
  /** Text after the label at the line's end, e.g. "+76.5%". */
  endText?: string;
}

export interface Band {
  from: number;
  to: number;
  fill: string;
  label?: string;
  hatch?: boolean;
}

export interface DataNote {
  x: number; // ms
  y: number; // value
  text: string;
  sub?: string;
  dir?: Dir;
  len?: number;
}

export interface LineChartProps {
  x: number[]; // ms, ascending
  series: LineSeries[];
  label: string;
  height?: number;
  yFormat: (v: number) => string;
  xFormat?: (ms: number) => string;
  /** Fixed y ticks (a short strip needs only one or two). */
  yTicks?: number[];
  /** Fixed x ticks, for a folded (non-calendar) x axis. */
  xTicks?: number[];
  log?: boolean;
  /** Value of the reference rule (0% or $10,000). */
  zero?: number;
  focus?: string | null;
  lead?: string | null; // drawn bold when nothing is in focus
  onPick?: (id: string | null) => void;
  bands?: Band[];
  notes?: DataNote[];
  xDomain?: [number, number];
  yDomain?: [number, number];
  curve?: "step" | "linear";
  endLabels?: boolean;
  /** Row(s) for the tooltip at sample i; default lists every series. */
  tooltip?: (i: number) => ReactNode;
  /** Extra marks drawn in chart pixels, after the lines. */
  /** Override the plot margins, to line up with another chart. */
  pad?: Partial<{ t: number; r: number; b: number; l: number }>;
  /** Hide the x axis labels (a strip stacked under another chart). */
  noXAxis?: boolean;
  overlay?: (s: { x: (ms: number) => number; y: (v: number) => number; width: number; height: number }) => ReactNode;
}

export function LineChart(props: LineChartProps) {
  const [ref, width] = useSize<HTMLDivElement>();
  const { tip, show, hide: hideTip } = useTip();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const hide = () => {
    hideTip();
    setHoverX(null);
  };
  const height = props.height ?? 300;
  const narrow = width < 520;
  const endLabels = props.endLabels ?? true;
  const labelW = endLabels ? (narrow ? 84 : 128) : 12;
  const m = { t: 16, r: labelW, b: 28, l: narrow ? 46 : 58, ...props.pad };

  const full: [number, number] = [props.x[0] ?? 0, props.x[props.x.length - 1] ?? 1];
  const xDomain = useTween(props.xDomain ?? full);

  const yDomainAuto = useMemo<[number, number]>(() => {
    // Fit y to the visible window only, so a zoomed story step fills the height.
    const vals: number[] = [];
    props.x.forEach((t, i) => {
      if (t < xDomain[0] || t > xDomain[1]) return;
      for (const s of props.series) {
        const v = s.values[i];
        if (v !== null && v !== undefined && Number.isFinite(v)) vals.push(v);
      }
    });
    if (props.zero !== undefined) vals.push(props.zero);
    if (!vals.length) return [0, 1];
    let lo = d3.min(vals)!;
    let hi = d3.max(vals)!;
    if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.06;
    return props.log ? [Math.max(lo * 0.97, 1e-6), hi * 1.03] : [lo - pad, hi + pad];
  }, [props.x, props.series, props.zero, props.log, xDomain]);
  const yDomain = useTween(props.yDomain ?? yDomainAuto);

  if (!props.x.length || !props.series.length) return <ChartEmpty height={height}>No samples yet.</ChartEmpty>;

  const iw = Math.max(10, width - m.l - m.r);
  const x = d3
    .scaleTime()
    .domain(xDomain)
    .range([m.l, m.l + iw]);
  const y = (props.log ? d3.scaleLog() : d3.scaleLinear()).domain(yDomain).range([height - m.b, m.t]);
  const xs = (ms: number) => x(ms);
  const ys = (v: number) => y(v);
  const yTicks = props.yTicks ?? (props.log ? y.ticks(4).filter((_, i, a) => a.length < 7 || i % 2 === 0) : y.ticks(narrow ? 4 : 5));
  const xTicks = props.xTicks
    ? props.xTicks.filter((t, i, a) => t >= xDomain[0] && t <= xDomain[1] && (i === 0 || x(t) - x(a[i - 1]) > 44))
    : timeTicks(xDomain, iw);
  const xFormat = props.xFormat ?? timeFormatFor(xDomain);

  const line = d3
    .line<[number, number | null]>()
    .defined((d) => d[1] !== null && Number.isFinite(d[1]!))
    .x((d) => x(d[0]))
    .y((d) => y(d[1] as number))
    .curve(props.curve === "linear" ? d3.curveLinear : d3.curveStepAfter);

  const order = [...props.series].sort((a, b) => {
    const ka = a.id === (props.focus ?? props.lead) ? 1 : 0;
    const kb = b.id === (props.focus ?? props.lead) ? 1 : 0;
    return ka - kb;
  });

  // End labels at the last visible value, spread so none overlap.
  const lastIdx = (s: LineSeries) => {
    for (let i = props.x.length - 1; i >= 0; i--) if (props.x[i] <= xDomain[1] && s.values[i] !== null) return i;
    return -1;
  };
  const ends = props.series.map((s) => {
    const i = lastIdx(s);
    return { s, i, y: i >= 0 ? y(s.values[i]!) : m.t };
  });
  const spread = spreadLabels(
    ends.map((e) => e.y),
    14,
    m.t + 4,
    height - m.b,
  );

  const bisect = d3.bisector((t: number) => t).center;
  const onMove = (_: unknown, px: number, py: number) => {
    if (px < m.l || px > m.l + iw) return hide();
    const i = bisect(props.x, x.invert(px).getTime());
    const content = props.tooltip ? (
      props.tooltip(i)
    ) : (
      <>
        <p className="kit-tip-head">
          {new Date(props.x[i]).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
        {props.series
          .filter((s) => s.values[i] !== null)
          .map((s) => (
            <p key={s.id} className="kit-tip-row" style={{ opacity: dim(props.focus, s.id) < 1 ? 0.5 : 1 }}>
              <span className="kit-tip-swatch" style={{ background: s.color }} />
              {s.label}
              <span className="num">{props.yFormat(s.values[i]!)}</span>
            </p>
          ))}
      </>
    );
    show(Math.min(px, width - 8), Math.max(8, py - 20), content);
    setHoverX(props.x[i]);
  };
  const clip = `clip-${props.label.replace(/[^a-z0-9]/gi, "").slice(0, 24)}`;

  return (
    <ChartBox boxRef={ref}>
      {width > 0 && (
        <Frame width={width} height={height} label={props.label} onPointerMove={onMove} onPointerLeave={hide}>
          <defs>
            <clipPath id={clip}>
              <rect x={m.l} y={0} width={iw} height={height} />
            </clipPath>
            <pattern id="kit-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="kit-hatch-line" />
            </pattern>
          </defs>
          <g clipPath={`url(#${clip})`}>
            {props.bands?.map((b, i) => (
              <g key={i}>
                <rect x={x(b.from)} y={m.t} width={Math.max(0, x(b.to) - x(b.from))} height={height - m.b - m.t} style={{ fill: b.fill }} />
                {b.hatch && (
                  <rect x={x(b.from)} y={m.t} width={Math.max(0, x(b.to) - x(b.from))} height={height - m.b - m.t} fill="url(#kit-hatch)" />
                )}
                {b.label && x(b.to) - x(b.from) > 40 && (
                  <text className="kit-band-label" x={(x(b.from) + x(b.to)) / 2} y={m.t + 12} textAnchor="middle">
                    {b.label}
                  </text>
                )}
              </g>
            ))}
          </g>
          <AxisY scale={ys} ticks={yTicks} x0={m.l} x1={m.l + iw} format={props.yFormat} zero={props.zero ?? null} />
          {!props.noXAxis && <AxisX scale={xs} ticks={xTicks} y={height - m.b + 2} format={xFormat} />}
          {props.zero !== undefined && !yTicks.includes(props.zero) && (
            <line className="kit-zero" x1={m.l} x2={m.l + iw} y1={y(props.zero)} y2={y(props.zero)} />
          )}
          <g clipPath={`url(#${clip})`}>
            {order.map((s) => {
              const bold = s.id === (props.focus ?? props.lead);
              const d = line(props.x.map((t, i) => [t, s.values[i]] as [number, number | null])) ?? "";
              return (
                <g key={s.id} style={{ opacity: dim(props.focus, s.id) }} className="kit-series">
                  {s.area && (
                    <path
                      d={
                        d3
                          .area<[number, number | null]>()
                          .defined((p) => p[1] !== null && Number.isFinite(p[1]!))
                          .x((p) => x(p[0]))
                          .y0(y(props.zero ?? 0))
                          .y1((p) => y(p[1] as number))
                          .curve(props.curve === "linear" ? d3.curveLinear : d3.curveStepAfter)(
                          props.x.map((t, i) => [t, s.values[i]] as [number, number | null]),
                        ) ?? ""
                      }
                      className="kit-area"
                      style={{ fill: s.color }}
                    />
                  )}
                  <path
                    d={d}
                    className="kit-line"
                    style={{ stroke: s.color, strokeWidth: s.width ?? (bold ? 2.6 : 1.6) }}
                    strokeDasharray={s.dashed ? "4 4" : undefined}
                  />
                  {props.onPick && (
                    <path
                      d={d}
                      className="kit-hit"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onPick!(props.focus === s.id ? null : s.id);
                      }}
                    />
                  )}
                </g>
              );
            })}
          </g>
          {hoverX !== null && <line className="kit-cross" x1={x(hoverX)} x2={x(hoverX)} y1={m.t} y2={height - m.b} />}
          {props.overlay?.({ x: xs, y: ys, width, height })}
          {endLabels &&
            ends.map((e, k) =>
              e.i < 0 ? null : (
                <g
                  key={e.s.id}
                  style={{ opacity: dim(props.focus, e.s.id), cursor: props.onPick ? "pointer" : undefined }}
                  onClick={props.onPick ? () => props.onPick!(props.focus === e.s.id ? null : e.s.id) : undefined}
                >
                  <circle cx={x(props.x[e.i])} cy={e.y} r={3.5} style={{ fill: e.s.color }} />
                  <text className="kit-end-label" x={m.l + iw + 8} y={spread[k] + 4} style={{ fill: e.s.color }}>
                    {e.s.label}
                    {e.s.endText && !narrow && <tspan className="kit-end-value"> {e.s.endText}</tspan>}
                  </text>
                </g>
              ),
            )}
          {props.notes?.map((n, i) =>
            n.x >= xDomain[0] && n.x <= xDomain[1] ? annotate({ ...n, x: x(n.x), y: y(n.y) }, { width: m.l + iw, height }, i) : null,
          )}
        </Frame>
      )}
      <Tip tip={tip} width={width} />
    </ChartBox>
  );
}
