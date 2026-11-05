// Client for the trading floor HTTP API. All paths are relative; in dev the Vite
// proxy forwards /api to the FastAPI backend, so the browser sees one origin.

export interface TraderInfo {
  name: string;
  lastname: string;
  model_name: string;
}

export interface Holding {
  symbol: string;
  quantity: number;
  price: number;
  avg_cost: number;
  market_value: number;
  unrealized_pnl: number;
}

export interface Transaction {
  symbol: string;
  quantity: number;
  price: number;
  timestamp: string;
  rationale: string;
  trace_id?: string | null; // the agent run that placed it; absent before Phase 2
}

export interface TimePoint {
  datetime: string;
  value: number;
}

// Mirrors the full backend payload; the dashboard renders a subset of these fields.
export interface TraderDetail extends TraderInfo {
  balance: number;
  strategy: string;
  portfolio_value: number;
  pnl: number;
  holdings: Holding[];
  transactions: Transaction[];
  time_series: TimePoint[];
}

export interface LogRow {
  datetime: string;
  type: string;
  message: string;
  color: string;
}

export interface MarketInfo {
  source: "massive" | "simulator";
  is_market_open: boolean;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
  return r.json() as Promise<T>;
}

export function getTraders(): Promise<TraderInfo[]> {
  return get("/api/traders");
}

export function getTrader(name: string): Promise<TraderDetail> {
  return get(`/api/traders/${encodeURIComponent(name)}`);
}

export function getTraderLogs(name: string, lastN = 13): Promise<LogRow[]> {
  return get(`/api/traders/${encodeURIComponent(name)}/logs?last_n=${lastN}`);
}

export function getMarket(): Promise<MarketInfo> {
  return get("/api/market");
}

// --- Runs and research, read from the saved SDK spans (backend/runs.py) -------

export interface Source {
  url: string;
  title: string | null;
  via: "search" | "fetch";
}

export interface Usage {
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ResearchItem extends Usage {
  id: string;
  trace_id: string;
  trader: string | null;
  mode?: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  request: string;
  answer: string;
  error: unknown;
  sources: Source[];
  searches: (string | null)[];
  fetches: number;
  memory_calls: number;
}

export interface AccountState {
  balance: number | null;
  holdings: Record<string, number>;
  portfolio_value: number | null;
  pnl: number | null;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  error: { message?: string } | null;
  at: string | null;
}

export interface TimelineSpan {
  id: string;
  type: string;
  name: string;
  depth: number;
  offset_ms: number | null;
  duration_ms: number | null;
  error: { message?: string } | null;
}

export interface RunSummary {
  trace_id: string;
  cycle_id: string | null;
  trader: string;
  mode: string;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface RunDetail {
  trace_id: string;
  trader: string | null;
  cycle_id: string | null;
  mode: string | null;
  strategy: string | null;
  output: string | null;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
  before: AccountState | null;
  after: AccountState | null;
  research: ResearchItem[];
  orders: ToolCall[];
  market_calls: ToolCall[];
  usage: Usage;
  mcp_listings: number;
  timeline: TimelineSpan[];
  openai_trace_url: string | null;
}

export function getResearch(trader?: string | null): Promise<ResearchItem[]> {
  return get(`/api/research${trader ? `?trader=${encodeURIComponent(trader)}` : ""}`);
}

export function getRuns(trader?: string | null): Promise<RunSummary[]> {
  return get(`/api/runs${trader ? `?trader=${encodeURIComponent(trader)}` : ""}`);
}

export function getRun(traceId: string): Promise<RunDetail> {
  return get(`/api/runs/${encodeURIComponent(traceId)}`);
}

// --- Lessons and memory (backend/review.py, backend/memory.py) ---------------

export interface LessonRecall {
  trace_id: string;
  at: string | null;
  tool: string;
  query: string | null;
  fill_ids: string[];
}

export interface Lesson {
  id: number;
  trader: string;
  text: string;
  kind: "success" | "mistake";
  pattern: string;
  symbol: string;
  side: "buy" | "sell";
  fill_ids: string[];
  trace_ids: string[];
  /** The decision's return at review, signed so positive means it was right. */
  return: number;
  /** SPY's move over the same days; null when no history was available. */
  benchmark_return: number | null;
  horizon_days: number;
  decided_at: string;
  created_at: string;
  review_trace_id: string | null;
  recalled_count: number;
  recalls: LessonRecall[];
  contradicted_by: number | null;
  contradicts: number[];
  recurs: number;
  memory_node: string;
}

export interface PendingReview {
  trader: string;
  symbol: string;
  side: "buy" | "sell";
  fill_ids: string[];
  decided_at: string;
  due_at: string;
  horizon_days: number;
}

export interface LessonsPayload {
  lessons: Lesson[];
  pending: PendingReview[];
  horizons: number[];
}

export interface Observation {
  id: number;
  content: string;
  created_at: string | null;
}

export interface MemoryNode {
  name: string;
  type: string | null; // null: named by a relation but never stored
  created_at: string | null;
  lesson_id: number | null;
  observations: Observation[];
  used: number; // runs whose memory reads returned it
}

export interface MemoryEdge {
  id: number;
  source: string;
  target: string;
  type: string;
  created_at: string | null;
}

export interface MemoryGraph {
  trader: string;
  exists: boolean;
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  reads: number;
}

export interface NodeUse {
  trace_id: string;
  span_id: string;
  at: string | null;
  tool: string;
  query: string | null;
  before_order: boolean;
  run_had_orders: boolean;
  mode: string | null;
  fill_ids: string[];
}

export interface MemoryNodeDetail extends MemoryNode {
  edges: MemoryEdge[];
  uses: NodeUse[];
  lesson: Omit<Lesson, "recalls" | "contradicts" | "recurs" | "memory_node"> | null;
}

export function getLessons(trader?: string | null): Promise<LessonsPayload> {
  return get(`/api/lessons${trader ? `?trader=${encodeURIComponent(trader)}` : ""}`);
}

export function getMemory(trader: string): Promise<MemoryGraph> {
  return get(`/api/memory/${encodeURIComponent(trader)}`);
}

export function getMemoryNode(trader: string, node: string): Promise<MemoryNodeDetail> {
  return get(`/api/memory/${encodeURIComponent(trader)}/node/${encodeURIComponent(node)}`);
}
