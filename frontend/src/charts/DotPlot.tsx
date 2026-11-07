// Dots on one value axis, stacked where they collide (a dot-density plot): every
// closing sell by P&L, every trial by score. Reference lines mark averages or a
// bar to clear; a dot can be a filled disc or a ring. Optional lanes put each
// group on its own row (the fill timeline uses the same component on a time axis).

import { type ReactNode } from "react";
import * as d3 from "d3";
import { AxisX, ChartBox, Frame, Tip, dim, timeFormatFor, timeTicks, useSize, useTip } from "./core";
import { annotate, type Dir } from "./annotate";
import { ChartEmpty } from "./states";

export interface Dot {
  id: string;
  value: number;
  color: string;
  group?: string; // trader, for focus and lanes
  /** Focus by this id instead of group (when lanes are not traders). */
  focusId?: string;
  ring?: boolean;
  /** Outline colour, e.g. positive for a winning sell. */
  stroke?: string;
  r?: number;
  tip: ReactNode;
}

export interface RefLine {
  value: number;
  label: string;
  tone?: "good" | "bad" | "flat";
}

export interface DotNote {
  id: string; // the dot it points at
  text: string;
  sub?: string;
  dir?: Dir;
}

export function DotPlot(props: {
  dots: Dot[];
  label: string;
  format: (v: number) => string;
  refs?: RefLine[];
  notes?: DotNote[];
  focus?: string | null;
  onPick?: (dot: Dot) => void;
  /** One row per lane id, labelled; dots spread along x within their lane. */
  lanes?: { id: string; label: string; color?: string }[];
  time?: boolean;
  domain?: [number, number];
  zero?: number;
  minHeight?: number;
  log?: boolean;
}) {
  const [ref, width] = useSize<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const narrow = width < 520;
  if (!props.dots.length) return <ChartEmpty height={props.minHeight ?? 120}>Nothing to plot yet.</ChartEmpty>;

  const laneW = props.lanes ? (narrow ? 64 : 84) : 0;
  const m = { t: props.refs?.length ? 10 + 14 * props.refs.length : 10, r: 14, b: 26, l: 12 + laneW };
  const iw = Math.max(10, width - m.l - m.r);
  const ext = props.domain ?? (d3.extent(props.dots, (d) => d.value) as [number, number]);
  const pad = props.time || props.log ? 0 : (ext[1] - ext[0] || 1) * 0.04;
  const domain: [number, number] = props.log
    ? [ext[0] * 0.8, ext[1] * 1.25]
    : [Math.min(ext[0] - pad, props.zero ?? Infinity), Math.max(ext[1] + pad, props.zero ?? -Infinity)];
  const x = props.time
    ? d3
        .scaleTime()
        .domain(domain)
        .range([m.l, m.l + iw])
    : props.log
      ? d3
          .scaleLog()
          .domain(domain)
          .range([m.l, m.l + iw])
      : d3
          .scaleLinear()
          .domain(domain)
          .range([m.l, m.l + iw])
          .nice();
  const xs = (v: number) => x(v);

  const placed: { d: Dot; cx: number; cy: number; r: number }[] = [];
  let height: number;
  if (props.lanes) {
    const laneH = 44;
    height = m.t + props.lanes.length * laneH + m.b;
    props.lanes.forEach((lane, li) => {
      const mid = m.t + li * laneH + laneH / 2;
      // Small vertical jitter by order keeps overlapping dots visible.
      props.dots
        .filter((d) => d.group === lane.id)
        .forEach((d, k) => placed.push({ d, cx: x(d.value), cy: mid + ((k % 3) - 1) * 4, r: d.r ?? 6 }));
    });
  } else {
    // Stack upward in pixel bins one dot wide.
    const r = narrow ? 5 : 6;
    const bins = new Map<number, number>();
    const sorted = [...props.dots].sort((a, b) => a.value - b.value);
    let maxStack = 0;
    const tmp = sorted.map((d) => {
      const b = Math.round(x(d.value) / (2 * r + 1));
      const k = bins.get(b) ?? 0;
      bins.set(b, k + 1);
      maxStack = Math.max(maxStack, k + 1);
      return { d, cx: b * (2 * r + 1), k, r: d.r ?? r };
    });
    height = Math.max(props.minHeight ?? 120, m.t + maxStack * (2 * r + 2) + m.b + 8);
    const base = height - m.b - r - 2;
    tmp.forEach((p) => placed.push({ d: p.d, cx: Math.min(Math.max(p.cx, m.l + r), m.l + iw - r), cy: base - p.k * (2 * r + 2), r: p.r }));
  }

  const ticks = props.time
    ? timeTicks(domain, iw)
    : props.log
      ? logTicks(domain, narrow ? 4 : 7)
      : (x as d3.ScaleLinear<number, number>).ticks(narrow ? 4 : 6);
  const fmt = props.time ? timeFormatFor(domain) : props.format;

  return (
    <ChartBox boxRef={ref}>
      {width > 0 && (
        <Frame width={width} height={height} label={props.label} onPointerLeave={hide}>
          {props.lanes?.map((lane, li) => (
            <g key={lane.id} style={{ opacity: dim(props.focus, lane.id) }}>
              <line className="kit-lane-rule" x1={0} x2={width} y1={m.t + (li + 1) * 44} y2={m.t + (li + 1) * 44} />
              <text className="kit-lane-label" x={0} y={m.t + li * 44 + 26} style={{ fill: lane.color }}>
                {lane.label}
              </text>
              {!props.dots.some((d) => d.group === lane.id) && (
                <text className="kit-lane-empty" x={m.l} y={m.t + li * 44 + 26}>
                  no fills yet
                </text>
              )}
            </g>
          ))}
          <AxisX scale={xs} ticks={ticks} y={height - m.b + 2} top={m.t} format={fmt} />
          {props.zero !== undefined && <line className="kit-zero" x1={x(props.zero)} x2={x(props.zero)} y1={m.t - 6} y2={height - m.b} />}
          {props.refs?.map((r, i) => {
            // Labels sit on their own rows and flip side to stay inside the chart.
            const rx = x(r.value);
            const w = r.label.length * 6.8;
            let end = r.value < (props.zero ?? 0);
            if (end && rx - 6 - w < 0) end = false;
            if (!end && rx + 6 + w > width) end = true;
            const ty = 12 + i * 14;
            return (
              <g key={i} className="kit-ref" data-tone={r.tone ?? "flat"}>
                <line x1={rx} x2={rx} y1={ty + 4} y2={height - m.b} />
                <text x={rx + (end ? -6 : 6)} y={ty} textAnchor={end ? "end" : "start"}>
                  {r.label}
                </text>
              </g>
            );
          })}
          {placed.map(({ d, cx, cy, r }) => (
            <circle
              key={d.id}
              className="kit-dot"
              cx={cx}
              cy={cy}
              r={d.ring ? r - 1 : r}
              style={{
                fill: d.ring ? "var(--surface)" : d.color,
                stroke: d.ring ? d.color : (d.stroke ?? "var(--surface)"),
                strokeWidth: d.ring || d.stroke ? 2 : 1,
                opacity: dim(props.focus, d.focusId ?? d.group),
                cursor: props.onPick ? "pointer" : undefined,
              }}
              tabIndex={props.onPick ? 0 : undefined}
              onPointerEnter={() => show(cx, cy - 10, d.tip)}
              onPointerLeave={hide}
              onClick={() => props.onPick?.(d)}
              onKeyDown={(e) => e.key === "Enter" && props.onPick?.(d)}
            >
              <title>{typeof d.tip === "string" ? d.tip : undefined}</title>
            </circle>
          ))}
          {props.notes?.map((n, i) => {
            const p = placed.find((q) => q.d.id === n.id);
            return p ? annotate({ x: p.cx, y: p.cy, text: n.text, sub: n.sub, dir: n.dir ?? "nw" }, { width, height }, i) : null;
          })}
        </Frame>
      )}
      <Tip tip={tip} width={width} />
    </ChartBox>
  );
}

/** Powers of ten across a log domain, thinned to about n labels. */
function logTicks([a, b]: [number, number], n: number): number[] {
  const out: number[] = [];
  for (let e = Math.ceil(Math.log10(a)); e <= Math.floor(Math.log10(b)); e++) out.push(10 ** e);
  const step = Math.ceil(out.length / n);
  return out.filter((_, i) => i % step === 0);
}
