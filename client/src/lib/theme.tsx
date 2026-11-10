// Light/dark theme. The choice is a data-theme attribute on <html>; the CSS reacts
// through its :root[data-theme="..."] blocks, and canvas charts redraw when the
// theme changes because they read it from this context.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
const KEY = "antimat-lab-theme";
const OLD_KEY = "traders-lab-theme"; // before the rename

function saved(): Theme {
  try {
    return (localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY)) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(saved);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Storage can be blocked; the theme still applies for this visit.
    }
  }, [theme]);
  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
