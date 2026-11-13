// Client for the trading floor HTTP API. All paths are relative; in dev the Vite
// proxy forwards /api to the FastAPI backend, so the browser sees one origin.

import { activityOrder } from "./lib/traders";
import { VIEW_ONLY } from "./lib/access";

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

export async function getTraders(): Promise<TraderInfo[]> {
  const traders = await get<TraderInfo[]>("/api/traders");
  return traders.sort((a, b) => activityOrder(a.name) - activityOrder(b.name));
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

// --- Runs and research, read from the saved SDK spans (server/runs.py) -------

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
  parent_id?: string | null; // Additive: older servers still provide chronological depth-only timelines.
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
  playbook: PlaybookCheck | null;
  thesis: ThesisCheck | null;
}

export interface Claim {
  text: string;
  source: string;
}

export interface TradeThesis {
  regime: string;
  confidence: number;
  summary: string;
  signals: { signal: string; stance: "for" | "against"; evidence: Claim }[];
  conflicts: { story: Claim; numbers: Claim; winner: "story" | "numbers" | "unresolved"; why: string }[];
  targets: { symbol: string; weight: number; reason: string }[];
  invalidation: Claim[];
  horizon_days: number;
  lessons_used: number[];
}

export interface ThesisCheck {
  thesis: TradeThesis | null;
  raw?: string;
  claims: (Claim & { where: string; grounded: boolean })[];
  uncited: number;
  sources_available?: { tools: string[]; pages: number; lessons: string[] };
}

export interface PlaybookRule {
  id: string;
  text: string;
  status: "pass" | "fail" | "unknown";
  evidence: string;
}

export interface PlaybookCheck {
  id: string;
  name: string;
  orders: { order: { side: "buy" | "sell"; symbol: string; quantity: number; price: number | null }; rules: PlaybookRule[] }[];
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

// --- Lessons and memory (server/review.py, server/memory.py) ---------------

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

// --- Experiment Lab (server/lab) --------------------------------------------

export interface Baseline {
  id: "hold" | "spy" | "equal" | "random";
  label: string;
  detail: string;
  return: number;
  edge: number; // against doing nothing
  grade: Grade | null;
  score: number;
  lo: number | null;
  hi: number | null;
}

export type Grade = "pass" | "partial" | "fail";

export interface ScenarioInfo {
  id: string;
  version: number;
  title: string;
  family: string;
  question: string;
  task: "trade" | "rebalance";
  as_of: string;
  horizon_days: number;
  universe: { symbol: string; name: string; price: number; price_end: number; move: number }[];
  cash: number;
  positions: Record<string, number>;
  equity_start: number;
  documents: { id: string; title: string; url: string; date: string }[];
  grading: Record<string, Record<string, unknown>[]>;
  baselines: Baseline[];
}

export interface DimensionValue {
  id: string;
  label: string;
  detail: string;
}

export interface Dimension {
  id: "agent" | "researcher" | "model" | "prompt" | "strategy";
  label: string;
  question: string;
  values: DimensionValue[];
  default: string[];
}

export interface WorkerState {
  alive: boolean;
  seen_at: string | null;
  busy: string | null;
}

export interface Estimate {
  seconds: number;
  measured: number; // finished trials the estimate is the median of; 0 means a guess
}

export interface LabCatalog {
  scenarios: ScenarioInfo[];
  dimensions: Dimension[];
  worker: WorkerState;
  estimate: Estimate;
}

export type Arm = Record<Dimension["id"], string>;

export interface ExperimentSpec {
  name?: string;
  scenarios: string[];
  arms: Record<string, string[]>;
  trials: number;
}

export interface ExperimentListItem {
  id: string;
  name: string;
  spec: ExperimentSpec;
  status: "queued" | "running" | "done" | "cancelled";
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  progress: Partial<Record<"queued" | "running" | "done" | "error" | "cancelled", number>>;
}

export interface Interval {
  mean: number | null;
  lo: number | null;
  hi: number | null;
  n: number;
}

export interface ArmSummary {
  arm_id: string;
  arm: Arm;
  n: number;
  score: Interval;
  edge: Interval;
  return: Interval;
  tokens: Interval;
  seconds: Interval;
  research_calls: Interval;
  violations: Interval;
  recovered: Interval;
  loops: Interval;
  adherence: Interval;
  uncited: Interval;
  conflicts: Interval;
  violated: number;
  completed: number;
  cited: number;
  grades: Record<Grade, number>;
}

export interface Effect {
  dimension: Dimension["id"];
  value: string;
  reference: string;
  cells: number;
  score: Interval;
  edge: Interval;
  seconds: Interval;
  tokens: Interval;
  violations: Interval;
  token_ratio: number | null;
}

export interface TrialCell {
  id: number;
  seq: number;
  scenario_id: string;
  arm_id: string;
  trial: number;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  started_at: string | null;
  ended_at: string | null;
  grade: Grade | null;
  action: string | null;
  error_kind: string | null;
}

export interface ScenarioArmCell {
  score: number;
  edge: number;
  trials: { id: number; trial: number; grade: Grade; score: number; action: string; edge: number; return: number;
    violations: number; tokens: number; seconds: number; error_kind: string | null }[];
}

export interface Experiment extends ExperimentListItem {
  manifest: Record<string, unknown>;
  arms: { arm_id: string; arm: Arm }[];
  cells: TrialCell[];
  summary: ArmSummary[];
  scenarios: Record<string, Record<string, ScenarioArmCell>>;
  effects: Effect[];
  worker: WorkerState;
  estimate: Estimate;
}

export interface LabOrder {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number | null;
  status: "filled" | "rejected";
  reason: string | null;
  rationale: string;
}

export interface TrialGrades {
  grade: Grade;
  score: number;
  action: string;
  return: number;
  edge: number;
  attempts: number;
  filled: number;
  violations: number;
  violation_reasons: string[];
  completed: boolean;
  error_kind: string | null;
  model_calls: number;
  tokens: number;
  tokens_in: number;
  tokens_out: number;
  research_calls: number;
  research_tokens: number;
  searches: number;
  tool_calls: number;
  lookups: number;
  loops: number;
  recovered: number;
  evidence_cited: boolean;
  seconds: number;
  adherence?: number | null; // share of playbook rule checks passed (regime scenarios)
  rule_checks?: number;
  uncited?: number | null; // share of the thesis's claims with no source in the trial
  conflicts?: number | null; // story-vs-numbers conflicts the thesis named
}

export interface TrialDetail {
  id: number;
  experiment_id: string;
  scenario_id: string;
  arm_id: string;
  arm: Arm;
  trial: number;
  status: TrialCell["status"];
  trace_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  error: string | null;
  result: { orders: LabOrder[]; lookups: string[]; cash: number; positions: Record<string, number>; output: string | null } | null;
  grades: TrialGrades | null;
  run: RunDetail | null;
}

async function send<T>(path: string, body?: unknown): Promise<T> {
  if (VIEW_ONLY) throw new Error("This dashboard is view-only.");
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(typeof detail?.detail === "string" ? detail.detail : `${path} failed: ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export function getLabCatalog(): Promise<LabCatalog> {
  return get("/api/lab/catalog");
}

export function getExperiments(): Promise<ExperimentListItem[]> {
  return get("/api/experiments");
}

export function getExperiment(id: string): Promise<Experiment> {
  return get(`/api/experiments/${encodeURIComponent(id)}`);
}

export function getTrial(id: number): Promise<TrialDetail> {
  return get(`/api/lab/trials/${id}`);
}

export function createExperiment(spec: ExperimentSpec): Promise<{ id: string; trials: number }> {
  return send("/api/experiments", spec);
}

export function cancelExperiment(id: string): Promise<{ id: string }> {
  return send(`/api/experiments/${encodeURIComponent(id)}/cancel`);
}

// --- Market Year, from the daily pipeline (server/quant) -----------------------

export type RegimeLabel = "Calm bull" | "Volatile bull" | "Calm chop" | "Stress";
export type RegimeModel = "rules" | "hmm";
export type YearRange = "ytd" | "2y" | "10y";

export interface MarketEvent {
  day: string;
  headline: string;
  summary: string;
  sources: { title: string | null; url: string }[];
  trace_id: string | null;
}

export interface Episode {
  label: RegimeLabel;
  risk: string;
  start: string;
  end: string;
  open: boolean;
  days: number;
  spy_return: number;
  max_drawdown: number;
  vol: number | null;
  leaders: { symbol: string; name: string; return: number }[];
  laggards: { symbol: string; name: string; return: number }[];
  event: MarketEvent | null;
}

export interface RegimeSince {
  label: RegimeLabel;
  since: string;
  days: number;
  risk: string;
}

export interface ScoreCell {
  signal: string;
  regime: RegimeLabel | "All";
  window: "ytd" | "10y" | "blend";
  n_days: number;
  n_episodes: number;
  ann_return: number | null;
  hit_rate: number | null;
  sharpe: number | null;
  ci_lo: number | null;
  ci_hi: number | null;
}

export interface Exposure {
  trader: string;
  equity: number;
  cash: number;
  risk_on: number;
  defensive: number;
  positions: { symbol: string; quantity: number; value: number; priced: string; bucket: "risk_on" | "defensive" }[];
}

export interface MarketYear {
  ready: true;
  as_of: string;
  range: YearRange;
  start: string;
  computed_at: string;
  versions: Partial<Record<RegimeModel, string>>;
  bars: { n: number; symbols: number; first: string; last: string; source: string };
  labels: RegimeLabel[];
  risk: Record<RegimeLabel, string>;
  series: {
    days: string[];
    spy: number[];
    sma200: (number | null)[];
    rules: (RegimeLabel | null)[];
    hmm: (RegimeLabel | null)[];
    hmm_prob: (number | null)[];
    hmm_probs: (Record<RegimeLabel, number> | null)[];
  };
  read: {
    day: string;
    rules: RegimeSince;
    hmm: (RegimeSince & { prob: number; probs: Record<RegimeLabel, number> }) | null;
    agree: boolean;
    raw: Record<RegimeModel, RegimeLabel | null>;
    /** Trading days each model's raw daily label has held; it confirms at `dwell`. */
    raw_days: Record<RegimeModel, number>;
    dwell: number;
    switches_this_month: number;
    features: { key: string; label: string; unit: string; value: number | null }[];
  };
  episodes: Record<RegimeModel, Episode[]>;
  signals: { id: string; label: string; rule: string }[];
  scores: Record<RegimeModel, { as_of: string | null; cells: ScoreCell[] }>;
  exposure: Exposure[];
  notes: string[];
}

export type MarketYearResponse = MarketYear | { ready: false; bars: { n: number } };

export function getMarketYear(range: YearRange): Promise<MarketYearResponse> {
  return get(`/api/market-year?range=${range}`);
}

// --- Health: recent agent activity from the saved spans (server/runs.py) -------

export interface ActivitySpan {
  trader: string;
  trace_id: string;
  kind: "turn" | "generation" | "function" | "mcp_tools";
  name: string;
  started_at: string | null;
  ended_at: string | null;
  error: boolean;
}

export interface Activity {
  start: string;
  end: string;
  now: string;
  /** Set when nothing ran in the window: the window then ends at the last span. */
  idle_since: string | null;
  spans: ActivitySpan[];
  errors: number;
  tokens_per_second: number | null;
  db_bytes: number | null;
}

export function getActivity(minutes: number): Promise<Activity> {
  return get(`/api/health/activity?minutes=${minutes}`);
}
