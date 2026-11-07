// Identity for each trader: the archetype it trades as and its colour. The colour
// is the trader's own across every chart and swatch on every screen; the CSS
// defines it per theme as --t-<name>.

export const ARCHETYPES: Record<string, string> = {
  warren: "Value, patient",
  george: "Macro, contrarian",
  ray: "Risk parity, systematic",
  cathie: "Disruptive growth, crypto ETFs",
  jim: "Regime quant",
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
