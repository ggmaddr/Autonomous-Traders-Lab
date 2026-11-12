// The frame around every view: the lab's mark and name, the desk it is scoped to,
// the views grouped by the question they answer, and the market's state. On a
// phone the sidebar folds into a top bar with a menu sheet.

import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { NAV } from "../nav";
import { useMarket } from "../lib/desk";
import { useTheme } from "../lib/theme";
import { ROSTER, useTraderFilter } from "../lib/filter";
import { GiMoon, GiSun } from "react-icons/gi";
import { Crew } from "./Crew";
import { VIEW_ONLY } from "../lib/access";

export function Mark() {
  // Chopper's jolly roger; the browser tab uses the same picture (public/favicon.png).
  return <img className="mark" src="/chopper.png" width="36" height="36" alt="" />;
}

function MarketState() {
  const market = useMarket();
  if (market.isError) return <p className="market">Market state unavailable</p>;
  if (!market.data) return <p className="market">Checking the market…</p>;
  return (
    <p className="market">
      <span className="market-dot" data-open={market.data.is_market_open} aria-hidden="true" />
      {market.data.is_market_open ? "Market open" : "Market closed"}
      <span className="market-source">
        {market.data.source === "massive" ? "Massive · fast desk: IEX" : "Simulator · fast desk: IEX"}
      </span>
    </p>
  );
}

export function Shell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { theme, toggle } = useTheme();
  // The trader in focus follows you between tabs.
  const [trader] = useTraderFilter();
  const search = trader ? `?trader=${trader}` : "";
  useEffect(() => setOpen(false), [location.pathname]);

  const current = NAV.flatMap((g) => g.items).find((i) => i.path === location.pathname);

  const next = theme === "light" ? "dark" : "light";

  return (
    <div className="app">
      <button className="theme-icon" onClick={toggle} title={`Switch to ${next} theme`} aria-label={`Switch to ${next} theme`}>
        <Crew icon={theme === "light" ? <GiMoon /> : <GiSun />} motion="bob" size={34} play="hover" />
      </button>
      <header className="topbar">
        <span className="brand">
          <Mark />
          <span className="wordmark">
            Antimat Lab<span className="dot">.</span>
          </span>
        </span>
        <span className="topbar-title">{current?.label}</span>
        <button
          className="btn-ghost"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </header>
      <aside className="sidebar" id="sidebar" data-open={open}>
        <div className="brand sidebar-brand">
          <Mark />
          <span className="wordmark">
            Antimat Lab<span className="dot">.</span>
          </span>
        </div>
        <p className="scope">Paper desk · a crew of {ROSTER.length}{VIEW_ONLY ? " · View only" : ""}</p>
        <nav aria-label="Views">
          {NAV.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.path}>
                    <NavLink to={{ pathname: item.path, search }} end className="nav-item" data-soon={!!item.shows}>
                      <span>{item.label}</span>
                      {item.phase && <span className="nav-phase">Phase {item.phase}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <MarketState />
        </div>
      </aside>
      <main className="canvas">
        <Outlet />
      </main>
    </div>
  );
}
