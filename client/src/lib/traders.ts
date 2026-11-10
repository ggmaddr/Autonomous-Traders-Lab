// Identity for each trader: the archetype it trades as and its colour. The colour
// is the trader's own across every chart and swatch on every screen; the CSS
// defines it per theme as --t-<name>.

export const ARCHETYPES: Record<string, string> = {
  robin: "Regime quant",
  nami: "All weather, risk parity",
  jinbe: "Value, patient",
  law: "Macro, contrarian",
  luffy: "Day trader, opening range breakout",
  zoro: "Momentum sprinter · 1-min checks · no AI/search cost",
  sanji: "Dip and rebound · all session · no AI/search cost",
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
