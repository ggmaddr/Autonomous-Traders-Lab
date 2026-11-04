// A view the roadmap has not built yet. It keeps the shell and the title, says
// which phase builds it and what it will answer, so the navigation is honest.

import { Link } from "react-router-dom";
import { PageHeader, Panel } from "../components/bits";
import type { NavItem } from "../nav";

export function Coming({ item }: { item: NavItem }) {
  return (
    <div className="view">
      <PageHeader
        kicker={item.phase ? `Coming in phase ${item.phase}` : "Not scheduled yet"}
        title={item.label}
        finding={item.question}
      />
      <Panel title="What this view will show" id="shows" className="coming">
        <ul className="coming-list">
          {item.shows?.map((s) => <li key={s}>{s}</li>)}
        </ul>
        <p className="note">
          Until then, the trades and the reasons behind them are on <Link className="text-link" to="/trades">Trades</Link>.
        </p>
      </Panel>
    </div>
  );
}
