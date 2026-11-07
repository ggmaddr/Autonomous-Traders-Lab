// The chart kit's base: a measured, responsive SVG frame, shared axes, motion
// helpers (tweening that respects prefers-reduced-motion) and the tooltip. Every
// chart in src/charts draws with React and uses d3 only for maths: scales, shapes,
// layouts and interpolation. That keeps marks themeable through CSS variables and
// lets a story step change a chart by changing its props.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import * as d3 from "d3";

/** Story steps and value changes animate over this long. */
export const DURATION = 600;

export interface Margin {
  t: number;
  r: number;
  b: number;
  l: number;
}

/** The width of an element, kept current with a ResizeObserver. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const obs = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, width];
}

export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Follow a target value with a d3 transition: when the target changes, the
 * returned value interpolates to it over DURATION. Only a real change animates,
 * never a re-render with the same value; reduced motion jumps straight there.
 */
export function useTween<T>(target: T, duration = DURATION): T {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const key = JSON.stringify(target);
  const lastKey = useRef(key);
  useEffect(() => {
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (reduced) {
      from.current = target;
      setValue(target);
      return;
    }
    const interp = d3.interpolate(from.current as never, target as never) as (t: number) => T;
    const timer = d3.timer((elapsed) => {
      const t = Math.min(1, elapsed / duration);
      // d3's array and object interpolators reuse one output object; copy it so
      // React sees a new value every frame.
      const raw = interp(d3.easeCubicInOut(t)) as unknown;
      const v = (Array.isArray(raw) ? [...raw] : raw && typeof raw === "object" ? { ...raw } : raw) as T;
      from.current = v;
      setValue(v);
      if (t >= 1) timer.stop();
    });
    return () => timer.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced, duration]);
  return value;
}

/** A number that counts up to its new value when it changes. */
export function CountUp({ value, format }: { value: number; format: (v: number) => string }) {
  const v = useTween(value);
  return <>{format(v)}</>;
}

/** True for ~400 ms after the value changes: drives the lime flash on updated rows. */
export function useFlash(value: unknown): boolean {
  const key = JSON.stringify(value);
  const first = useRef(key);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (key === first.current) return;
    first.current = key;
    setOn(true);
    const t = setTimeout(() => setOn(false), 400);
    return () => clearTimeout(t);
  }, [key]);
  return on;
}

// --- Frame and axes ----------------------------------------------------------

export function Frame(props: {
  width: number;
  height: number;
  label: string;
  children: ReactNode;
  onPointerMove?: (e: ReactPointerEvent<SVGSVGElement>, x: number, y: number) => void;
  onPointerLeave?: () => void;
  onClick?: () => void;
}) {
  const { width, height } = props;
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!props.onPointerMove) return;
    const r = e.currentTarget.getBoundingClientRect();
    // The viewBox matches the measured width, so client pixels map 1:1 to chart units.
    props.onPointerMove(e, ((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height);
  };
  return (
    <svg
      className="kit-svg"
      viewBox={`0 0 ${Math.max(1, width)} ${height}`}
      width="100%"
      role="img"
      aria-label={props.label}
      onPointerMove={props.onPointerMove ? move : undefined}
      onPointerLeave={props.onPointerLeave}
      onClick={props.onClick}
    >
      {props.children}
    </svg>
  );
}

type Scale = { (v: number): number; ticks?: (n?: number) => number[] };

export function AxisX(props: {
  scale: Scale;
  ticks: number[];
  y: number;
  top?: number; // draw vertical grid lines up to here
  format: (v: number) => string;
}) {
  const { scale, ticks, y } = props;
  return (
    <g className="kit-axis" aria-hidden="true">
      {props.top !== undefined &&
        ticks.map((t) => <line key={`g${t}`} className="kit-grid" x1={scale(t)} x2={scale(t)} y1={props.top} y2={y} />)}
      {ticks.map((t, i) => (
        <text
          key={t}
          className="kit-tick"
          x={scale(t)}
          y={y + 16}
          textAnchor={i === 0 && ticks.length > 2 ? "start" : i === ticks.length - 1 && ticks.length > 2 ? "end" : "middle"}
        >
          {props.format(t)}
        </text>
      ))}
    </g>
  );
}

export function AxisY(props: {
  scale: Scale;
  ticks: number[];
  x0: number;
  x1: number;
  format: (v: number) => string;
  zero?: number | null; // the value drawn as the reference rule
}) {
  const { scale, ticks, x0, x1 } = props;
  return (
    <g className="kit-axis" aria-hidden="true">
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === props.zero ? "kit-zero" : "kit-grid"} x1={x0} x2={x1} y1={scale(t)} y2={scale(t)} />
          <text className="kit-tick" x={x0 - 8} y={scale(t) + 4} textAnchor="end">
            {props.format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Ticks for a time axis that fit the width: one label per ~90 px. */
export function timeTicks(domain: [number, number], width: number): number[] {
  const n = Math.max(2, Math.floor(width / 90));
  return d3
    .scaleTime()
    .domain(domain)
    .ticks(n)
    .map((d) => d.getTime());
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const clockFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short" });
const yearFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" });

/** A time tick label that suits the span shown. */
export function timeFormatFor(domain: [number, number]): (ms: number) => string {
  const span = domain[1] - domain[0];
  if (span < 2 * 86_400_000) return (ms) => clockFmt.format(ms);
  if (span < 120 * 86_400_000) return (ms) => dayFmt.format(ms);
  if (span < 500 * 86_400_000) return (ms) => monthFmt.format(ms);
  return (ms) => yearFmt.format(ms);
}

/** Spread labels apart vertically so none overlap: positions are label centres. */
export function spreadLabels(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = order.map((o) => o.y);
  for (let pass = 0; pass < 4; pass++) {
    for (let k = 1; k < out.length; k++) if (out[k] - out[k - 1] < gap) out[k] = out[k - 1] + gap;
    if (out.length && out[out.length - 1] > hi) out[out.length - 1] = hi;
    for (let k = out.length - 2; k >= 0; k--) if (out[k + 1] - out[k] < gap) out[k] = out[k + 1] - gap;
    if (out.length && out[0] < lo) out[0] = lo;
  }
  const res = new Array<number>(ys.length);
  order.forEach((o, k) => (res[o.i] = out[k]));
  return res;
}

// --- Tooltip -----------------------------------------------------------------

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Tooltip state for one chart; render <Tip> inside the chart's .kit-box. */
export function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((x: number, y: number, content: ReactNode) => setTip({ x, y, content }), []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export function Tip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  // Flip to the left of the pointer in the right half so it never leaves the box.
  const right = tip.x > width / 2;
  return (
    <div
      className="kit-tip"
      role="status"
      style={{
        top: tip.y,
        left: right ? undefined : tip.x + 14,
        right: right ? width - tip.x + 14 : undefined,
      }}
    >
      {tip.content}
    </div>
  );
}

/** The wrapper every chart sits in: measured, positioned for its tooltip. */
export function ChartBox(props: { boxRef: React.RefObject<HTMLDivElement>; children: ReactNode; className?: string }) {
  return (
    <div ref={props.boxRef} className={`kit-box ${props.className ?? ""}`}>
      {props.children}
    </div>
  );
}

/** Dim a mark when another trader is in focus. */
export function dim(focus: string | null | undefined, id: string | undefined): number {
  return !focus || !id || focus === id ? 1 : 0.18;
}
