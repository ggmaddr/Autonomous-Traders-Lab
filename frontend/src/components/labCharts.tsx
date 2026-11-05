// The Lab's instruments: the cost and quality frontier (one mark per arm, its 95%
// interval as a whisker, the baselines as reference lines), the effect of one
// dimension (each value against the reference, with its interval), and the run grid
// (one cell per trial, filling in as the worker goes). Marks move and recolour with a
// short transition when the lens or the cost axis changes, so the eye can follow
// each arm from one view to the next.

import type { ArmSummary, Effect, Experiment, LabCatalog, TrialCell } from "../api";
import { niceTicks, useWidth } from "./charts";
import { armLabel, markOf, points, scorePct, shapePath, valueLabel } from "../lib/lab";
import { tokens as fmtTokens } from "../lib/format";
import { runLength } from "../lib/lab";

export type CostAxis = "tokens" | "seconds";

export interface RefLine {
  label: string;
  score: number;
}

export function Frontier(props: {
  exp: Experiment;
  catalog: LabCatalog | undefined;
  lens: string | null;
  cost: CostAxis;
  refs: RefLine[];
  picked: string[];
  onPick: (armId: string) => void;
}) {
  const { exp, catalog, lens, cost, refs, picked } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 300;
  const pad = { l: 52, r: 24, t: 16, b: 40 };
  const rows = exp.summary.filter((s) => s[cost].mean !== null && s.score.mean !== null);
  const xt = niceTicks(0, Math.max(1, ...rows.map((r) => r[cost].mean!)) * 1.08, 4);
  const yt = [0, 0.25, 0.5, 0.75, 1];
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const x = (v: number) => pad.l + (v / xt[xt.length - 1]) * w;
  const y = (v: number) => pad.t + h - v * h;
  const fmtX = (v: number) => (cost === "tokens" ? fmtTokens(v) : runLength(v));

  return (
    <div ref={ref} className="svg-chart frontier">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Decision quality against ${cost === "tokens" ? "tokens" : "time"} per run. ${rows
            .map((r) => `${armLabel(r.arm, exp.spec, catalog)}: ${scorePct(r.score.mean)}, ${fmtX(r[cost].mean!)}`)
            .join("; ")}`}
        >
          {yt.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? "axis-zero" : "grid"} />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="tick">
                {Math.round(v * 100)}%
              </text>
            </g>
          ))}
          {xt.map((v, i) => (
            <text key={v} x={x(v)} y={height - 18} textAnchor={i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"} className="tick">
              {fmtX(v)}
            </text>
          ))}
          <text x={width - pad.r} y={height - 2} textAnchor="end" className="tick-note">
            {cost === "tokens" ? "tokens per run →" : "time per run →"}
          </text>
          {[...refs]
            .sort((p, q) => q.score - p.score)
            .map((r, i, all) => {
              // Labels sit at the left end; a second line close to the first takes its label below.
              const close = i > 0 && Math.abs(y(all[i - 1].score) - y(r.score)) < 16;
              return (
                <g key={r.label}>
                  <line x1={pad.l} x2={width - pad.r} y1={y(r.score)} y2={y(r.score)} className="ref-line" />
                  <text x={pad.l + 6} y={y(r.score) + (close ? 14 : -5)} className="tick-note">
                    {r.label} {scorePct(r.score)}
                  </text>
                </g>
              );
            })}
          {rows.map((r) => {
            const mark = markOf(exp.spec, lens, r.arm);
            const tag = picked.indexOf(r.arm_id);
            const cx = x(r[cost].mean!);
            const cy = y(r.score.mean!);
            return (
              <g
                key={r.arm_id}
                className="lab-mark"
                data-picked={tag >= 0}
                style={{ transform: `translate(${cx}px, ${cy}px)`, color: mark.color }}
                tabIndex={0}
                role="button"
                aria-pressed={tag >= 0}
                aria-label={`${armLabel(r.arm, exp.spec, catalog)}: quality ${scorePct(r.score.mean)}, ${fmtX(r[cost].mean!)} per run. ${tag >= 0 ? `Compared as ${"AB"[tag]}` : "Press to compare"}`}
                onClick={() => props.onPick(r.arm_id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), props.onPick(r.arm_id))}
              >
                {r.score.lo !== null && (
                  <line x1={0} x2={0} y1={y(r.score.hi!) - cy} y2={y(r.score.lo!) - cy} className="whisker" />
                )}
                <path d={shapePath(mark.shape, 6.5)} className="mark-shape" />
                {tag >= 0 && (
                  <text x={11} y={-9} className="pick-tag">
                    {"AB"[tag]}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** A signed bar from the middle with its interval, on a fixed ± scale. */
function DeltaBar({ mean, lo, hi, scale }: { mean: number | null; lo: number | null; hi: number | null; scale: number }) {
  if (mean === null) return <span className="dash">—</span>;
  const pos = (v: number) => 50 + Math.max(-50, Math.min(50, (v / scale) * 50));
  const left = Math.min(pos(0), pos(mean));
  const width = Math.abs(pos(mean) - pos(0));
  return (
    <span className="delta-bar" aria-hidden="true">
      <span className="delta-zero" />
      <span className="delta-fill" data-tone={mean > 0 ? "good" : mean < 0 ? "bad" : "flat"} style={{ left: `${left}%`, width: `${width}%` }} />
      {lo !== null && hi !== null && <span className="delta-ci" style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }} />}
    </span>
  );
}

function ci(i: { lo: number | null; hi: number | null }, f: (v: number) => string): string {
  return i.lo === null || i.hi === null ? "one cell, no interval" : `${f(i.lo)} to ${f(i.hi)}`;
}

export function EffectTable({ effects, catalog, exp, lens }: { effects: Effect[]; catalog: LabCatalog | undefined; exp: Experiment; lens: string }) {
  const rows = effects.filter((e) => e.dimension === lens);
  if (!rows.length) return <p className="empty">No matched pairs yet: each value needs a finished trial on the same scenario and options.</p>;
  return (
    <div className="table-wrap">
      <table className="table effect-table">
        <thead>
          <tr>
            <th scope="col">Against {valueLabel(catalog, lens, rows[0].reference)}</th>
            <th scope="col" className="num">Quality</th>
            <th scope="col" className="bar-col">
              <span className="sr-only">Quality change, with its interval</span>
            </th>
            <th scope="col" className="num">Edge vs holding</th>
            <th scope="col" className="num">Tokens</th>
            <th scope="col" className="num">Time</th>
            <th scope="col" className="num">Pairs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const mark = markOf(exp.spec, lens, { ...exp.arms[0].arm, [lens]: e.value });
            return (
              <tr key={e.value}>
                <th scope="row">
                  <span className="mark-key" style={{ color: mark.color }}>
                    <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
                      <path d={shapePath(mark.shape, 5)} fill="currentColor" />
                    </svg>
                  </span>
                  {valueLabel(catalog, lens, e.value)}
                </th>
                <td className="num">
                  <span className="change" data-tone={(e.score.mean ?? 0) > 0 ? "good" : (e.score.mean ?? 0) < 0 ? "bad" : "flat"}>
                    {points(e.score.mean)} pts
                  </span>
                  <span className="ci-note">{ci(e.score, (v) => points(v))}</span>
                </td>
                <td className="bar-col">
                  <DeltaBar mean={e.score.mean} lo={e.score.lo} hi={e.score.hi} scale={1} />
                </td>
                <td className="num">
                  {points(e.edge.mean, 2)} pp<span className="ci-note">{ci(e.edge, (v) => points(v, 2))}</span>
                </td>
                <td className="num">{e.token_ratio !== null ? `×${e.token_ratio.toFixed(2)}` : "—"}</td>
                <td className="num">
                  {e.seconds.mean !== null ? `${e.seconds.mean >= 0 ? "+" : "−"}${runLength(Math.abs(e.seconds.mean))}` : "—"}
                </td>
                <td className="num muted">{e.cells}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_WORD: Record<string, string> = {
  queued: "waiting",
  running: "running now",
  cancelled: "cancelled",
  error: "failed to run",
};

export function RunGrid(props: {
  exp: Experiment;
  catalog: LabCatalog | undefined;
  lens: string | null;
  onOpen: (cell: TrialCell) => void;
  open: number | null;
}) {
  const { exp, catalog } = props;
  const titles = Object.fromEntries((catalog?.scenarios ?? []).map((s) => [s.id, s.title]));
  const byKey = new Map(exp.cells.map((c) => [`${c.arm_id}|${c.scenario_id}|${c.trial}`, c]));
  const k = exp.spec.trials;
  return (
    <div className="run-grid-wrap">
      <table className="run-grid">
        <thead>
          <tr>
            <th scope="col">Arm</th>
            {exp.spec.scenarios.map((sid) => (
              <th key={sid} scope="col" title={titles[sid]}>
                <span className="rg-scenario">{titles[sid] ?? sid}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {exp.arms.map(({ arm_id, arm }) => {
            const mark = markOf(exp.spec, props.lens, arm);
            return (
              <tr key={arm_id}>
                <th scope="row">
                  <span className="mark-key" style={{ color: mark.color }}>
                    <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">
                      <path d={shapePath(mark.shape, 4.2)} fill="currentColor" />
                    </svg>
                  </span>
                  {armLabel(arm, exp.spec, catalog)}
                </th>
                {exp.spec.scenarios.map((sid) => (
                  <td key={sid}>
                    <span className="rg-cells">
                      {Array.from({ length: k }, (_, i) => {
                        const c = byKey.get(`${arm_id}|${sid}|${i}`);
                        if (!c) return <span key={i} className="rg-cell" data-status="none" />;
                        const word = c.status === "done" ? `${c.grade}${c.action ? `, ${c.action}` : ""}` : STATUS_WORD[c.status];
                        const openable = c.status === "done" || c.status === "error";
                        return (
                          <button
                            key={i}
                            className="rg-cell"
                            data-status={c.status}
                            data-grade={c.grade ?? undefined}
                            data-open={props.open === c.id}
                            disabled={!openable}
                            aria-label={`${titles[sid] ?? sid}, ${armLabel(arm, exp.spec, catalog)}, trial ${i + 1}: ${word}`}
                            title={`Trial ${i + 1}: ${word}`}
                            onClick={() => props.onOpen(c)}
                          />
                        );
                      })}
                    </span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function scoreOf(s: ArmSummary): number {
  return s.score.mean ?? 0;
}
