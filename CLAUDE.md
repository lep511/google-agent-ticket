# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server (Express + Vite middleware) on http://localhost:3000
npm run build        # Vite frontend build + esbuild server bundle → dist/
npm run lint         # tsc --noEmit (type check only)
npm test             # vitest --run (all four projects, ~4 min)
npm run test:essential      # projects `server` + `web`: fast suites, ~21 s
npm run test:non-essential  # projects `server-slow` + `web-slow`: the long property suites
npm run test:watch   # vitest in watch mode, essential suites only
```

Run a single test file:
```bash
npx vitest --run server/lib/agentRegistry.test.ts
npx vitest --run src/agentInput.test.ts
```

fast-check property tests run at least 100 iterations. Override with `FC_NUM_RUNS=500 npm test`. Seed with `FC_SEED=12345` for reproducibility.

## Architecture

**Tickr** is a single-process app: an Express server runs AI agents in-process using the [Strands Agents SDK](https://strandsagents.com/) and streams results as SSE to a React frontend served by Vite (dev) or from `dist/` (production).

### Deployment topology

- **Frontend**: Deployed on Vercel (Vite static build) at `https://tickr-bay.vercel.app`
- **Backend**: Express server running on EC2
- Vercel rewrites `/api/*` to the EC2 backend (configured in `vercel.json`)
- Auto-deploys on push to `main` via GitHub integration (repo: `lep511/google-agent-ticket`)

### Runtime stack

- **Agent SDK**: `@strands-agents/sdk` with NVIDIA NIM provider (OpenAI-compatible endpoint)
- **Model**: DeepSeek V4 Flash via `NVIDIA_API_KEY` (default: `deepseek-ai/deepseek-v4-flash-0731`)
- **Tools**: `braveSearchTool` (web search via Brave API), `calculatorTool` (arithmetic), tool registry for automatic resolution per agent
- **Auth**: Amazon Cognito (user pool `us-east-1_2kDiHif9V`, Managed Login with authorization code + PKCE)
- **Frontend**: React 19, Tailwind CSS 4, Recharts, motion (animations), lucide-react (icons)

### Key directories

| Path | Purpose |
|------|---------|
| `server.ts` | Express entry point: mounts API routes, Vite middleware, access control |
| `server/lib/model/` | Model providers: `strandsAgent.ts` (Strands runner), `nvidiaProvider.ts` (NVIDIA NIM) |
| `server/lib/agent/` | Agent system: registry, catalog, manifest validation, types, events |
| `server/lib/tools/` | Tool implementations: `braveSearchTool.ts`, `calculatorTool.ts`, `toolRegistry.ts` |
| `server/lib/` | Other server modules: input validation, prompt builder, Cognito auth, artifact upload |
| `agent/` | Agent definitions (discovered at runtime from filesystem). Each subfolder is one agent |
| `src/` | React frontend: App, components, client-side types and logic |
| `cognito_setup/` | Cognito deployment scripts (`deploy.sh`, `teardown.sh`, Managed Login branding) |
| `tests/` | Shared fixtures, setup files, and test helpers |

### Agent system

Agents are filesystem-discovered from `agent/<agent_id>/`. Each folder contains:
- `manifest.json` — catalog metadata (id, name, inputMode, outputRenderer, etc.)
- `AGENTS.md` — system prompt
- `prompt.md` — user prompt template with `{{input}}`, `{{instruction}}`, `{{schema}}` placeholders
- `output.schema.json` — JSON schema the model must return

Current agents: `financial_analyst_agent`, `web_search_agent`, `brainstorm_agent`, `calculator_agent`.

The registry (`server/lib/agent/agentRegistry.ts`) caches the catalog in memory and rebuilds when the mtime of `agent/` changes. Adding a new agent requires no TypeScript changes.

### Request flow

1. `POST /api/analyze` receives `agentId`, `input`, optional `instruction` and `model`
2. Agent is resolved (exact match or fall back to default), input validated per `inputMode`
3. System prompt (`AGENTS.md`) + assembled user prompt (`prompt.md` with placeholders filled) are passed to a Strands `Agent`
4. SSE stream sends: `agent_info` → `thinking`/`text`/`tool_call`/`tool_result` → `complete` → `final_stats` → `done`
5. Run logs written to `run_logs/` as `.jsonl` + `.txt`

### Test structure

Two vitest projects configured in `vitest.config.ts`:
- **server**: `environment: 'node'`, covers `server/**/*.test.ts` and `tests/server/**`
- **web**: `environment: 'jsdom'`, covers `src/**/*.test.{ts,tsx}` and `tests/web/**`

Motion library is stubbed in web tests (`tests/helpers/motionStub.tsx`).

## Conventions

- **Language**: All written output in English — code comments, UI copy, error messages, console output, commit messages, docs, and test names. This supersedes the earlier Spanish convention found in older files (`src/App.tsx`, `src/agentSelection.ts`). Translate opportunistically when editing those blocks, not repo-wide.
- **Path alias**: `@/` resolves to the repo root (configured in tsconfig, vite, and vitest).
- **Requirement citations**: Comments may reference `(Requirement X.Y)` — preserve these when editing nearby code.
- **Agent IDs**: Must be snake_case (`a-z`, `0-9`, single `_` separators).
- **Input modes**: `ticker` (1-10 chars A-Z0-9) or `text` (1-2000 chars).
- **Output renderers**: `financial_report` or `simple_report`.

## Environment

Required in `.env`:
- `NVIDIA_API_KEY` — NVIDIA NGC API key for NIM models
- `VITE_COGNITO_USER_POOL_ID` — Cognito user pool ID
- `VITE_COGNITO_CLIENT_ID` — Cognito app client ID
- `VITE_COGNITO_REGION` — AWS region (e.g. `us-east-1`)
- `VITE_COGNITO_DOMAIN` — Cognito Managed Login domain prefix

Optional:
- `NVIDIA_MODEL_ID` — override model (default: `deepseek-ai/deepseek-v4-flash-0731`)
- `BRAVE_API_KEY` — Brave Search API key (required for `web_search_agent`)
- `HOST` — bind address (default `127.0.0.1`; non-loopback requires `API_ACCESS_TOKEN`)
- `API_ACCESS_TOKEN` — shared secret (≥32 chars) required when HOST is not loopback
- `CORS_ORIGINS` — comma-separated origins allowed for cross-origin API calls (e.g. `https://tickr-bay.vercel.app`)
- `MCP_CONFIG_PATH` — path to MCP servers JSON config for additional agent tools
