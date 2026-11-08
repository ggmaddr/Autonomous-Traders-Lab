// Shared reading of the Market Year payload: day labels, regime fills, the best
// signal for a regime, the desk's risk-on share and the HMM in words. The
// dashboard and the story mode both say things the same way through here.

import type { MarketYear as Year, RegimeLabel, RegimeModel } from "../api";
import { pct } from "./format";

export const slug = (l: string) => l.toLowerCase().replace(/\s+/g, "-");

export const fill = (l: string) => (l === "Volatile bull" ? "url(#rg-hatch)" : `var(--rg-${slug(l)})`);

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "13 Jul" from an ISO day, without a timezone shift. */
export function dayLabel(d: string): string {
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
}

export function longDay(d: string): string {
  return `${dayLabel(d)} ${d.slice(0, 4)}`;
}

export function bestSignal(year: Year, model: RegimeModel, regime: RegimeLabel) {
  const cells = year.scores[model].cells.filter((c) => c.regime === regime && c.window === "blend" && c.sharpe !== null);
  const best = cells.sort((a, b) => b.sharpe! - a.sharpe!)[0];
  return best ? { ...best, label: year.signals.find((s) => s.id === best.signal)!.label } : null;
}

export function deskRiskOn(year: Year): number {
  const equity = year.exposure.reduce((s, e) => s + e.equity, 0);
  return equity ? year.exposure.reduce((s, e) => s + e.risk_on, 0) / equity : 0;
}

/**
 * What the HMM says, in words. Its confirmed label only switches after the raw
 * daily label has held `dwell` days, so the probability of the confirmed label
 * can be ~0% while the model's daily read has already moved on. Say so instead
 * of printing "agrees (0%)".
 */
export function hmmPhrase(year: Year): string | null {
  const { hmm, agree, raw, raw_days, dwell } = year.read;
  if (!hmm) return null;
  const turning = raw.hmm && raw.hmm !== hmm.label;
  const head = agree ? "the HMM agrees" : `the HMM reads ${hmm.label}`;
  if (!turning) return `${head} (${pct(hmm.prob)})`;
  const left = Math.max(0, (dwell ?? 5) - (raw_days?.hmm ?? 0));
  return (
    `${agree ? "the HMM still confirms it" : head}, but its daily read has been ${raw.hmm} ` +
    `(${pct(hmm.probs[raw.hmm!] ?? 0)}) for ${raw_days?.hmm ?? 0} day${raw_days?.hmm === 1 ? "" : "s"}` +
    (left ? `; it switches if that holds ${left} more` : "")
  );
}
