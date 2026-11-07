// Nested rectangles, area = value: trader → symbol for what the desk holds, so
// a concentrated position stands out at once. Tile colour comes from a caller's
// diverging scale (unrealized %); the group header carries the trader's colour.

import { type ReactNode } from "react";
import * as d3 from "d3";
import { ChartBox, Frame, Tip, dim, useSize, useTip } from "./core";
import { ChartEmpty } from "./states";

export interface Tile {
  id: string;
  label: string;
  value: number;
  shade: { fill: string; text: string };
  lines?: string[];
  flag?: string;
  tip?: ReactNode;
}

export interface TileGroup {
  id: string;
  label: string;
  color: string;
  meta?: string;
  tiles: Tile[];
}

interface Node {
  id: string;
  children?: Node[];
  value?: number;
  group?: TileGroup;
  tile?: Tile;
}

export function Treemap(props: {
  groups: TileGroup[];
  label: string;
  height?: number;
  focus?: string | null;
  onPickGroup?: (id: string) => void;
  onPickTile?: (tile: Tile, group: TileGroup) => void;
}) {
  const [ref, width] = useSize<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const narrow = width < 520;
  const height = props.height ?? (narrow ? 420 : 380);
  const groups = props.groups.filter((g) => g.tiles.some((t) => t.value > 0));
  if (!groups.length) return <ChartEmpty height={height}>Nothing is held right now.</ChartEmpty>;

  const root = d3
    .hierarchy<Node>({
      id: "root",
      children: groups.map((g) => ({ id: g.id, group: g, children: g.tiles.filter((t) => t.value > 0).map((t) => ({ id: t.id, tile: t, value: t.value })) })),
    })
    .sum((d) => d.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const layout = d3
    .treemap<Node>()
    .size([Math.max(1, width), height])
    .paddingOuter(0)
    .paddingTop((d) => (d.depth === 1 ? 20 : 0))
    .paddingInner(3)
    .round(true)
    .tile(d3.treemapSquarify.ratio(1.2));
  const laid = layout(root);

  return (
    <ChartBox boxRef={ref}>
      {width > 0 && (
        <Frame width={width} height={height} label={props.label} onPointerLeave={hide}>
          {laid.children?.map((g) => {
            const group = g.data.group!;
            const gw = g.x1 - g.x0;
            return (
              <g key={group.id} style={{ opacity: dim(props.focus, group.id), transition: "opacity 300ms" }}>
                <text
                  className="kit-tm-group"
                  x={g.x0 + 2}
                  y={g.y0 + 14}
                  style={{ fill: group.color, cursor: props.onPickGroup ? "pointer" : undefined }}
                  onClick={props.onPickGroup ? () => props.onPickGroup!(group.id) : undefined}
                >
                  {fit(group.label + (group.meta && gw > 120 ? `  ${group.meta}` : ""), gw)}
                </text>
                {g.children?.map((leaf) => {
                  const t = leaf.data.tile!;
                  const w = leaf.x1 - leaf.x0;
                  const h = leaf.y1 - leaf.y0;
                  const big = w > 56 && h > 34;
                  return (
                    <g
                      key={t.id}
                      onPointerEnter={() => t.tip && show(Math.min(leaf.x0 + w / 2, width - 10), leaf.y0 + 10, t.tip)}
                      onPointerLeave={hide}
                      onClick={props.onPickTile ? () => props.onPickTile!(t, group) : undefined}
                      style={{ cursor: props.onPickTile ? "pointer" : undefined }}
                    >
                      <rect className="kit-tm-tile" x={leaf.x0} y={leaf.y0} width={w} height={h} rx={3} style={{ fill: t.shade.fill }} />
                      {big && (
                        <text x={leaf.x0 + 8} y={leaf.y0 + 18} className="kit-tm-sym" style={{ fill: t.shade.text }}>
                          {fit(t.label, w - 12, 8.4)}
                        </text>
                      )}
                      {big &&
                        t.lines?.map((line, i) =>
                          h > 34 + (i + 1) * 15 ? (
                            <text key={i} x={leaf.x0 + 8} y={leaf.y0 + 34 + i * 15} className="kit-tm-line" style={{ fill: t.shade.text }}>
                              {fit(line, w - 12)}
                            </text>
                          ) : null,
                        )}
                      {big && t.flag && h > 90 && (
                        <text x={leaf.x0 + 8} y={leaf.y1 - 10} className="kit-tm-flag" style={{ fill: t.shade.text }}>
                          {fit(t.flag, w - 12)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </Frame>
      )}
      <Tip tip={tip} width={width} />
    </ChartBox>
  );
}

function fit(s: string, px: number, perChar = 6.6): string {
  const n = Math.floor(px / perChar);
  return s.length > n ? (n > 2 ? s.slice(0, n - 1) + "…" : "") : s;
}
