// Story mode: the scrollyteller. A sticky figure holds the charts while steps
// scroll past beside it; an IntersectionObserver marks the step crossing the
// middle of the viewport as active and the figure redraws for it (the charts
// tween their own props, so reduced motion is handled there). The Dashboard |
// Story toggle lives in the URL (?view=story) so a story can be linked.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

export type ViewMode = "dashboard" | "story";

export function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [params, setParams] = useSearchParams();
  const mode: ViewMode = params.get("view") === "story" ? "story" : "dashboard";
  const set = (v: ViewMode) => {
    const next = new URLSearchParams(params);
    if (v === "story") next.set("view", "story");
    else next.delete("view");
    setParams(next, { replace: true });
  };
  return [mode, set];
}

export function ViewToggle() {
  const [mode, set] = useViewMode();
  return (
    <div className="segmented view-toggle" role="group" aria-label="View">
      <button aria-pressed={mode === "dashboard"} onClick={() => set("dashboard")}>
        Dashboard
      </button>
      <button aria-pressed={mode === "story"} onClick={() => set("story")}>
        Story
      </button>
    </div>
  );
}

export interface StoryStep {
  id: string;
  tag?: string;
  title: string;
  body: ReactNode;
}

/** Index of the step crossing the viewport's middle band. */
export function useActiveStep(count: number): [React.MutableRefObject<(HTMLElement | null)[]>, number, (i: number) => void] {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const els = refs.current.slice(0, count).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
        }
      },
      // On a phone the pinned figure covers the top, so steps activate lower down.
      { rootMargin: matchMedia("(max-width: 900px)").matches ? "-72% 0px -22% 0px" : "-45% 0px -50% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [count]);
  const go = (i: number) => {
    setActive(i);
    refs.current[i]?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  };
  return [refs, active, go];
}

export function Scrolly(props: { steps: StoryStep[]; figure: (active: number) => ReactNode; figureTitle: string; label: string }) {
  const [refs, active, go] = useActiveStep(props.steps.length);
  return (
    <div className="scrolly">
      <ol className="scrolly-steps" aria-label={props.label}>
        {props.steps.map((s, i) => (
          <li
            key={s.id}
            ref={(el) => (refs.current[i] = el)}
            data-step={i}
            className="scrolly-step"
            aria-current={i === active ? "step" : undefined}
            onClick={() => go(i)}
          >
            {s.tag && <p className="scrolly-tag num">{s.tag}</p>}
            <h3>{s.title}</h3>
            <div className="scrolly-body">{s.body}</div>
          </li>
        ))}
        <li className="scrolly-spacer" aria-hidden="true" />
      </ol>
      <figure className="scrolly-figure panel" aria-live="polite">
        <figcaption className="panel-head">
          <h2>{props.figureTitle}</h2>
          <span className="panel-meta num">
            step {active + 1} of {props.steps.length}
          </span>
        </figcaption>
        {props.figure(active)}
      </figure>
    </div>
  );
}
