// Empty and loading states shared by every chart, so a chart with no data keeps
// its height and says why, instead of collapsing or drawing an empty axis.

import type { ReactNode } from "react";

export function ChartEmpty({ height = 160, children }: { height?: number; children: ReactNode }) {
  return (
    <div className="kit-empty" style={{ minHeight: height }}>
      <p>{children}</p>
    </div>
  );
}

export function ChartLoading({ height = 160, label = "Loading chart" }: { height?: number; label?: string }) {
  return (
    <div className="kit-loading" style={{ height }} aria-busy="true" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}

/** A small "stub" badge for figures the API does not supply yet. */
export function Stub({ why }: { why: string }) {
  return (
    <span className="kit-stub" title={why}>
      not in the API yet
    </span>
  );
}
