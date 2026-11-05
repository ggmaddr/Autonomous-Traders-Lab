// Small SVG charts drawn from the books: return against worst drawdown, where the
// money sits, and the fills of one symbol against its price now. Each follows the
// same rules as the equity chart: round ticks, faint horizontal grid, no y-axis
// line, the trader's own colour, labels on the marks instead of a legend.

import { useLayoutEffect, useRef, useState } from "react";
import type { Fill } from "../lib/ledger";
import { money, pct, price, shortDay, signedPct, stamp } from "../lib/format";
import { hueVar } from "../lib/traders";

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return [ref, width];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) {
    max = min + 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= max) hi += step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(8)));
  return out;
}

// --- Return against worst drawdown ------------------------------------------

export interface RiskPoint {
  trader: string;
  ret: number; // ratio
  drawdown: number; // ratio ≤ 0
}

export function RiskScatter({ points }: { points: RiskPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 196;
  const pad = { l: 52, r: 16, t: 12, b: 34 };
  const xs = points.map((p) => -p.drawdown);
  const ys = points.map((p) => p.ret);
  const xt = niceTicks(0, Math.max(0.01, ...xs), 4);
  const yt = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys), 4);
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const x = (v: number) => pad.l + ((v - xt[0]) / (xt[xt.length - 1] - xt[0])) * w;
  const y = (v: number) => pad.t + h - ((v - yt[0]) / (yt[yt.length - 1] - yt[0])) * h;

  // Each label takes the first spot beside its dot (right, left, above, below)
  // that clears every dot and every label already placed.
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const dots: Box[] = points.map((p) => {
    const cx = x(-p.drawdown);
    const cy = y(p.ret);
    return { x0: cx - 6, y0: cy - 6, x1: cx + 6, y1: cy + 6 };
  });
  const boxes: Box[] = [];
  const placed = points.map((p) => {
    const cx = x(-p.drawdown);
    const cy = y(p.ret);
    const w = p.trader.length * 7.6 + 4;
    const spots = [
      { lx: cx + 10, ly: cy + 4, anchor: "start" },
      { lx: cx - 10, ly: cy + 4, anchor: "end" },
      { lx: cx, ly: cy - 11, anchor: "middle" },
      { lx: cx, ly: cy + 20, anchor: "middle" },
    ];
    const boxOf = (s: (typeof spots)[number]): Box => {
      const x0 = s.anchor === "start" ? s.lx : s.anchor === "end" ? s.lx - w : s.lx - w / 2;
      return { x0, y0: s.ly - 11, x1: x0 + w, y1: s.ly + 3 };
    };
    const spot =
      spots.find((s) => {
        const b = boxOf(s);
        return b.x0 >= 0 && b.x1 <= width && ![...dots, ...boxes].some((o) => hit(b, o));
      }) ?? spots[0];
    boxes.push(boxOf(spot));
    return { ...p, ...spot };
  });

  return (
    <div ref={ref} className="svg-chart">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={points
            .map((p) => `${p.trader}: return ${signedPct(p.ret)}, worst drawdown ${signedPct(p.drawdown)}`)
            .join("; ")}
        >
          {yt.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? "axis-zero" : "grid"} />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="tick">
                {v === 0 ? "0%" : signedPct(v, 1)}
              </text>
            </g>
          ))}
          {xt.map((v, i) => (
            <text
              key={v}
              x={x(v)}
              y={height - 12}
              textAnchor={i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"}
              className="tick"
            >
              {pct(v, 1)}
            </text>
          ))}
          {placed.map((p) => (
            <g key={p.trader}>
              <circle cx={x(-p.drawdown)} cy={y(p.ret)} r={5.5} fill={hueVar(p.trader)} />
              <text x={p.lx} y={p.ly} textAnchor={p.anchor} className="mark-label">
                {p.trader.charAt(0).toUpperCase() + p.trader.slice(1)}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

// --- Where the money sits -----------------------------------------------------

export interface AllocationRow {
  key: string;
  label: string;
  sub: string;
  value: number;
  trader?: string; // absent for cash
}

export function AllocationList({ rows, total }: { rows: AllocationRow[]; total: number }) {
  const top = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="alloc">
      {rows.map((r) => (
        <li key={r.key} className="alloc-row">
          <div className="alloc-line">
            <span className="alloc-label">
              {r.label} <span className="alloc-sub">{r.sub}</span>
            </span>
            <span className="num alloc-value">
              {money(r.value)} <span className="alloc-share">{pct(r.value / total, 1)}</span>
            </span>
          </div>
          <span className="alloc-track" aria-hidden="true">
            <span
              className="alloc-bar"
              style={{
                width: `${(r.value / top) * 100}%`,
                background: r.trader ? hueVar(r.trader) : "var(--cash)",
              }}
            />
          </span>
        </li>
      ))}
    </ol>
  );
}

// --- Fills of one symbol --------------------------------------------------------

export function FillsChart({
  fills,
  now,
  selected,
  onSelect,
}: {
  fills: Fill[];
  now: number | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 200;
  const pad = { l: 60, r: 76, t: 14, b: 30 };
  const ordered = [...fills].sort((a, b) => a.time - b.time);
  const prices = ordered.map((f) => f.price).concat(now ? [now] : []);
  const yt = niceTicks(Math.min(...prices), Math.max(...prices), 4);
  const t0 = ordered[0].time;
  const t1 = Math.max(ordered[ordered.length - 1].time, t0 + 3600_000);
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * w;
  const y = (v: number) => pad.t + h - ((v - yt[0]) / (yt[yt.length - 1] - yt[0])) * h;
  const days = [...new Set(ordered.map((f) => shortDay(f.time)))];

  return (
    <div ref={ref} className="svg-chart">
      {width > 0 && (
        <svg width={width} height={height} role="group" aria-label="Fill prices for this symbol">
          {yt.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="grid" />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="tick">
                {price(v)}
              </text>
            </g>
          ))}
          {days.map((d) => {
            const first = ordered.find((f) => shortDay(f.time) === d)!;
            return (
              <text key={d} x={x(first.time)} y={height - 8} textAnchor="middle" className="tick">
                {d}
              </text>
            );
          })}
          {now !== null && (
            <g>
              <line x1={pad.l} x2={width - pad.r} y1={y(now)} y2={y(now)} className="ref-line" />
              <text x={width - pad.r + 6} y={y(now) + 4} className="tick">
                Now {price(now)}
              </text>
            </g>
          )}
          {ordered.map((f) => {
            const cx = x(f.time);
            const cy = y(f.price);
            const up = f.side === "buy";
            const d = up
              ? `M${cx},${cy - 6} L${cx + 6},${cy + 5} L${cx - 6},${cy + 5} Z`
              : `M${cx},${cy + 6} L${cx + 6},${cy - 5} L${cx - 6},${cy - 5} Z`;
            return (
              <path
                key={f.id}
                d={d}
                className="fill-mark"
                data-side={f.side}
                data-selected={f.id === selected}
                style={{ color: hueVar(f.trader) }}
                tabIndex={0}
                role="button"
                aria-label={`${f.side === "buy" ? "Bought" : "Sold"} ${f.quantity} at ${price(f.price)}, ${stamp(f.time)}`}
                onClick={() => onSelect(f.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(f.id)}
              >
                <title>{`${f.side === "buy" ? "Bought" : "Sold"} ${f.quantity} at ${price(f.price)} · ${stamp(f.time)}`}</title>
              </path>
            );
          })}
        </svg>
      )}
    </div>
  );
}
