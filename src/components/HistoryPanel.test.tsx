/* ──────────────────────────────────────────────────────────── */
/*  History_Panel component tests                               */
/*                                                              */
/*  Feature: interaction-history-panel                          */
/* ──────────────────────────────────────────────────────────── */

import { useState } from 'react';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HistoryPanel } from './HistoryPanel';
import {
  createHistoryEntry,
  DAY_MS,
  HISTORY_LIMIT,
  HOUR_MS,
  insertEntry,
  MINUTE_MS,
  WEEK_MS,
  type HistoryEntryDraft,
  type InteractionHistoryEntry,
} from '../interactionHistory';
import { OUTPUT_RENDERERS } from '../types';

/**
 * Per-test budget for the asynchronous property tests. Each generated case
 * mounts the panel and drives real user events, so 100 runs need far more than
 * the default budget when the whole suite runs in parallel.
 */
const PROPERTY_TEST_TIMEOUT_MS = 60_000;

/* ── Generators ──────────────────────────────────────────────── */

const metricsArb = fc.record({
  durationSecs: fc.double({ min: 0, max: 3600, noNaN: true }),
  tokenCount: fc.integer({ min: 0, max: 5_000_000 }),
  toolRuns: fc.integer({ min: 0, max: 500 }),
});

/** Entry without its identifier; the list generator assigns unique ones. */
const entryBodyArb: fc.Arbitrary<Omit<InteractionHistoryEntry, 'id'>> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 20 }),
  agentName: fc.string({ minLength: 1, maxLength: 20 }),
  outputRenderer: fc.constantFrom(...OUTPUT_RENDERERS),
  query: fc.string({ minLength: 1, maxLength: 40 }),
  instruction: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
  // Milliseconds since the epoch, from 1970 to well past today.
  createdAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
  report: fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue(), { maxKeys: 4 }),
  metrics: metricsArb,
});

/**
 * Non-empty lists of Visible Entries with distinct identifiers, so the
 * confirmation layer is reachable (Requirement 10.5 gates it behind at least
 * one Visible Entry) and every row keeps a stable React key.
 */
const entriesArb: fc.Arbitrary<InteractionHistoryEntry[]> = fc
  .array(entryBodyArb, { minLength: 1, maxLength: 6 })
  .map((bodies) => bodies.map((body, index) => ({ ...body, id: `entry-${index}` })));

/* ── Harness ─────────────────────────────────────────────────── */

/**
 * Owns the state the History_Panel does not own: the open flag and the list of
 * History Entries. Wiring `onDelete` and `onClearAll` to real mutations is what
 * makes "the list is unchanged" observable: any spurious destructive intent
 * would show up in the rendered identifier snapshot.
 */
function HistoryPanelHarness({
  entries: initialEntries,
  now = 4_000_000_000_000,
  running = false,
}: {
  entries: InteractionHistoryEntry[];
  /** Reference instant of the relative timestamps (). */
  now?: number;
  /** Run-in-progress flag of the Web_Client (). */
  running?: boolean;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [open, setOpen] = useState(true);
  // Restoration intents received from the panel, in order. Recording them makes
  // "no restoration happened" observable ().
  const [restoredIds, setRestoredIds] = useState<string[]>([]);

  return (
    <>
      <button
        type="button"
        data-testid="history-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Toggle history
      </button>
      <div data-testid="entry-ids">{entries.map((entry) => entry.id).join(',')}</div>
      <div data-testid="restored-ids">{restoredIds.join(',')}</div>
      <HistoryPanel
        open={open}
        entries={entries}
        running={running}
        onClose={() => setOpen(false)}
        onRestore={(entry) => setRestoredIds((current) => [...current, entry.id])}
        onDelete={(id) => setEntries((current) => current.filter((entry) => entry.id !== id))}
        onClearAll={() => setEntries([])}
        now={now}
      />
    </>
  );
}

/** Open flag of the harness, read through the trigger's `aria-expanded`. */
function isPanelOpen(): boolean {
  return screen.getByTestId('history-trigger').getAttribute('aria-expanded') === 'true';
}

/** Identifiers currently held by the harness, in order. */
function currentEntryIds(): string {
  return screen.getByTestId('entry-ids').textContent ?? '';
}

/** Identifiers the panel asked to restore, in order. */
function restoredEntryIds(): string {
  return screen.getByTestId('restored-ids').textContent ?? '';
}

/** The confirmation layer is identified by its heading copy (Requirement 10.6). */
function isConfirmationOpen(): boolean {
  return screen.queryByText('Clear all history?') !== null;
}

afterEach(() => {
  cleanup();
});

/* ── Property 4 ──────────────────────────────────────────────── */

describe('History_Panel layered Escape handling', () => {
  it('Feature: interaction-history-panel, Property 4: Escape closes only the top layer', async () => {
    await fc.assert(
      fc.asyncProperty(entriesArb, fc.boolean(), async (entries, confirmationOpen) => {
        const user = userEvent.setup({ delay: null });
        const expectedIds = entries.map((entry) => entry.id).join(',');

        try {
          render(<HistoryPanelHarness entries={entries} />);

          if (confirmationOpen) {
            //  the `Clear all` control raises the top layer.
            await user.click(screen.getByRole('button', { name: 'Clear all' }));
            expect(isConfirmationOpen()).toBe(true);
          }

          expect(isPanelOpen()).toBe(true);
          expect(isConfirmationOpen()).toBe(confirmationOpen);

          await user.keyboard('{Escape}');

          if (confirmationOpen) {
            //  only the confirmation closes; the panel stays open.
            expect(isConfirmationOpen()).toBe(false);
            expect(isPanelOpen()).toBe(true);
            expect(screen.getByRole('dialog', { name: 'History' })).toBeInTheDocument();
            expect(screen.getAllByRole('listitem')).toHaveLength(entries.length);
          } else {
            //  with no layer above it, the panel itself closes.
            expect(isPanelOpen()).toBe(false);
            expect(isConfirmationOpen()).toBe(false);
          }

          // Requirements 2.3, 10.9: neither branch touches the History Entries.
          expect(currentEntryIds()).toBe(expectedIds);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full mount plus real user events, do not
    // fit in the default per-test budget once the whole suite runs in parallel.
  }, PROPERTY_TEST_TIMEOUT_MS);
});
/* ── Property 9 ──────────────────────────────────────────────── */

/**
 * Chronological sequence of runs of a single agent: a base instant plus a
 * non-negative gap before each run. Real runs finish one after another, so a
 * new History Entry never predates the ones already stored; that is the input
 * space  describes. Ties are allowed on purpose (a gap of 0),
 * because the newest entry has to stay first even when it shares `createdAt`.
 */
const chronologicalDraftsArb: fc.Arbitrary<HistoryEntryDraft[]> = fc
  .tuple(
    fc.integer({ min: 0, max: 2_000_000_000_000 }),
    fc.array(
      fc.record({
        gap: fc.integer({ min: 0, max: 90 * DAY_MS }),
        // Unique per row through the index below, so the rendered order can be
        // compared text by text against the stored order.
        querySuffix: fc.stringMatching(/^[A-Za-z0-9]{1,12}$/),
        agentName: fc.string({ minLength: 1, maxLength: 20 }),
        outputRenderer: fc.constantFrom(...OUTPUT_RENDERERS),
        instruction: fc.option(fc.stringMatching(/^[A-Za-z0-9 ]{1,20}$/), { nil: null }),
        report: fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue(), { maxKeys: 4 }),
        metrics: metricsArb,
      }),
      // Up to 24 runs, so some cases cross the History Limit of 20.
      { minLength: 1, maxLength: 24 },
    ),
  )
  .map(([base, runs]) => {
    let createdAt = base;
    return runs.map((run, index) => {
      createdAt += run.gap;
      return {
        agentId: 'agent-under-test',
        agentName: run.agentName,
        outputRenderer: run.outputRenderer,
        query: `run ${index} ${run.querySuffix}`,
        instruction: run.instruction,
        createdAt,
        report: run.report,
        metrics: run.metrics,
      } satisfies HistoryEntryDraft;
    });
  });

/** Query text of a rendered row: the first paragraph of its restore control. */
function rowQueryText(row: HTMLElement): string {
  return row.querySelector('p')?.textContent ?? '';
}

/** Instant exposed by the row timestamp through its `datetime` attribute. */
function rowInstant(row: HTMLElement): string {
  return row.querySelector('time')?.getAttribute('datetime') ?? '';
}

describe('History_Panel ordering by descending age', () => {
  it('Feature: interaction-history-panel, Property 9: Ordering by descending age', () => {
    fc.assert(
      fc.property(chronologicalDraftsArb, (drafts) => {
        let stored: InteractionHistoryEntry[] = [];

        for (const draft of drafts) {
          const inserted = createHistoryEntry(draft, stored);
          stored = insertEntry(stored, inserted);

          //  the new entry takes the first position.
          expect(stored[0].id).toBe(inserted.id);

          //  the `createdAt` sequence stays monotonically
          // non-increasing, so the list is ordered newest first.
          for (let index = 1; index < stored.length; index += 1) {
            expect(stored[index - 1].createdAt).toBeGreaterThanOrEqual(stored[index].createdAt);
          }

          expect(stored.length).toBeLessThanOrEqual(HISTORY_LIMIT);
        }

        try {
          render(<HistoryPanelHarness entries={stored} />);

          const rows = screen.getAllByRole('listitem');

          //  the rendered order matches the stored order.
          expect(rows).toHaveLength(stored.length);
          expect(rows.map(rowQueryText)).toEqual(stored.map((entry) => entry.query));
          expect(rows.map(rowInstant)).toEqual(
            stored.map((entry) => new Date(entry.createdAt).toISOString()),
          );
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full mount of the panel, do not fit in the
    // default per-test budget once the whole suite runs in parallel.
  }, PROPERTY_TEST_TIMEOUT_MS);
});

/* ── Property 10 ─────────────────────────────────────────────── */

/**
 * Ages that land on every branch of , including a negative one
 * (a `createdAt` in the future relative to the render instant), so the rendered
 * timestamp is exercised across the whole boundary space instead of a single
 * bucket.
 */
const ageArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: -DAY_MS, max: MINUTE_MS }),
  fc.integer({ min: MINUTE_MS, max: HOUR_MS }),
  fc.integer({ min: HOUR_MS, max: DAY_MS }),
  fc.integer({ min: DAY_MS, max: WEEK_MS }),
  fc.integer({ min: WEEK_MS, max: 400 * DAY_MS }),
);

/**
 * Visible Entries paired with the render instant. `instruction` stays nullable
 * so each case covers both the presence and the absence of the secondary line
 * ().
 */
const renderedEntriesArb: fc.Arbitrary<{ entries: InteractionHistoryEntry[]; now: number }> = fc
  .tuple(
    fc.integer({ min: 500 * DAY_MS, max: 4_000_000_000_000 }),
    fc.array(fc.tuple(entryBodyArb, ageArb), { minLength: 1, maxLength: 6 }),
  )
  .map(([now, rows]) => ({
    now,
    entries: rows.map(([body, age], index) => ({
      ...body,
      id: `entry-${index}`,
      createdAt: now - age,
    })),
  }));

/**
 * Relative Timestamp required by , recomputed here instead of
 * reusing the store helper, so the assertion checks the specification and not
 * the implementation against itself.
 */
function expectedRelativeText(createdAt: number, now: number): string {
  const deltaMs = Math.max(0, now - createdAt);
  if (deltaMs < MINUTE_MS) return 'just now';
  if (deltaMs < HOUR_MS) return `${Math.floor(deltaMs / MINUTE_MS)} minutes ago`;
  if (deltaMs < DAY_MS) return `${Math.floor(deltaMs / HOUR_MS)} hours ago`;
  if (deltaMs < WEEK_MS) return `${Math.floor(deltaMs / DAY_MS)} days ago`;
  return new Date(createdAt).toLocaleDateString();
}

/** Paragraph texts of a rendered row: the query first, the instruction second. */
function rowParagraphTexts(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll('p')).map((node) => node.textContent ?? '');
}

/** Timestamp element of a rendered row (Requirements 4.4, 4.6). */
function rowTimestamp(row: HTMLElement): HTMLTimeElement {
  const node = row.querySelector('time');
  if (!node) throw new Error('The rendered row exposes no timestamp element');
  return node;
}

describe('History_Panel rendered content of each entry', () => {
  it('Feature: interaction-history-panel, Property 10: Rendered content of each entry', () => {
    fc.assert(
      fc.property(renderedEntriesArb, ({ entries, now }) => {
        try {
          render(<HistoryPanelHarness entries={entries} now={now} />);

          const rows = screen.getAllByRole('listitem');
          expect(rows).toHaveLength(entries.length);

          entries.forEach((entry, index) => {
            const row = rows[index];
            const paragraphs = rowParagraphTexts(row);

            //  the row shows the `query` value.
            expect(paragraphs[0]).toBe(entry.query);

            //  the instruction appears as the secondary line if
            // and only if the field is not null.
            if (entry.instruction === null) {
              expect(paragraphs).toHaveLength(1);
            } else {
              expect(paragraphs).toHaveLength(2);
              expect(paragraphs[1]).toBe(entry.instruction);
            }

            const timestamp = rowTimestamp(row);

            //  the Relative Timestamp of `createdAt` against the
            // render instant.
            expect(timestamp.textContent).toBe(expectedRelativeText(entry.createdAt, now));

            //  the `title` attribute carries the full local
            // date and time of `createdAt`.
            expect(timestamp.getAttribute('title')).toBe(
              new Date(entry.createdAt).toLocaleString(),
            );
          });
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full mount of the panel, do not fit in the
    // default per-test budget once the whole suite runs in parallel.
  }, PROPERTY_TEST_TIMEOUT_MS);
});
/* ── Property 13 ─────────────────────────────────────────────── */

/** English notice required by , pinned literally. */
const RUNNING_NOTICE = 'Restoring is paused while a run is in progress.';

/** Restore control of a rendered row: the first button inside the list item. */
function rowRestoreControl(row: HTMLElement): HTMLButtonElement {
  const node = row.querySelector('button');
  if (!node) throw new Error('The rendered row exposes no restore control');
  return node as HTMLButtonElement;
}

describe('History_Panel restoration blocked during a run', () => {
  it('Feature: interaction-history-panel, Property 13: Restoration blocked during a run', async () => {
    await fc.assert(
      // The `running` flag is generated instead of pinned to true, so the
      // notice and the blocking are tied to a run being in progress rather
      // than being unconditional panel copy.
      fc.asyncProperty(entriesArb, fc.boolean(), async (entries, running) => {
        const user = userEvent.setup({ delay: null });
        const expectedIds = entries.map((entry) => entry.id).join(',');

        try {
          render(<HistoryPanelHarness entries={entries} running={running} />);

          const rows = screen.getAllByRole('listitem');
          expect(rows).toHaveLength(entries.length);

          //  the English notice explaining the reason appears
          // while a run is in progress, and only then.
          if (running) {
            expect(screen.getByText(RUNNING_NOTICE)).toBeInTheDocument();
          } else {
            expect(screen.queryByText(RUNNING_NOTICE)).not.toBeInTheDocument();
          }

          for (const row of rows) {
            const control = rowRestoreControl(row);

            //  every Visible Entry refuses restoration while a
            // run is in progress.
            expect(control).toHaveProperty('disabled', running);

            await user.click(control);
          }

          if (running) {
            //  not a single restoration intent reached the
            // Web_Client.
            expect(restoredEntryIds()).toBe('');
          } else {
            // Control branch: with no run in progress the same activations do
            // reach the Web_Client, so the blocking above is not a dead row.
            expect(restoredEntryIds()).toBe(expectedIds);
          }

          //  blocking restoration is not destructive and does
          // not dismiss the panel.
          expect(currentEntryIds()).toBe(expectedIds);
          expect(isPanelOpen()).toBe(true);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full mount plus real user events, do not
    // fit in the default per-test budget once the whole suite runs in parallel.
  }, PROPERTY_TEST_TIMEOUT_MS);
});
