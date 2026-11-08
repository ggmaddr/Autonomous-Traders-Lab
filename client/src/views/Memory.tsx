// Memory: what does each agent's long-term memory contain? The knowledge graph its
// researcher keeps in memory/<name>.db (entities, relations, observations), drawn
// with Cytoscape, beside the selected node: its observations with when each was
// written, its relations, and the runs whose memory reads returned it, with their
// fills. A node list under the graph is the keyboard and screen-reader way in. Filter
// by when things were written; compare two traders side by side.

import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import * as d3 from "d3";
import { ChartBox, Tip, useSize, useTip } from "../charts";
import cytoscape, { type Core } from "cytoscape";
import { getMemory, getMemoryNode, type MemoryGraph, type MemoryNode } from "../api";
import { Change, Failed, Loading, PageHeader, Panel, TraderName } from "../components/bits";
import { useDesk, type Desk } from "../lib/desk";
import { fillPnl } from "../lib/research";
import { cssColor, hue, hueVar } from "../lib/traders";
import { useTheme } from "../lib/theme";
import { count, longDate, parseIso, stamp, time } from "../lib/format";

const MEMORY_POLL_MS = 30_000;
const DAY = 86_400_000;
const WINDOWS = [
  { id: "all", label: "All time", ms: Infinity },
  { id: "30d", label: "30 days", ms: 30 * DAY },
  { id: "7d", label: "7 days", ms: 7 * DAY },
  { id: "1d", label: "24 hours", ms: DAY },
];
const FIT_ZOOM = 1.25;
const TRADERS = ["robin", "nami", "jinbe", "law", "luffy"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** Shape by kind, so the kind does not rest on colour alone. */
function shapeOf(node: MemoryNode): string {
  if (node.type === "Lesson") return "round-rectangle";
  if (node.type === "Pattern") return "diamond";
  return "ellipse";
}

/** The last time anything was written to a node: its creation or its newest observation. */
function writtenAt(node: MemoryNode): number | null {
  const times = [node.created_at, ...node.observations.map((o) => o.created_at)].map(parseIso).filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

interface Shown {
  nodes: MemoryNode[];
  edges: MemoryGraph["edges"];
  observations: number;
}

/** The graph as written within the window: nodes created or added to in it, the
 *  relations made in it, and the nodes those relations join. */
function within(graph: MemoryGraph, windowMs: number, now: number): Shown {
  if (windowMs === Infinity) {
    return { nodes: graph.nodes, edges: graph.edges, observations: graph.nodes.reduce((s, n) => s + n.observations.length, 0) };
  }
  const since = now - windowMs;
  const recent = (s: string | null) => (parseIso(s) ?? 0) >= since;
  const edges = graph.edges.filter((e) => recent(e.created_at));
  const keep = new Set(graph.nodes.filter((n) => (writtenAt(n) ?? 0) >= since).map((n) => n.name));
  edges.forEach((e) => (keep.add(e.source), keep.add(e.target)));
  const nodes = graph.nodes.filter((n) => keep.has(n.name));
  return { nodes, edges, observations: nodes.reduce((s, n) => s + n.observations.filter((o) => recent(o.created_at)).length, 0) };
}

export function Memory() {
  const [params, setParams] = useSearchParams();
  const trader = params.get("trader") ?? "robin";
  const compare = params.get("compare");
  const windowId = params.get("window") ?? "all";
  const win = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[0];
  const selectedNode = params.get("node");
  const selectedOf = params.get("of") ?? trader;
  const { desk } = useDesk();

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
    setParams(next);
  };
  const select = (of: string, node: string) => set({ node, of: of === trader ? null : of });

  const left = useQuery({ queryKey: ["memory", trader], queryFn: () => getMemory(trader), refetchInterval: MEMORY_POLL_MS });
  const right = useQuery({
    queryKey: ["memory", compare],
    queryFn: () => getMemory(compare!),
    enabled: !!compare,
    refetchInterval: MEMORY_POLL_MS,
  });
  const now = left.dataUpdatedAt || Date.now();
  const shownLeft = useMemo(() => left.data && within(left.data, win.ms, now), [left.data, win.ms, now]);
  const shownRight = useMemo(() => right.data && within(right.data, win.ms, now), [right.data, win.ms, now]);

  return (
    <div className="view">
      <PageHeader
        kicker={`Each researcher's knowledge graph · ${longDate(Date.now())}`}
        title="Memory"
        finding={<Finding trader={trader} left={shownLeft} graph={left.data} compare={compare} right={shownRight} win={win.label} />}
        aside={left.dataUpdatedAt > 0 && <p className="fresh num">Updated {time(left.dataUpdatedAt)} · every 30 s</p>}
      />
      <div className="filter-row">
        <div className="segmented filter" role="group" aria-label="Trader">
          {TRADERS.map((n) => (
            <button
              key={n}
              aria-pressed={trader === n}
              onClick={() => set({ trader: n, node: null, of: null, compare: compare === n ? null : compare })}
            >
              <TraderName name={n} />
            </button>
          ))}
        </div>
        <div className="segmented filter" role="group" aria-label="Compare with">
          <button aria-pressed={!compare} onClick={() => set({ compare: null, of: null })}>
            No comparison
          </button>
          {TRADERS.filter((n) => n !== trader).map((n) => (
            <button key={n} aria-pressed={compare === n} onClick={() => set({ compare: n })}>
              <span className="muted">with</span> <TraderName name={n} />
            </button>
          ))}
        </div>
        <div className="segmented filter" role="group" aria-label="Written in">
          {WINDOWS.map((w) => (
            <button key={w.id} aria-pressed={win.id === w.id} onClick={() => set({ window: w.id === "all" ? null : w.id })}>
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {left.error && <Failed what={`${cap(trader)}'s memory`} error={left.error as Error} />}
      <WriteRead current={trader} onPick={(n) => set({ trader: n, node: null, of: null, compare: compare === n ? null : compare })} />
      {!left.data && !left.error && <Loading rows={8} />}
      {left.data && shownLeft && !compare && (
        <>
          <div className="grid-lead rows-start">
            <GraphPanel
              trader={trader}
              graph={left.data}
              shown={shownLeft}
              win={win.label}
              selected={selectedOf === trader ? selectedNode : null}
              onSelect={(n) => select(trader, n)}
            />
            <NodePanel trader={selectedOf} node={selectedNode} desk={desk} />
          </div>
          <NodeList trader={trader} shown={shownLeft} selected={selectedNode} onSelect={(n) => select(trader, n)} />
        </>
      )}
      {left.data && shownLeft && compare && (
        <>
          <div className="grid-halves rows-start">
            <GraphPanel
              trader={trader}
              graph={left.data}
              shown={shownLeft}
              win={win.label}
              selected={selectedOf === trader ? selectedNode : null}
              onSelect={(n) => select(trader, n)}
            />
            {right.error ? (
              <Failed what={`${cap(compare)}'s memory`} error={right.error as Error} />
            ) : right.data && shownRight ? (
              <GraphPanel
                trader={compare}
                graph={right.data}
                shown={shownRight}
                win={win.label}
                selected={selectedOf === compare ? selectedNode : null}
                onSelect={(n) => select(compare, n)}
              />
            ) : (
              <Loading rows={8} />
            )}
          </div>
          {shownRight && <Shared a={trader} b={compare} left={shownLeft} right={shownRight} onSelect={select} />}
          <NodePanel trader={selectedOf} node={selectedNode} desk={desk} />
        </>
      )}
    </div>
  );
}

function Finding(props: { trader: string; graph?: MemoryGraph; left?: Shown; compare: string | null; right?: Shown; win: string }) {
  const { trader, graph, left, compare, right } = props;
  if (!graph || !left) return <>Reading the memory…</>;
  const scope = props.win === "All time" ? "" : ` written in the last ${props.win.toLowerCase()}`;
  const sizeOf = (s: Shown) =>
    `${plural(s.nodes.length, "entity", "entities")}, ${plural(s.edges.length, "relation")} and ${plural(s.observations, "observation")}`;
  if (compare && right) {
    const shared = left.nodes.filter((n) => right.nodes.some((m) => m.name === n.name)).length;
    return (
      <>
        {cap(trader)} holds {sizeOf(left)}; {cap(compare)} holds {sizeOf(right)}
        {scope}. They share {plural(shared, "entity", "entities")} by name.
      </>
    );
  }
  if (!graph.nodes.length) {
    return (
      <>
        {cap(trader)}'s memory is empty: its researcher has not stored anything{graph.exists ? "" : ", and no memory file exists yet"}. The
        lesson review writes here once a traced trade is 3 days old.
      </>
    );
  }
  const lessons = left.nodes.filter((n) => n.type === "Lesson").length;
  return (
    <>
      {cap(trader)}'s memory holds {sizeOf(left)}
      {scope}
      {lessons ? `, ${plural(lessons, "lesson")} among them` : ", and no lessons yet"}. Saved runs read it{" "}
      {graph.reads ? plural(graph.reads, "time") : "no times at all"}.
    </>
  );
}

function GraphPanel(props: {
  trader: string;
  graph: MemoryGraph;
  shown: Shown;
  win: string;
  selected: string | null;
  onSelect: (n: string) => void;
}) {
  const { trader, graph, shown } = props;
  return (
    <Panel
      title={`${cap(trader)}'s graph`}
      id={`graph-${trader}`}
      meta={
        <span className="graph-key">
          <span className="key-shape" data-shape="ellipse" aria-hidden="true" /> Stock or company
          <span className="key-shape" data-shape="lesson" aria-hidden="true" /> Lesson
          <span className="key-shape" data-shape="diamond" aria-hidden="true" /> Pattern
        </span>
      }
    >
      {shown.nodes.length && !shown.edges.length ? (
        <Bubbles trader={trader} shown={shown} selected={props.selected} onSelect={props.onSelect} />
      ) : shown.nodes.length ? (
        <Graph trader={trader} shown={shown} selected={props.selected} onSelect={props.onSelect} />
      ) : (
        <p className="empty graph-empty">
          {graph.nodes.length
            ? `Nothing in ${cap(trader)}'s memory was written in the last ${props.win.toLowerCase()}.`
            : `${cap(trader)}'s memory is empty. Its researcher can store companies and market notes here, and the lesson review adds a lesson 3 days after each traced trade.`}
        </p>
      )}
      <p className="note">
        {shown.nodes.length && !shown.edges.length
          ? "No relations link these entities, so they are drawn as bubbles grouped by kind, sized by observations; small ones are named on hover. "
          : "Size follows the number of observations. A dashed outline is a name a relation points to that was never stored. Drag to move, scroll to zoom; "}
        The node list below works with the keyboard.
      </p>
    </Panel>
  );
}

function Graph({
  trader,
  shown,
  selected,
  onSelect,
}: {
  trader: string;
  shown: Shown;
  selected: string | null;
  onSelect: (n: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const { theme } = useTheme();
  const pick = useRef(onSelect);
  pick.current = onSelect;

  useEffect(() => {
    if (!box.current) return;
    const ink = cssColor("--text");
    const muted = cssColor("--muted");
    const line = cssColor("--control");
    const ground = cssColor("--surface");
    const own = hue(trader);
    const instance = cytoscape({
      container: box.current,
      elements: [
        ...shown.nodes.map((n) => ({
          data: { id: n.name, label: n.name, size: 22 + Math.min(n.observations.length, 12) * 3 },
          classes: [shapeOf(n), n.type ? "" : "missing", n.type === "Lesson" ? "lesson" : ""].join(" "),
        })),
        ...shown.edges.map((e) => ({ data: { id: `e${e.id}`, source: e.source, target: e.target, label: e.type } })),
      ],
      style: [
        {
          selector: "node",
          style: {
            shape: "ellipse",
            width: "data(size)",
            height: "data(size)",
            "background-color": own,
            "background-opacity": 0.28,
            "border-width": 2,
            "border-color": own,
            label: "data(label)",
            color: ink,
            "font-family": cssColor("--font") || "system-ui",
            "font-size": 12,
            "font-weight": 500,
            "text-valign": "bottom",
            "text-margin-y": 5,
            "text-max-width": "140px",
            "text-wrap": "ellipsis",
          },
        },
        { selector: "node.round-rectangle", style: { shape: "round-rectangle", "background-opacity": 1 } },
        { selector: "node.diamond", style: { shape: "diamond" } },
        { selector: "node.missing", style: { "border-style": "dashed", "border-color": muted, "background-opacity": 0 } },
        { selector: "node:selected", style: { "border-width": 4, "border-color": ink } },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": line,
            "target-arrow-color": line,
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": 11,
            color: muted,
            "text-rotation": "autorotate",
            "text-background-color": ground,
            "text-background-opacity": 1,
            "text-background-padding": "2px",
          },
        },
      ],
      layout: {
        name: shown.nodes.length > 1 ? "cose" : "grid",
        animate: false,
        padding: 30,
        nodeRepulsion: () => 24000,
        idealEdgeLength: () => 110,
      } as cytoscape.LayoutOptions,
      minZoom: 0.3,
      maxZoom: 3,
      wheelSensitivity: 0.3,
      selectionType: "single",
    });
    // A sparse graph fits by zooming in until two nodes fill the frame; keep it at reading size.
    if (instance.zoom() > FIT_ZOOM) {
      instance.zoom(FIT_ZOOM);
      instance.center();
    }
    instance.on("tap", "node", (e) => pick.current(e.target.id()));
    cy.current = instance;
    return () => instance.destroy();
  }, [trader, shown, theme]);

  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    c.nodes().unselect();
    if (selected) c.getElementById(selected).select();
  }, [selected, shown, theme]);

  return (
    <div
      ref={box}
      className="graph-canvas"
      role="img"
      aria-label={`${cap(trader)}'s memory graph: ${plural(shown.nodes.length, "node")}, ${plural(shown.edges.length, "relation")}. The node list below has the same contents.`}
    />
  );
}

function NodeList({
  trader,
  shown,
  selected,
  onSelect,
}: {
  trader: string;
  shown: Shown;
  selected: string | null;
  onSelect: (n: string) => void;
}) {
  const degree = (name: string) => shown.edges.filter((e) => e.source === name || e.target === name).length;
  const rows = [...shown.nodes].sort((a, b) => (writtenAt(b) ?? 0) - (writtenAt(a) ?? 0));
  return (
    <Panel title="Every node" id="nodes" meta={<span className="num">{count(rows.length)}, last written first</span>}>
      {rows.length ? (
        <div className="table-wrap">
          <table className="table blotter">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Kind</th>
                <th scope="col" className="num">
                  Observations
                </th>
                <th scope="col" className="num">
                  Relations
                </th>
                <th scope="col" className="num">
                  Last written
                </th>
                <th scope="col" className="num">
                  Read by runs
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const at = writtenAt(n);
                return (
                  <tr
                    key={n.name}
                    aria-selected={n.name === selected}
                    tabIndex={0}
                    onClick={() => onSelect(n.name)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(n.name))}
                  >
                    <td className="ident">{n.name}</td>
                    <td className="muted">{n.type ?? "Not stored"}</td>
                    <td className="num">{count(n.observations.length)}</td>
                    <td className="num">{count(degree(n.name))}</td>
                    <td className="num muted">{at ? stamp(at) : "—"}</td>
                    <td className="num">{count(n.used)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">No nodes to list for {cap(trader)}.</p>
      )}
    </Panel>
  );
}

function Shared({
  a,
  b,
  left,
  right,
  onSelect,
}: {
  a: string;
  b: string;
  left: Shown;
  right: Shown;
  onSelect: (of: string, n: string) => void;
}) {
  const names = new Set(right.nodes.map((n) => n.name));
  const both = left.nodes.filter((n) => names.has(n.name));
  return (
    <Panel title="In both memories" id="shared" meta={<span className="num">{count(both.length)} shared by name</span>}>
      {both.length ? (
        <ul className="shared-list">
          {both.map((n) => (
            <li key={n.name}>
              <span className="ident strong">{n.name}</span>
              <button className="text-link btn-link" onClick={() => onSelect(a, n.name)}>
                {cap(a)}'s {plural(n.observations.length, "note")}
              </button>
              <button className="text-link btn-link" onClick={() => onSelect(b, n.name)}>
                {cap(b)}'s {plural(right.nodes.find((m) => m.name === n.name)!.observations.length, "note")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">
          {cap(a)} and {cap(b)} share no entity by name. Each researcher keeps its own graph, so what one learns the other does not see.
        </p>
      )}
    </Panel>
  );
}

function NodePanel({ trader, node, desk }: { trader: string; node: string | null; desk: Desk | null }) {
  const detail = useQuery({
    queryKey: ["memory-node", trader, node],
    queryFn: () => getMemoryNode(trader, node!),
    enabled: !!node,
    staleTime: 15_000,
  });
  if (!node) {
    return (
      <Panel title="Selected node" id="node">
        <p className="empty">Pick a node in the graph or the list to see its observations and the runs that read it.</p>
      </Panel>
    );
  }
  const d = detail.data;
  return (
    <Panel title={node} id="node" className="sticky" meta={<TraderName name={trader} />}>
      {detail.error ? (
        <Failed what={`the node ${node}`} error={detail.error as Error} />
      ) : !d ? (
        <Loading rows={4} />
      ) : (
        <div className="stack node-detail">
          <p className="muted">
            {d.type ?? "Named by a relation, never stored"}
            {d.created_at && (
              <>
                {" · created "}
                <span className="num">{stamp(parseIso(d.created_at)!)}</span>
              </>
            )}
            {d.lesson && (
              <>
                {" · "}
                <span className="tag" data-tone={d.lesson.kind === "success" ? "good" : "bad"}>
                  {d.lesson.kind === "success" ? "Success" : "Mistake"}
                </span>{" "}
                <Link className="text-link" to={`/lessons?trader=${trader}&lesson=${d.lesson.id}#lesson-${d.lesson.id}`}>
                  Open in Lessons
                </Link>
              </>
            )}
          </p>
          <section aria-labelledby="obs-head">
            <h3 className="sub-head" id="obs-head">
              Observations <span className="muted num">{count(d.observations.length)}</span>
            </h3>
            {d.observations.length ? (
              <ol className="observations">
                {d.observations.map((o) => (
                  <li key={o.id}>
                    <span className="num muted">{o.created_at ? stamp(parseIso(o.created_at)!) : "—"}</span>
                    <span>{o.content}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">None stored.</p>
            )}
          </section>
          <section aria-labelledby="rel-head">
            <h3 className="sub-head" id="rel-head">
              Relations <span className="muted num">{count(d.edges.length)}</span>
            </h3>
            {d.edges.length ? (
              <ul className="relations">
                {d.edges.map((e) => (
                  <li key={e.id}>
                    <span className={e.source === node ? "muted" : "ident strong"}>{e.source}</span>
                    <span className="muted">{e.type} →</span>
                    <span className={e.target === node ? "muted" : "ident strong"}>{e.target}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None.</p>
            )}
          </section>
          <section aria-labelledby="use-head">
            <h3 className="sub-head" id="use-head">
              Runs that read it <span className="muted num">{count(new Set(d.uses.map((u) => u.trace_id)).size)}</span>
            </h3>
            {d.uses.length ? (
              <ul className="uses">
                {d.uses.map((u) => (
                  <li key={u.span_id}>
                    <p>
                      <span className="num">{u.at ? stamp(parseIso(u.at)!) : "—"}</span>{" "}
                      <span className="muted">
                        {u.tool}
                        {u.query ? ` "${u.query}"` : ""} ·{" "}
                        {u.mode === "trade" ? "trading run" : u.mode === "rebalance" ? "rebalancing run" : "run"} ·{" "}
                        {!u.run_had_orders ? "no orders followed" : u.before_order ? "before its first order" : "after it had traded"}
                      </span>
                    </p>
                    {u.fill_ids.length > 0 && (
                      <p className="note">
                        Filled:{" "}
                        {u.fill_ids.map((id, i) => {
                          const fill = desk?.fills.find((f) => f.id === id);
                          const pnl = desk && fill ? fillPnl(desk, fill) : null;
                          return (
                            <span key={id}>
                              {i > 0 && ", "}
                              <Link className="text-link" to={`/decisions?fill=${id}`}>
                                {fill ? `${fill.side} ${fill.symbol}` : id}
                              </Link>
                              {pnl !== null && (
                                <>
                                  {" "}
                                  <Change value={pnl} />
                                </>
                              )}
                            </span>
                          );
                        })}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                No saved run has read it yet. A read counts when a memory search or graph read returns this node inside a trader's run.
              </p>
            )}
          </section>
        </div>
      )}
    </Panel>
  );
}

/** Written against read, per trader: what each researcher stored, and how often a saved run read it back. */
function WriteRead({ current, onPick }: { current: string; onPick: (n: string) => void }) {
  const graphs = useQueries({
    queries: TRADERS.map((n) => ({ queryKey: ["memory", n], queryFn: () => getMemory(n), refetchInterval: MEMORY_POLL_MS })),
  });
  if (graphs.some((g) => g.isLoading)) return null;
  const rows = TRADERS.map((n, i) => {
    const g = graphs[i].data;
    return {
      n,
      written: g ? g.nodes.reduce((s, x) => s + x.observations.length, 0) : 0,
      entities: g?.nodes.length ?? 0,
      reads: g?.reads ?? 0,
    };
  });
  const max = Math.max(1, ...rows.map((r) => Math.max(r.written, r.reads)));
  const written = rows.reduce((s, r) => s + r.written, 0);
  const reads = rows.reduce((s, r) => s + r.reads, 0);
  return (
    <Panel
      title={reads ? "Written, and read back" : "Written, never read"}
      id="write-read"
      className={reads ? "" : "panel-alert"}
      meta={
        <span className="num">
          {count(written)} observations written · {count(reads)} runs read
        </span>
      }
    >
      <div className="wr">
        {rows.map((r) => (
          <button key={r.n} className="wr-row" aria-pressed={r.n === current} onClick={() => onPick(r.n)}>
            <span className="wr-name">
              <TraderName name={r.n} />
            </span>
            <span className="wr-bars">
              <span className="wr-line">
                <span className="wr-bar" style={{ width: `${(r.written / max) * 100}%`, background: hueVar(r.n) }} />
                <span className="num wr-val">{plural(r.written, "observation")}</span>
              </span>
              <span className="wr-line">
                {r.reads ? (
                  <span className="wr-bar" style={{ width: `${(r.reads / max) * 100}%`, background: "var(--text)" }} />
                ) : (
                  <span className="wr-bar wr-none" />
                )}
                <span className="num wr-val" data-tone={r.reads ? undefined : "bad"}>
                  read {r.reads ? plural(r.reads, "time") : "0 times"}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className="note">
        Top bar: observations each researcher stored. Bottom bar: saved runs whose memory reads returned something. An empty bottom bar
        means the traders write memory but never use it.
      </p>
    </Panel>
  );
}

const KIND_ORDER = ["Stock or company", "Lesson", "Pattern", "Unstored"];
const kindOf = (n: MemoryNode) =>
  n.type === "Lesson" ? "Lesson" : n.type === "Pattern" ? "Pattern" : n.type ? "Stock or company" : "Unstored";

/** With no relations a force layout collapses into a grid; pack the entities by kind instead. */
function Bubbles({
  trader,
  shown,
  selected,
  onSelect,
}: {
  trader: string;
  shown: Shown;
  selected: string | null;
  onSelect: (n: string) => void;
}) {
  const [ref, width] = useSize<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const height = Math.max(260, Math.min(440, width * 0.62));
  type Leaf = { name: string; value?: number; node?: MemoryNode; children?: Leaf[] };
  const groups = KIND_ORDER.map((k) => ({
    name: k,
    children: shown.nodes.filter((n) => kindOf(n) === k).map((n) => ({ name: n.name, node: n, value: 1 + n.observations.length })),
  })).filter((g) => g.children.length);
  const root = d3
    .hierarchy<Leaf>({ name: "root", children: groups })
    .sum((d) => d.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const packed = d3
    .pack<Leaf>()
    .size([Math.max(1, width), height])
    .padding((d) => (d.depth === 0 ? 14 : 4))(root);
  return (
    <ChartBox boxRef={ref} className="bubbles">
      {width > 0 && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          role="img"
          aria-label={`${cap(trader)}'s ${shown.nodes.length} memory entities as bubbles by kind`}
          onPointerLeave={hide}
        >
          {packed.children?.map((g) => (
            <g key={g.data.name}>
              {groups.length > 1 && <circle cx={g.x} cy={g.y} r={g.r} className="bubble-group" />}
              {groups.length > 1 && (
                <text x={g.x} y={g.y - g.r + 14} textAnchor="middle" className="bubble-kind">
                  {g.data.name}
                </text>
              )}
              {g.children?.map((leaf) => {
                const n = leaf.data.node!;
                const big = leaf.r > 18;
                return (
                  <g
                    key={n.name}
                    className="bubble"
                    data-selected={selected === n.name || undefined}
                    tabIndex={0}
                    role="button"
                    aria-label={`${n.name}, ${plural(n.observations.length, "observation")}`}
                    onClick={() => onSelect(n.name)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(n.name))}
                    onPointerEnter={() =>
                      show(
                        leaf.x,
                        leaf.y - leaf.r,
                        <>
                          <p className="strong">{n.name}</p>
                          <p className="muted">
                            {kindOf(n)} · {plural(n.observations.length, "observation")}
                            {n.used ? ` · read by ${plural(n.used, "run")}` : " · never read"}
                          </p>
                        </>,
                      )
                    }
                    onPointerLeave={hide}
                  >
                    <circle
                      cx={leaf.x}
                      cy={leaf.y}
                      r={leaf.r}
                      style={{
                        stroke: hueVar(trader),
                        fill: n.type ? `color-mix(in srgb, ${hueVar(trader)} 22%, var(--surface))` : "none",
                      }}
                      strokeDasharray={n.type ? undefined : "3 3"}
                    />
                    {big && (
                      <text x={leaf.x} y={leaf.y + 4} textAnchor="middle" className="bubble-label">
                        {n.name.length > leaf.r / 3.6 ? n.name.slice(0, Math.max(2, Math.floor(leaf.r / 3.6) - 1)) + "…" : n.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      )}
      <Tip tip={tip} width={width} />
    </ChartBox>
  );
}
