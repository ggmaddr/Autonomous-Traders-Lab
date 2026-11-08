// Experiments: which configuration is better, by how much, at what cost? On the left,
// the rig: pick scenarios and the options to vary, and the combinations, trial count
// and time are worked out as you switch. On the right, the chosen experiment: the
// frontier of quality against cost (one mark per arm), the effect of the dimension
// under the lens, a side-by-side of any two arms per scenario, and the run grid that
// fills in as the worker goes. Every cell opens the trial: what it did in the sandbox,
// its research, its tool calls and its spans.

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelExperiment,
  createExperiment,
  getExperiment,
  getExperiments,
  getLabCatalog,
  getTrial,
  type ArmSummary,
  type Experiment,
  type ExperimentListItem,
  type Grade,
  type LabCatalog,
  type ScenarioInfo,
  type TrialCell,
} from "../api";
import { Failed, Loading, PageHeader, Panel } from "../components/bits";
import { EffectTable, Frontier, RunGrid, type CostAxis } from "../components/labCharts";
import { Timeline } from "./Decisions";
import { Heatmap, divergingFill } from "../charts";
import { count, longDate, parseIso, price, signedPct, stamp, time, tokens } from "../lib/format";
import {
  DIMS,
  ROBIN_AGENTS,
  armCount,
  armLabel,
  dimLabel,
  fixedLabel,
  markOf,
  points,
  runLength,
  scorePct,
  shapePath,
  valueLabel,
  varying,
} from "../lib/lab";

const MAX_TRIALS = 400;
const GRADE_WORD: Record<Grade, string> = { pass: "Pass", partial: "Partial", fail: "Fail" };

export function Experiments() {
  const [params, setParams] = useSearchParams();
  const catalog = useQuery({ queryKey: ["lab-catalog"], queryFn: getLabCatalog, refetchInterval: 15_000 });
  const list = useQuery({ queryKey: ["experiments"], queryFn: getExperiments, refetchInterval: 5_000 });
  const selectedId = params.get("exp") ?? list.data?.[0]?.id ?? null;
  const exp = useQuery({
    queryKey: ["experiment", selectedId],
    queryFn: () => getExperiment(selectedId!),
    enabled: !!selectedId,
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 4_000 : 30_000),
  });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
    setParams(next, { replace: true });
  };

  return (
    <div className="view">
      <PageHeader
        kicker={`Experiment Lab · frozen scenarios, repeated trials · ${longDate(Date.now())}`}
        title="Experiments"
        finding={<Finding catalog={catalog.data} exp={exp.data} hasAny={!!list.data?.length} />}
        aside={<WorkerLine catalog={catalog.data} />}
      />
      {catalog.error && <Failed what="the lab catalog" error={catalog.error as Error} />}
      {!catalog.data && !catalog.error && <Loading rows={8} />}
      {catalog.data && (
        <div className="lab">
          <Rig catalog={catalog.data} onQueued={(id) => set({ exp: id, trial: null })} />
          <div className="stack lab-results">
            <ExperimentTabs
              list={list.data ?? []}
              selected={selectedId}
              onSelect={(id) => set({ exp: id, trial: null, a: null, b: null })}
            />
            {!selectedId ? (
              <Baselines scenarios={catalog.data.scenarios} />
            ) : exp.error ? (
              <Failed what="the experiment" error={exp.error as Error} />
            ) : !exp.data ? (
              <Loading rows={6} />
            ) : (
              <Results exp={exp.data} catalog={catalog.data} params={params} set={set} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Finding({ catalog, exp, hasAny }: { catalog?: LabCatalog; exp?: Experiment; hasAny: boolean }) {
  if (!catalog) return <>Reading the lab…</>;
  const randomScore = avg(catalog.scenarios.map((s) => s.baselines.find((b) => b.id === "random")!.score));
  if (!hasAny || !exp) {
    return (
      <>
        No experiment has run yet. On these {count(catalog.scenarios.length)} frozen scenarios a random trader scores{" "}
        <span className="num">{scorePct(randomScore)}</span>: the bar every arm has to clear.
      </>
    );
  }
  const done = exp.cells.filter((c) => c.status === "done" || c.status === "error").length;
  const best = [...exp.summary].sort((a, b) => (b.score.mean ?? 0) - (a.score.mean ?? 0))[0];
  const live = exp.status === "running" || exp.status === "queued";
  if (!best) {
    return (
      <>
        {exp.name}: {count(done)} of {count(exp.cells.length)} trials done
        {live ? `, about ${runLength((exp.cells.length - done) * exp.estimate.seconds)} to go` : ""}. Results appear with the first finished
        trial.
      </>
    );
  }
  const effect = exp.effects.find((e) => e.cells > 0 && e.score.mean !== null);
  const tied = exp.summary.filter((s) => s.score.mean === best.score.mean);
  return (
    <>
      {live ? `${count(done)} of ${count(exp.cells.length)} trials in. ` : ""}
      {tied.length > 1 ? `${tied.length} arms tie for best` : `Best so far: ${armLabel(best.arm, exp.spec, catalog)}`} at{" "}
      <span className="num">{scorePct(best.score.mean)}</span>
      {best.score.lo !== null && (
        <span className="num">
          {" "}
          ({scorePct(best.score.lo)}–{scorePct(best.score.hi)})
        </span>
      )}
      , for <span className="num">{tokens(best.tokens.mean ?? 0)}</span> tokens a run.
      {effect && (
        <>
          {" "}
          {dimLabel(catalog, effect.dimension)} {valueLabel(catalog, effect.dimension, effect.value)} against{" "}
          {valueLabel(catalog, effect.dimension, effect.reference)}: <span className="num">{points(effect.score.mean)}</span> points.
        </>
      )}
    </>
  );
}

function WorkerLine({ catalog }: { catalog?: LabCatalog }) {
  if (!catalog) return null;
  const w = catalog.worker;
  return (
    <p className="fresh worker-line" data-alive={w.alive}>
      <span className="market-dot" data-open={w.alive} aria-hidden="true" />
      {w.alive ? (
        w.busy ? (
          "Worker running a trial"
        ) : (
          "Worker idle"
        )
      ) : (
        <>
          Worker off · start it with <code>uv run -m server.lab</code>
        </>
      )}
    </p>
  );
}

// --- The rig ------------------------------------------------------------------

function Rig({ catalog, onQueued }: { catalog: LabCatalog; onQueued: (id: string) => void }) {
  const queries = useQueryClient();
  const [scenarios, setScenarios] = useState<string[]>(() => catalog.scenarios.slice(0, 3).map((s) => s.id));
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(catalog.dimensions.map((d) => [d.id, d.default.filter((v) => d.values.some((x) => x.id === v))])),
  );
  const [trials, setTrials] = useState(3);
  const [name, setName] = useState("");
  const arms = armCount(chosen);
  const synthetic = catalog.scenarios.filter((s) => scenarios.includes(s.id) && s.family !== "regime");
  const robinChosen = (chosen.agent ?? []).some((a) => ROBIN_AGENTS.includes(a));
  const runs = arms * scenarios.length * trials;
  const eta = runs * catalog.estimate.seconds;
  const missing = DIMS.find((d) => !chosen[d]?.length);
  const problem = !scenarios.length
    ? "Pick at least one scenario"
    : robinChosen && synthetic.length
      ? `Robin trades on real bars: pick only regime scenarios (not ${synthetic.map((s) => s.title).join(", ")})`
      : missing
        ? `Pick at least one ${dimLabel(catalog, missing).toLowerCase()}`
        : runs > MAX_TRIALS
          ? `${count(runs)} runs is over the ${MAX_TRIALS} limit`
          : null;
  const queue = useMutation({
    mutationFn: () => createExperiment({ name, scenarios, arms: chosen, trials }),
    onSuccess: (r) => {
      queries.invalidateQueries({ queryKey: ["experiments"] });
      setName("");
      onQueued(r.id);
    },
  });
  const toggle = (dim: string, id: string) =>
    setChosen((c) => ({ ...c, [dim]: c[dim].includes(id) ? c[dim].filter((v) => v !== id) : [...c[dim], id] }));

  return (
    <section className="panel rig sticky" aria-labelledby="rig-title">
      <header className="panel-head">
        <h2 id="rig-title">Build a run</h2>
        <span className="panel-meta">every combination is one arm</span>
      </header>

      <fieldset className="rig-group">
        <legend>
          Scenarios{" "}
          <span className="muted num">
            {scenarios.length} of {catalog.scenarios.length}
          </span>
          <button
            type="button"
            className="btn-link text-link rig-all"
            onClick={() => setScenarios(scenarios.length === catalog.scenarios.length ? [] : catalog.scenarios.map((s) => s.id))}
          >
            {scenarios.length === catalog.scenarios.length ? "None" : "All"}
          </button>
        </legend>
        <ul className="rig-scenarios">
          {catalog.scenarios.map((s) => {
            const on = scenarios.includes(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="rig-scenario"
                  aria-pressed={on}
                  onClick={() => setScenarios(on ? scenarios.filter((x) => x !== s.id) : [...scenarios, s.id])}
                >
                  <span className="rig-check" aria-hidden="true" />
                  <span className="rig-scenario-text">
                    <span className="strong">{s.title}</span>
                    <span className="muted">
                      {s.family} · {s.task} · random agent {scorePct(s.baselines.find((b) => b.id === "random")!.score)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {catalog.dimensions.map((d) => (
        <fieldset key={d.id} className="rig-group">
          <legend>
            {d.label} <span className="muted num">{chosen[d.id]?.length ?? 0}</span>
          </legend>
          <p className="rig-question">{d.question}</p>
          <div className="chips" role="group" aria-label={d.label}>
            {d.values.map((v) => (
              <button
                key={v.id}
                type="button"
                className="chip"
                aria-pressed={chosen[d.id]?.includes(v.id)}
                title={v.detail}
                onClick={() => toggle(d.id, v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="rig-group">
        <legend>Trials per arm and scenario</legend>
        <div className="stepper">
          <button type="button" aria-label="Fewer trials" onClick={() => setTrials((t) => Math.max(1, t - 1))} disabled={trials <= 1}>
            −
          </button>
          <span className="num" aria-live="polite">
            {trials}
          </span>
          <button type="button" aria-label="More trials" onClick={() => setTrials((t) => Math.min(10, t + 1))} disabled={trials >= 10}>
            +
          </button>
          <span className="muted rig-hint">{trials < 3 ? "under 3 gives no useful interval" : "repeats show the spread"}</span>
        </div>
      </fieldset>

      <div className="readout" aria-live="polite">
        <p className="readout-math num">
          {count(arms)} {arms === 1 ? "arm" : "arms"} × {count(scenarios.length)} × {count(trials)} ={" "}
          <span className="readout-total">{count(runs)}</span> runs
        </p>
        <p className="muted">
          About {runLength(eta)} on the local model, at {runLength(catalog.estimate.seconds)} a run
          {catalog.estimate.measured
            ? ` (median of ${count(catalog.estimate.measured)} finished)`
            : " (a guess until the first runs finish)"}
          .
        </p>
      </div>
      <label className="rig-name">
        <span className="muted">Name (optional)</span>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Researcher on vs off" />
      </label>
      <button type="button" className="btn-primary" disabled={!!problem || queue.isPending} onClick={() => queue.mutate()}>
        {queue.isPending ? "Queueing…" : `Queue ${count(runs)} runs`}
      </button>
      {(problem || queue.error) && (
        <p className="rig-problem" role="alert">
          {problem ?? (queue.error as Error).message}
        </p>
      )}
      {!catalog.worker.alive && !problem && (
        <p className="note">The worker is off, so queued runs wait until you start it: uv run -m server.lab</p>
      )}
    </section>
  );
}

function ExperimentTabs({
  list,
  selected,
  onSelect,
}: {
  list: ExperimentListItem[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (!list.length) return null;
  return (
    <div className="exp-tabs" role="tablist" aria-label="Experiments">
      {list.slice(0, 8).map((e) => {
        const total = Object.values(e.progress).reduce((a, b) => a + (b ?? 0), 0);
        const done = (e.progress.done ?? 0) + (e.progress.error ?? 0);
        return (
          <button key={e.id} role="tab" aria-selected={e.id === selected} className="exp-tab" onClick={() => onSelect(e.id)}>
            <span className="exp-tab-name">{e.name}</span>
            <span className="exp-tab-meta num">
              {e.status === "done" ? "done" : e.status === "cancelled" ? "cancelled" : `${done}/${total}`} ·{" "}
              {stamp(parseIso(e.created_at)!)}
            </span>
            <span className="exp-tab-bar" aria-hidden="true">
              <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// --- Results ---------------------------------------------------------------------

function Results({
  exp,
  catalog,
  params,
  set,
}: {
  exp: Experiment;
  catalog: LabCatalog;
  params: URLSearchParams;
  set: (p: Record<string, string | null>) => void;
}) {
  const queries = useQueryClient();
  const dims = varying(exp.spec);
  const lens = dims.includes(params.get("lens") as never) ? params.get("lens") : (dims[0] ?? null);
  const cost = (params.get("cost") === "seconds" ? "seconds" : "tokens") as CostAxis;
  const ranked = [...exp.summary].sort((a, b) => (b.score.mean ?? 0) - (a.score.mean ?? 0));
  const a = params.get("a") ?? ranked[0]?.arm_id ?? exp.arms[0]?.arm_id;
  const b = params.get("b") ?? ranked[1]?.arm_id ?? exp.arms[1]?.arm_id ?? null;
  const trialId = Number(params.get("trial")) || null;
  const scenarios = catalog.scenarios.filter((s) => exp.spec.scenarios.includes(s.id));
  const refs = [
    { label: "Random agent", score: avg(scenarios.map((s) => s.baselines.find((x) => x.id === "random")!.score)) },
    { label: "Do nothing", score: avg(scenarios.map((s) => s.baselines.find((x) => x.id === "hold")!.score)) },
  ];
  const pick = (id: string) => {
    if (id === a || id === b) return;
    set({ a: b ?? a, b: id });
  };
  const cancel = useMutation({
    mutationFn: () => cancelExperiment(exp.id),
    onSuccess: () => queries.invalidateQueries({ queryKey: ["experiment", exp.id] }),
  });
  const live = exp.status === "queued" || exp.status === "running";
  const done = exp.cells.filter((c) => c.status === "done" || c.status === "error").length;

  return (
    <>
      <Panel
        title="Quality against cost"
        id="frontier"
        meta={
          <div className="lens-bar">
            {dims.length > 0 && (
              <div className="segmented" role="group" aria-label="Compare by">
                {dims.map((d) => (
                  <button key={d} aria-pressed={lens === d} onClick={() => set({ lens: d })}>
                    {dimLabel(catalog, d)}
                  </button>
                ))}
              </div>
            )}
            <div className="segmented" role="group" aria-label="Cost axis">
              {(["tokens", "seconds"] as CostAxis[]).map((c) => (
                <button key={c} aria-pressed={cost === c} onClick={() => set({ cost: c === "tokens" ? null : c })}>
                  {c === "tokens" ? "Tokens" : "Time"}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {exp.summary.length ? (
          <>
            {lens && <LensKey exp={exp} catalog={catalog} lens={lens} />}
            <Frontier
              exp={exp}
              catalog={catalog}
              lens={lens}
              cost={cost}
              refs={refs}
              picked={[a, b].filter(Boolean) as string[]}
              onPick={pick}
            />
            <p className="note">
              Quality: 100% is a pass on every trial, 50% a partial. Whiskers are 95% bootstrap intervals over trials. Up and to the left is
              better. Press any two marks to compare them below. Held fixed: {fixedLabel(exp.spec, catalog) || "nothing"}.
            </p>
          </>
        ) : (
          <p className="empty">
            {live
              ? `No trial has finished yet. The first mark lands after about ${runLength(exp.estimate.seconds)}${exp.worker.alive ? "" : ", once the worker is started"}.`
              : "No finished trials in this experiment."}
          </p>
        )}
      </Panel>

      {lens && exp.effects.some((e) => e.dimension === lens) && (
        <Panel
          title={`What ${dimLabel(catalog, lens).toLowerCase()} changes`}
          id="effects"
          meta={<span>paired on the same scenario and options</span>}
        >
          <EffectTable effects={exp.effects} catalog={catalog} exp={exp} lens={lens} />
        </Panel>
      )}

      {a && b && (
        <Duel exp={exp} catalog={catalog} scenarios={scenarios} a={a} b={b} set={set} onOpen={(id) => set({ trial: String(id) })} />
      )}

      <Panel
        title="Run grid"
        id="grid"
        meta={
          <span className="grid-meta">
            <span className="num">
              {count(done)} of {count(exp.cells.length)} done
            </span>
            {live && (
              <button type="button" className="btn-ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                Cancel the rest
              </button>
            )}
          </span>
        }
      >
        <RunGrid exp={exp} catalog={catalog} lens={lens} open={trialId} onOpen={(c: TrialCell) => set({ trial: String(c.id) })} />
        <p className="note grid-key">
          <span className="rg-cell" data-status="done" data-grade="pass" /> pass{" "}
          <span className="rg-cell" data-status="done" data-grade="partial" /> partial{" "}
          <span className="rg-cell" data-status="done" data-grade="fail" /> fail <span className="rg-cell" data-status="running" /> running{" "}
          <span className="rg-cell" data-status="queued" /> waiting. Press a cell to open the trial.
        </p>
      </Panel>

      {exp.summary.length > 0 && (
        <Panel title="Every arm" id="arms" meta={<span>means with 95% intervals</span>}>
          <ArmsTable exp={exp} catalog={catalog} lens={lens} />
        </Panel>
      )}

      <Panel title="Manifest" id="manifest" meta={<span className="num">{exp.id}</span>}>
        <Manifest exp={exp} />
      </Panel>

      {trialId && <TrialSheet id={trialId} catalog={catalog} exp={exp} onClose={() => set({ trial: null })} />}
    </>
  );
}

function LensKey({ exp, catalog, lens }: { exp: Experiment; catalog: LabCatalog; lens: string }) {
  return (
    <p className="lens-key">
      {exp.spec.arms[lens].map((v, i) => {
        const mark = markOf(exp.spec, lens, { ...exp.arms[0].arm, [lens]: v });
        return (
          <span key={v} className="lens-key-item">
            <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true" style={{ color: mark.color }}>
              <path d={shapePath(mark.shape, 5)} fill="currentColor" />
            </svg>
            {valueLabel(catalog, lens, v)}
            {i === 0 && <span className="muted"> (reference)</span>}
          </span>
        );
      })}
    </p>
  );
}

function Duel(props: {
  exp: Experiment;
  catalog: LabCatalog;
  scenarios: ScenarioInfo[];
  a: string;
  b: string;
  set: (p: Record<string, string | null>) => void;
  onOpen: (trialId: number) => void;
}) {
  const { exp, catalog, scenarios, a, b } = props;
  const armOf = (id: string) => exp.arms.find((x) => x.arm_id === id)?.arm;
  const sum = (id: string) => exp.summary.find((s) => s.arm_id === id);
  const rows = scenarios.map((s) => ({ s, A: exp.scenarios[s.id]?.[a], B: exp.scenarios[s.id]?.[b] }));
  const paired = rows.filter((r) => r.A && r.B);
  const wins = paired.filter((r) => r.B!.score > r.A!.score).length;
  const losses = paired.filter((r) => r.B!.score < r.A!.score).length;
  const diff = paired.length ? avg(paired.map((r) => r.B!.score - r.A!.score)) : null;
  const select = (side: "a" | "b", id: string) => props.set({ [side]: id });

  return (
    <Panel
      title="Side by side"
      id="duel"
      meta={
        <span className="num">
          {paired.length
            ? `B ${points(diff)} pts against A · better on ${wins}, worse on ${losses}, level on ${paired.length - wins - losses}`
            : "no scenario finished for both yet"}
        </span>
      }
    >
      <div className="duel-pick">
        {(["a", "b"] as const).map((side) => {
          const id = side === "a" ? a : b;
          const arm = armOf(id);
          const s = sum(id);
          return (
            <label key={side} className="duel-side" data-side={side}>
              <span className="duel-tag">{side.toUpperCase()}</span>
              <select value={id} onChange={(e) => select(side, e.target.value)} aria-label={`Arm ${side.toUpperCase()}`}>
                {exp.arms.map((x) => (
                  <option key={x.arm_id} value={x.arm_id}>
                    {armLabel(x.arm, exp.spec, catalog)}
                  </option>
                ))}
              </select>
              <span className="duel-figures num">
                {s
                  ? `${scorePct(s.score.mean)} · ${tokens(s.tokens.mean ?? 0)} tok · ${runLength(s.seconds.mean ?? 0)}`
                  : arm
                    ? "no trials yet"
                    : ""}
              </span>
            </label>
          );
        })}
      </div>
      <div className="table-wrap">
        <table className="table duel-table">
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">A did</th>
              <th scope="col">B did</th>
              <th scope="col" className="num">
                B − A
              </th>
              <th scope="col" className="num">
                Doing nothing
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, A, B }) => {
              const hold = s.baselines.find((x) => x.id === "hold")!;
              const d = A && B ? B.score - A.score : null;
              return (
                <tr key={s.id}>
                  <th scope="row">
                    <span className="duel-scenario">
                      <span className="strong">{s.title}</span>
                      <span className="muted">{s.question}</span>
                    </span>
                  </th>
                  <td>
                    <Trials cell={A} onOpen={props.onOpen} />
                  </td>
                  <td>
                    <Trials cell={B} onOpen={props.onOpen} />
                  </td>
                  <td className="num">
                    {d === null ? (
                      <span className="dash">—</span>
                    ) : (
                      <span className="change" data-tone={d > 0 ? "good" : d < 0 ? "bad" : "flat"}>
                        {points(d)}
                      </span>
                    )}
                  </td>
                  <td className="num muted">
                    {hold.grade ? GRADE_WORD[hold.grade] : "—"} · {signedPct(hold.return, 1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Trials({ cell, onOpen }: { cell?: Experiment["scenarios"][string][string]; onOpen: (id: number) => void }) {
  if (!cell) return <span className="dash">not run yet</span>;
  const actions = [...new Set(cell.trials.map((t) => t.action))];
  return (
    <span className="duel-trials">
      <span className="duel-grades">
        {cell.trials.map((t) => (
          <button
            key={t.id}
            className="grade-pip"
            data-grade={t.grade}
            onClick={() => onOpen(t.id)}
            aria-label={`Trial ${t.trial + 1}: ${t.grade}, ${t.action}`}
            title={`Trial ${t.trial + 1}: ${GRADE_WORD[t.grade]}, ${t.action}`}
          >
            {GRADE_WORD[t.grade][0]}
          </button>
        ))}
      </span>
      <span className="duel-action">
        {actions.slice(0, 2).join("; ")}
        {actions.length > 2 ? ` and ${actions.length - 2} more` : ""}
      </span>
    </span>
  );
}

function ArmsTable({ exp, catalog, lens }: { exp: Experiment; catalog: LabCatalog; lens: string | null }) {
  const rows = [...exp.summary].sort((a, b) => (b.score.mean ?? 0) - (a.score.mean ?? 0));
  // Columns for metrics only some experiments have: playbook rules and a written thesis.
  const playbooks = rows.some((r) => r.adherence?.n);
  const theses = rows.some((r) => r.uncited?.n);
  const iv = (s: ArmSummary["score"], f: (v: number) => string) => (s.lo === null ? "" : `${f(s.lo)}–${f(s.hi!)}`);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Arm</th>
            <th scope="col" className="num">
              Trials
            </th>
            <th scope="col" className="num">
              Quality
            </th>
            <th scope="col" className="num">
              Edge
            </th>
            <th scope="col" className="num">
              Tokens
            </th>
            <th scope="col" className="num">
              Time
            </th>
            <th scope="col" className="num">
              Research
            </th>
            <th scope="col" className="num">
              Broke a rule
            </th>
            {playbooks && (
              <th scope="col" className="num">
                Playbook kept
              </th>
            )}
            {theses && (
              <th scope="col" className="num">
                Uncited claims
              </th>
            )}
            <th scope="col" className="num">
              Finished
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const mark = markOf(exp.spec, lens, r.arm);
            return (
              <tr key={r.arm_id}>
                <th scope="row">
                  <span className="mark-key" style={{ color: mark.color }}>
                    <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">
                      <path d={shapePath(mark.shape, 4.2)} fill="currentColor" />
                    </svg>
                  </span>
                  {armLabel(r.arm, exp.spec, catalog)}
                </th>
                <td className="num">{r.n}</td>
                <td className="num strong">
                  {scorePct(r.score.mean)} <span className="ci-note">{iv(r.score, scorePct)}</span>
                </td>
                <td className="num">
                  {points(r.edge.mean, 2)} pp <span className="ci-note">{iv(r.edge, (v) => points(v, 2))}</span>
                </td>
                <td className="num">{tokens(Math.round(r.tokens.mean ?? 0))}</td>
                <td className="num">{runLength(r.seconds.mean ?? 0)}</td>
                <td className="num">{(r.research_calls.mean ?? 0).toFixed(1)} calls</td>
                <td className="num">{Math.round(r.violated * 100)}%</td>
                {playbooks && (
                  <td className="num">
                    {r.adherence?.n ? (
                      <>
                        {scorePct(r.adherence.mean)} <span className="ci-note">{iv(r.adherence, scorePct)}</span>
                      </>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                )}
                {theses && (
                  <td className="num">
                    {r.uncited?.n ? (
                      <>
                        {scorePct(r.uncited.mean)} <span className="ci-note">{(r.conflicts.mean ?? 0).toFixed(1)} conflicts</span>
                      </>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                )}
                <td className="num">{Math.round(r.completed * 100)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="note">
        Edge: the return the decision added over keeping the starting portfolio on the scenario's frozen path, in percentage points. Broke a
        rule: trials with at least one refused order (unknown symbol, more than the cash, more shares than held).
        {playbooks &&
          " Playbook kept: the share of playbook rule checks the filled orders passed; a persona is held to its playbook's rules (E14)."}
        {theses &&
          " Uncited claims: the share of the Synthesizer thesis's claims citing nothing the trial had, and the conflicts it named (E13)."}
      </p>
    </div>
  );
}

function Manifest({ exp }: { exp: Experiment }) {
  const m = exp.manifest as Record<string, unknown>;
  const show = (v: unknown) =>
    typeof v === "object" && v !== null
      ? Object.entries(v)
          .map(([k, x]) => `${k} ${x}`)
          .join(" · ")
      : String(v);
  return (
    <dl className="manifest">
      {Object.entries(m).map(([k, v]) => (
        <div key={k}>
          <dt>{k.replace(/_/g, " ")}</dt>
          <dd className="num">{show(v) || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- Baselines (shown before any experiment) -------------------------------------

function Baselines({ scenarios }: { scenarios: ScenarioInfo[] }) {
  // One column per baseline any scenario has, in a fixed order; the regime scenarios add
  // the rules E12 compares against, the others show a dash there.
  // The random agent comes first: it is the bar every arm has to clear.
  const order = ["random", "hold", "spy", "equal", "mechanical", "trend_200d", "sixty_forty", "vol_target"];
  const cols = order
    .map((id) => scenarios.flatMap((s) => s.baselines).find((b) => b.id === id))
    .filter((b): b is ScenarioInfo["baselines"][number] => !!b);
  const scale = Math.max(0.01, ...scenarios.flatMap((s) => s.baselines.map((b) => Math.abs(b.return))));
  const moves = (s: ScenarioInfo) =>
    s.universe.length > 6
      ? `${s.universe.length} symbols · SPY ${signedPct(s.universe.find((u) => u.symbol === "SPY")?.move ?? 0, 1)}`
      : s.universe.map((u) => `${u.symbol} ${signedPct(u.move, 1)}`).join(", ");
  return (
    <Panel title="The scenarios and their baselines" id="baselines" meta={<span>what simple rules make on each frozen path</span>}>
      <Heatmap
        label="Scenario by baseline: return over the horizon, outline is the grade"
        rowHead="Scenario"
        rows={scenarios.map((s) => ({
          id: s.id,
          label: (
            <span className="duel-scenario">
              <span className="strong">{s.title}</span>
              <span className="muted">
                {s.family} · {s.horizon_days} days · {moves(s)}
              </span>
            </span>
          ),
        }))}
        cols={cols.map((b) => ({
          id: b.id,
          label: <span title={b.detail}>{b.id === "random" ? "Random · the bar" : b.label}</span>,
          now: b.id === "random",
        }))}
        cell={(sid, id) => {
          const s = scenarios.find((x) => x.id === sid)!;
          const b = s.baselines.find((x) => x.id === id);
          if (!b) return null;
          const { fill, ink } = divergingFill(b.return, scale);
          return {
            text: signedPct(b.return, 1),
            fill,
            ink,
            outline: b.grade === "pass" ? "good" : b.grade === "fail" ? "bad" : b.grade === "partial" ? "partial" : null,
            tip: `${b.label}: ${signedPct(b.return, 2)} · ${b.grade ? GRADE_WORD[b.grade] : `quality ${scorePct(b.score)}`}. ${b.detail}`,
          };
        }}
      />
      <ul className="kit-legend">
        <li>Cell colour: return</li>
        <li>
          <span className="kit-legend-mark grade-key" data-outline="good" /> pass
        </li>
        <li>
          <span className="kit-legend-mark grade-key" data-outline="partial" /> partial
        </li>
        <li>
          <span className="kit-legend-mark grade-key" data-outline="bad" /> fail
        </li>
        <li>First column: the random agent, the bar an arm has to clear</li>
      </ul>
      <p className="note">
        Returns over each scenario's horizon. Hand-written scenarios use synthetic tickers, so a model cannot know the path. Regime
        scenarios replay real bars from each of this year's regime turns; the local model's training ends before 2026. They pass a trial
        that beats the mechanical regime rule (E12) and call it partial when it beats only the 200-day rule. The random agent takes 400
        seeded valid actions; it never breaks a rule, so on the constraint scenarios it sets a high bar for rule-keeping.
      </p>
    </Panel>
  );
}

// --- One trial ---------------------------------------------------------------------

function TrialSheet({ id, catalog, exp, onClose }: { id: number; catalog: LabCatalog; exp: Experiment; onClose: () => void }) {
  const trial = useQuery({ queryKey: ["trial", id], queryFn: () => getTrial(id), staleTime: 60_000 });
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const t = trial.data;
  const s = catalog.scenarios.find((x) => x.id === t?.scenario_id);
  const g = t?.grades;
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <div>
            <p className="kicker">{t ? `Trial ${t.trial + 1} · ${armLabel(t.arm, exp.spec, catalog)}` : "Trial"}</p>
            <h2 id="sheet-title">{s?.title ?? "Loading…"}</h2>
          </div>
          <button ref={closeRef} type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>
        {trial.error && <Failed what="the trial" error={trial.error as Error} />}
        {!t && !trial.error && <Loading rows={6} />}
        {t && g && (
          <div className="stack sheet-body">
            <p className="sheet-verdict">
              <span className="tag" data-tone={g.grade === "pass" ? "good" : g.grade === "fail" ? "bad" : undefined}>
                {GRADE_WORD[g.grade]}
              </span>{" "}
              It {g.action}. Return <span className="num">{signedPct(g.return, 2)}</span> over {s?.horizon_days} days,{" "}
              <span className="num">{points(g.edge, 2)}</span> pp against holding.
            </p>
            {t.error && <p className="failed">Run ended with {t.error}</p>}
            <dl className="sheet-stats">
              {[
                ["Model calls", count(g.model_calls)],
                ["Tokens", tokens(g.tokens)],
                ["Time", runLength(g.seconds)],
                ["Research calls", count(g.research_calls)],
                ["Searches", count(g.searches)],
                ["Price lookups", count(g.lookups)],
                ["Refused orders", count(g.violations)],
                ["Recovered tool calls", count(g.recovered)],
                ["Loops", count(g.loops)],
                ["Cited the evidence", g.evidence_cited ? "yes" : "no"],
                ...(g.adherence !== undefined && g.adherence !== null
                  ? [["Playbook rules kept", `${scorePct(g.adherence)} of ${g.rule_checks}`]]
                  : []),
                ...(g.uncited !== undefined && g.uncited !== null
                  ? [
                      ["Thesis claims uncited", scorePct(g.uncited)],
                      ["Conflicts named", count(g.conflicts ?? 0)],
                    ]
                  : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd className="num">{v}</dd>
                </div>
              ))}
            </dl>
            <section>
              <h3 className="sub-head">Orders it tried</h3>
              {t.result?.orders.length ? (
                <ul className="calls">
                  {t.result.orders.map((o, i) => (
                    <li key={i} data-failed={o.status === "rejected"}>
                      <p>
                        <span className="strong">
                          {o.side} {o.quantity} {o.symbol}
                        </span>{" "}
                        <span className="muted">{o.status === "filled" ? `filled at ${price(o.price!)}` : `refused: ${o.reason}`}</span>
                      </p>
                      {o.rationale && <p className="call-result">{o.rationale}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No orders: it held.</p>
              )}
            </section>
            {t.run && t.run.research.length > 0 && (
              <section>
                <h3 className="sub-head">Research it got</h3>
                <ul className="evidence">
                  {t.run.research.map((r) => (
                    <li key={r.id}>
                      <p className="evidence-ask">
                        Asked: <span className="muted">{r.request}</span>
                      </p>
                      <div className="answer-text">{r.answer || "No answer recorded."}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {t.result?.output && (
              <section>
                <h3 className="sub-head">What it said</h3>
                <blockquote className="decision-quote small">{t.result.output}</blockquote>
              </section>
            )}
            {t.run && (
              <section>
                <h3 className="sub-head">
                  Spans{" "}
                  {t.run.openai_trace_url && (
                    <a className="text-link" href={t.run.openai_trace_url} target="_blank" rel="noreferrer">
                      open the raw trace
                    </a>
                  )}
                </h3>
                <Timeline spans={t.run.timeline} />
              </section>
            )}
            <p className="note num">
              {t.trace_id} · started {t.started_at ? time(parseIso(t.started_at)!) : "—"}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
