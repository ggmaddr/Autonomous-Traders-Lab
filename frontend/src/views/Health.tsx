// Health: is the infrastructure OK? The full view is not scheduled yet; until it
// is, this shows what exists today, the agents' activity log from the logs table.

import { useQueries, useQuery } from "@tanstack/react-query";
import { getTraderLogs, getTraders } from "../api";
import { Failed, Loading, PageHeader, Panel, TraderName } from "../components/bits";
import { NAV } from "../nav";
import { parseStamp, stamp } from "../lib/format";

const LOG_POLL_MS = 4000;

export function Health() {
  const item = NAV.flatMap((g) => g.items).find((i) => i.path === "/health")!;
  const roster = useQuery({ queryKey: ["traders"], queryFn: getTraders, staleTime: Infinity });
  const logs = useQueries({
    queries: (roster.data ?? []).map((t) => ({
      queryKey: ["logs", t.name],
      queryFn: () => getTraderLogs(t.name, 20),
      refetchInterval: LOG_POLL_MS,
    })),
  });
  const rows = logs
    .flatMap((q, i) => (q.data ?? []).map((r) => ({ ...r, trader: roster.data![i].name.toLowerCase() })))
    // Log times are SQLite UTC (D9); mark them as UTC so they show in local time.
    .map((r) => ({ ...r, t: parseStamp(r.datetime + "Z") }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 40);
  const error = roster.error ?? logs.find((q) => q.error)?.error ?? null;

  return (
    <div className="view">
      <PageHeader kicker="Not scheduled yet" title="Health" finding={item.question} />
      <div className="grid-lead list-detail">
        <Panel title="Agent activity" id="activity" meta={<span className="num">Last {rows.length} lines</span>}>
          {error && !rows.length ? (
            <Failed what="the activity log" error={error as Error} />
          ) : !roster.data ? (
            <Loading rows={6} />
          ) : rows.length ? (
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
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="tnum muted">{stamp(r.t)}</td>
                      <td>
                        <TraderName name={r.trader} />
                      </td>
                      <td className="muted">{r.type}</td>
                      <td>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">No activity logged yet. Start the traders with uv run -m backend.trading_floor.</p>
          )}
        </Panel>
        <Panel title="What this view will show" id="shows">
          <ul className="coming-list">
            {item.shows?.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
