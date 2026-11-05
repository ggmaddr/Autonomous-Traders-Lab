// Lessons: what have the agents learned, and is it still true? Every lesson the
// post-cycle review wrote (backend/review.py), newest first, with its verdict, the
// return it was judged on against SPY, how often the same lesson recurs, whether a
// later one contradicted it, and whether the trader recalled it before trading. Each
// links to its fills on Decisions, with their P&L from the same ledger as Money.

import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getLessons, type Lesson, type LessonsPayload, type PendingReview } from "../api";
import { Change, Failed, Loading, PageHeader, Panel, Ratio, TraderName } from "../components/bits";
import { useDesk, type Desk } from "../lib/desk";
import { fillPnl } from "../lib/research";
import { count, longDate, parseIso, shortDay, stamp, time } from "../lib/format";

const LESSONS_POLL_MS = 30_000;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export function Lessons() {
  const [params, setParams] = useSearchParams();
  const trader = params.get("trader");
  const focus = Number(params.get("lesson")) || null;
  const lessons = useQuery({
    queryKey: ["lessons", trader],
    queryFn: () => getLessons(trader),
    refetchInterval: LESSONS_POLL_MS,
  });
  const { desk } = useDesk();
  const setTrader = (t: string | null) => setParams(t ? { trader: t } : {});

  return (
    <div className="view">
      <PageHeader
        kicker={`Written by the review after each cycle · ${longDate(Date.now())}`}
        title="Lessons"
        finding={<Finding data={lessons.data} trader={trader} />}
        aside={lessons.dataUpdatedAt > 0 && <p className="fresh num">Updated {time(lessons.dataUpdatedAt)} · every 30 s</p>}
      />
      {desk && (
        <div className="segmented filter" role="group" aria-label="Trader">
          <button aria-pressed={!trader} onClick={() => setTrader(null)}>
            Whole desk
          </button>
          {desk.books.map((b) => {
            const n = b.trader.name.toLowerCase();
            return (
              <button key={n} aria-pressed={trader === n} onClick={() => setTrader(n)}>
                <TraderName name={n} />
              </button>
            );
          })}
        </div>
      )}
      {lessons.error && <Failed what="the lessons" error={lessons.error as Error} />}
      {!lessons.data && !lessons.error && <Loading rows={6} />}
      {lessons.data && (
        <div className="grid-lead list-detail">
          <Panel
            title="What they learned"
            id="lessons"
            meta={<span className="num">{lessons.data.lessons.length ? `${count(lessons.data.lessons.length)}, newest first` : "none yet"}</span>}
          >
            {lessons.data.lessons.length ? (
              <ol className="lesson-list">
                {lessons.data.lessons.map((l) => (
                  <LessonRow key={l.id} lesson={l} all={lessons.data.lessons} desk={desk} focused={l.id === focus} />
                ))}
              </ol>
            ) : (
              <NoLessons data={lessons.data} trader={trader} />
            )}
          </Panel>
          <div className="stack">
            <Panel title="By trader" id="by-trader">
              <ByTrader lessons={lessons.data.lessons} traders={desk?.books.map((b) => b.trader.name.toLowerCase()) ?? []} trader={trader} />
            </Panel>
            <Panel
              title="Waiting for review"
              id="pending"
              meta={<span className="num">{lessons.data.horizons.map((h) => `${h} d`).join(" and ")} after the trade</span>}
            >
              <Pending pending={lessons.data.pending} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function Finding({ data, trader }: { data?: LessonsPayload; trader: string | null }) {
  if (!data) return <>Reading the lessons…</>;
  const who = trader ? cap(trader) : "The desk";
  const { lessons, pending } = data;
  if (!lessons.length) {
    const next = pending[0];
    return next ? (
      <>
        No lessons yet: a trade is reviewed {data.horizons[0]} days after it fills. The first due is {cap(next.trader)}'s{" "}
        {next.symbol} {next.side}, on <span className="num">{shortDay(parseIso(next.due_at)!)}</span>.
      </>
    ) : (
      <>No lessons yet, and no traced trades waiting for review. Lessons start {data.horizons[0]} days after the first traced fill.</>
    );
  }
  const mistakes = lessons.filter((l) => l.kind === "mistake").length;
  const contradicted = lessons.filter((l) => l.contradicted_by !== null).length;
  const recalled = lessons.filter((l) => l.recalled_count > 0).length;
  return (
    <>
      {who} has {plural(lessons.length, "lesson")}: {count(lessons.length - mistakes)} from successes, {count(mistakes)} from
      mistakes. {contradicted ? `${count(contradicted)} no longer hold; a later trade pointed the other way. ` : ""}
      {recalled
        ? `${plural(recalled, "lesson was", "lessons were")} recalled before trading.`
        : "None has been recalled before a trade yet."}
    </>
  );
}

function NoLessons({ data, trader }: { data: LessonsPayload; trader: string | null }) {
  return (
    <p className="empty">
      {trader ? `${cap(trader)} has` : "The desk has"} no lessons yet. After each cycle the review looks at every traced trade
      that is {data.horizons.join(" or ")} days old, compares its return with SPY's over the same days, and writes 1 to 3
      lessons into the trader's memory. Trades from before span saving began are never reviewed: there is no run to judge
      them by.
    </p>
  );
}

function LessonRow({ lesson: l, all, desk, focused }: { lesson: Lesson; all: Lesson[]; desk: Desk | null; focused: boolean }) {
  const by = l.contradicted_by !== null ? all.find((x) => x.id === l.contradicted_by) : null;
  const edge = l.benchmark_return !== null ? l.return - l.benchmark_return : null;
  return (
    <li className="lesson" data-contradicted={l.contradicted_by !== null} data-focused={focused} id={`lesson-${l.id}`}>
      <div className="lesson-main">
        <p className="lesson-text">
          <span className="tag" data-tone={l.kind === "success" ? "good" : "bad"}>
            {l.kind === "success" ? "Success" : "Mistake"}
          </span>{" "}
          {l.text}
        </p>
        <p className="lesson-meta">
          <TraderName name={l.trader} /> · {l.side === "buy" ? "bought" : "sold"} {l.symbol}{" "}
          <span className="num">{shortDay(parseIso(l.decided_at)!)}</span> · judged {l.horizon_days} days later ·{" "}
          <span className="muted">{l.pattern === "other" ? "no named pattern" : l.pattern.replace("-", " ")}</span>
        </p>
        <p className="lesson-meta">
          {l.recurs > 1 ? (
            <span className="strong">Recurs {count(l.recurs)}×</span>
          ) : (
            <span className="muted">First time</span>
          )}
          {" · "}
          {l.recalled_count ? (
            <span className="strong">Recalled before {plural(l.recalled_count, "trade")}</span>
          ) : (
            <span className="muted">Not recalled yet</span>
          )}
          {by && (
            <>
              {" · "}
              <a className="text-link" href={`#lesson-${by.id}`}>
                Contradicted by lesson {by.id}
              </a>
            </>
          )}
          {l.contradicts.length > 0 && (
            <>
              {" · "}
              <span className="muted">Contradicts lesson {l.contradicts.join(", ")}</span>
            </>
          )}
          {" · "}
          <Link className="text-link" to={`/memory?trader=${l.trader}&node=${encodeURIComponent(l.memory_node)}`}>
            In memory
          </Link>
        </p>
        <p className="lesson-meta">
          Fills:{" "}
          {l.fill_ids.map((id, i) => {
            const fill = desk?.fills.find((f) => f.id === id);
            const pnl = desk && fill ? fillPnl(desk, fill) : null;
            return (
              <span key={id}>
                {i > 0 && ", "}
                <Link className="text-link" to={`/decisions?fill=${id}`}>
                  {fill ? `${count(fill.quantity)} ${fill.symbol} ${stamp(fill.time)}` : id}
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
          {l.recalls.length > 0 && (
            <>
              {" · recalled in "}
              {l.recalls.map((r, i) => (
                <span key={`${r.trace_id}-${i}`}>
                  {i > 0 && ", "}
                  {r.fill_ids[0] ? (
                    <Link className="text-link" to={`/decisions?fill=${r.fill_ids[0]}`}>
                      the run of {stamp(parseIso(r.at)!)}
                    </Link>
                  ) : (
                    <span className="num">{stamp(parseIso(r.at)!)}</span>
                  )}
                </span>
              ))}
            </>
          )}
        </p>
      </div>
      <dl className="lesson-figures">
        <div>
          <dt>{l.side === "buy" ? "Since the buy" : "Since the sell"}</dt>
          <dd>
            <Ratio value={l.return} digits={1} />
          </dd>
        </div>
        <div>
          <dt>SPY</dt>
          <dd className="num muted">{l.benchmark_return !== null ? signed(l.benchmark_return) : "—"}</dd>
        </div>
        <div>
          <dt>Against SPY</dt>
          <dd>{edge !== null ? <Ratio value={edge} digits={1} /> : <span className="dash">—</span>}</dd>
        </div>
      </dl>
    </li>
  );
}

function signed(ratio: number): string {
  const v = ratio * 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
}

function ByTrader({ lessons, traders, trader }: { lessons: Lesson[]; traders: string[]; trader: string | null }) {
  const shown = trader ? [trader] : traders;
  const rows = shown.map((t) => {
    const own = lessons.filter((l) => l.trader === t);
    return {
      trader: t,
      total: own.length,
      success: own.filter((l) => l.kind === "success").length,
      mistake: own.filter((l) => l.kind === "mistake").length,
      contradicted: own.filter((l) => l.contradicted_by !== null).length,
      recalled: own.reduce((s, l) => s + l.recalled_count, 0),
    };
  });
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Trader</th>
            <th scope="col" className="num">Lessons</th>
            <th scope="col" className="num">Successes</th>
            <th scope="col" className="num">Mistakes</th>
            <th scope="col" className="num">No longer hold</th>
            <th scope="col" className="num">Recalls</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.trader}>
              <th scope="row">
                <TraderName name={r.trader} />
              </th>
              <td className="num strong">{count(r.total)}</td>
              <td className="num">{count(r.success)}</td>
              <td className="num">{count(r.mistake)}</td>
              <td className="num">{count(r.contradicted)}</td>
              <td className="num">{count(r.recalled)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">Recalls count memory reads that returned a lesson before the run's first order.</p>
    </div>
  );
}

function Pending({ pending }: { pending: PendingReview[] }) {
  const sorted = useMemo(() => [...pending].sort((a, b) => a.due_at.localeCompare(b.due_at)), [pending]);
  if (!sorted.length) {
    return <p className="empty">No traced trades waiting. Trades the traders make from now on are reviewed here.</p>;
  }
  return (
    <ul className="pending-list">
      {sorted.map((p) => (
        <li key={`${p.fill_ids[0]}-${p.horizon_days}`}>
          <span>
            <TraderName name={p.trader} /> {p.side === "buy" ? "bought" : "sold"}{" "}
            <Link className="text-link" to={`/decisions?fill=${p.fill_ids[0]}`}>
              {p.symbol}
            </Link>{" "}
            <span className="muted num">{shortDay(parseIso(p.decided_at)!)}</span>
          </span>
          <span className="num muted">
            {p.horizon_days}-day review {shortDay(parseIso(p.due_at)!)}
          </span>
        </li>
      ))}
    </ul>
  );
}
