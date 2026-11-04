// App entry: server-state cache, routes, and the shell around every view. The
// trading floor runs on its own; this only reads the API.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "uplot/dist/uPlot.min.css";
import "./styles.css";
import { Shell } from "./components/Shell";
import { ThemeProvider } from "./lib/theme";
import { Money } from "./views/Money";
import { Trades } from "./views/Trades";
import { Coming } from "./views/Coming";
import { Health } from "./views/Health";
import { NAV } from "./nav";

const queries = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

const coming = NAV.flatMap((g) => g.items).filter((item) => item.phase);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Money />} />
              <Route path="trades" element={<Trades />} />
              {coming.map((item) => (
                <Route key={item.path} path={item.path.slice(1)} element={<Coming item={item} />} />
              ))}
              <Route path="health" element={<Health />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
