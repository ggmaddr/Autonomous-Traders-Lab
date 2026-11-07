// The trader cross-filter. One trader can be in focus at a time, kept in the URL
// as ?trader=<name> so it survives moving between tabs (the sidebar carries it).
// Pills and chart marks both set it; picking the trader already in focus clears
// it. Views decide what focus means for them: charts dim the other traders,
// tables narrow to the trader.

import { useSearchParams } from "react-router-dom";
import { TraderName } from "../components/bits";

export const ROSTER = ["warren", "george", "ray", "cathie", "jim"];

export function useTraderFilter(): [string | null, (t: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("trader");
  const trader = raw && ROSTER.includes(raw) ? raw : null;
  const set = (t: string | null) => {
    const next = new URLSearchParams(params);
    if (t && t !== trader) next.set("trader", t);
    else next.delete("trader");
    setParams(next, { replace: true });
  };
  return [trader, set];
}

export function TraderPills(props: {
  value: string | null;
  onChange: (t: string | null) => void;
  traders?: string[];
  counts?: Record<string, number>;
  total?: number;
  allLabel?: string;
}) {
  const traders = props.traders ?? ROSTER;
  return (
    <div className="segmented filter trader-pills" role="group" aria-label="Focus on a trader">
      <button aria-pressed={!props.value} onClick={() => props.onChange(null)}>
        {props.allLabel ?? "Whole desk"}
        {props.total !== undefined && <span className="num seg-count">{props.total}</span>}
      </button>
      {traders.map((n) => (
        <button key={n} aria-pressed={props.value === n} onClick={() => props.onChange(n)}>
          <TraderName name={n} />
          {props.counts && <span className="num seg-count">{props.counts[n] ?? 0}</span>}
        </button>
      ))}
    </div>
  );
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
