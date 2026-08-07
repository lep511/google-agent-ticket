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

   # Model overrides (optional). See .env.example for the rest.
   GEMINI_MODEL_ID=gemini-3.6-flash
   
   # Server binding (optional). Defaults to 127.0.0.1, reachable only from this
   # machine. Any other address requires API_ACCESS_TOKEN (see "Network exposure").
   HOST=127.0.0.1
   API_ACCESS_TOKEN=
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
├── manifest.json        # catalog + UI metadata
├── prompt.md            # prompt template with {{input}}, {{instruction}}, {{schema}}
├── output.schema.json   # JSON shape the model must return
├── AGENTS.md            # instructions used as the agent's system prompt
└── agent.yaml           # deployment metadata, not read by the server
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
4. Add `AGENTS.md`, which becomes the system prompt: it declares the workflow, the search rules, the anti-hallucination rules and the output format. Copy an existing agent as a starting point. `agent.yaml` is deployment metadata and is not read by the server.
5. Restart or just touch `agent/` — the catalog is cached in memory and rebuilt whenever the modification timestamp of `agent/` changes.
6. Verify with `curl http://localhost:3000/api/agents` and pick the agent in the header selector.

Anything malformed is skipped with a single warning naming the folder and the first offending field or file, so a broken manifest never takes down the rest of the catalog.

## Agent runtime

Agents run **in this process** with the [Strands Agents SDK](https://strandsagents.com/) for TypeScript. There is no remote agent service and no `@google/genai` dependency: the models are reached through the Vercel AI SDK Google provider (`@ai-sdk/google`), which the Strands `VercelModel` adapter wraps.

One run is assembled from the agent folder like this:

| Piece | Source |
| --- | --- |
| System prompt | `AGENTS.md` |
| User prompt | `prompt.md` with `{{input}}`, `{{instruction}}` and `{{schema}}` replaced |
| Model | request `model` field, then `GEMINI_MODEL_ID`, then `gemini-3.6-flash` |
| Tools | `google_search` |

`google_search` takes a single `query` and answers with one grounded Gemini lookup: what the results say, the queries Google actually ran, and the pages they came from. Grounding hands back `vertexaisearch.cloud.google.com` redirect links, so each one is resolved to its publisher URL before the agent sees it, which is what lets the reports cite real sources.

Model failures are retried with exponential backoff for throttling (`429`) and for transient server errors (`5xx`), up to 4 attempts, so a blip halfway through a run does not discard the searches already done. Anything else fails the run.

Two notes on models:

- Use a Gemini 3.x model for the agent loop. `gemini-2.5-flash` answers `500 INTERNAL` when the provider replays the tool-call ids of a previous turn, so multi-step runs cannot complete against it. It is fine for `GEMINI_SEARCH_MODEL_ID`, whose calls are single-shot.
- A run that never produces its first event is rejected before the SSE stream opens, with `429` / `503` / `502` and a stable `code`, so the client can tell a temporary quota limit from a real failure.

## API notes

### Network exposure and access control

The server binds to `127.0.0.1` by default, so `npm run dev` is reachable only from the machine that runs it. `HOST` overrides the address, and any non-loopback value is refused unless `API_ACCESS_TOKEN` is set to a secret of at least 32 characters. When the server is bound to such an address, `/api/*`, `/artifacts` and `/run_logs` require `Authorization: Bearer <API_ACCESS_TOKEN>` and answer `401` with `{"code":"unauthorized"}` otherwise; the static frontend stays public.

This is a fail-safe gate against accidental exposure, not user authentication: the Cognito session the frontend obtains is still not verified server side, and the browser does not send the access token, so an exposed server serves the UI but rejects its API calls.

In dev the source is served by Vite from the project root, so `server.ts`, `server/**`, `agent/**`, the lockfiles and any root `test_*` script are denied through `server.fs.deny` in `vite.config.ts` and answer `403`. Production (`npm run build && npm start`) serves only `dist/`.

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
