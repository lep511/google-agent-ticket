# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Scripts live in `package.json`. Timings worth knowing: `npm test` runs all four vitest projects (~4 min), `npm run test:essential` is the fast `server` + `web` pair (~21 s), and `npm run test:non-essential` is the long property suites.

fast-check property tests run at least 100 iterations. Override with `FC_NUM_RUNS=500 npm test`. Seed with `FC_SEED=12345` for reproducibility.

## Architecture

**Tickr** is a single-process app: an Express server runs AI agents in-process using the [Strands Agents SDK](https://strandsagents.com/) and streams results as SSE to a React frontend served by Vite (dev) or from `dist/` (production).

### Deployment topology

- **Frontend**: Deployed on Vercel (Vite static build) at `https://tickr-bay.vercel.app`
- **Backend**: Express server running on EC2
- Vercel rewrites `/api/*` to the EC2 backend (configured in Vercel dashboard, not in repo — to avoid exposing the server IP)
- Auto-deploys on push to `main` via GitHub integration

### Agent system

Agents are filesystem-discovered from `agent/<agent_id>/`. The registry (`server/lib/agent/agentRegistry.ts`) caches the catalog in memory and rebuilds when the mtime of `agent/` changes. Adding a new agent requires no TypeScript changes.

### Request flow

SSE event order from `POST /api/analyze`: `agent_info` → `thinking`/`text`/`tool_call`/`tool_result` → `complete` → `final_stats` → `done`.

### Test structure

Motion library is stubbed in web tests (`tests/helpers/motionStub.tsx`).

## Conventions

- **Language**: All written output in English — code comments, UI copy, error messages, console output, commit messages, docs, and test names. This supersedes the earlier Spanish convention found in older files (`src/App.tsx`, `src/agentSelection.ts`). Translate opportunistically when editing those blocks, not repo-wide.
- **Requirement citations**: Comments may reference `(Requirement X.Y)` — preserve these when editing nearby code.
- **Agent IDs**: Must be snake_case (`a-z`, `0-9`, single `_` separators).

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
