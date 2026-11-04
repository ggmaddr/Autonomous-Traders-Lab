// Equity over time, with the desk's drawdown underneath on the same clock. Each
// trader keeps its own colour; the end of every line is labelled with its name
// and return, so the chart needs no legend. Lines step: a value holds until the
// next sample, because nothing between samples was recorded (D5).

import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import type { Curves } from "../lib/ledger";
import { INITIAL_BALANCE } from "../lib/ledger";
import { cssColor, hue } from "../lib/traders";
import { money, signedPct, stamp } from "../lib/format";
import { useTheme } from "../lib/theme";

export type Mode = "traders" | "desk";

interface Props {
  curves: Curves;
  traders: string[];
  mode: Mode;
}

interface EndLabel {
  key: string;
  text: string;
  value: string;
  colour: string;
  top: number;
}

const LABEL_W = 132;
const EQUITY_H = 236;
const DD_H = 92;

function roundTicks(min: number, max: number, count = 4): number[] {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= max) hi += step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** Push labels apart so none overlaps the next, keeping them inside the plot. */
function spread(labels: EndLabel[], height: number, gap = 18): EndLabel[] {
  const sorted = [...labels].sort((a, b) => a.top - b.top);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].top - sorted[i - 1].top < gap) sorted[i].top = sorted[i - 1].top + gap;
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].top - (height - 8) : 0;
  if (overflow > 0) sorted.forEach((l) => (l.top -= overflow));
  return sorted;
}

export function EquityChart({ curves, traders, mode }: Props) {
  const equityRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [labels, setLabels] = useState<EndLabel[]>([]);
  const [hover, setHover] = useState<{ t: number; rows: { key: string; colour: string; value: number }[] } | null>(
    null,
  );

  useEffect(() => {
    const host = equityRef.current;
    const ddHost = ddRef.current;
    if (!host || !ddHost) return;
    const muted = cssColor("--muted");
    const grid = cssColor("--grid");
    const negative = cssColor("--negative");
    const font = `12px Geist, system-ui, sans-serif`;

    const lines =
      mode === "traders"
        ? traders.map((t) => ({ key: t, label: t, colour: hue(t), values: curves.byTrader[t], base: INITIAL_BALANCE }))
        : [{ key: "desk", label: "Desk", colour: cssColor("--accent-data"), values: curves.desk, base: INITIAL_BALANCE * traders.length }];

    const all = lines.flatMap((l) => l.values).concat(lines.map((l) => l.base));
    const ticks = roundTicks(Math.min(...all), Math.max(...all), 4);
    const stepped = uPlot.paths.stepped!({ align: 1 });
    const width = host.clientWidth;
    const sync = uPlot.sync("equity");

    const axisX = {
      stroke: muted,
      font,
      grid: { show: false },
      ticks: { show: false },
      gap: 6,
      size: 28,
    };

    const equity = new uPlot(
      {
        width,
        height: EQUITY_H,
        padding: [12, LABEL_W, 0, 0],
        legend: { show: false },
        cursor: {
          sync: { key: sync.key },
          points: { size: 7, width: 0 },
          y: false,
          drag: { x: false, y: false },
        },
        scales: { x: { time: true }, y: { range: () => [ticks[0], ticks[ticks.length - 1]] } },
        axes: [
          { ...axisX, show: false },
          {
            stroke: muted,
            font,
            size: 76,
            gap: 8,
            grid: { stroke: grid, width: 1 },
            ticks: { show: false },
            splits: () => ticks,
            values: (_u, vals) => vals.map((v) => "$" + Math.round(v).toLocaleString("en-US")),
          },
        ],
        series: [
          {},
          ...lines.map((l) => ({ label: l.label, stroke: l.colour, width: 2, paths: stepped, points: { show: false } })),
          {
            label: "Funded",
            stroke: muted,
            width: 1,
            dash: [4, 4],
            points: { show: false },
          },
        ],
        hooks: {
          setCursor: [
            (u) => {
              const i = u.cursor.idx;
              if (i == null) return setHover(null);
              setHover({
                t: curves.times[i] * 1000,
                rows: lines.map((l) => ({ key: l.label, colour: l.colour, value: l.values[i] })),
              });
            },
          ],
          draw: [
            (u) => {
              const h = u.bbox.height / devicePixelRatio;
              const top0 = u.bbox.top / devicePixelRatio;
              const last = curves.times.length - 1;
              setLabels(
                spread(
                  lines.map((l) => {
                    const v = l.values[last];
                    return {
                      key: l.key,
                      text: l.label.charAt(0).toUpperCase() + l.label.slice(1),
                      value: signedPct(v / l.base - 1, 1),
                      colour: l.colour,
                      top: top0 + u.valToPos(v, "y") - 9,
                    };
                  }),
                  top0 + h,
                ),
              );
            },
          ],
        },
      },
      [curves.times, ...lines.map((l) => l.values), curves.times.map(() => lines[0].base)],
      host,
    );

    const ddMin = Math.min(...curves.drawdown);
    const ddTicks = ddMin < 0 ? roundTicks(ddMin, 0, 2) : [-0.01, 0];
    const drawdown = new uPlot(
      {
        width,
        height: DD_H,
        padding: [6, LABEL_W, 0, 0],
        legend: { show: false },
        cursor: { sync: { key: sync.key }, points: { show: false }, y: false, drag: { x: false, y: false } },
        scales: { x: { time: true }, y: { range: () => [ddTicks[0], 0] } },
        axes: [
          axisX,
          {
            stroke: muted,
            font,
            size: 76,
            gap: 8,
            grid: { stroke: grid, width: 1 },
            ticks: { show: false },
            splits: () => [ddTicks[0], 0],
            values: (_u, vals) => vals.map((v) => (v === 0 ? "0%" : signedPct(v, 1))),
          },
        ],
        series: [
          {},
          {
            label: "Drawdown",
            stroke: negative,
            width: 1.5,
            fill: negative + "22",
            paths: stepped,
            points: { show: false },
          },
        ],
      },
      [curves.times, curves.drawdown],
      ddHost,
    );

    const resize = new ResizeObserver(() => {
      const w = host.clientWidth;
      equity.setSize({ width: w, height: EQUITY_H });
      drawdown.setSize({ width: w, height: DD_H });
    });
    resize.observe(host);
    return () => {
      resize.disconnect();
      equity.destroy();
      drawdown.destroy();
    };
  }, [curves, traders, mode, theme]);

  const worst = Math.min(...curves.drawdown);
  const last = curves.times.length - 1;
  const latest =
    mode === "traders"
      ? traders.map((t) => ({ key: t, colour: `var(--t-${t})`, value: curves.byTrader[t][last] }))
      : [{ key: "desk", colour: "var(--accent-data)", value: curves.desk[last] }];
  return (
    <figure className="equity">
      <p className="equity-readout num" aria-live="polite">
        <span className="readout-time">{hover ? stamp(hover.t) : "Now"}</span>
        {(hover?.rows ?? latest).map((r) => (
          <span key={r.key} className="readout-row">
            <span className="swatch" style={{ background: r.colour }} aria-hidden="true" />
            {r.key.charAt(0).toUpperCase() + r.key.slice(1)} {money(r.value)}
          </span>
        ))}
      </p>
      <div className="equity-plot" ref={equityRef} role="img" aria-label="Equity over time for each trader, against the funded amount">
        {labels.map((l) => (
          <span key={l.key} className="end-label" style={{ top: l.top }}>
            <span className="swatch" style={{ background: l.colour }} aria-hidden="true" />
            {l.text} <span className="num">{l.value}</span>
          </span>
        ))}
      </div>
      <div className="dd-head">
        <span>Desk drawdown from its peak</span>
        <span className="num">Worst {worst < 0 ? signedPct(worst, 2) : "0.00%"}</span>
      </div>
      <div className="dd-plot" ref={ddRef} role="img" aria-label="Desk drawdown from its running peak" />
    </figure>
  );
}
