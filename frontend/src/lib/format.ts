// Number and date formatting. Every figure on screen goes through here so money,
// percentages and signs read the same everywhere: two decimals for money, a true
// minus sign, and a sign on every change.

const MINUS = "−";

const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function money(v: number): string {
  return (v < 0 ? MINUS : "") + "$" + usd.format(Math.abs(v));
}

/** A change in money: "+$12.30", "−$4.10", "$0.00". */
export function signedMoney(v: number): string {
  const r = Math.round(v * 100) / 100;
  return (r > 0 ? "+" : r < 0 ? MINUS : "") + "$" + usd.format(Math.abs(r));
}

/** A ratio as a percentage with a sign: 0.0123 → "+1.23%". */
export function signedPct(ratio: number, digits = 2): string {
  const p = ratio * 100;
  const r = Number(p.toFixed(digits));
  return (r > 0 ? "+" : r < 0 ? MINUS : "") + Math.abs(r).toFixed(digits) + "%";
}

/** A ratio as an unsigned percentage: 0.4 → "40%". */
export function pct(ratio: number, digits = 0): string {
  return (ratio * 100).toFixed(digits) + "%";
}

export function count(v: number): string {
  return int.format(v);
}

/** Price per share, two decimals, no sign. */
export function price(v: number): string {
  return "$" + usd.format(v);
}

/** "good" | "bad" | "flat" for a change where up is good. */
export function tone(v: number): "good" | "bad" | "flat" {
  const r = Math.round(v * 100) / 100;
  return r > 0 ? "good" : r < 0 ? "bad" : "flat";
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const longDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** "3 Nov, 23:15" */
export function stamp(ms: number): string {
  return `${day.format(ms)}, ${clock.format(ms)}`;
}

/** "3 Nov" */
export function shortDay(ms: number): string {
  return day.format(ms);
}

/** "23:15" */
export function time(ms: number): string {
  return clock.format(ms);
}

/** "Wednesday 4 November 2026" */
export function longDate(ms: number): string {
  return longDay.format(ms);
}

/** A holding period: "45 m", "6 h 20 m", "7 d 5 h". */
export function duration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} m`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Stored timestamps are naive local time, "YYYY-MM-DD HH:MM:SS" (D9 in the plan). */
export function parseStamp(s: string): number {
  return new Date(s.replace(" ", "T")).getTime();
}
