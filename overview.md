# App Overview: Multi-Agent Financial Research System

> **Scope note:** the pipeline described below is the behavior of the default agent, `financial_analyst_agent`. The app hosts a **catalog of agents** discovered from the `agent/` folder, each with its own prompt, output schema and renderer. See [Agent Catalog](#agent-catalog) for how the catalog works and how to add an agent.

## Overall Logic
This application functions as an autonomous, multi-agent research research committee. When a user requests an analysis of a stock ticker, the app does not rely on a single, monolithic AI query. Instead, it orchestrates a structured pipeline where analytical workloads are distributed across specialized sub-agents. 

The pipeline runs in a simulated four-tier process:
1. **Tier 1 (Data Gathering & Domain Analysis)**: Domain-specific agents analyze distinct facets of the asset in parallel (e.g., technicals, options, fundamentals).
2. **Tier 2 (Case Construction & scenario impact)**: Agents synthesize the raw data into adversarial upside, downside, and Base cases, simulate scenario impact, and fact-check claims.
3. **Tier 3 (Judgment & Synthesis)**: A final executive agent evaluates the competing cases, resolves tensions, and compiles a structured JSON report.
4. **Tier 4 (Media Production)**: A post-processing agent synthesizes the debate into a multi-speaker audio podcast briefing.

The backend is a Node.js/Express server that constructs a prompt commanding the AI to simulate this multi-agent fan-out process, injecting the specialized instructions (skills) for each agent into the context. The final output is exfiltrated back to the server and parsed as a structured JSON object matching the React frontend's `ReportData` schema, resulting in a rich, interactive dashboard.

---

## Sub-Agents and Their Roles

### Tier 1: Data Gatherers & Domain Experts
These agents act as analysts focused on a specific slice of market data.
* **Fundamentals Agent**: Scores the financial health of the target ticker. Analyzes revenue growth, margins, Free Cash Flow (FCF), debt, and ROIC trends over a 5-year period.
* **Technical Analysis Agent**: Analyzes price structure, including trend, momentum, support/resistance levels, and relative strength versus the broader sector.
* **Options Flow Agent**: Examines unusual options activity, put/call skew, and implied volatility vs. historical averages to gauge market sentiment and expected price movement.
* **Insider & Institutional Agent**: Reviews Form 4 insider transactions and 13F institutional position changes to distinguish routine distribution from actionable conviction signals.
* **Earnings Call Agent**: Parses the last 2-4 earnings call transcripts to find guidance changes, shifts in management tone, and friction points during analyst Q&A.
* **News & Sentiment Agent**: Evaluates the 90-day narrative arc. Identifies what is driving the story, tracks sentiment trajectories, and maps out upcoming known catalysts.
* **Competitive Landscape Agent**: Positions the target ticker against 3-5 peers based on valuation multiples, growth rates, and market share trajectory.
* **scenario Composition Agent**: Evaluates the current sector, factor, and geography exposure of the hypothetical existing holdings to baseline the scenario before a new asset is added.

### Tier 2: Case Construction & Validation
These agents act as scenario managers and headwind officers.
* **upside case Agent**: Constructs the strongest, most honest case for accumulation the asset. It is strictly required to cite which Tier 1 sub-agent's data supports each of its arguments.
* **downside case Agent**: Plays the devil's advocate. Attacks the upside case by finding the weakest assumptions, ignored headwinds, and base-rate failures to construct a strong opposing thesis.
* **Base Case Agent**: Constructs the baseline expectations, modeling steady execution with in-line growth and stable margins against macro pressures.
* **Correlation & Overlap Agent**: Assesses how correlated the candidate stock is to the assets already held in the scenario.
* **scenario impact Simulator Agent**: Models the scenario after a hypothetical purchase at different position sizes (e.g., 2%, 5%, 10%) to estimate changes in exposure, Value at headwind (VaR), and Sharpe ratio.
* **Verifier Agent**: Acts as the compliance officer. Audits the constructed cases by checking every cited number against the underlying Tier 1 agent outputs, flagging unsupported claims or hallucinations.

### Tier 3: Judgment & Synthesis
* **Synthesis & Scoring Agent**: The Chief research Officer. It weighs the verified cases into a final, nuanced assessment. Instead of providing a binary "accumulate/distribute" guidance, it provides a structured view with a conviction score, key tensions, and a monitoring plan.

### Tier 4: Media Production
* **Media Director Agent**: Acts as the production team. It takes the textual debate outputs, creates a debate script, and converts it into a multi-speaker audio podcast briefing (using Gemini Flash audio features).

---

## Data Flow and Output Processing

1. **User Request**: The user selects a stock ticker and active agents in the React UI, which sends a POST request to `/api/analyze`.
2. **Context Assembly**: The Node.js server reads the agent descriptions and injects them into the instruction context for the AI interaction.
3. **LLM Orchestration**: The AI executes the Tier 1-2 fan-out parallel data gathering, runs the Tier 3 judgment layer, and triggers the Tier 4 media production step within a continuous interaction.
4. **Artifacts Exfiltration**: As a critical final step, the AI executes a bash script to exfiltrate generated artifacts (the JSON report objects and `.wav` audio files) back to the Express backend via `curl` requests to the `/api/upload_artifact` endpoint.
5. **Frontend Rendering**: The React application fetches the uploaded artifacts. The UI components (using Recharts and Tailwind CSS) map over this structured data to render:
    * **Executive Verdict**: Summary, Conviction Score, Key Tensions, and Monitoring Plan.
    * **Podcast Briefing**: An embedded audio player serving the rendered multi-speaker summary of the debate.
    * **Case Analysis**: A grid view displaying the upside case, downside case, and Base Case theses.
    * **Multi-Pane Trend (6M)**: A line chart mapping the 6-month price movement.
    * **Fundamentals**: Visualized financial metrics trends.
    * **Options Implied Move**: A visual slider showing expected price volatility.
    * **Sector Exposure Shift**: A pie chart showing the impact on scenario allocation.
    * **90-Day Sentiment Vector**: An area chart plotting sentiment trajectories.
    * **Peer Sorting Matrix**: A grid view comparing the target ticker against peers on valuation multiples and relative premium/discount.
    * **Earnings Call Anomalies**: An accordion list highlighting detected deflections, vague answers, or unusual language patterns in recent management calls.
    * **Critical Catalysts**: Upcoming events and timeline for potential price action triggers.
---

## Agent Catalog

The agent that runs is not hardcoded. `server/lib/agentRegistry.ts` discovers the catalog from the filesystem, `server/lib/promptBuilder.ts` assembles each run's prompt from the agent's own template, and the frontend renders the result with the renderer that agent declares. Adding an agent is a filesystem operation: **no TypeScript file changes**.

### Runtime pieces

* **Agent Registry** (`server/lib/agentRegistry.ts`): enumerates up to 100 direct subfolders of `agent/`, validates each `manifest.json`, applies defaults, sorts the catalog and resolves the default agent. The catalog is cached in memory and rebuilt only when the modification timestamp of `agent/` changes. An invalid folder is skipped with a single warning; the rest of the catalog keeps serving.
* **Prompt Builder** (`server/lib/promptBuilder.ts`): replaces `{{input}}`, `{{instruction}}` and `{{schema}}` in the agent's template and appends the shared JSON output rules block once. Any other `{{...}}` marker in the template aborts the run before any remote interaction is created.
* **`GET /api/agents`**: returns the ordered catalog plus the resolved `defaultAgentId`, built only from the in-memory catalog. No filesystem paths and no file contents are exposed.
* **`POST /api/analyze`**: resolves the agent from the `agentId` field (falling back to the default agent when it is missing or unknown), validates the input according to that agent's `inputMode`, loads only that agent's files as inline sources, and emits a single `agent_info` event (`agentId`, `agentName`, `outputRenderer`) before any other SSE event.
* **Frontend** (`src/App.tsx`, `src/components/AgentSelector.tsx`): the header selector lists the catalog, the selection is persisted in `localStorage` under `tickr.selectedAgentId`, the landing view and the input bar adapt to the active manifest, and the result is rendered by `ReportTemplate` (`financial_report`) or `SimpleReportView` (`simple_report`) according to the `agent_info` of the run that produced it.

### Agent folder structure

The folder name is the `agentId`: snake_case, and identical to the manifest's `id` field.

```
agent/<agent_id>/
├── manifest.json        # catalog + UI metadata (server only, not uploaded)
├── prompt.md            # prompt template (server only, not uploaded)
├── output.schema.json   # expected JSON output shape (server only, not uploaded)
├── AGENTS.md            # workspace rules for the remote agent (uploaded)
├── agent.yaml           # base agent, remote environment and tools (uploaded)
└── requirements.txt     # python dependencies of the remote environment (uploaded)
```

`AGENTS.md`, the prompt file and the schema file must exist, be readable and be non-empty, and the schema must parse as JSON.

### Manifest fields

Required, all non-empty strings: `id` (≤64, equals the folder name), `name` (≤64), `tagline` (≤160), `description` (≤1000), `icon` (≤64, from the allowed `lucide-react` list in `server/lib/agentTypes.ts`), `inputMode` (`ticker` or `text`), `inputPlaceholder` (≤160), `actionLabel` (≤160) and `outputRenderer` (`financial_report` or `simple_report`). Enumerated values are compared exactly, case sensitively.

Optional fields and their defaults (a wrong type degrades to the same default with a warning, keeping the entry):

| Field | Default |
| --- | --- |
| `order` (integer 0-9999) | `100` |
| `isDefault` | `false` |
| `supportsInstruction` | `false` |
| `promptFile` | `prompt.md` |
| `schemaFile` | `output.schema.json` |
| `accentColor` (hex) | `#FFFFFF1A`, translucent white |
| `landing` (`title`, `subtitle`, `highlights[]`) | `null`, falls back to `name` / `tagline` / `description` |

Ordering is `order` ascending, then `name` case-insensitively, then `agentId`. The default agent is the single entry with `isDefault: true`, otherwise `financial_analyst_agent`, otherwise the first entry in that order.

`inputMode` drives validation and the input bar: `ticker` accepts 1-10 characters of `A`-`Z` and `0`-`9`; `text` accepts 1-2000 characters. `supportsInstruction` decides whether the instruction field appears and whether `instruction` reaches the prompt.

### Steps to add a new agent

1. Create `agent/<agent_id>/` with a snake_case folder name.
2. Write `manifest.json` with the required fields, `id` matching the folder name, an `icon` from the allowed list, and the `inputMode` / `outputRenderer` pair the agent needs.
3. Write `prompt.md` using `{{input}}`, `{{instruction}}` and `{{schema}}`, and `output.schema.json` with the exact JSON shape the model must return. For `simple_report` the contract is `summary`, `key_points`, `sections` (`title`, `body`) and `sources` (`title`, `url`, `date`).
4. Add `AGENTS.md`, `agent.yaml` and `requirements.txt`, using an existing agent as the template (`base_agent`, remote environment without preconfigured sources, `google_search` as the tool).
5. Touch or restart so `agent/` gets a new modification timestamp; the registry rebuilds the catalog and the agent appears in `GET /api/agents` and in the header selector.

### Metadata files not uploaded to the remote environment

The agent folder is uploaded as inline sources under `/.agents`, preserving relative paths, except the server-side metadata files:

* `manifest.json`
* the prompt file declared in `promptFile` (default `prompt.md`)
* the schema file declared in `schemaFile` (default `output.schema.json`)

Only the resolved agent's folder is traversed (max depth 5, max 200 files, 1 MB per file). Other agents' folders, loose files at the root of `agent/` and symlinks resolving outside the folder are never uploaded, so agents cannot contaminate each other.

### Run traceability

Each run writes `run_log_<agentId>_<input>_<runId>.jsonl` and `run_log_<agentId>_<input>_<runId>.txt` in `run_logs/`, and `final_stats` publishes `jsonlLogUrl` for that run under the static `/run_logs` path. `GET /api/download_jsonl?ticker=<input>` returns the most recent matching `.jsonl` for any agent; adding `&agent=<agentId>` restricts the search to that agent. Legacy logs named `run_log_<input>_<runId>` are still recognized and are served under `/run_logs` with their original name, never renamed.
