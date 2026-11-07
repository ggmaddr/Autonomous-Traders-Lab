// The annotation layer: a thin leader line from a point on the chart to a short
// label, so a chart explains itself in place ("3 Nov · Warren breaks away").
// annotate() turns a spec in chart pixels into the SVG; charts accept specs in
// data units and call it after scaling.

import type { ReactNode } from "react";

export type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface NoteSpec {
  x: number;
  y: number;
  text: string;
  sub?: string;
  dir?: Dir;
  /** Leader length in px. */
  len?: number;
}

const VEC: Record<Dir, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [0.7, -0.7],
  nw: [-0.7, -0.7],
  se: [0.7, 0.7],
  sw: [-0.7, 0.7],
};

/**
 * Draw one note. `bounds` keeps the label inside the plot: a label that would
 * run off the right edge is anchored to its end instead.
 */
export function annotate(spec: NoteSpec, bounds: { width: number; height: number }, key?: string | number): ReactNode {
  const dir = spec.dir ?? "ne";
  const len = spec.len ?? 28;
  const [vx, vy] = VEC[dir];
  const ex = spec.x + vx * len;
  const ey = spec.y + vy * len;
  // Estimate label width to choose a side that fits (≈6.6 px per character at 12 px).
  const w = Math.max(spec.text.length, spec.sub?.length ?? 0) * 6.6;
  let anchor: "start" | "end" | "middle" = vx > 0.1 ? "start" : vx < -0.1 ? "end" : "middle";
  if (anchor === "start" && ex + 4 + w > bounds.width) anchor = "end";
  if (anchor === "end" && ex - 4 - w < 0) anchor = "start";
  if (anchor === "middle") {
    if (ex + w / 2 > bounds.width) anchor = "end";
    else if (ex - w / 2 < 0) anchor = "start";
  }
  const tx = anchor === "start" ? ex + 4 : anchor === "end" ? ex - 4 : ex;
  const below = vy > 0.1;
  const ty = below ? ey + 13 : vy < -0.1 ? ey - (spec.sub ? 18 : 4) : ey + 4;
  return (
    <g className="kit-note" key={key} aria-hidden="true">
      <circle cx={spec.x} cy={spec.y} r={3} className="kit-note-dot" />
      <line x1={spec.x} y1={spec.y} x2={ex} y2={ey} className="kit-note-line" />
      <text x={tx} y={ty} textAnchor={anchor} className="kit-note-text">
        {spec.text}
      </text>
      {spec.sub && (
        <text x={tx} y={ty + 15} textAnchor={anchor} className="kit-note-sub">
          {spec.sub}
        </text>
      )}
    </g>
  );
}
