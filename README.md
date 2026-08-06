<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/0e98dc47-4c39-44d6-b7a4-885bde9ec2de

## Run Locally

**Prerequisites:**  Node.js (v18 or higher recommended)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `.env`:
   ```env
   # Cognito Configuration (required for authentication)
   VITE_COGNITO_USER_POOL_ID=your_user_pool_id
   VITE_COGNITO_CLIENT_ID=your_client_id
   VITE_COGNITO_REGION=us-east-1
   VITE_COGNITO_DOMAIN=your-cognito-domain
   
   # Gemini API Key (required for AI analysis)
   GEMINI_API_KEY=your_gemini_api_key
   ```
   
   **Note**: See [COGNITO_SETUP.md](COGNITO_SETUP.md) for detailed instructions on configuring Cognito Hosted UI.

3. Run the app:
   ```bash
   npm run dev
   ```

4. Open your browser at `http://localhost:3000`
## Agents

The app does not hardcode a single agent. Every agent lives in its own folder under `agent/` and is discovered from the filesystem at runtime, so adding one requires **no TypeScript changes**.

The initial catalog ships with three agents:

| Folder | Input | Output renderer | Default |
| --- | --- | --- | --- |
| `agent/financial_analyst_agent/` | `ticker` | `financial_report` | yes |
| `agent/market_news_agent/` | `ticker` | `simple_report` | no |
| `agent/company_profile_agent/` | `text` | `simple_report` | no |

### Agent folder structure

The folder name is the `agentId`: it must be snake_case (`a`-`z`, `0`-`9`, single `_` separators) and must match the `id` field of the manifest character for character. Only direct subfolders of `agent/` are scanned (up to 100), and no loose files should sit at the root of `agent/`.

```
agent/<agent_id>/
├── manifest.json        # catalog + UI metadata (server only)
├── prompt.md            # prompt template with {{input}}, {{instruction}}, {{schema}} (server only)
├── output.schema.json   # JSON shape the model must return (server only)
├── AGENTS.md            # workspace rules for the remote agent (uploaded)
├── agent.yaml           # base agent, environment and tools (uploaded)
└── requirements.txt     # python dependencies of the remote environment (uploaded)
```

`AGENTS.md`, the prompt file and the schema file must exist, be readable and be non-empty, and the schema must contain valid JSON. Otherwise the folder is skipped with a warning and the rest of the catalog keeps working.

### Manifest fields

Required. All of them must be non-empty strings after trimming:

| Field | Max length | Notes |
| --- | --- | --- |
| `id` | 64 | Must equal the folder name exactly |
| `name` | 64 | Shown in the selector and the run header |
| `tagline` | 160 | One-line description in the selector |
| `description` | 1000 | Long description, also used as landing fallback |
| `icon` | 64 | Name from the allowed `lucide-react` list in `server/lib/agentTypes.ts` |
| `inputMode` | 64 | `ticker` or `text` (case sensitive) |
| `inputPlaceholder` | 160 | Placeholder of the input field |
| `actionLabel` | 160 | Label of the run button |
| `outputRenderer` | 64 | `financial_report` or `simple_report` (case sensitive) |

Optional, with the default applied when the field is omitted (a value of the wrong type falls back to the same default, logs a warning and keeps the entry):

| Field | Type | Default |
| --- | --- | --- |
| `order` | integer 0-9999 | `100` |
| `isDefault` | boolean | `false` |
| `supportsInstruction` | boolean | `false` |
| `promptFile` | simple file name | `prompt.md` |
| `schemaFile` | simple file name | `output.schema.json` |
| `accentColor` | hex color (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`) | `#FFFFFF1A` (translucent white) |
| `landing` | object with `title`, `subtitle`, `highlights[]` | `null` (falls back to `name`, `tagline`, `description`) |

The catalog is sorted by `order` ascending, then by `name` case-insensitively, then by `agentId`. Exactly one agent is the default: the single entry with `isDefault: true`, otherwise `financial_analyst_agent`, otherwise the first entry in that order.

`inputMode` also drives input validation: `ticker` accepts 1-10 characters of `A`-`Z` and `0`-`9` (trimmed and uppercased), `text` accepts 1-2000 characters after trimming. `supportsInstruction` decides whether the optional instruction field is shown and whether `instruction` reaches the prompt (max 2000 characters).

### Prompt template

`prompt.md` supports exactly three placeholders, all replaced in every occurrence:

- `{{input}}` — the validated, trimmed input value.
- `{{instruction}}` — the user instruction, or an empty string when the agent does not declare `supportsInstruction` or the instruction is empty.
- `{{schema}}` — the literal content of the schema file.

Any other `{{...}}` marker in the template aborts the run with an explicit error naming the marker. Placeholder-looking text inside the input, the instruction or the schema is safe: only the template is scanned. A shared JSON output rules block is appended once at the end of the prompt unless the template already states those rules. The template and the schema must each stay under 256 KiB.

`simple_report` agents must return `summary`, `key_points`, `sections` (`title`, `body`) and `sources` (`title`, `url`, `date`). `financial_report` agents return the richer `verdict` / `deep_insights` / `findings` / `financial_charts` shape.

### Adding a new agent

No TypeScript file needs to change:

1. Create `agent/<agent_id>/` using snake_case for the folder name.
2. Add `manifest.json` with the required fields; set `id` to the folder name, pick an `icon` from the allowed list, and choose `inputMode` and `outputRenderer`.
3. Add `prompt.md` with the placeholders your agent needs, and `output.schema.json` with the exact JSON shape it must return (use the `simple_report` contract unless you are building a financial report).
4. Add `AGENTS.md`, `agent.yaml` and `requirements.txt`. Copy an existing agent as a starting point: `agent.yaml` declares `base_agent`, the remote environment and the tools (`google_search`), and `AGENTS.md` declares the workspace rules, workflow, anti-hallucination rules and output format.
5. Restart or just touch `agent/` — the catalog is cached in memory and rebuilt whenever the modification timestamp of `agent/` changes.
6. Verify with `curl http://localhost:3000/api/agents` and pick the agent in the header selector.

Anything malformed is skipped with a single warning naming the folder and the first offending field or file, so a broken manifest never takes down the rest of the catalog.

### Files that are not uploaded to the remote environment

Every file in the agent folder is uploaded to the remote environment as an inline source under `/.agents`, preserving its relative path, **except** these server-side metadata files:

- `manifest.json`
- the prompt file declared in `promptFile` (default `prompt.md`)
- the schema file declared in `schemaFile` (default `output.schema.json`)

Only the resolved agent's own folder is traversed, up to 5 levels deep and 200 files, with a 1 MB limit per file. Files from other agent folders, loose files at the root of `agent/` and symlinks resolving outside the folder are never uploaded.

## API notes

- `GET /api/agents` — returns the ordered catalog and the resolved `defaultAgentId`. Filesystem paths and the content of `AGENTS.md`, the prompt and the schema are never exposed. An empty catalog answers `200` with an empty list and a `null` default.
- `POST /api/analyze` — accepts `agentId` (falls back to the default agent when missing or unknown), `input` (with the legacy `ticker` field as alias), the optional `instruction` and `model`. The SSE stream starts with a single `agent_info` event carrying `agentId`, `agentName` and `outputRenderer`, before the usual `thinking`, `text`, `tool_call`, `tool_result`, `complete`, `error`, `done` and `final_stats` events.
- `GET /api/download_jsonl?ticker=<input>[&agent=<agentId>]` — returns the most recent `.jsonl` run log for that input. With `agent`, the search is restricted to runs of that agentId; without it, any agent matches. `ticker` is required and accepts only `A`-`Z`, `a`-`z` and `0`-`9` (invalid values answer `400` without listing `run_logs/`); no match answers `404`.

### Run log naming

Each run writes two files in `run_logs/`:

```
run_log_<agentId>_<input>_<runId>.jsonl
run_log_<agentId>_<input>_<runId>.txt
```

`<input>` keeps letters and digits as received and replaces any other character with `_`, truncated to 40 characters. `<runId>` is the run timestamp shared by both files, and the highest one wins when several runs match. The `final_stats` event publishes `jsonlLogUrl` pointing at the `.jsonl` under the static `/run_logs` path. Logs written before the multi-agent migration follow the legacy `run_log_<input>_<runId>` pattern; they are still recognized by the download endpoint and served under `/run_logs` with their original name, never renamed.

## Scripts

```bash
npm run dev     # dev server on http://localhost:3000
npm run build   # vite build + bundled node server
npm run lint    # tsc --noEmit
npm test        # vitest --run
```
