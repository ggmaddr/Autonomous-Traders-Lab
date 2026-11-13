# Architectural Mechanisms

The `/architecture` route is an independent **Engineering → Architectural Mechanisms** navigation item, outside Lab. Mechanism deep links use `?mechanism=memory` (or any ID below). The public gateway allows the page without extending its API allowlist.

## Implementation order and experience

1. **Overall architecture:** a lazy-loaded Three.js systems bench, directional connections, selectable contracts, dependency highlighting, camera controls, separated layers and a seven-step Robin-cycle walkthrough.
2. **Focused mechanisms:** distinct radial, staged, tree and matrix layouts. Saved-span inspection, an experiment-plan matrix and an ORB clock/sizing instrument provide mechanism-specific interactions.
3. **Agent strategy architecture:** five strategy cards compare inputs, decisions, tools and playbooks. They explicitly share a single Qwen2.5 Coder 32B model; they are not individually fine-tuned models. Zoro and Sanji have a separate rules-only mechanism.

Anatomy supplied the instrument vocabulary, mechanical forms, purposeful detail, motion and verification approach. Native Three.js provides orbit/pan/zoom, lighting and depth for the requested network. These are native 3D meshes, not the Anatomy SVG/turn runtime, so its SVG painter-order and line-end audits do not apply. Source files in the shared Claude skill were read in place, not copied or modified. Sites' local-preview guidance was also consulted; existing repository hosting is retained.

## Source-backed scenes

| ID | Mechanism | Main evidence |
| --- | --- | --- |
| `overview` | Complete system, including the separate fast desk | `server/trading_floor.py`, `server/traders.py`, `server/mcp_servers.py` |
| `orchestration` | Agent-as-tool delegation and shared inference | `server/traders.py`, `server/robin.py`, `local_llm.py` |
| `memory` | Research graph, outcome review, lessons, contradiction, recall | `server/memory.py`, `server/review.py`, `server/runs.py` |
| `research` | Robin's requested research-to-paper-order workflow | `server/robin.py:thesis_message`, `server/quant/tools.py` |
| `observability` | Persisted runs, exact parent IDs, spans and trade joins | `server/tracers.py`, `server/runs.py`, `server/database.py` |
| `experiments` | Scenario fixtures, arms, isolated accounts and graders | `server/lab/{scenarios,arms,env,runner,grading,stats}.py` |
| `quant` | Daily bars, features, rule/HMM regimes, signals and sizing | `server/quant/{pipeline,features,regimes,signals,tools}.py` |
| `guardrails` | Mutation binding, fixed playbooks, calculator versus execution checks | `server/accounts_server.py`, `server/accounts.py`, `server/playbooks.py` |
| `luffy` | ORB signal, sizing, time windows and closing attempts | `server/orb.py`, `server/day_trade_server.py`, `server/luffy.py` |
| `infrastructure` | Separate execution, persistence, API and public boundary | `server/api.py`, `server/public_web.py`, `client/src/main.tsx` |
| `reliability` | Specific recovery, error persistence and planned fault testing | `local_llm.py`, `server/traders.py`, `server/lab/runner.py`, `client/src/nav.ts` |
| `fast-desk` | Zoro/Sanji's one-minute deterministic loop | `server/active_traders.py` |

The source audit is based on repository revision `cdde9d2`. `client/src/architecture/model.ts` holds 42 component contracts with source paths/symbols. Update this curated map and its audit reference when the corresponding architecture changes. It is not generated from runtime configuration.

## Truth and status contract

- **Implemented** means a code path exists, not that its provider is currently online, a run succeeded, or a strategy is profitable.
- **Experimental** covers the HMM comparison; the rules series drives Robin's cycle gate.
- **Known limitation** marks incomplete generic execution validation. Account binding, cash, holdings and missing-price checks exist. Universal positive-quantity/finite-value validation and all playbook limits are not enforced by the generic Account order methods. The Lab and rules-only desk have different, stricter checks.
- **Planned** marks a proven memory-improvement evaluation and the general failure-injection platform. Neither is depicted as running.
- Researcher/Synthesizer are nested **agents as tools**, not SDK handoffs replacing the parent. Shared graph nodes collapse per-trader MCP and Researcher instances.
- Memory writes, 3/10-day outcome reviews, contradiction edges and before-order recall counts exist. None establish a causal return benefit, and there is no model-weight training loop.
- Robin's `REBALANCE_DAYS` is currently **1**, despite the legacy `thesis-weekly` mode name.
- Nami has risk-parity instructions, not a dedicated Quant MCP connection or risk-parity optimizer.
- Luffy's setup feed is Alpaca IEX; ordinary Account fills use the market adapter. Stop flags require agent action. Floor-driven 15:50 liquidation attempts can fail and do not have agent traces.
- Lab scenarios fix evidence/prices and manifests record hashes, but the worker reloads files and reads as-of stored bars. This is not an immutable queued-input archive. Sampling remains stochastic.
- The animated graph and walkthroughs are **explanatory**, not live telemetry. Only the optional saved-run inspector loads actual traces. Trial-planning and sizing instruments are explicitly illustrative and never submit work.

## Engineering and accessibility

- Only the architecture route loads Three.js. Static module parts are merged by material to reduce draw calls. Pixel ratio is capped at 1.5; resources, controls and WebGL contexts are released on scene changes.
- Agent modules use low-poly robot heads with distinct identity accents and silhouettes; the Researcher adds round glasses. Memory uses a multicolored connected-graph symbol and its own atlas layout. These are symbolic shapes, not portraits or live memory contents. Label colors still identify architectural layers. Faces use static geometry with no textures, additional lights or facial animation; nested parts are baked into the existing material batches.
- FastAPI uses a shallow blue/gold Python emblem; the frontend uses three cyan React hoops and a nucleus. Both reuse static, material-batched geometry. The Python silhouette is adapted from [Simple Icons](https://github.com/simple-icons/simple-icons/blob/develop/icons/python.svg) (CC0).
- Quant MCP uses a bright vector-math board with coordinate axes, colored arrows and a symbolic parabola. Alpaca uses a miniature colorful OHLCV dashboard; its candles and volume bars are symbolic icon details, not live or historical market values. Both use existing primitive geometry and material batching.
- Search + Fetch uses a blue globe with latitude/longitude rings and a gold magnifier; Accounts MCP uses a violet wallet with colorful cards. Zoro + Sanji share a compact green/gold robot-duo module while retaining their rules-only description. All are static, material-batched primitives; the open magnifier needs no transparent lens or texture.
- Day-trade MCP uses a colorful candle chart with a raised clock. Market MCP uses a ticker board with geometric SPY/QQQ/IWM lettering and illustrative direction marks. These static icon details are not current quotes, signals or wall-clock time; no fonts, textures or live feeds are loaded.
- Rendering pauses offscreen or in a hidden document; reduced motion disables continuous animation. Controls support pause, reset, rotate, zoom, focus and presentation mode. Presentation mode supports Escape and confines keyboard focus.
- HTML component buttons, contracts, a searchable component index and step controls remain accessible. A WebGL failure renders a component explorer rather than a blank panel.
- Component labels face the viewer at fixed anchors above their modules. They may overlap or leave the viewport while orbiting; no collision avoidance, viewport clamping, leader lines or independent position smoothing moves them around. Labels are projected only when the view or module positions change.
- Desktop and mobile use the same data model. Explanations follow the website's existing light/dark palette; the 3D instrument remains a dark technical surface.
- `parent_id` is an additive field in run timelines. The tree uses actual parent IDs, so concurrent child spans cannot be assigned to the wrong parent by chronological adjacency. Older servers still display depth-only timelines without inventing expandable relationships.

Three.js references: [OrbitControls](https://threejs.org/docs/pages/OrbitControls), [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer).

## Verification and recording

```sh
npm run test:architecture --prefix client
npm run build --prefix client
uv run python -m unittest server.test_public_web server.test_architecture -v
```

The frontend test validates unique IDs, all edge and walkthrough endpoints, related navigation, source paths/symbols, explicit status caveats, strategy names, and trace nesting/collapse under overlapping calls. Public-boundary tests include both the overview and mechanism deep links, while retaining write blocking and private-file protections.

For a recording: open `/architecture`, choose **Present**, start the walkthrough, pause on a component, choose **Focus in 3D**, and follow a related mechanism. **Reset view** restores the scene. Turn off motion for static captures. Start at `/architecture?mechanism=memory` or `...=experiments` for a focused demonstration. A walkthrough represents the documented requested workflow; actual runs can diverge and are inspectable in Decisions or the saved-trace panel.
