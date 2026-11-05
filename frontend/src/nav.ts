// Every view of the lab, in the order of plan §11.2. Views not built yet carry the
// roadmap phase that builds them (§16) and what they will answer.

export interface NavItem {
  path: string;
  label: string;
  question: string;
  phase?: number;
  shows?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Desk",
    items: [
      { path: "/", label: "Money", question: "Where is the money and how is it doing?" },
      { path: "/trades", label: "Trades", question: "What do we hold and what did each trade earn?" },
    ],
  },
  {
    label: "Why it traded",
    items: [
      { path: "/researcher", label: "Researcher", question: "What did the researcher find, and did it help?" },
      { path: "/decisions", label: "Decisions", question: "Why did this trade happen?" },
      { path: "/lessons", label: "Lessons", question: "What have the agents learned, and is it still true?" },
      { path: "/memory", label: "Memory", question: "What does each agent's long-term memory contain?" },
    ],
  },
  {
    label: "Lab",
    items: [
      { path: "/experiments", label: "Experiments", question: "Which configuration is better, by how much, at what cost?" },
      {
        path: "/failures",
        label: "Failures",
        phase: 5,
        question: "How does the system behave when something breaks?",
        shows: [
          "A catalogue of faults: feed down, stale prices, researcher timeout, broker rejection",
          "Expected against actual outcome, with the trace",
          "How V1 behaved against how it behaves now",
        ],
      },
      {
        path: "/health",
        label: "Health",
        question: "Is the infrastructure OK?",
        shows: ["MCP servers, model speed and queue", "Market feed freshness", "Database size and errors"],
      },
    ],
  },
];
