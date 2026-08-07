# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server (Express + Vite middleware) on http://localhost:3000
npm run build        # Vite frontend build + esbuild server bundle → dist/
npm run lint         # tsc --noEmit (type check only)
npm test             # vitest --run (all projects)
npm run test:watch   # vitest in watch mode
```

Run a single test file:
```bash
npx vitest --run server/lib/agentRegistry.test.ts
npx vitest --run src/agentInput.test.ts
```

fast-check property tests run at least 100 iterations. Override with `FC_NUM_RUNS=500 npm test`. Seed with `FC_SEED=12345` for reproducibility.

## Architecture

**Tickr** is a single-process app: an Express server runs AI agents in-process using the [Strands Agents SDK](https://strandsagents.com/) and streams results as SSE to a React frontend served by Vite (dev) or from `dist/` (production).

### Runtime stack

- **Agent SDK**: `@strands-agents/sdk` with `VercelModel` adapter wrapping `@ai-sdk/google` (Gemini)
- **Model**: Gemini 3.x via `GEMINI_API_KEY`. Gemini 2.5 breaks multi-step runs (it rejects replayed tool-call ids)
- **Tool**: `google_search` — a single grounded Gemini lookup per call; redirect URLs are resolved to publisher URLs before the agent sees them
- **Frontend**: React 19, Tailwind CSS 4, Recharts, motion (animations), lucide-react (icons)

### Key directories

| Path | Purpose |
|------|---------|
| `server.ts` | Express entry point: mounts API routes, Vite middleware, access control |
| `server/lib/` | All server modules: agent registry, validation, Strands runner, prompt builder, tools |
| `agent/` | Agent definitions (discovered at runtime from filesystem). Each subfolder is one agent |
| `src/` | React frontend: App, components, client-side types and logic |
| `tests/` | Shared fixtures, setup files, and test helpers |

### Agent system

Agents are filesystem-discovered from `agent/<agent_id>/`. Each folder contains:
- `manifest.json` — catalog metadata (id, name, inputMode, outputRenderer, etc.)
- `AGENTS.md` — system prompt
- `prompt.md` — user prompt template with `{{input}}`, `{{instruction}}`, `{{schema}}` placeholders
- `output.schema.json` — JSON schema the model must return

The registry (`server/lib/agentRegistry.ts`) caches the catalog in memory and rebuilds when the mtime of `agent/` changes. Adding a new agent requires no TypeScript changes.

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
- `GEMINI_API_KEY` — credentials for the Gemini model
- `VITE_COGNITO_*` — Cognito auth configuration (user pool, client, region, domain)

Optional:
- `GEMINI_MODEL_ID` — override agent model (default: `gemini-3.6-flash`)
- `GEMINI_SEARCH_MODEL_ID` — model for google_search tool (default: `gemini-2.5-flash`)
- `HOST` — bind address (default `127.0.0.1`; non-loopback requires `API_ACCESS_TOKEN`)
