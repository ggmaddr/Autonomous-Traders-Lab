// A run's saved SDK spans as a trace waterfall, the way Jaeger draws one: one
// lane per kind of step (the model thinking, research, data lookups, memory,
// orders), each bar at its real offset and duration in the run. A memory read
// that should have come before the first order but did not is drawn dashed.
// Decisions and the Lab's trial sheet both use it; replay walks the bars in
// the order they started, one highlighted at a time.

import { useEffect, useMemo, useState } from "react";
import type { TimelineSpan } from "../api";
import { Swimlane, useReducedMotion, type Lane, type LaneBar } from "../charts";
import { elapsed, time } from "../lib/format";

export const ORDER_TOOLS = new Set(["buy_shares", "sell_shares"]);
const MEMORY_READ = new Set(["search_nodes", "read_graph", "open_nodes"]);
const MEMORY_WRITE = new Set([
  "create_entities",
  "create_relations",
  "add_observations",
  "delete_entities",
  "delete_observations",
  "delete_relations",
]);
const ACCOUNT = new Set(["get_balance", "get_holdings"]);
const DATA = new Set(["call_api", "search_endpoints", "query_data", "lookup_share_price", "get_share_price", "lookup"]);
const NOTIFY = new Set(["push", "change_strategy"]);
const SEARCH = new Set(["tavily_search", "fetch", "search"]);
const SUBAGENTS = new Set(["Researcher", "Synthesizer"]);

export const TRACE_KINDS = {
  think: { label: "model thinking", color: "var(--control)" },
  research: { label: "research", color: "var(--t-jinbe)" },
  search: { label: "web search / fetch", color: "color-mix(in srgb, var(--t-jinbe) 55%, var(--surface))" },
  quant: { label: "quant tools", color: "var(--t-law)" },
  data: { label: "data lookups", color: "var(--muted)" },
  memory: { label: "memory", color: "var(--t-robin)" },
  account: { label: "account", color: "var(--faint)" },
  order: { label: "order", color: "var(--accent-data)" },
  other: { label: "notify", color: "var(--cash)" },
};

export interface TraceStep {
  id: string;
  lane: string;
  start: number;
  end: number;
  label: string;
  missing?: boolean;
  failed?: boolean;
}

export interface Trace {
  lanes: Lane[];
  total: number;
  steps: TraceStep[]; // every bar except thinking, in start order (the replay)
  firstOrder: number | null;
  researchEnd: number | null;
  memoryReadBeforeOrder: boolean;
  thinkMs: number;
  failedOrders: number;
  orders: number;
}

/** Turn a run's timeline into lanes. */
export function buildTrace(spans: TimelineSpan[], focus?: { side: string; symbol: string } | null): Trace {
  const all = spans
    .filter((s) => s.offset_ms !== null)
    .map((s) => ({ ...s, a: s.offset_ms ?? 0, b: (s.offset_ms ?? 0) + (s.duration_ms ?? 0) }));
  const total = Math.max(1, ...all.map((s) => s.b));
  const subs = all.filter((s) => s.type === "function" && SUBAGENTS.has(s.name));
  const inside = (s: (typeof all)[number]) => subs.find((r) => r !== s && s.depth > r.depth && s.a >= r.a && s.b <= r.b + 1);

  const lanes: Record<string, { label: string; sub: string; bars: LaneBar[] }> = {};
  const steps: TraceStep[] = [];
  const add = (lane: string, label: string, bar: LaneBar, stepLabel?: string) => {
    lanes[lane] ??= { label, sub: "", bars: [] };
    lanes[lane].bars.push(bar);
    if (stepLabel)
      steps.push({ id: bar.id!, lane, start: bar.start, end: bar.end, label: stepLabel, missing: bar.missing, failed: bar.failed });
  };

  let thinkMs = 0;
  let researchEnd: number | null = null;
  const orderSpans: (typeof all)[number][] = [];
  const memoryReads: number[] = [];
  all.forEach((s, i) => {
    const id = `s${i}`;
    const tip = (
      <>
        <p className="kit-tip-head">{s.type === "generation" ? "Model call" : s.name}</p>
        <p className="num">
          +{elapsed(s.a)} · {elapsed(s.b - s.a)}
        </p>
        {s.error && (
          <p className="money-tone" data-tone="bad">
            {s.error.message ?? "Failed"}
          </p>
        )}
      </>
    );
    const parent = inside(s);
    if (s.type === "generation") {
      if (parent) return; // the sub-agent's own model calls sit inside its research bar
      thinkMs += s.b - s.a;
      add("think", "Thinking", { id, start: s.a, end: s.b, kind: "think", tip });
      return;
    }
    if (s.type !== "function") return;
    const n = s.name;
    if (SUBAGENTS.has(n)) {
      researchEnd = Math.max(researchEnd ?? 0, s.b);
      add(
        n === "Synthesizer" ? "synth" : "research",
        n === "Synthesizer" ? "Synthesizer" : "Research",
        { id, start: s.a, end: s.b, kind: "research", failed: !!s.error, tip },
        `${n} · ${elapsed(s.b - s.a)}`,
      );
    } else if (parent && SEARCH.has(n)) {
      add(
        parent.name === "Synthesizer" ? "synth" : "research",
        parent.name === "Synthesizer" ? "Synthesizer" : "Research",
        { id, start: s.a, end: s.b, kind: "search", row: 1, tip },
        `${parent.name} searches · ${n}`,
      );
    } else if (parent) {
      add(parent.name === "Synthesizer" ? "synth" : "research", parent.name, { id, start: s.a, end: s.b, kind: "quant", row: 1, tip });
    } else if (ORDER_TOOLS.has(n)) {
      orderSpans.push(s);
      add(
        "order",
        "Orders",
        { id, start: s.a, end: s.b, kind: "order", failed: !!s.error, tip },
        `${n === "buy_shares" ? "Buy" : "Sell"} order${s.error ? " · failed" : ""}`,
      );
    } else if (MEMORY_READ.has(n) || MEMORY_WRITE.has(n)) {
      if (MEMORY_READ.has(n)) memoryReads.push(s.a);
      add(
        "memory",
        "Memory",
        { id, start: s.a, end: s.b, kind: "memory", row: MEMORY_READ.has(n) ? 0 : 1, tip },
        `Memory ${MEMORY_READ.has(n) ? "read" : "write"} · ${n}`,
      );
    } else if (ACCOUNT.has(n)) {
      add("account", "Account", { id, start: s.a, end: s.b, kind: "account", tip }, `Account · ${n}`);
    } else if (DATA.has(n)) {
      add("data", "Price lookups", { id, start: s.a, end: s.b, kind: "data", failed: !!s.error, tip }, `Data lookup · ${n}`);
    } else if (NOTIFY.has(n)) {
      add("other", "Notify", { id, start: s.a, end: s.b, kind: "other", tip }, n === "push" ? "Push notification" : n);
    } else {
      add("quant", "Quant tools", { id, start: s.a, end: s.b, kind: "quant", failed: !!s.error, tip }, `Quant · ${n}`);
    }
  });

  const firstOrder = orderSpans.length ? Math.min(...orderSpans.map((s) => s.a)) : null;
  const memoryReadBeforeOrder = firstOrder !== null && memoryReads.some((a) => a < firstOrder);
  if (firstOrder !== null && !memoryReadBeforeOrder) {
    const end = firstOrder;
    const start = Math.max(0, end - total * 0.08);
    add(
      "memory",
      "Memory",
      {
        id: "missing-memory",
        start,
        end,
        kind: "memory",
        missing: true,
        note: "no read before the first order",
        tip: <p>No memory read before the first order</p>,
      },
      "Memory read expected before ordering · none",
    );
  }

  // Mark this fill's order.
  if (focus && lanes.order) {
    const want = focus.side === "buy" ? "Buy" : "Sell";
    const match = steps.find((s) => s.lane === "order" && s.label.startsWith(want) && !s.failed);
    const bar = match && lanes.order.bars.find((b) => b.id === match.id);
    if (bar) bar.note = `${focus.side} ${focus.symbol}`;
  }

  const count = (lane: string) => lanes[lane]?.bars.filter((b) => !b.missing && (b.row ?? 0) === 0).length ?? 0;
  const subs_: Record<string, string> = {
    think: `${count("think")} model calls · ${elapsed(thinkMs)}`,
    research: `${count("research")} requests · ${lanes.research?.bars.filter((b) => b.kind === "search").length ?? 0} searches`,
    synth: `${count("synth")} thesis`,
    quant: `${lanes.quant?.bars.length ?? 0} calls`,
    data: `${lanes.data?.bars.length ?? 0} calls`,
    memory: memoryReads.length
      ? `${memoryReads.length} reads · ${(lanes.memory?.bars.length ?? 0) - memoryReads.length - (memoryReadBeforeOrder || firstOrder === null ? 0 : 1)} writes`
      : "no reads",
    account: `${lanes.account?.bars.length ?? 0} reads`,
    order: `${orderSpans.length} tried${orderSpans.some((s) => s.error) ? ` · ${orderSpans.filter((s) => s.error).length} failed` : ""}`,
    other: `${lanes.other?.bars.length ?? 0}`,
  };
  const order = ["think", "research", "synth", "quant", "data", "account", "memory", "order", "other"];
  return {
    lanes: order
      .filter((k) => lanes[k])
      .map((k) => ({
        id: k,
        label: lanes[k].label,
        sub: subs_[k],
        bars: lanes[k].bars,
        rows: Math.max(1, ...lanes[k].bars.map((b) => (b.row ?? 0) + 1)),
      })),
    total,
    steps: steps.sort((a, b) => a.start - b.start),
    firstOrder,
    researchEnd,
    memoryReadBeforeOrder,
    thinkMs,
    failedOrders: orderSpans.filter((s) => s.error).length,
    orders: orderSpans.length,
  };
}

/** Tick labels: clock time for long runs, minutes:seconds from the start for short ones. */
export function traceFormat(total: number, startedAt: string | null): (v: number) => string {
  const t0 = startedAt ? new Date(startedAt).getTime() : null;
  if (t0 && total > 10 * 60_000) return (v) => time(t0 + v);
  return (v) => {
    const s = Math.round(v / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
}

export function RunTrace(props: {
  spans: TimelineSpan[];
  startedAt: string | null;
  focus?: { side: string; symbol: string } | null;
  highlight?: string | null;
}) {
  const trace = useMemo(() => buildTrace(props.spans, props.focus), [props.spans, props.focus]);
  if (!trace.lanes.length) return <p className="muted">No spans saved for this run.</p>;
  return (
    <Swimlane
      lanes={trace.lanes}
      kinds={Object.fromEntries(Object.entries(TRACE_KINDS).filter(([k]) => trace.lanes.some((l) => l.bars.some((b) => b.kind === k))))}
      domain={[0, trace.total]}
      format={traceFormat(trace.total, props.startedAt)}
      label="Run trace: each step of the run on a time axis"
      highlight={props.highlight}
    />
  );
}

/** Step through a trace's bars one at a time. */
export function useReplay(steps: TraceStep[]) {
  const reduced = useReducedMotion();
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (at === null) return;
    if (at >= steps.length) {
      const t = setTimeout(() => setAt(null), 1600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setAt((i) => (i === null ? null : i + 1)), reduced ? 1800 : 1200);
    return () => clearTimeout(t);
  }, [at, steps.length, reduced]);
  return {
    step: at !== null && at < steps.length ? steps[at] : null,
    index: at,
    playing: at !== null,
    toggle: () => setAt((i) => (i === null ? 0 : null)),
  };
}
