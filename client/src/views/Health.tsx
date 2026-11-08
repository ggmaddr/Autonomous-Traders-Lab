// Health: is the infrastructure OK? Status tiles first, then what every agent is
// doing: the saved spans of the last few minutes as one swimlane per trader
// (turns behind, model calls, tools and MCP listings as bars), each trader's
// event rate, and how long each kind of span takes. The raw activity log sits
// behind a toggle, with its Started/Ended pairs folded into one line.

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getActivity, getExperiments, getLabCatalog, getTraderLogs, getTraders, type ActivitySpan } from "../api";
import { Failed, Loading, PageHeader, Panel, TraderName } from "../components/bits";
import { DotPlot, Stub, Swimlane, type Lane } from "../charts";
import { TraderPills, ROSTER, cap, useTraderFilter } from "../lib/filter";
import { elapsed, parseIso, parseStamp, stamp, time } from "../lib/format";
import { hueVar } from "../lib/traders";
import { useMarket } from "../lib/desk";

const ACTIVITY_POLL_MS = 5000;
const LOG_POLL_MS = 5000;
const WINDOWS = [
  { id: 10, label: "10 min" },
  { id: 60, label: "1 hour" },
  { id: 360, label: "6 hours" },
];

const KINDS = {
  turn: { label: "turn", color: "var(--control)", backdrop: true },
  generation: { label: "model call", color: "var(--t-ray)" },
  function: { label: "tool call", color: "var(--accent-data)" },
  mcp_tools: { label: "MCP listing", color: "var(--t-george)" },
};
const ROW: Record<string, number> = { generation: 0, function: 1, mcp_tools: 2 };

export function Health() {
  const [minutes, setMinutes] = useState(10);
  const [trader, setTrader] = useTraderFilter();
  const activity = useQuery({
    queryKey: ["activity", minutes],
    queryFn: () => getActivity(minutes),
    refetchInterval: ACTIVITY_POLL_MS,
  });
  const catalog = useQuery({ queryKey: ["lab-catalog"], queryFn: getLabCatalog, refetchInterval: 15_000 });
  const experiments = useQuery({ queryKey: ["experiments"], queryFn: getExperiments, refetchInterval: 15_000 });
  const market = useMarket();

  const data = activity.data;
  const view = useMemo(() => {
    if (!data) return null;
    const t0 = parseIso(data.start)!;
    const t1 = parseIso(data.end)!;
    const spans = data.spans.map((s) => ({
      ...s,
      a: parseIso(s.started_at) ?? t0,
      b: parseIso(s.ended_at) ?? t1,
    }));
    const lanes: Lane[] = ROSTER.map((name) => {
      const mine = spans.filter((s) => s.trader === name);
      const events = mine.filter((s) => s.kind !== "turn").length;
      const last = Math.max(0, ...mine.map((s) => s.b));
      const quiet = last ? (t1 - last) / 60000 : null;
      const rate = events / Math.max(1, minutes);
      return {
        id: name,
        label: cap(name),
        color: hueVar(name),
        sub: !mine.length
          ? "no activity"
          : `${rate < 1 ? rate.toFixed(1) : Math.round(rate)} events/min${quiet !== null && quiet > 2 ? ` · quiet ${Math.round(quiet)} m` : ""}`,
        rows: 3,
        bars: mine.map((s, i) => ({
          id: `${name}-${i}`,
          start: s.a,
          end: s.b,
          kind: s.kind,
          row: ROW[s.kind] ?? 0,
          failed: s.error,
          tip: <SpanTip s={s} />,
        })),
      };
    });
    const durations = spans
      .filter((s) => s.kind !== "turn" && s.b > s.a)
      .map((s, i) => ({ ...s, i, secs: Math.max(0.001, (s.b - s.a) / 1000) }));
    return { t0, t1, lanes, durations, count: spans.length };
  }, [data, minutes]);

  const queued = experiments.data?.reduce((s, e) => s + (e.progress.queued ?? 0), 0) ?? null;
  const running = experiments.data?.reduce((s, e) => s + (e.progress.running ?? 0), 0) ?? 0;
  const worker = catalog.data?.worker;
  const idle = data?.idle_since ? parseIso(data.idle_since) : null;

  let finding: React.ReactNode = "Reading the saved spans…";
  if (data && view) {
    const active = view.lanes.filter((l) => l.bars.length).length;
    finding = idle
      ? `No agent has run since ${stamp(idle)}. The lanes show the last ${minutes} minutes before that: ${active} of ${view.lanes.length} traders were active.`
      : `${active} of ${view.lanes.length} traders ran in the last ${minutes} minutes, with ${data.errors ? `${data.errors} failed spans` : "no failed spans"}.`;
  }

  return (
    <div className="view">
      <PageHeader
        kicker="Infrastructure · live"
        title="Health"
        finding={finding}
        aside={activity.dataUpdatedAt > 0 && <p className="fresh num">Updated {time(activity.dataUpdatedAt)} · every 5 s</p>}
      />

      <section className="tiles" aria-label="Status">
        <Tile label="MCP servers" hint="up / total" stub="The API does not report MCP server health yet" />
        <Tile
          label="Model speed"
          value={data?.tokens_per_second != null ? `${data.tokens_per_second}` : "—"}
          hint="output tokens per second of model time"
          tone={data?.tokens_per_second != null && data.tokens_per_second < 2 ? "warn" : undefined}
        />
        <Tile
          label="Lab queue"
          value={queued !== null ? `${queued}` : "—"}
          hint={worker ? (worker.alive ? `worker up${running ? ` · ${running} running` : ""}` : "worker not running") : "trials waiting"}
          tone={worker && !worker.alive && (queued ?? 0) > 0 ? "bad" : undefined}
        />
        <Tile
          label="Feed freshness"
          hint={market.data ? (market.data.source === "massive" ? "prices from Massive" : "simulated prices") : "age of last price"}
          stub="The API does not expose when the last price was fetched"
        />
        <Tile label="Database" value={data?.db_bytes ? `${(data.db_bytes / 1e6).toFixed(1)} MB` : "—"} hint="accounts.db on disk" />
        <Tile
          label="Errors"
          value={data ? `${data.errors}` : "—"}
          hint={`failed spans, last ${minutes} min`}
          tone={data?.errors ? "bad" : data ? "good" : undefined}
        />
      </section>

      <div className="filter-row">
        <TraderPills value={trader} onChange={setTrader} />
        <div className="segmented filter" role="group" aria-label="Window">
          {WINDOWS.map((w) => (
            <button key={w.id} aria-pressed={minutes === w.id} onClick={() => setMinutes(w.id)}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {activity.error && <Failed what="the agents' activity" error={activity.error as Error} />}
      {!data && !activity.error && <Loading rows={6} />}
      {view && (
        <>
          <Panel
            title={`Agent activity · ${idle ? `the ${minutes} minutes before ${time(idle)}` : `last ${minutes} minutes`}`}
            id="lanes"
            meta={<span className="num">{view.count} spans</span>}
          >
            <Swimlane
              lanes={view.lanes}
              kinds={KINDS}
              domain={[view.t0, view.t1]}
              format={(v) => time(v)}
              label={`Agent activity swimlanes, ${minutes} minutes`}
              focus={trader}
              onPickLane={(id) => setTrader(id)}
              rowH={12}
            />
            <p className="note">
              Each bar is one saved SDK span, from its start to its end; turns sit behind as faint blocks. A lane that goes quiet while the
              others work is a stuck agent.
            </p>
          </Panel>

          <Panel title="How long each kind of span takes" id="latency" meta={<span>seconds, log scale</span>}>
            <DotPlot
              label="Span durations by kind"
              log
              format={(v) => (v < 1 ? `${Math.round(v * 1000)} ms` : v < 60 ? `${v.toFixed(v < 10 ? 1 : 0)} s` : `${Math.round(v / 60)} m`)}
              lanes={Object.entries(KINDS)
                .filter(([k]) => k !== "turn")
                .map(([id, k]) => ({ id, label: k.label, color: k.color }))}
              dots={view.durations.map((s) => ({
                id: `${s.trace_id}-${s.i}`,
                value: s.secs,
                group: s.kind,
                focusId: s.trader,
                color: hueVar(s.trader),
                r: 4,
                tip: <SpanTip s={s} />,
              }))}
              focus={trader}
            />
            <p className="note">Dot colour is the trader. The local model's calls run minutes long; tools take milliseconds to seconds.</p>
          </Panel>
        </>
      )}

      <RawLog />
    </div>
  );
}

function SpanTip({ s }: { s: ActivitySpan & { a: number; b: number } }) {
  return (
    <>
      <p className="kit-tip-head">
        {cap(s.trader)} · {KINDS[s.kind as keyof typeof KINDS]?.label ?? s.kind}
      </p>
      {s.name && <p className="strong">{s.name}</p>}
      <p className="num">
        {time(s.a)} → {time(s.b)} · {elapsed(s.b - s.a)}
      </p>
      {s.error && (
        <p className="money-tone" data-tone="bad">
          Failed
        </p>
      )}
    </>
  );
}

function Tile(props: { label: string; value?: string; hint: string; stub?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="tile" data-tone={props.tone}>
      <p className="tile-label">
        <span className="tile-dot" aria-hidden="true" />
        {props.label}
      </p>
      <p className="tile-value num">{props.stub ? "—" : (props.value ?? "—")}</p>
      <p className="tile-hint">{props.hint}</p>
      {props.stub && <Stub why={props.stub} />}
    </div>
  );
}

/** The activity log, Started/Ended pairs folded and repeats counted. */
function RawLog() {
  const [open, setOpen] = useState(false);
  const roster = useQuery({ queryKey: ["traders"], queryFn: getTraders, staleTime: Infinity });
  const logs = useQueries({
    queries: (roster.data ?? []).map((t) => ({
      queryKey: ["logs", t.name, 40],
      queryFn: () => getTraderLogs(t.name, 40),
      refetchInterval: open ? LOG_POLL_MS : false,
      enabled: open,
    })),
  });
  const rows = logs
    .flatMap((q, i) => (q.data ?? []).map((r) => ({ ...r, trader: roster.data![i].name.toLowerCase() })))
    // Log times are SQLite UTC (D9); mark them as UTC so they show in local time.
    .map((r) => ({ ...r, t: parseStamp(r.datetime + "Z"), what: r.message.replace(/^(Started|Ended):?\s*/, "") }))
    .sort((a, b) => b.t - a.t);
  const grouped: ((typeof rows)[number] & { n: number })[] = [];
  for (const r of rows) {
    const prev = grouped[grouped.length - 1];
    if (prev && prev.trader === r.trader && prev.type === r.type && prev.what === r.what && Math.abs(prev.t - r.t) < 60_000) prev.n++;
    else grouped.push({ ...r, n: 1 });
  }
  return (
    <Panel
      title="Activity log"
      id="log"
      meta={
        <button className="btn-ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide log" : "Show log"}
        </button>
      }
    >
      {!open ? (
        <p className="muted">The raw log from the logs table, with each Started/Ended pair folded into one line.</p>
      ) : !roster.data || logs.some((q) => q.isLoading) ? (
        <Loading rows={6} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Trader</th>
                <th scope="col">Kind</th>
                <th scope="col">What happened</th>
              </tr>
            </thead>
            <tbody>
              {grouped.slice(0, 60).map((r, i) => (
                <tr key={i}>
                  <td className="tnum muted">{stamp(r.t)}</td>
                  <td>
                    <TraderName name={r.trader} />
                  </td>
                  <td className="muted">
                    {r.type}
                    {r.n > 1 && <span className="num"> ×{r.n}</span>}
                  </td>
                  <td>{r.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
