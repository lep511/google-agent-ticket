# Tickr

AI-powered agent platform that runs multi-step tasks with tool use and streams results in real time.

## Architecture

**Split deployment**: a React frontend on Vercel calls an Express backend on EC2 (or any server). The backend runs AI agents in-process using the Strands Agents SDK with no timeout limit.

```
┌─────────────────────┐  proxy   ┌─────────────────────────────┐
│  Vercel (frontend)  │  /api/*  │  EC2 / Server (backend)     │
│  Static React app   │ ───────► │  Express + Strands Agents   │
│  HTTPS only         │  HTTP    │  NVIDIA NIM (DeepSeek)      │
└─────────────────────┘          │  Brave Search               │
                                 └─────────────────────────────┘
```

Vercel rewrites proxy all `/api/*` requests to the backend server-to-server. The browser only communicates with Vercel over HTTPS — no mixed content, no self-signed certificates.

### Runtime stack

- **Agent SDK**: `@strands-agents/sdk` with `OpenAIModel` adapter
- **Model**: NVIDIA NIM via `NVIDIA_API_KEY` (default: `deepseek-ai/deepseek-v4-flash-0731`)
- **Tools**: `search_web` (Brave Search), `calculate` (arithmetic)
- **Frontend**: React 19, Tailwind CSS 4, Recharts, motion, lucide-react
- **Auth**: Amazon Cognito (Hosted UI, authorization code grant)

## Run Locally

**Prerequisites:** Node.js v18+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure `.env` (copy from `.env.example`):
   ```env
   NVIDIA_API_KEY=your_nvidia_api_key
   BRAVE_API_KEY=your_brave_api_key

   VITE_COGNITO_USER_POOL_ID=your_user_pool_id
   VITE_COGNITO_CLIENT_ID=your_client_id
   VITE_COGNITO_REGION=us-east-1
   VITE_COGNITO_DOMAIN=your-cognito-domain
   ```

3. Run:
   ```bash
   npm run dev
   ```

4. Open http://localhost:3000

### Cognito Setup

Use the scripts in `cognito_setup/` to provision a Cognito user pool:

```bash
cd cognito_setup
./deploy.sh                    # Create pool, client, domain
./deploy.sh --create-test-user # Add a test user
./brand.sh                     # Apply Tickr-themed login page
```

See [`cognito_setup/README.md`](cognito_setup/README.md) for full details.

## Deployment

### Option A: Single server (dev / self-hosted)

```bash
npm run build
npm start        # Serves frontend + API on port 3000
```

### Option B: Split (Vercel frontend + remote backend)

Frontend deploys to Vercel as a static site. Vercel proxies `/api/*` to the backend via rewrites. Backend runs on EC2 (or any server) with no timeout limit for agent runs.

**Backend (EC2):**
```env
HOST=0.0.0.0
API_ACCESS_TOKEN=<generated-secret>
CORS_ORIGINS=https://your-app.vercel.app
NVIDIA_API_KEY=...
BRAVE_API_KEY=...
```

**Vercel env vars (build-time only):**
```
VITE_COGNITO_USER_POOL_ID=...
VITE_COGNITO_CLIENT_ID=...
VITE_COGNITO_REGION=...
VITE_COGNITO_DOMAIN=...
```

**`vercel.json` rewrites:**
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "http://<server-ip>:3000/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Deploy:
```bash
vercel --prod
```

The browser never talks to the backend directly — Vercel handles HTTPS and forwards API requests server-to-server over HTTP.

**Keeping the backend running (pm2):**

The Express server must stay running for the Vercel frontend to work. Use `pm2` for process management.

If Node was installed via `nvm`, load it into the shell first (needed on fresh SSM/SSH sessions, since they don't source `.bashrc`/`.nvm` automatically):

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use <installed-node-version>   # e.g. nvm use 24.19.0
```

Install pm2 globally, then start the server with the **project's local `tsx` binary** — not `npx tsx`. `npx tsx` resolves against a cached copy under `~/.npm/_npx/...` instead of the project's `node_modules`, which fails with `ERR_MODULE_NOT_FOUND` for dependencies like `dotenv` that are only installed locally:

```bash
npm install -g pm2

cd /path/to/tickr
pm2 start ./node_modules/.bin/tsx --name tickr -- server.ts

pm2 save       # Persist across pm2 restarts
pm2 startup    # Prints a command to run once (with sudo) to auto-start on system boot
```

Useful commands:
```bash
pm2 logs tickr     # View logs
pm2 restart tickr  # Restart after code changes
pm2 stop tickr     # Stop the server
pm2 delete tickr   # Stop and remove from pm2's process list
pm2 flush tickr    # Clear old log output (useful after fixing a startup error)
```

## Agents

Every agent lives in its own folder under `agent/` and is discovered from the filesystem at runtime. Adding one requires **no TypeScript changes**.

| Folder | Input | Tools | Default |
| --- | --- | --- | --- |
| `agent/web_search_agent/` | `text` | `search_web` | yes |
| `agent/calculator_agent/` | `text` | `calculate` | no |
| `agent/brainstorm_agent/` | `text` | — | no |

### Agent folder structure

```
agent/<agent_id>/
├── manifest.json        # catalog + UI metadata
├── prompt.md            # prompt template with {{input}}, {{instruction}}, {{schema}}
├── output.schema.json   # JSON shape the model must return
└── AGENTS.md            # system prompt
```

The folder name is the `agentId`: snake_case (`a-z`, `0-9`, single `_` separators), matching the `id` field in the manifest.

### Manifest fields

Required:

| Field | Notes |
| --- | --- |
| `id` | Must equal folder name |
| `name` | Shown in selector |
| `tagline` | One-line description |
| `description` | Long description |
| `icon` | lucide-react icon name |
| `inputMode` | `ticker` or `text` |
| `inputPlaceholder` | Input field placeholder |
| `actionLabel` | Run button label |
| `outputRenderer` | `financial_report` or `simple_report` |

Optional:

| Field | Type | Default |
| --- | --- | --- |
| `order` | integer 0-9999 | `100` |
| `isDefault` | boolean | `false` |
| `supportsInstruction` | boolean | `false` |
| `accentColor` | hex color | `#FFFFFF1A` |
| `landing` | object | `null` |

### Adding a new agent

1. Create `agent/<agent_id>/` with snake_case name
2. Add `manifest.json`, `prompt.md`, `output.schema.json`, `AGENTS.md`
3. Restart or touch `agent/` — catalog rebuilds on mtime change
4. Verify: `curl http://localhost:3000/api/agents`

## Agent Runtime

Agents run in-process with the Strands SDK. One run is assembled from:

| Piece | Source |
| --- | --- |
| System prompt | `AGENTS.md` |
| User prompt | `prompt.md` with placeholders replaced |
| Model | request `model` field → `NVIDIA_MODEL_ID` env → default |
| Tools | per-agent (`search_web`, `calculate`, or none) |

`search_web` serializes its requests and keeps ~1.1 s between them, because Brave's free tier allows about one per second. A failed search returns an `error` field with empty results instead of throwing: a thrown tool error comes back to the model with nothing to act on, and the retries it triggers each cost a turn.

Model failures retry with exponential backoff (429, 5xx) up to 4 attempts.

### Turn budget (`MAX_AGENT_TURNS`)

A **turn** is one iteration of the agent loop: one model call plus the execution of any tools that call requested. `MAX_AGENT_TURNS` (`server/lib/model/strandsAgent.ts`, currently **50**) is the hard ceiling on turns per run, passed to the SDK as `limits: { turns }`.

It exists to stop runaway loops — a model that keeps calling tools and never writes an answer, for example retrying a rate-limited search forever — from burning tokens without end.

Sizing it matters, because the budget has to cover **every research turn plus the turn that writes the final answer**. Agents spend roughly one turn per tool call, and research-heavy ones spend many: `financial_analyst_agent` looks for several filings and then searches separately for monthly closing prices and quarterly figures.

**When the budget trips**, the SDK cuts the loop at the top of the next iteration and returns `stopReason: 'limitTurns'` without ever asking the model for an answer. The runner does not accept that outcome: it runs a **salvage pass** (`SALVAGE_PROMPT`, `SALVAGE_TURNS`) that reuses the agent's conversation and asks it to write the report from what it already gathered, with no further tool calls. The run reports a single `complete` event carrying the tokens of both passes plus `turnLimitReached: true`, and the browser notes in the timeline that the research was cut short. Without it, a run that spent its budget ended with tool traces and nothing to render.

A run that keeps tripping the budget is usually looping on a failing tool rather than genuinely needing more turns — check the run log before raising the ceiling.

Related limits, all in the same file:

| Constant | Value | Caps |
| --- | --- | --- |
| `MAX_AGENT_TURNS` | 50 | Agent-loop turns per run |
| `MAX_MODEL_ATTEMPTS` | 4 | Model attempts, first one included |
| `DEFAULT_MAX_OUTPUT_TOKENS` | 65536 | Output tokens per model call |

## API

- `GET /api/agents` — ordered catalog + `defaultAgentId` (public)
- `POST /api/analyze` — SSE stream: `agent_info` → `thinking`/`text`/`tool_call`/`tool_result` → `complete` → `final_stats` → `done` (**requires auth**)
- `GET /api/download_jsonl?ticker=<input>[&agent=<agentId>]` — download run log

### Authentication

Agent execution (`POST /api/analyze`) requires a valid Cognito ID token. The frontend sends it automatically via `Authorization: Bearer <id_token>`.

The backend verifies tokens using `aws-jwt-verify` against the configured user pool (`VITE_COGNITO_USER_POOL_ID` + `VITE_COGNITO_CLIENT_ID`). Invalid or expired tokens receive a 401 response with a descriptive error code (`auth_required`, `token_expired`, `invalid_token`).

The frontend gates all app functionality behind authentication — unauthenticated users see only a login screen. On sign out, all session state (history, reports, events) is cleared.

### Network access control

`HOST=127.0.0.1` (default) = local only. Any other address requires `API_ACCESS_TOKEN` (32+ chars). The token gate is bypassed for:
- Requests with a valid `Authorization: Bearer <token>` header
- Requests from origins listed in `CORS_ORIGINS`
- Vercel proxy requests (detected via `x-vercel-id` header when `CORS_ORIGINS` is set)

## Scripts

```bash
npm run dev          # Dev server on http://localhost:3000
npm run build        # Vite frontend + esbuild server bundle
npm start            # Production server from dist/
npm run lint         # tsc --noEmit
npm test             # vitest --run, every suite (~4 min)
npm run test:essential      # fast suites only (~21 s)
npm run test:non-essential  # the four long property suites
npm run test:watch   # vitest watch mode, essential suites only
```