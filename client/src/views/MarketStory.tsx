// Market Year in story mode: "The year in N transitions". One step per regime
// episode of the Rules model, in order; each zooms the SPY chart to its episode
// (the x domain tweens over 600 ms, or jumps with reduced motion), shows the HMM
// probabilities shifting underneath and the news the Researcher attached to the
// turn, and the last step ends on where the desk is positioned now.

import { useMemo } from "react";
import type { Episode, MarketYear as Year } from "../api";
import { Crew, ICONS, RegimeMark } from "../components/Crew";
import { Scrolly, type StoryStep } from "../charts";
import { PositionGauge, ProbRibbon, SpyRegimeChart, dayMs } from "../components/RegimeCharts";
import { host, pct, price, signedPct } from "../lib/format";
import { bestSignal, dayLabel, deskRiskOn, hmmPhrase } from "../lib/regime";

const DAY = 86_400_000;

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

export function MarketStory({ year }: { year: Year }) {
  // On a phone the pinned figure must leave room for the steps below it.
  const phone = typeof window !== "undefined" && window.innerWidth < 600;
  const episodes = year.episodes.rules ?? [];
  const { days, spy } = year.series;
  const x0 = dayMs(days[0]);
  const x1 = dayMs(days[days.length - 1]);
  const spyAt = (d: string) => {
    const i = days.indexOf(d);
    return i >= 0 ? spy[i] : null;
  };

  const steps = useMemo<(StoryStep & { domain: [number, number]; ep: Episode | null })[]>(() => {
    const out: (StoryStep & { domain: [number, number]; ep: Episode | null })[] = [];
    episodes.forEach((e, k) => {
      const a = Math.max(x0, dayMs(e.start) - 12 * DAY);
      const b = Math.min(x1, dayMs(e.end) + 12 * DAY);
      // Give short episodes enough context to read: at least ~6 weeks wide.
      const mid = (a + b) / 2;
      const half = Math.max((b - a) / 2, 21 * DAY);
      const domain: [number, number] = [Math.max(x0, mid - half), Math.min(x1, mid + half)];
      const prev = episodes[k - 1];
      const start = spyAt(e.start);
      const body = (
        <>
          {k === 0 ? (
            <p>
              The range opens in a <strong>{e.label.toLowerCase()}</strong> ({e.risk}){start !== null && <>, SPY near {price(start)}</>}.
            </p>
          ) : (
            <p>
              {e.event ? <strong>{e.event.headline}.</strong> : null}{" "}
              {e.event ? clip(e.event.summary, 240) : "No news was attached to this turn."}
            </p>
          )}
          <p className="num story-stats">
            SPY {signedPct(e.spy_return, 1)} over {e.days} days · max drawdown {signedPct(e.max_drawdown, 1)}
            {e.vol !== null && <> · vol {pct(e.vol, 0)}</>}
          </p>
          {e.leaders.length > 0 && (
            <p className="story-sub">
              Led by {e.leaders.map((l) => `${l.symbol} ${signedPct(l.return, 1)}`).join(", ")}
              {e.laggards.length > 0 && <>; lagging {e.laggards.map((l) => `${l.symbol} ${signedPct(l.return, 1)}`).join(", ")}</>}.
            </p>
          )}
          {k === 1 && (
            <p className="story-sub">
              Labels change only after 5 trading days hold the new regime, so every turn is confirmed late by design.
            </p>
          )}
          {e.event?.sources.length ? (
            <p className="story-sub">
              {e.event.sources.slice(0, 3).map((s, i) => (
                <span key={s.url}>
                  {i > 0 && " · "}
                  <a className="text-link" href={s.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                    {host(s.url)}
                  </a>
                </span>
              ))}
            </p>
          ) : null}
        </>
      );
      out.push({
        id: e.start,
        tag: k === 0 ? `${dayLabel(e.start)} · start of the range` : `${dayLabel(e.start)} · transition ${k}`,
        title: k === 0 ? `The range opens: ${e.label}` : `${prev.label} → ${e.label}`,
        body,
        mark: <RegimeMark label={e.label} corner play="active" />,
        domain,
        ep: e,
      });
    });
    const best = bestSignal(year, "rules", year.read.rules.label);
    const last = spy[spy.length - 1];
    const hmm = hmmPhrase(year);
    out.push({
      id: "now",
      mark: <Crew icon={ICONS.spyglass} motion="rock" corner play="active" />,
      tag: `${dayLabel(year.as_of)} · today`,
      title: "Where the desk stands",
      body: (
        <>
          <p>
            SPY {price(last)}, {signedPct(last / spy[0] - 1)} over the range. {year.read.rules.label} for {year.read.rules.days} trading
            days
            {hmm ? `; ${hmm}` : ""}.
          </p>
          {best && (
            <p>
              In this regime {best.label.toLowerCase()} has paid best (Sharpe {best.sharpe! > 0 ? "+" : ""}
              {best.sharpe!.toFixed(2)} over {best.n_days} days).
            </p>
          )}
          <p>The desk is {pct(deskRiskOn(year))} risk-on; each tick on the gauge is a trader.</p>
        </>
      ),
      domain: [x0, x1],
      ep: null,
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  if (!episodes.length) return <p className="empty">No regime episodes in this range yet.</p>;

  return (
    <Scrolly
      label="Story steps"
      figureTitle={`SPY by regime, ${dayLabel(days[0])} – ${dayLabel(year.as_of)}`}
      steps={steps}
      figure={(active) => {
        const s = steps[active];
        const e = s.ep;
        const notes =
          e && spyAt(e.start) !== null
            ? [
                {
                  x: dayMs(e.start),
                  y: spyAt(e.start)!,
                  text: e.label,
                  sub: `${dayLabel(e.start)} · ${e.risk}`,
                  dir: "ne" as const,
                  len: 34,
                },
              ]
            : [
                {
                  x: x1,
                  y: spy[spy.length - 1],
                  text: `SPY ${price(spy[spy.length - 1])}`,
                  sub: signedPct(spy[spy.length - 1] / spy[0] - 1),
                  dir: "nw" as const,
                },
              ];
        return (
          <div className="story-figure">
            <SpyRegimeChart year={year} model="rules" xDomain={s.domain} notes={notes} height={phone ? 180 : 280} />
            <ProbRibbon year={year} xDomain={s.domain} height={phone ? 44 : 64} />
            {!phone && <RegimeKey year={year} />}
            {s.id === "now" && <PositionGauge year={year} />}
          </div>
        );
      }}
    />
  );
}

function RegimeKey({ year }: { year: Year }) {
  return (
    <ul className="kit-legend">
      {year.labels.map((l) => (
        <li key={l}>
          <span
            className="kit-legend-mark"
            style={{ background: l === "Volatile bull" ? "var(--rg-volatile-line)" : `var(--rg-${l.toLowerCase().replace(/\s+/g, "-")})` }}
          />
          {l}
        </li>
      ))}
      <li>Dashed: 200-day average</li>
    </ul>
  );
}
