// Names and marks for the Experiment Lab. An arm is one value per dimension; on screen
// it is named only by the dimensions that vary in its experiment, and each value of
// the dimension being compared gets one mark: a shape and a colour, so the two
// never rest on colour alone.

import type { Arm, Dimension, ExperimentSpec, LabCatalog } from "../api";
import { hueVar } from "./traders";

export const DIMS: Dimension["id"][] = ["agent", "researcher", "model", "prompt", "strategy"];
export const JIM_AGENTS = ["jim", "jim_raw"];

/** Arms an experiment will run. Jim trades his own playbook with the fixed prompt, so his
 *  arms do not multiply by strategy or prompt (server/lab/arms.py combinations). */
export function armCount(chosen: Record<string, string[]>): number {
  const n = (d: string) => chosen[d]?.length ?? 0;
  const agents = chosen.agent ?? ["trader"];
  const jim = agents.filter((a) => JIM_AGENTS.includes(a)).length;
  const trader = agents.includes("trader") ? 1 : 0;
  return trader * n("researcher") * n("model") * n("prompt") * n("strategy") + jim * n("researcher") * n("model");
}

export function valueLabel(catalog: LabCatalog | undefined, dim: string, id: string): string {
  return catalog?.dimensions.find((d) => d.id === dim)?.values.find((v) => v.id === id)?.label ?? id;
}

export function dimLabel(catalog: LabCatalog | undefined, dim: string): string {
  return catalog?.dimensions.find((d) => d.id === dim)?.label ?? dim;
}

/** Dimensions with more than one value in this experiment, in display order. */
export function varying(spec: ExperimentSpec): Dimension["id"][] {
  return DIMS.filter((d) => (spec.arms[d]?.length ?? 0) > 1);
}

export function armLabel(arm: Arm, spec: ExperimentSpec, catalog: LabCatalog | undefined): string {
  const dims = varying(spec);
  if (!dims.length) return "The one arm";
  return dims.map((d) => valueLabel(catalog, d, arm[d])).join(" · ");
}

export function fixedLabel(spec: ExperimentSpec, catalog: LabCatalog | undefined): string {
  return DIMS.filter((d) => (spec.arms[d]?.length ?? 0) === 1)
    .map((d) => `${dimLabel(catalog, d)} ${valueLabel(catalog, d, spec.arms[d][0])}`)
    .join(" · ");
}

export type Shape = "circle" | "square" | "diamond" | "triangle";
const SHAPES: Shape[] = ["circle", "square", "diamond", "triangle"];
// The reference value in ink, the first alternative in the data accent, the rest in greys.
const TONES = ["var(--text)", "var(--accent-data)", "var(--muted)", "var(--faint)"];
const PERSONA: Record<string, string> = {
  value: "warren",
  value_playbook: "warren",
  macro: "george",
  macro_playbook: "george",
  risk_parity: "ray",
  thematic: "cathie",
  jim: "jim",
};

export interface Mark {
  shape: Shape;
  color: string;
}

/** The mark for one value of the lens dimension. Strategies keep their persona's colour. */
export function markOf(spec: ExperimentSpec, lens: string | null, arm: Arm): Mark {
  if (!lens) return { shape: "circle", color: "var(--accent-data)" };
  const i = Math.max(0, (spec.arms[lens] ?? []).indexOf(arm[lens as Dimension["id"]]));
  const color = lens === "strategy" && PERSONA[arm.strategy] ? hueVar(PERSONA[arm.strategy]) : TONES[i % TONES.length];
  return { shape: SHAPES[i % SHAPES.length], color };
}

export function shapePath(shape: Shape, r: number): string {
  switch (shape) {
    case "square":
      return `M${-r},${-r}H${r}V${r}H${-r}Z`;
    case "diamond":
      return `M0,${-r * 1.3}L${r * 1.3},0L0,${r * 1.3}L${-r * 1.3},0Z`;
    case "triangle":
      return `M0,${-r * 1.25}L${r * 1.15},${r * 0.85}L${-r * 1.15},${r * 0.85}Z`;
    default:
      return `M${-r},0A${r},${r} 0 1,0 ${r},0A${r},${r} 0 1,0 ${-r},0`;
  }
}

/** "1 h 20 m", "12 m", "40 s": a run length. */
export function runLength(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} m`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`;
}

export function points(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "—";
  const x = v * 100;
  const sign = x > 0.05 ? "+" : x < -0.05 ? "−" : "";
  return `${sign}${Math.abs(x).toFixed(digits)}`;
}

export function scorePct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;
}
