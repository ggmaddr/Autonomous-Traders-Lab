// Identity for each trader: the archetype it trades as and its colour. The colour
// is the trader's own across every chart and swatch on every screen; the CSS
// defines it per theme as --t-<name>.

// Stable display order by intended trading activity, not accumulated fill count.
export const ROSTER = ["zoro", "sanji", "luffy", "robin", "law", "nami", "jinbe"];

export function activityOrder(name: string): number {
  const index = ROSTER.indexOf(name.toLowerCase());
  return index < 0 ? ROSTER.length : index;
}

export const ARCHETYPES: Record<string, string> = {
  robin: "Regime quant",
  nami: "Risk parity",
  jinbe: "Value investing",
  law: "Contrarian macro",
  luffy: "Opening range breakout",
  zoro: "Momentum scalping",
  sanji: "Dip and rebound",
};

export function archetype(name: string): string {
  return ARCHETYPES[name.toLowerCase()] ?? "";
}

export function hueVar(name: string): string {
  return `var(--t-${name.toLowerCase()})`;
}

/** The resolved colour, for canvas charts that cannot read CSS variables. */
export function hue(name: string): string {
  return cssColor(`--t-${name.toLowerCase()}`);
}

export function cssColor(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || "#888";
}
