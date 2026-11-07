// Horizontal waterfall and diverging bars. The waterfall walks from a starting
// total through signed steps to an end total (funded → realized → unrealized →
// now); each step floats where the last one ended. Diverging bars put each row's
// signed value either side of zero (each trader's contribution).

import * as d3 from "d3";
import { ChartBox, Frame, Tip, dim, useSize, useTip } from "./core";
import { ChartEmpty } from "./states";

export interface Step {
  id: string;
  label: string;
  value: number;
  kind: "total" | "delta";
  color?: string;
  note?: string;
}

export function Waterfall(props: { steps: Step[]; label: string; format: (v: number) => string; signed: (v: number) => string; floor?: number; note?: string }) {
  const [ref, width] = useSize<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  if (!props.steps.length) return <ChartEmpty height={160}>Nothing to add up yet.</ChartEmpty>;
  const narrow = width < 380;
  const labelW = narrow ? 78 : 96;
  const rowH = 34;
  const m = { t: 6, r: 12, b: props.note ? 24 : 6, l: labelW };
  const height = m.t + props.steps.length * rowH + m.b;

  let run = 0;
  const bars = props.steps.map((s) => {
    const from = s.kind === "total" ? (props.floor ?? 0) : run;
    const to = s.kind === "total" ? s.value : run + s.value;
    run = s.kind === "total" ? s.value : to;
    return { s, from, to };
  });
  const lo = Math.min(props.floor ?? 0, ...bars.map((b) => Math.min(b.from, b.to)));
  const hi = Math.max(...bars.map((b) => Math.max(b.from, b.to)));
  const x = d3
    .scaleLinear()
    .domain([lo, hi])
    .range([m.l, Math.max(m.l + 10, width - m.r)]);

  return (
    <ChartBox boxRef={ref}>
      {width > 0 && (
        <Frame width={width} height={height} label={props.label} onPointerLeave={hide}>
          {bars.map(({ s, from, to }, i) => {
            const y = m.t + i * rowH;
            const x0 = x(Math.min(from, to));
            const w = Math.max(2, Math.abs(x(to) - x(from)));
            const tone = s.kind === "total" ? "total" : s.value >= 0 ? "good" : "bad";
            const inside = w > 76;
            const text = s.kind === "total" ? props.format(s.value) : props.signed(s.value);
            const next = bars[i + 1];
            return (
              <g key={s.id} onPointerEnter={() => show(x0 + w / 2, y, <p>{s.note ?? `${s.label}: ${text}`}</p>)} onPointerLeave={hide}>
                <text className="kit-wf-label" data-total={s.kind === "total" || undefined} x={0} y={y + 20}>
                  {s.label}
                </text>
                <rect className="kit-wf-bar" data-tone={tone} x={x0} y={y + 5} width={w} height={22} rx={3} style={s.color ? { fill: s.color } : undefined} />
                <text
                  className="kit-wf-value"
                  data-tone={tone}
                  data-inside={inside || undefined}
                  x={inside ? x0 + w - 6 : x0 + w + 6 > width - 70 ? x0 - 6 : x0 + w + 6}
                  y={y + 20}
                  textAnchor={inside || x0 + w + 6 > width - 70 ? "end" : "start"}
                >
                  {text}
                </text>
                {next && <line className="kit-wf-link" x1={x(to)} x2={x(to)} y1={y + 27} y2={y + rowH + 5} />}
              </g>
            );
          })}
          {props.note && (
            <text className="kit-tick" x={m.l} y={height - 6}>
              {props.note}
            </text>
          )}
        </Frame>
      )}
      <Tip tip={tip} width={width} />
    </ChartBox>
  );
}

export interface BarRow {
  id: string;
  label: string;
  value: number;
  color: string;
}

export function DivergingBars(props: { rows: BarRow[]; label: string; format: (v: number) => string; focus?: string | null; onPick?: (id: string) => void }) {
  const [ref, width] = useSize<HTMLDivElement>();
  if (!props.rows.length) return <ChartEmpty height={120}>No traders yet.</ChartEmpty>;
  const labelW = 70;
  const valueW = 72;
  const rowH = 30;
  const height = props.rows.length * rowH + 4;
  const ext = Math.max(1, ...props.rows.map((r) => Math.abs(r.value)));
  const lo = Math.min(0, ...props.rows.map((r) => r.value));
  const hi = Math.max(0, ...props.rows.map((r) => r.value));
  const x = d3
    .scaleLinear()
    .domain([lo < 0 ? Math.min(lo, -ext * 0.15) : 0, hi > 0 ? hi : ext * 0.15])
    .range([labelW + (lo < 0 ? valueW : 4), Math.max(labelW + valueW + 20, width - valueW)]);
  const z = x(0);
  return (
    <ChartBox boxRef={ref}>
      {width > 0 && (
        <Frame width={width} height={height} label={props.label}>
          <line className="kit-zero" x1={z} x2={z} y1={0} y2={height} />
          {props.rows.map((r, i) => {
            const y = i * rowH + 4;
            const x1 = x(r.value);
            const tone = r.value > 0.005 ? "good" : r.value < -0.005 ? "bad" : "flat";
            return (
              <g
                key={r.id}
                style={{ opacity: dim(props.focus, r.id), cursor: props.onPick ? "pointer" : undefined }}
                onClick={props.onPick ? () => props.onPick!(r.id) : undefined}
              >
                <text className="kit-lane-label" x={0} y={y + 15}>
                  {r.label}
                </text>
                <rect x={Math.min(z, x1)} y={y + 3} width={Math.max(2, Math.abs(x1 - z))} height={16} rx={2} style={{ fill: r.color }} />
                <text className="kit-bar-value" data-tone={tone} x={r.value < 0 ? Math.min(z, x1) - 6 : Math.max(z, x1) + 6} y={y + 15} textAnchor={r.value < 0 ? "end" : "start"}>
                  {props.format(r.value)}
                </text>
              </g>
            );
          })}
        </Frame>
      )}
    </ChartBox>
  );
}
