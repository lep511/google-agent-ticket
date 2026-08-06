# Agent Change Log

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
