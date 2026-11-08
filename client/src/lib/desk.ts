// Server state for the desk. Every trader's detail is polled on one interval and
// turned into books once, so the Money and Trades views read the same numbers.
// Polling stays until the SSE stream lands (plan §11.1).

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getMarket, getTrader, getTraders } from "../api";
import { alignCurves, buildBook, type Book, type Curves, type Fill } from "./ledger";

const DATA_POLL_MS = 6000;

export interface Desk {
  books: Book[];
  curves: Curves;
  fills: Fill[]; // every fill on the desk, newest first
  updatedAt: number;
}

export function useDesk(): { desk: Desk | null; error: Error | null; loading: boolean } {
  const roster = useQuery({ queryKey: ["traders"], queryFn: getTraders, staleTime: Infinity });
  const details = useQueries({
    queries: (roster.data ?? []).map((t) => ({
      queryKey: ["trader", t.name],
      queryFn: () => getTrader(t.name),
      refetchInterval: DATA_POLL_MS,
    })),
  });

  const ready = roster.data && details.length > 0 && details.every((d) => d.data);
  const updatedAt = Math.max(0, ...details.map((d) => d.dataUpdatedAt));
  const desk = useMemo<Desk | null>(() => {
    if (!ready) return null;
    const books = details.map((d) => buildBook(d.data!));
    const fills = books.flatMap((b) => b.fills).sort((a, b) => b.time - a.time);
    return { books, curves: alignCurves(books, updatedAt), fills, updatedAt };
    // Rebuild only when a poll brought new data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, updatedAt]);

  const error = (roster.error ?? details.find((d) => d.error)?.error ?? null) as Error | null;
  return { desk, error, loading: !desk && !error };
}

export function useMarket() {
  return useQuery({ queryKey: ["market"], queryFn: getMarket, refetchInterval: 60_000 });
}
