# Agent Change Log

## [2026-08-07 18:00] Drop the unused `@google-cloud/storage` dependency

**Context/prompt:** What is `@google-cloud/storage` used for? Remove it completely.

**Files modified:**

- `package.json`, `package-lock.json` (`-@google-cloud/storage`, 57 packages removed from the tree)

**Summary:** Nothing imported it. A grep across every `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs` and `.html` outside `node_modules` and `dist` returned no reference, and `npm ls` listed it as a direct dependency rather than something another package pulled in. The only "storage" in the code is `window.localStorage`, in `interactionHistory.ts` and `agentSelection.ts`.

It is a leftover of a Firebase-era version of the app: `bun.lock` still records `firebase`, `firebase-admin` and `@google-cloud/firestore`, and `firebase-admin` declares `@google-cloud/storage` among its optional dependencies. Neither `firebase` nor `firebase-admin` is in `package.json` any more, but this one stayed behind. Artifacts are written to local disk today (`POST /api/upload_artifact` → `workspace/artifacts/`), and run logs to `run_logs/`; nothing uploads to a cloud bucket.

Removing it pruned 57 packages, including the `google-auth-library`, `gaxios`, `google-gax` and `protobufjs` chain.

**Also audited, left in place:** `archiver`, `jszip` and `pako` have no importers either (only their own `@types/*` entries reference them). They were not part of this request, so they stay for now.

**Verification:** `npm run lint` clean; `npm test` 234 tests across 19 files; `npm run build` clean; `npm ls @google-cloud/storage` reports an empty tree. Server boots and `GET /api/agents` answers `200`.

**Commit:** uncommitted

**Status:** ✅ Applied

---

## [2026-08-07 17:50] Remove the `/api/tts` endpoint

**Context/prompt:** Remove `/api/tts` completely.

**Files modified:**

- `server.ts` (handler and its import deleted; body-limit comment no longer cites the TTS payload)
- `server/lib/textToSpeech.ts`, `server/lib/textToSpeech.test.ts` (deleted)
- `.env.example` (`GEMINI_TTS_MODEL_ID` dropped)
- `server/lib/serverAccess.ts` (module comment no longer names the route)

**Summary:** Narration is gone. `POST /api/tts` had no caller: nothing under `src/` ever requested it, so removing it changes no user-visible behaviour. It was also the last route that talked to a Gemini endpoint outside the Strands agent loop, so the server now reaches Gemini through exactly one path, the `@ai-sdk/google` provider used by `strandsAgent.ts` and `googleSearchTool.ts`.

The artifact route is untouched: `DEFAULT_ARTIFACT_NAME` is still `podcast_briefing.wav` and `POST /api/upload_artifact` keeps accepting audio, since that upload came from the agent environment rather than from this endpoint.

**Verification:** `npm run lint` clean; `npm test` 226 tests across 19 files; `npm run build` clean. Server boots and `GET /api/agents` answers `200`; `POST /api/tts` now answers `404`, and a `market_news_agent` run still streams to `final_stats`. A repo-wide grep for `tts`, `textToSpeech` and `synthesizeSpeech` returns nothing outside this changelog.

**Commit:** uncommitted

**Status:** ✅ Applied

---

## [2026-08-07 17:30] Run the agents on the Strands Agents SDK and drop `@google/genai`

**Context/prompt:** Use strands-agents in this project and remove `@google/genai` completely; use the Strands MCP for any lookup.

**Files modified:**

- `server/lib/strandsAgent.ts` (rewritten: `VercelModel` instead of `GoogleModel`, token usage in `complete`, `GeminiRetryStrategy`, `classifyAgentFailureStatus`, failures thrown instead of swallowed)
- `server/lib/geminiProvider.ts`, `server/lib/googleSearchTool.ts`, `server/lib/agentEvents.ts`, `server/lib/textToSpeech.ts` (new)
- `server/lib/agentClient.ts`, `server/lib/agentClientPerseus.ts`, `tests/helpers/fakeAgentClient.ts` (deleted)
- `server.ts` (`/api/analyze` runs the Strands agent; `/api/tts` through `synthesizeSpeech`)
- `server/lib/agentRegistry.ts` (new `readAgentInstructions` / `getInstructions`)
- `server/lib/analyzeExecution.ts` (dropped the Perseus client selection and `toRemoteInlineSources`; `describeCreateInteractionFailure` → `describeAgentStartFailure`)
- `server/lib/strandsAgent.test.ts`, `server/lib/googleSearchTool.test.ts`, `server/lib/textToSpeech.test.ts` (new), `server/lib/analyzeExecution.test.ts`, `tests/server/helpers.test.ts`
- `package.json` (`-@google/genai`, `+@ai-sdk/google`, `+@ai-sdk/provider`)
- `README.md`, `.env.example`, `DEBUG_MODE.md`, `gallery.md`

**Summary:** `/api/analyze` used to POST to the remote Gemini Managed Agents endpoint (`agentClient.ts` and its byte-identical `agentClientPerseus.ts` copy), and `/api/tts` was the only importer of `@google/genai`. The agent loop now runs in-process with the Strands Agents SDK, which was already a dependency but had no importers.

`@google/genai` could not simply be replaced by the Strands Google provider: `@strands-agents/sdk/models/google` imports it, so the package would have stayed in the tree. The models are reached through `VercelModel` + `@ai-sdk/google` instead, which talks to the Generative Language REST API directly. `@ai-sdk/google` is pinned to the `3.x` line because that is what implements the `LanguageModelV3` interface the Strands adapter expects.

Search is a named `google_search` function tool rather than silent Gemini grounding, because every agent prompt names that tool and the timeline labels its calls by `arguments.query`. Each call is one grounded lookup, and grounding redirect links are resolved to publisher URLs so reports cite real sources. `AGENTS.md` becomes the system prompt, replacing the `/.agents` inline-source upload the remote sandbox needed.

The SSE contract is unchanged (`agent_info` → `thinking`/`text`/`tool_call`/`tool_result` → `complete` → `done` → `final_stats`), including the token count, which now comes from `result.metrics.accumulatedUsage`. Startup failures are still answered with `429`/`503`/`502` and a stable `code`: the first event is awaited before the SSE headers are written, so a run that never starts is rejected with a status instead of an empty stream. A run is also cancelled when the client disconnects (`res` close, not `req` close, which fires as soon as the body is read).

**Trade-offs:** the remote sandbox is gone, so agents no longer have code execution, a python environment or artifact uploads; `agent.yaml` and `requirements.txt` are now deployment metadata only. `server/lib/agentInlineSources.ts` and `agentRegistry.getInlineSources` are left in place but no longer used by the analyze path. `gemini-2.5-flash` cannot serve the agent loop: it answers `500 INTERNAL` when the provider replays tool-call ids, so the default is `gemini-3.6-flash`.

**Verification:** `npm run lint` clean; `npm test` 240 tests across 19 files; `npm run build` clean. Live end-to-end run of `market_news_agent` on TSLA: 8 `google_search` calls, 92 `text` events, `complete` with 36,192 tokens, `final_stats` with duration and log URL, and a valid `simple_report` JSON block citing 7 resolved publisher URLs. `POST /api/tts` returns a 167 KB `audio/wav`. Both run logs are written. `npm ls @google/genai` reports an empty tree.

**Commit:** uncommitted

**Status:** ✅ Applied

---

## [2026-08-06 21:39] Fix the three errors found while browsing the site on port 3000

**Context/prompt:** Browse the site on port 3000 looking for errors, then fix all of them.

**Files modified:**

- `public/favicon.svg` (new: Tickr mark), `index.html` (`<link rel="icon">`)
- `src/App.tsx` (new `countReportDocuments`, new `describeAnalyzeFailure`, both call sites of the `Docs` metric)
- `server/lib/analyzeExecution.ts` (new: `describeCreateInteractionFailure`, `CreateInteractionFailure`)
- `server.ts`, `test_server.ts` (`createInteraction` failure through the new helper)

**Summary:** A full pass over the running app (three agents, SSE streaming, both report renderers, debug panel, Cognito sign-in redirect) surfaced three defects.

1. No icon was declared, so every page load requested `/favicon.ico` and left a 404 in the console. Added `public/favicon.svg` and its `<link>`; the console is now clean on load.
2. The `Docs` metric was derived from `reportData.findings?.length`, a field that only exists in the `financial_report` contract, so it always read `0` for the `simple_report` agents (`market_news_agent`, `company_profile_agent`), which cite their documents in `sources`. `countReportDocuments(data, renderer)` now counts per contract and is used by both the timeline metric and `ReportTemplate`. The `financial_report` branch is unchanged.
3. Every `createInteraction` rejection collapsed into `500 {"error":"Failed to start agent interaction."}`, so a transient upstream quota limit was indistinguishable from a real failure and the reason only reached the server log; the UI showed `Server responded 500`. `describeCreateInteractionFailure` maps 429 to `429 upstream_rate_limited`, 503/504 to `503 upstream_unavailable`, anything else to `502 upstream_error`, each with `code`, `upstreamStatus` and `retryable`. On the client, `describeAnalyzeFailure` reads that body and shows the message with a `(reintentable)` suffix. Both server entry points share the helper, replacing the duplicated block.

Two findings were investigated and dismissed: the `net::ERR_ABORTED` on `GET /api/agents` is React StrictMode's double mount cancelled by the effect cleanup, and the fallback to the default agent on an unknown `agentId` is the documented behaviour of `resolveAgentSelection` (Requirements 5.x, 16.2).

**Verification:** `npm run lint` (`tsc --noEmit`) clean; `npm test` 168 tests passing across 12 files; `npm run build` clean with `favicon.svg` emitted into `dist/`. In the browser: zero console errors on load, and a Company Profile run on "Nvidia" reported `Docs: 8` matching the 8 links in the report's Sources section. `describeCreateInteractionFailure` checked against 429/503/504/500/400/undefined, and the client message verified by serving an intercepted 429. The `server.ts` changes need the `tsx server.ts` dev process restarted to take effect; it was left running untouched.

**Commit:** uncommitted (working tree on top of `7e47b07`)

**Status:** ✅ Applied

---

## [2026-08-06 17:30] Write all server debug artifacts to a `debug/` folder

**Context/prompt:** Debug files should be saved in the `debug` folder; update `DEBUG_MODE.md`.

**Files modified:**

- `server/lib/debugFiles.ts` (new: `debug/` path resolution, guarded append/write helpers)
- `server/lib/agentClient.ts`, `server/lib/agentClientPerseus.ts` (delta log through the helper)
- `server.ts`, `test_server.ts` (legacy `sub_agents_debug_<input>.txt` through the helper)
- `.gitignore` (`debug/*`)
- `DEBUG_MODE.md` (new "Debug output files" section, `run_logs/` distinction)

**Summary:** `debug_delta.log` and `sub_agents_debug_<input>.txt` were written straight to the project root from four call sites. They now go through `server/lib/debugFiles.ts`, which resolves a single `debug/` folder, creates it on demand, reduces the file name to its last segment so an input-derived slug cannot escape the folder, and logs write failures instead of throwing inside the stream parser. `run_logs/` is unchanged: it is served as a static route and its URL is published in `final_stats`. Existing artifacts were moved into `debug/`.

**Verification:** `npm run lint` (`tsc --noEmit`) clean; `npm test` 168 tests passing.

**Commit:** uncommitted (working tree on top of `723e6d2`)

**Status:** ✅ Applied

---

## [2026-08-06 17:05] Surface silent agent-run failures instead of falling back to the landing view

**Context/prompt:** Sometimes when the agent finishes, no result is shown and the UI returns to the initial page immediately; debug mode reports no error.

**Files modified:**

- `src/App.tsx` (`startStream`: new `error` SSE branch, `emit` event counter, empty-run guard, logged parse failures)

**Summary:** The main view is derived state (`!running && !reportData && events.length === 0` renders `LandingView`), so any run that ends without a report and without timeline events silently snaps back to the initial page. Root cause: the SSE loop had no branch for `evt.type === 'error'`, the event the server emits when the remote agent fails (`server.ts` forwarding loop, `buildStreamFailureEvents` in `server/lib/analyzeExecution.ts`), so the failure was dropped without calling `setErr` or pushing an event. Added that branch, plus an `eventsPushed` counter wrapping `pushEvt` so a run finishing with no report, no text and no events now emits an `error` event and a visible message. `AbortError` and generic stream failures also leave a timeline entry when nothing was rendered yet. Replaced the two bare `catch` blocks that discarded malformed SSE payloads with `console.warn` calls that include the offending payload.

**Verification:** `npm run lint` (`tsc --noEmit`) clean; `npm test` 168 tests passing across 12 files.

**Commit:** uncommitted (working tree on top of `723e6d2`)

**Status:** ✅ Applied

---
