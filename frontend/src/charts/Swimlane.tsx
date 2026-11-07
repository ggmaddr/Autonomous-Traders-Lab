// Lanes of bars on a time axis. One component, two uses: a run trace as a
// Jaeger-style waterfall (one lane per step: research, each lookup, each order)
// and Health's agent activity (one lane per trader, sub-rows per span kind).
// A bar can be marked missing (dashed: expected but not in the trace) and one
// bar can be highlighted, which is how story mode walks a trace step by step.

import { type ReactNode } from "react";
import * as d3 from "d3";
import { AxisX, ChartBox, Frame, Tip, dim, useSize, useTip } from "./core";
import { ChartEmpty } from "./states";

export interface LaneBar {
  id?: string;
  start: number;
  end: number;
  kind: string;
  row?: number; // sub-row inside the lane
  missing?: boolean;
  note?: string;
  failed?: boolean;
  tip?: ReactNode;
}

export interface Lane {
  id: string;
  label: string;
  sub?: string;
  color?: string;
  bars: LaneBar[];
  rows?: number;
}

export interface Kind {
  label: string;
  color: string;
  /** Bars of this kind are drawn as a tall faint backdrop behind the lane. */
  backdrop?: boolean;
}

export function Swimlane(props: {
  lanes: Lane[];
  kinds: Record<string, Kind>;
  domain: [number, number];
  format: (v: number) => string;
  label: string;
  highlight?: string | null;
  focus?: string | null;
  onPickLane?: (id: string) => void;
  onPickBar?: (bar: LaneBar) => void;
  rowH?: number;
  legend?: boolean;
}) {
  const [ref, width] = useSize<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const narrow = width < 560;
  const rowH = props.rowH ?? 16;
  if (!props.lanes.length) return <ChartEmpty height={140}>Nothing in this window.</ChartEmpty>;

  const labelW = narrow ? 96 : 168;
  const m = { t: 8, r: 12, b: 26, l: labelW };
  const iw = Math.max(10, width - m.l - m.r);
  const x = d3
    .scaleLinear()
    .domain(props.domain)
    .range([m.l, m.l + iw]);
  const ticks = x.ticks(narrow ? 3 : 5);

  let yAt = m.t;
  const lanes = props.lanes.map((l) => {
    const rows = l.rows ?? Math.max(1, ...l.bars.map((b) => (b.row ?? 0) + 1));
    const h = Math.max(rows * rowH + 14, l.sub ? 42 : 0);
    const top = yAt;
    yAt += h;
    return { l, top, h, rows };
  });
  const height = yAt + m.b;
  const anyHi = !!props.highlight;

  return (
    <ChartBox boxRef={ref}>
      {width > 0 && (
        <Frame width={width} height={height} label={props.label} onPointerLeave={hide}>
          <AxisX scale={(v) => x(v)} ticks={ticks} y={height - m.b + 2} top={m.t} format={props.format} />
          {lanes.map(({ l, top, h }) => (
            <g
              key={l.id}
              style={{ opacity: dim(props.focus, l.id), cursor: props.onPickLane ? "pointer" : undefined }}
              onClick={props.onPickLane ? () => props.onPickLane!(l.id) : undefined}
            >
              <line className="kit-lane-rule" x1={0} x2={width} y1={top + h} y2={top + h} />
              <text className="kit-lane-label" x={0} y={top + (l.sub ? 17 : h / 2 + 4)} style={{ fill: l.color }}>
                {clip(l.label, narrow ? 12 : 22)}
              </text>
              {l.sub && (
                <text className="kit-lane-sub" x={0} y={top + 32}>
                  {clip(l.sub, narrow ? 14 : 26)}
                </text>
              )}
              {l.bars.map((b, i) => {
                const k = props.kinds[b.kind] ?? { label: b.kind, color: "var(--muted)" };
                const x0 = x(Math.max(props.domain[0], b.start));
                const x1 = x(Math.min(props.domain[1], b.end));
                const w = Math.max(2.5, x1 - x0);
                const yy = k.backdrop ? top + 4 : top + 7 + (b.row ?? 0) * rowH;
                const hh = k.backdrop ? h - 8 : rowH - 4;
                const on = !anyHi || b.id === props.highlight;
                return (
                  <g key={b.id ?? i} style={{ opacity: on ? 1 : 0.25, transition: "opacity 300ms" }}>
                    <rect
                      className="kit-bar"
                      data-missing={b.missing || undefined}
                      data-failed={b.failed || undefined}
                      data-hi={(anyHi && b.id === props.highlight) || undefined}
                      x={x0}
                      y={yy}
                      width={w}
                      height={hh}
                      rx={2}
                      style={b.missing ? undefined : { fill: k.color, opacity: k.backdrop ? 0.35 : 1 }}
                      onPointerEnter={() => b.tip && show(Math.min(x0 + w / 2, width - 10), yy - 6, b.tip)}
                      onPointerLeave={hide}
                      onClick={props.onPickBar ? (e) => (e.stopPropagation(), props.onPickBar!(b)) : undefined}
                    />
                    {b.note && x1 + 8 < m.l + iw - 40 && (
                      <text className="kit-bar-note" x={x0 + w + 6} y={yy + hh / 2 + 4}>
                        {clip(b.note, Math.floor((m.l + iw - x0 - w) / 6.5))}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}
        </Frame>
      )}
      {props.legend !== false && (
        <ul className="kit-legend">
          {Object.entries(props.kinds).map(([id, k]) => (
            <li key={id}>
              <span className="kit-legend-mark" style={{ background: k.color, opacity: k.backdrop ? 0.5 : 1 }} />
              {k.label}
            </li>
          ))}
          {props.lanes.some((l) => l.bars.some((b) => b.missing)) && (
            <li>
              <span className="kit-legend-mark" data-missing="true" />
              expected but missing
            </li>
          )}
        </ul>
      )}
      <Tip tip={tip} width={width} />
    </ChartBox>
  );
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s;
}
