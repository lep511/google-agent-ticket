# Debug Mode

Provisional in-app debug panel plus the debug artifacts the server writes on disk. The panel
shows live application state so you can inspect a run without opening devtools, and it is
designed to be removed in a single commit.

## Files involved

| File | Role |
| --- | --- |
| `src/components/DebugPanel.tsx` | The whole panel. Self-contained, no side effects. |
| `src/App.tsx` | Two references: the `import` marked `// DEBUG (provisional)` and the `<DebugPanel />` block delimited by `DEBUG` / `FIN DEBUG` comments at the end of the render tree. |
| `server/lib/debugFiles.ts` | Single place that resolves where debug artifacts are written. Creates `debug/` on demand and swallows write failures. |

## Using the panel

A small `DEBUG` pill sits at the bottom-right corner, above the page content but below the
Stop Analysis modal (`z-40` vs `z-50`). Click it to expand the panel.

The expanded panel shows:

- **State rows** — `running`, `isStopped`, `error`, catalog status and error, number of
  agents, active agent id/name and its `outputRenderer`, the frozen `runAgent` of the
  current execution and its renderer, `inputMode`, the raw input value and instruction,
  `canRunAnalysis`, the model id, event count, whether a report exists,
  `unstructuredReport`, which report is open, duration, token count, tool runs, start
  timestamp, and the signed-in user.
- **Render counter** — increments on every render of the panel. Useful for spotting
  re-render loops.
- **Event tail** — the last 6 timeline events with id, kind, label and elapsed time. An
  event still in flight shows `…` instead of a duration.
- **`copy` button** — writes `{ state, events }` as formatted JSON to the clipboard. If the
  clipboard API is unavailable it falls back to `console.log`.

Open/closed state persists in `localStorage` under the key `debug-panel-open`. The panel is
hidden when printing (`print:hidden`), so it never shows up in generated reports.

## Debug output files

Every debug artifact the server writes lands in the `debug/` folder at the project root.
Nothing debug-related is written to the root itself.

| Path | Written by | Contents |
| --- | --- | --- |
| `debug/debug_delta.log` | `server/lib/agentClient.ts`, `server/lib/agentClientPerseus.ts` | Appended raw tool-call and tool-result deltas from the remote agent stream. Grows across runs; safe to delete at any time. |
| `debug/sub_agents_debug_<input>.txt` | `server.ts` (and the legacy `test_server.ts`) | Legacy copy of the run summary plus raw execution log for the **latest** run of that input. Overwritten on each run. |

Both go through `server/lib/debugFiles.ts`, so the location is one constant
(`DEBUG_DIR_NAME`) rather than a path repeated across call sites. The file name is reduced to
its last segment before writing, so an input-derived slug cannot escape the folder. A failed
write is logged with a `[debug]` prefix and ignored: debug logging never interrupts a run.

`debug/` is listed in `.gitignore`, so these artifacts stay out of commits.

### Not the same as `run_logs/`

`run_logs/` is not debug output and stays where it is. It holds the per-run `.txt` and
`.jsonl` logs named by `agentId`, input and `runId` (see `server/lib/runLogNaming.ts`), it is
served as a static route, and the `final_stats` event publishes the `.jsonl` URL to the
client. The `debug/sub_agents_debug_<input>.txt` file is a duplicate of the most recent
`run_logs/*.txt` for that input, kept only for backwards compatibility.

## Turning it off

Three options, from least to most permanent:

1. **Per session, no rebuild** — load the app with `?nodebug` in the URL.
2. **Build-wide, one line** — set `DEBUG_PANEL_ENABLED = false` in
   `src/components/DebugPanel.tsx`. The component returns `null` and nothing renders.
3. **Remove it entirely** — delete `src/components/DebugPanel.tsx`, the `DebugPanel` import
   in `src/App.tsx`, and the JSX block between the `DEBUG` and `FIN DEBUG` comments.

None of these affect the debug output files, which are server-side and independent of the
panel.

## Why removal is safe

The panel owns no application state and runs no effects. Everything it displays arrives
through props (`state` and `events`), and `App.tsx` passes a plain object literal built from
values that already exist in scope. Deleting the block cannot change how the app behaves.

The `state` prop is a `Record<string, unknown>` rendered in insertion order, so adding or
removing a field while debugging is a one-line edit in `App.tsx` and needs no change to the
component.

Deleting the `debug/` folder is equally safe: it is recreated on the next write.
