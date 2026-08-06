# Agent Change Log

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
