// Points on two value axes: research time against tokens, return against
// drawdown. A point carries its own colour (the trader), shape (what it led to)
// and size; notes point at chosen points; a trader in focus keeps full opacity.

import { type ReactNode } from "react";
import * as d3 from "d3";
import { AxisX, AxisY, ChartBox, Frame, Tip, dim, useSize, useTip } from "./core";
import { annotate, type Dir } from "./annotate";
import { ChartEmpty } from "./states";

export type PointShape = "disc" | "ring" | "diamond";

export interface Point {
  id: string;
  x: number;
  y: number;
  r?: number;
  color: string;
  shape?: PointShape;
  group?: string;
  tip: ReactNode;
}

export function Scatter(props: {
  points: Point[];
  label: string;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  xLabel: string;
  yLabel: string;
  height?: number;
  focus?: string | null;
  onPick?: (p: Point) => void;
  notes?: { id: string; text: string; dir?: Dir }[];
  xLog?: boolean;
  /** A shaded band on x, e.g. "under 7 minutes", with its caption. */
  xBand?: { to: number; text: string };
}) {
  const [ref, width] = useSize<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const height = props.height ?? 300;
  if (!props.points.length) return <ChartEmpty height={height}>Nothing to plot yet.</ChartEmpty>;
  const narrow = width < 520;
  const m = { t: 24, r: 16, b: 44, l: narrow ? 44 : 56 };
  // A long tail (one run ten times longer than the rest) gets a log axis.
  const xs = props.points.map((p) => p.x).filter((v) => v > 0);
  const xMax = d3.max(xs) ?? 1;
  const xLog = props.xLog ?? (xs.length > 3 && xMax / (d3.median(xs) ?? xMax) > 15);
  const range = [m.l, Math.max(m.l + 10, width - m.r)];
  const x = xLog
    ? d3
        .scaleLog()
        .domain([(d3.min(xs) ?? 0.1) * 0.8, xMax * 1.25])
        .range(range)
    : d3
        .scaleLinear()
        .domain([0, xMax * 1.08])
        .range(range)
        .nice();
  // On a log axis keep the 1-2-5 ticks only.
  const xTicks = xLog ? x.ticks(6).filter((t) => [1, 2, 5].includes(Number(t.toExponential()[0]))) : x.ticks(narrow ? 3 : 5);
  // Thin ticks that would collide (about 56 px a label).
  const shown: number[] = [];
  for (const t of xTicks) if (!shown.length || x(t) - x(shown[shown.length - 1]) > 56) shown.push(t);
  const y = d3
    .scaleLinear()
    .domain([0, (d3.max(props.points, (p) => p.y) ?? 1) * 1.1])
    .range([height - m.b, m.t])
    .nice();
  const order = [...props.points].sort((a, b) => (b.r ?? 6) - (a.r ?? 6));
  return (
    <ChartBox boxRef={ref}>
      {width > 0 && (
        <Frame width={width} height={height} label={props.label} onPointerLeave={hide}>
          {props.xBand && (
            <g>
              <rect
                className="kit-xband"
                x={m.l}
                y={m.t}
                width={Math.max(0, x(Math.max(props.xBand.to, x.domain()[0])) - m.l)}
                height={height - m.b - m.t}
              />
              <text className="kit-xband-text" x={m.l + 6} y={height - m.b - 8}>
                {props.xBand.text}
              </text>
            </g>
          )}
          <AxisY scale={(v) => y(v)} ticks={y.ticks(4)} x0={m.l} x1={width - m.r} format={props.yFormat} zero={0} />
          <AxisX scale={(v) => x(v)} ticks={shown} y={height - m.b + 2} format={props.xFormat} />
          <text className="kit-axis-title" x={width - m.r} y={height - 6} textAnchor="end">
            {props.xLabel}
            {xLog ? " (log)" : ""} →
          </text>
          <text className="kit-axis-title" x={m.l} y={12}>
            {props.yLabel} ↑
          </text>
          {order.map((p) => {
            const cx = x(p.x);
            const cy = y(p.y);
            const r = p.r ?? 6;
            const common = {
              className: "kit-dot",
              style: {
                fill: p.shape === "disc" || !p.shape ? p.color : "var(--surface)",
                stroke: p.color,
                strokeWidth: p.shape === "disc" || !p.shape ? 1 : 2,
                opacity: dim(props.focus, p.group),
                cursor: props.onPick ? "pointer" : undefined,
              },
              tabIndex: props.onPick ? 0 : undefined,
              onPointerEnter: () => show(cx, cy - r - 4, p.tip),
              onPointerLeave: hide,
              onClick: () => props.onPick?.(p),
              onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && props.onPick?.(p),
            };
            return p.shape === "diamond" ? (
              <rect
                key={p.id}
                x={cx - r * 0.8}
                y={cy - r * 0.8}
                width={r * 1.6}
                height={r * 1.6}
                transform={`rotate(45 ${cx} ${cy})`}
                {...common}
              />
            ) : (
              <circle key={p.id} cx={cx} cy={cy} r={p.shape === "ring" ? r - 1 : r} {...common} />
            );
          })}
          {props.notes?.map((n, i) => {
            const p = props.points.find((q) => q.id === n.id);
            return p ? annotate({ x: x(p.x), y: y(p.y), text: n.text, dir: n.dir ?? "nw" }, { width, height }, i) : null;
          })}
        </Frame>
      )}
      <Tip tip={tip} width={width} />
    </ChartBox>
  );
}
