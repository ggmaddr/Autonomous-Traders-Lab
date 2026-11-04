// The frame around every view: the lab's mark and name, the desk it is scoped to,
// the views grouped by the question they answer, and the market's state. On a
// phone the sidebar folds into a top bar with a menu sheet.

import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { NAV } from "../nav";
import { useMarket } from "../lib/desk";
import { useTheme } from "../lib/theme";

export function Mark() {
  // Four strokes, one per trader, in each trader's colour.
  return (
    <svg className="mark" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect x="1" y="8" width="3" height="11" fill="var(--t-warren)" />
      <rect x="6" y="4" width="3" height="15" fill="var(--t-george)" />
      <rect x="11" y="10" width="3" height="9" fill="var(--t-ray)" />
      <rect x="16" y="1" width="3" height="18" fill="var(--t-cathie)" />
    </svg>
  );
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
        {market.data.source === "massive" ? "Prices from Massive" : "Simulated prices"}
      </span>
    </p>
  );
}

export function Shell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { theme, toggle } = useTheme();
  useEffect(() => setOpen(false), [location.pathname]);

  const current = NAV.flatMap((g) => g.items).find((i) => i.path === location.pathname);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <Mark />
          <span className="wordmark">
            Traders Lab<span className="dot">.</span>
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
            Traders Lab<span className="dot">.</span>
          </span>
        </div>
        <p className="scope">Paper desk · 4 traders · $40,000 funded</p>
        <nav aria-label="Views">
          {NAV.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.path}>
                    <NavLink to={item.path} end className="nav-item" data-soon={!!item.shows}>
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
          <button className="btn-ghost theme-toggle" onClick={toggle}>
            {theme === "light" ? "Dark theme" : "Light theme"}
          </button>
        </div>
      </aside>
      <main className="canvas">
        <Outlet />
      </main>
    </div>
  );
}
