// A grid of coloured cells with the value written in each: signal × regime
// Sharpe, scenario × baseline return, trader × ticker mentions. A column can be
// outlined (the regime we are in now) and a cell can carry an outline tone
// (pass / partial / fail). Below ~520 px the grid scrolls inside its own box.

import { type ReactNode } from "react";

export interface HeatCell {
  text: string;
  fill: string;
  ink?: string;
  outline?: "good" | "bad" | "partial" | null;
  tip?: string;
}

export function Heatmap(props: {
  rows: { id: string; label: ReactNode }[];
  cols: { id: string; label: ReactNode; now?: boolean }[];
  cell: (row: string, col: string) => HeatCell | null;
  label: string;
  rowHead?: string;
  onPickRow?: (id: string) => void;
}) {
  return (
    <div className="kit-heat-wrap">
      <table className="kit-heat" aria-label={props.label}>
        <thead>
          <tr>
            <th scope="col">{props.rowHead ?? ""}</th>
            {props.cols.map((c) => (
              <th key={c.id} scope="col" data-now={c.now || undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={r.id} onClick={props.onPickRow ? () => props.onPickRow!(r.id) : undefined} data-pick={!!props.onPickRow || undefined}>
              <th scope="row">{r.label}</th>
              {props.cols.map((c) => {
                const v = props.cell(r.id, c.id);
                return (
                  <td key={c.id} data-now={c.now || undefined} title={v?.tip}>
                    {v ? (
                      <span className="kit-heat-cell num" data-outline={v.outline ?? undefined} style={{ background: v.fill, color: v.ink }}>
                        {v.text}
                      </span>
                    ) : (
                      <span className="kit-heat-cell kit-heat-none">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A diverging fill for a signed value: red below zero, lime/green above, stone near zero. */
export function divergingFill(v: number | null, scale: number): { fill: string; ink: string } {
  if (v === null || !Number.isFinite(v)) return { fill: "var(--raised)", ink: "var(--faint)" };
  const t = Math.max(-1, Math.min(1, v / scale));
  const a = Math.round(Math.abs(t) * 85 + 8);
  if (Math.abs(t) < 0.04) return { fill: "var(--raised)", ink: "var(--text)" };
  const base = t > 0 ? "var(--positive)" : "var(--negative)";
  return { fill: `color-mix(in srgb, ${base} ${a}%, var(--surface))`, ink: Math.abs(t) > 0.6 ? "var(--surface)" : "var(--text)" };
}
