// App entry: server-state cache, routes, and the shell around every view. The
// trading floor runs on its own; this only reads the API.

import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "uplot/dist/uPlot.min.css";
import "./styles.css";
import { Shell } from "./components/Shell";
import { ThemeProvider } from "./lib/theme";
import { Money } from "./views/Money";
import { Trades } from "./views/Trades";
import { Researcher } from "./views/Researcher";
import { Decisions } from "./views/Decisions";
import { Lessons } from "./views/Lessons";
import { Experiments } from "./views/Experiments";
import { Coming } from "./views/Coming";
import { Loading } from "./components/bits";
import { Health } from "./views/Health";
import { MarketYear } from "./views/MarketYear";
import { NAV } from "./nav";

// Heavy visualization libraries load only on their own routes: Three.js and Cytoscape.
const Architecture = lazy(() => import("./views/Architecture").then((m) => ({ default: m.Architecture })));
const Memory = lazy(() => import("./views/Memory").then((m) => ({ default: m.Memory })));

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
              <Route path="researcher" element={<Researcher />} />
              <Route path="decisions" element={<Decisions />} />
              <Route path="lessons" element={<Lessons />} />
              <Route
                path="memory"
                element={
                  <Suspense fallback={<Loading rows={8} />}>
                    <Memory />
                  </Suspense>
                }
              />
              {coming.map((item) => (
                <Route key={item.path} path={item.path.slice(1)} element={<Coming item={item} />} />
              ))}
              <Route path="market-year" element={<MarketYear />} />
              <Route path="architecture" element={<Suspense fallback={<Loading rows={8} />}><Architecture /></Suspense>} />
              <Route path="experiments" element={<Experiments />} />
              <Route path="health" element={<Health />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
