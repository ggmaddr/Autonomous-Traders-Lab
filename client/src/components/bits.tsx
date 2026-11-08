// Small pieces shared by the views: the title row, panels, signed changes and the
// trader's swatch.

import type { ReactNode } from "react";
import { signedMoney, signedPct, tone } from "../lib/format";
import { hueVar } from "../lib/traders";

export function PageHeader(props: { kicker: string; title: string; finding: ReactNode; aside?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <p className="kicker">{props.kicker}</p>
        <h1>
          {props.title}
          <span className="dot">.</span>
        </h1>
        <p className="finding">{props.finding}</p>
      </div>
      {props.aside && <div className="page-aside">{props.aside}</div>}
    </header>
  );
}

export function Panel(props: { title: string; meta?: ReactNode; className?: string; children: ReactNode; id?: string }) {
  return (
    <section className={`panel ${props.className ?? ""}`} aria-labelledby={props.id}>
      <header className="panel-head">
        <h2 id={props.id}>{props.title}</h2>
        {props.meta && <div className="panel-meta">{props.meta}</div>}
      </header>
      {props.children}
    </section>
  );
}

/** A change in money, coloured for good or bad, with its sign in the text. */
export function Change({ value, ratio }: { value: number; ratio?: number }) {
  return (
    <span className="num change" data-tone={tone(value)}>
      {signedMoney(value)}
      {ratio !== undefined && <span className="change-pct"> {signedPct(ratio)}</span>}
    </span>
  );
}

export function Ratio({ value, digits = 2 }: { value: number; digits?: number }) {
  return (
    <span className="num change" data-tone={tone(value * 100)}>
      {signedPct(value, digits)}
    </span>
  );
}

/** The trader's line, scaled down: the same mark the charts draw. */
export function Swatch({ trader }: { trader: string }) {
  return <span className="swatch" style={{ background: hueVar(trader) }} aria-hidden="true" />;
}

export function TraderName({ name }: { name: string }) {
  return (
    <span className="trader-name">
      <Swatch trader={name} />
      {name.charAt(0).toUpperCase() + name.slice(1)}
    </span>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="loading" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="loading-bar" />
      ))}
    </div>
  );
}

export function Failed({ what, error }: { what: string; error: Error | null }) {
  return (
    <p className="failed" role="alert">
      Couldn't load {what}. {error?.message ?? ""} Is the API running on port 8000?
    </p>
  );
}
