// A view the roadmap has not built yet. It keeps the shell and the title, says
// which phase builds it and what it will answer, and points at what already
// exists, so the navigation is honest.

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
      <div className="grid-lead list-detail">
        <Panel title="What this view will show" id="shows">
          <ul className="coming-list">
            {item.shows?.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </Panel>
        <Panel title="What you can see today" id="today">
          <ul className="coming-list">
            <li>
              Every fill with the agent's reason in its own words, on{" "}
              <Link className="text-link" to="/trades">
                Trades
              </Link>
            </li>
            <li>
              Equity, drawdown and P&L for each trader, on{" "}
              <Link className="text-link" to="/">
                Money
              </Link>
            </li>
            <li>
              The agents' activity log, on{" "}
              <Link className="text-link" to="/health">
                Health
              </Link>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
