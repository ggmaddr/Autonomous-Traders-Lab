// Joins research to the money. A research call and a fill belong together when they
// came from the same agent run (the fill's trace ID). A fill counts as citing the
// research when its symbol appears in the researcher's answer; otherwise the
// research was in the run but the trade did not draw on it by name.

import type { ResearchItem } from "../api";
import type { Desk } from "./desk";
import type { Fill } from "./ledger";

export interface FillOutcome {
  fill: Fill;
  cited: boolean;
  /** Realized on a sell; on a buy, what the shares bought are worth now against their cost. */
  pnl: number | null;
}

export function mentions(text: string, symbol: string): boolean {
  return new RegExp(`(^|[^A-Za-z])${symbol.replace(/[^A-Za-z0-9.]/g, "")}([^A-Za-z]|$)`).test(text);
}

export function fillPnl(desk: Desk, fill: Fill): number | null {
  if (fill.side === "sell") return fill.realized ?? null;
  const position = desk.books
    .find((b) => b.trader.name.toLowerCase() === fill.trader)
    ?.positions.find((p) => p.symbol === fill.symbol);
  return position ? (position.price - fill.price) * fill.quantity : null;
}

export function fillsOfRun(desk: Desk, traceId: string): Fill[] {
  return desk.fills.filter((f) => f.traceId === traceId);
}

export function outcomes(desk: Desk, item: ResearchItem): FillOutcome[] {
  return fillsOfRun(desk, item.trace_id).map((fill) => ({
    fill,
    cited: mentions(item.answer, fill.symbol),
    pnl: fillPnl(desk, fill),
  }));
}
