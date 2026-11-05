// The desk's books, computed from what the API returns: fills matched first in,
// first out into realized P&L, open lots for cost basis, equity curves aligned on
// one clock, and drawdown. Everything shown on the Money and Trades views comes
// from here, so the figures on both screens agree.

import type { TraderDetail } from "../api";
import { parseStamp } from "./format";

/** Starting cash per trader (backend/accounts.py INITIAL_BALANCE). */
export const INITIAL_BALANCE = 10_000;
/** Half-spread charged on every fill (backend/accounts.py SPREAD). */
export const SPREAD = 0.002;

export interface Fill {
  id: string;
  trader: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number; // always positive
  price: number; // fill price, spread included
  time: number; // ms
  rationale: string;
  traceId: string | null; // the agent run behind it; null before Phase 2 tracing
  spread: number; // dollars paid to the spread on this fill
  // Set on sells: the lots this fill closed.
  realized?: number;
  costBasis?: number;
  heldMs?: number;
}

export interface Lot {
  quantity: number;
  price: number;
  time: number;
}

export interface Position {
  trader: string;
  symbol: string;
  quantity: number;
  costBasis: number; // FIFO cost of the open lots
  avgCost: number;
  price: number; // latest price from the API
  value: number;
  unrealized: number;
  openedAt: number; // oldest open lot
}

export interface Book {
  trader: TraderDetail;
  fills: Fill[];
  positions: Position[];
  cash: number;
  invested: number;
  equity: number;
  realized: number;
  unrealized: number;
  spreadPaid: number;
  change: number; // equity − initial
}

function spreadOf(side: "buy" | "sell", quantity: number, fillPrice: number): number {
  // Buys fill at mid × (1 + SPREAD), sells at mid × (1 − SPREAD).
  const mid = side === "buy" ? fillPrice / (1 + SPREAD) : fillPrice / (1 - SPREAD);
  return Math.abs(fillPrice - mid) * quantity;
}

export function buildBook(trader: TraderDetail): Book {
  const name = trader.name.toLowerCase();
  const lots = new Map<string, Lot[]>();
  const fills: Fill[] = trader.transactions.map((t, i) => {
    const side = t.quantity > 0 ? "buy" : "sell";
    const quantity = Math.abs(t.quantity);
    const fill: Fill = {
      id: `${name}-${i}`,
      trader: name,
      symbol: t.symbol,
      side,
      quantity,
      price: t.price,
      time: parseStamp(t.timestamp),
      rationale: t.rationale,
      traceId: t.trace_id ?? null,
      spread: spreadOf(side, quantity, t.price),
    };
    const open = lots.get(t.symbol) ?? [];
    lots.set(t.symbol, open);
    if (side === "buy") {
      open.push({ quantity, price: t.price, time: fill.time });
    } else {
      let left = quantity;
      let cost = 0;
      let heldWeighted = 0;
      while (left > 0 && open.length) {
        const lot = open[0];
        const take = Math.min(left, lot.quantity);
        cost += take * lot.price;
        heldWeighted += take * (fill.time - lot.time);
        lot.quantity -= take;
        left -= take;
        if (lot.quantity === 0) open.shift();
      }
      const matched = quantity - left;
      fill.costBasis = cost;
      fill.realized = matched * t.price - cost;
      fill.heldMs = matched ? heldWeighted / matched : 0;
    }
    return fill;
  });

  const prices = new Map(trader.holdings.map((h) => [h.symbol, h.price]));
  const positions: Position[] = [];
  for (const [symbol, open] of lots) {
    const quantity = open.reduce((s, l) => s + l.quantity, 0);
    if (quantity === 0) continue;
    const costBasis = open.reduce((s, l) => s + l.quantity * l.price, 0);
    const price = prices.get(symbol) ?? 0;
    positions.push({
      trader: name,
      symbol,
      quantity,
      costBasis,
      avgCost: costBasis / quantity,
      price,
      value: price * quantity,
      unrealized: price * quantity - costBasis,
      openedAt: open[0].time,
    });
  }
  positions.sort((a, b) => b.value - a.value);

  const invested = positions.reduce((s, p) => s + p.value, 0);
  const realized = fills.reduce((s, f) => s + (f.realized ?? 0), 0);
  const unrealized = positions.reduce((s, p) => s + p.unrealized, 0);
  const equity = trader.balance + invested;
  const change = equity - INITIAL_BALANCE;
  // The books close: what was made on closed lots plus what is open equals the change in equity.
  console.assert(Math.abs(realized + unrealized - change) < 0.01, `${name}: realized + unrealized ≠ change`, {
    realized,
    unrealized,
    change,
  });
  return {
    trader,
    fills,
    positions,
    cash: trader.balance,
    invested,
    equity,
    realized,
    unrealized,
    spreadPaid: fills.reduce((s, f) => s + f.spread, 0),
    change,
  };
}

// --- Equity on one clock -----------------------------------------------------

export interface Curves {
  times: number[]; // seconds, for uPlot
  byTrader: Record<string, number[]>;
  desk: number[];
  drawdown: number[]; // desk, as a ratio ≤ 0
  suspect: Suspect[]; // samples left out of the curves
}

/** A sample that jumps and returns at once: a price from the other source (D1). */
export interface Suspect {
  trader: string;
  time: number; // ms
  value: number;
  around: number; // the neighbours' level
}

const SPIKE = 0.2;

function dropSpikes(name: string, pts: { t: number; v: number }[], suspect: Suspect[]) {
  const kept: { t: number; v: number }[] = [];
  pts.forEach((p, i) => {
    const prev = kept[kept.length - 1];
    const next = pts[i + 1];
    if (prev && next) {
      const jumps = Math.abs(p.v / prev.v - 1) > SPIKE && Math.abs(p.v / next.v - 1) > SPIKE;
      const neighboursAgree = Math.abs(next.v / prev.v - 1) < SPIKE / 4;
      if (jumps && neighboursAgree) {
        suspect.push({ trader: name, time: p.t, value: p.v, around: (prev.v + next.v) / 2 });
        return;
      }
    }
    kept.push(p);
  });
  return kept;
}

/**
 * The stored series are sampled whenever an agent read its account (D5), so the
 * traders' points fall at different times. Put them on one clock: every sample
 * time across the desk, each trader carrying its last known value forward, and
 * starting from its initial cash. The last point is the live value from the API.
 * A sample that leaps more than 20% and comes straight back is left out and
 * listed, so one mixed price does not draw a fake peak and a fake drawdown.
 */
export function alignCurves(books: Book[], now: number): Curves {
  const suspect: Suspect[] = [];
  const series = books.map((b) => {
    const name = b.trader.name.toLowerCase();
    const pts = b.trader.time_series.map((p) => ({ t: parseStamp(p.datetime), v: p.value }));
    pts.push({ t: now, v: b.equity });
    pts.sort((a, b) => a.t - b.t);
    return { name, pts: dropSpikes(name, pts, suspect) };
  });
  const times = [...new Set(series.flatMap((s) => s.pts.map((p) => p.t)))].sort((a, b) => a - b);
  const byTrader: Record<string, number[]> = {};
  for (const s of series) {
    let j = 0;
    let last = INITIAL_BALANCE;
    byTrader[s.name] = times.map((t) => {
      while (j < s.pts.length && s.pts[j].t <= t) last = s.pts[j++].v;
      return last;
    });
  }
  const desk = times.map((_, i) => series.reduce((sum, s) => sum + byTrader[s.name][i], 0));
  return { times: times.map((t) => t / 1000), byTrader, desk, drawdown: drawdownOf(desk), suspect };
}

export function drawdownOf(values: number[]): number[] {
  let peak = -Infinity;
  return values.map((v) => {
    peak = Math.max(peak, v);
    return peak > 0 ? v / peak - 1 : 0;
  });
}

export function maxDrawdown(values: number[]): number {
  return Math.min(0, ...drawdownOf(values));
}

/** The value at a moment: the last sample at or before it, or the opening value. */
export function valueAt(times: number[], values: number[], atSeconds: number, opening: number): number {
  let v = opening;
  for (let i = 0; i < times.length && times[i] <= atSeconds; i++) v = values[i];
  return v;
}

// --- Trade record ------------------------------------------------------------

export interface Record_ {
  closes: number; // sells that closed lots
  wins: number;
  losses: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  realized: number;
  avgHeldMs: number | null;
  best: Fill | null;
  worst: Fill | null;
}

export function tradeRecord(fills: Fill[]): Record_ {
  const closes = fills.filter((f) => f.side === "sell" && f.realized !== undefined);
  const wins = closes.filter((f) => (f.realized ?? 0) > 0);
  const losses = closes.filter((f) => (f.realized ?? 0) < 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const byRealized = [...closes].sort((a, b) => (b.realized ?? 0) - (a.realized ?? 0));
  return {
    closes: closes.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closes.length ? wins.length / closes.length : null,
    avgWin: mean(wins.map((f) => f.realized!)),
    avgLoss: mean(losses.map((f) => f.realized!)),
    realized: closes.reduce((s, f) => s + (f.realized ?? 0), 0),
    avgHeldMs: mean(closes.map((f) => f.heldMs ?? 0)),
    best: byRealized[0] ?? null,
    worst: byRealized.length ? byRealized[byRealized.length - 1] : null,
  };
}
