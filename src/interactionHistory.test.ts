/* ──────────────────────────────────────────────────────────── */
/*  Interaction history store tests                             */
/*                                                              */
/*  Feature: interaction-history-panel                          */
/* ──────────────────────────────────────────────────────────── */

import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import {
  createHistoryEntry,
  formatRelativeTimestamp,
  HISTORY_STORAGE_KEY,
  insertEntry,
  persistHistory,
  selectVisibleEntries,
  type HistoryEntryDraft,
  type InteractionHistoryEntry,
} from './interactionHistory';
import { OUTPUT_RENDERERS } from './types';

/* ── Generators ──────────────────────────────────────────────── */

/** Whitespace runs that surround a query or an instruction. */
const whitespaceArb = fc.stringMatching(/^[ \t\n\r\u000b\f]*$/);

/** Visible text: at least one character that survives `trim`. */
const visibleTextArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((text) => text.trim().length > 0);

/** Padded text: visible content wrapped in arbitrary leading/trailing whitespace. */
const paddedTextArb = fc
  .tuple(whitespaceArb, visibleTextArb, whitespaceArb)
  .map(([left, core, right]) => `${left}${core}${right}`);

/** Any query: padded visible text or whitespace only. */
const queryArb = fc.oneof(paddedTextArb, whitespaceArb);

/**
 * Any instruction the run can hand over: absent, explicitly null, padded
 * visible text or whitespace only (Requirements 3.4, 3.5).
 */
const instructionArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  paddedTextArb,
  whitespaceArb,
);

const metricsArb = fc.record({
  durationSecs: fc.double({ min: 0, max: 3600, noNaN: true }),
  tokenCount: fc.integer({ min: 0, max: 5_000_000 }),
  toolRuns: fc.integer({ min: 0, max: 500 }),
});

/** Milliseconds since the epoch, from 1970 to well past today. */
const createdAtArb = fc.integer({ min: 0, max: 4_000_000_000_000 });

const draftArb: fc.Arbitrary<HistoryEntryDraft> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 20 }),
  agentName: fc.string({ minLength: 1, maxLength: 20 }),
  outputRenderer: fc.constantFrom(...OUTPUT_RENDERERS),
  query: queryArb,
  instruction: instructionArb,
  createdAt: createdAtArb,
  report: fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue(), { maxKeys: 4 }),
  metrics: metricsArb,
});

/* ── Property 7 ──────────────────────────────────────────────── */

describe('createHistoryEntry field derivation', () => {
  it('Feature: interaction-history-panel, Property 7: Derivation of the entry fields', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const entry = createHistoryEntry(draft, []);

        //  query trimmed of leading and trailing whitespace.
        expect(entry.query).toBe(draft.query.trim());

        //  createdAt is the finite completion timestamp in ms.
        expect(Number.isFinite(entry.createdAt)).toBe(true);
        expect(entry.createdAt).toBe(draft.createdAt);

        //  metrics carried over field by field.
        expect(entry.metrics).toEqual({
          durationSecs: draft.metrics.durationSecs,
          tokenCount: draft.metrics.tokenCount,
          toolRuns: draft.metrics.toolRuns,
        });

        // Requirements 3.4, 3.5: the trimmed instruction is stored if and only
        // if it keeps at least one character; otherwise the field is null.
        const trimmedInstruction =
          typeof draft.instruction === 'string' ? draft.instruction.trim() : '';
        if (trimmedInstruction.length > 0) {
          expect(entry.instruction).toBe(trimmedInstruction);
        } else {
          expect(entry.instruction).toBeNull();
        }
      }),
      { numRuns: 300 },
    );
  });
});

/* ── Property 8 ──────────────────────────────────────────────── */

/**
 * Replaces `crypto.randomUUID` with a cyclic pool of `poolSize` values, so the
 * generator collides on purpose and the store has to resolve it. Returns the
 * restore function; a `poolSize` of `null` leaves the real generator in place.
 */
function stubIdPool(poolSize: number | null): () => void {
  if (poolSize === null) return () => {};

  let call = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => {
      const value = `pooled-id-${call % poolSize}`;
      call += 1;
      return value;
    },
  });
  return () => vi.unstubAllGlobals();
}

describe('history entry identifiers', () => {
  it('Feature: interaction-history-panel, Property 8: Uniqueness of the identifiers', () => {
    fc.assert(
      fc.property(
        fc.array(draftArb, { minLength: 1, maxLength: 30 }),
        // `null` exercises the real generator; the small pools force collisions.
        fc.constantFrom<number | null>(null, 1, 2, 5),
        (drafts, poolSize) => {
          const restoreIdPool = stubIdPool(poolSize);
          try {
            let entries: InteractionHistoryEntry[] = [];

            for (const draft of drafts) {
              entries = insertEntry(entries, createHistoryEntry(draft, entries));

              //  every identifier present in the list is
              // distinct from every other one, so the count of distinct
              // identifiers equals the length of the list.
              const distinctIds = new Set(entries.map((entry) => entry.id));
              expect(distinctIds.size).toBe(entries.length);
            }
          } finally {
            restoreIdPool();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* ── Property 11 ─────────────────────────────────────────────── */

/**
 * Boundary durations re-derived from  in plain literals instead
 * of reusing the store constants, so the test keeps an independent oracle.
 */
const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

/** Every threshold named by , plus the zero-difference edge. */
const BOUNDARIES_MS = [0, ONE_MINUTE_MS, ONE_HOUR_MS, ONE_DAY_MS, ONE_WEEK_MS];

/** Instants just below, exactly at, and just above each boundary. */
const boundaryDeltaArb = fc
  .tuple(fc.constantFrom(...BOUNDARIES_MS), fc.constantFrom(-1, 0, 1))
  .map(([boundary, offset]) => boundary + offset);

/** Negative differences: a `createdAt` that sits in the future of `now`. */
const futureDeltaArb = fc.integer({ min: -30 * ONE_DAY_MS, max: -1 });

/** Broad coverage inside and beyond every bucket. */
const wideDeltaArb = fc.integer({ min: 0, max: 60 * ONE_DAY_MS });

const deltaArb = fc.oneof(boundaryDeltaArb, futureDeltaArb, wideDeltaArb);

/** Reference instant far enough from the epoch that `now - delta` stays valid. */
const nowArb = fc.integer({ min: 1_000_000_000_000, max: 4_000_000_000_000 });

describe('relative timestamp formatting', () => {
  it('Feature: interaction-history-panel, Property 11: Relative timestamp formatting', () => {
    fc.assert(
      fc.property(nowArb, deltaArb, (now, delta) => {
        const createdAt = now - delta;
        const label = formatRelativeTimestamp(createdAt, now);

        //  a future `createdAt` counts as a zero difference.
        const effectiveDelta = Math.max(0, delta);

        if (effectiveDelta < ONE_MINUTE_MS) {
          // Below 60 seconds, including every future timestamp.
          expect(label).toBe('just now');
          return;
        }

        if (effectiveDelta < ONE_HOUR_MS) {
          // From 60 seconds to less than 60 minutes: truncated minutes.
          const minutes = Math.floor(effectiveDelta / ONE_MINUTE_MS);
          expect(minutes).toBeGreaterThanOrEqual(1);
          expect(minutes).toBeLessThanOrEqual(59);
          expect(label).toBe(`${minutes} minutes ago`);
          return;
        }

        if (effectiveDelta < ONE_DAY_MS) {
          // From 60 minutes to less than 24 hours: truncated hours.
          const hours = Math.floor(effectiveDelta / ONE_HOUR_MS);
          expect(hours).toBeGreaterThanOrEqual(1);
          expect(hours).toBeLessThanOrEqual(23);
          expect(label).toBe(`${hours} hours ago`);
          return;
        }

        if (effectiveDelta < ONE_WEEK_MS) {
          // From 24 hours to less than 7 days: truncated days.
          const days = Math.floor(effectiveDelta / ONE_DAY_MS);
          expect(days).toBeGreaterThanOrEqual(1);
          expect(days).toBeLessThanOrEqual(6);
          expect(label).toBe(`${days} days ago`);
          return;
        }

        // 7 days or more: the absolute date in local format.
        expect(label).toBe(new Date(createdAt).toLocaleDateString());
      }),
      { numRuns: 300 },
    );
  });
});
/* ── Property 20 ─────────────────────────────────────────────── */

/**
 * Agents a generated history mixes under the single History Key
 * (). Three of them can become the Active Agent; the fourth
 * never does, so it always contributes entries that must stay out of the
 * Visible Entries.
 */
const FILTER_AGENT_IDS = ['agent-alpha', 'agent-beta', 'agent-gamma'] as const;
const FILTER_ORPHAN_AGENT_ID = 'agent-orphan';

/**
 * `Map`-backed `Storage`, the same shape the application integration tests use.
 * Installing it over `window.localStorage` is what lets the persisted History
 * Key be read back field by field.
 */
function createStorageDouble(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.has(key) ? (values.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
  } satisfies Storage;
}

/**
 * History Entry whose only generated trait is the agent it belongs to. The
 * identifier and the `createdAt` come from the position, so the generated list
 * is already newest first and `capHistory` cannot reorder it.
 */
function makeFilterEntry(agentId: string, index: number): InteractionHistoryEntry {
  return {
    id: `filter-entry-${index}`,
    agentId,
    agentName: `Agent ${agentId}`,
    outputRenderer: 'simple_report',
    query: `QUERY-${index}`,
    instruction: null,
    createdAt: 1_700_000_000_000 - index * 60_000,
    report: { summary: `Snapshot ${index}` },
    metrics: { durationSecs: 1, tokenCount: 1_000, toolRuns: 1 },
  };
}

/**
 * Multi-agent histories, the empty one included, all of them within the History
 * Limit so this property observes the filtering and not the trim.
 */
const multiAgentHistoryArb: fc.Arbitrary<InteractionHistoryEntry[]> = fc
  .array(fc.constantFrom<string>(...FILTER_AGENT_IDS, FILTER_ORPHAN_AGENT_ID), {
    minLength: 0,
    maxLength: 12,
  })
  .map((agentIds) => agentIds.map(makeFilterEntry));

/**
 * Active Agents of the input space: an agent that owns entries, an agent that
 * may own none, and null ( folded into the generator).
 */
const activeAgentIdArb = fc.oneof(
  fc.constantFrom<string | null>(...FILTER_AGENT_IDS),
  fc.constant<string | null>('agent-never-in-any-history'),
  fc.constant<string | null>(null),
);

/**
 * Independent oracle of Requirements 8.1 and 8.5: the subsequence of entries
 * whose `agentId` matches exactly, walked in the received order, and nothing at
 * all while the Active Agent is null.
 */
function expectedSubsequence(
  entries: InteractionHistoryEntry[],
  activeAgentId: string | null,
): InteractionHistoryEntry[] {
  if (activeAgentId === null) return [];

  const expected: InteractionHistoryEntry[] = [];
  for (const entry of entries) {
    if (entry.agentId === activeAgentId) expected.push(entry);
  }
  return expected;
}

/** How many entries of each agent a list holds, agent by agent. */
function countByAgent(entries: InteractionHistoryEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.agentId] = (counts[entry.agentId] ?? 0) + 1;
  }
  return counts;
}

describe('Visible Entries of the Active Agent', () => {
  it('Feature: interaction-history-panel, Property 20: Filtering by active agent', () => {
    fc.assert(
      fc.property(multiAgentHistoryArb, activeAgentIdArb, (entries, activeAgentId) => {
        const storage = createStorageDouble();
        vi.stubGlobal('localStorage', storage);

        try {
          const visible = selectVisibleEntries(entries, activeAgentId);
          const expected = expectedSubsequence(entries, activeAgentId);

          // Requirements 8.1, 8.5: exactly the matching subsequence, in the same
          // relative order, and empty while the Active Agent is null.
          expect(visible).toEqual(expected);
          visible.forEach((entry, index) => {
            expect(entry).toBe(expected[index]);
            expect(entry.agentId).toBe(activeAgentId);
          });
          if (activeAgentId === null) {
            expect(visible).toHaveLength(0);
          }

          // Filtering is a read: the list it was derived from is untouched.
          const { persisted, entries: effective } = persistHistory(entries);
          expect(persisted).toBe(true);
          expect(effective).toEqual(entries);

          const raw = storage.getItem(HISTORY_STORAGE_KEY);
          expect(raw).not.toBeNull();
          const stored = JSON.parse(raw as string) as InteractionHistoryEntry[];

          /*
             the entries of every agent stay in the same History
            Key, so the persisted list is agent-for-agent the one that was
            handed over, whatever the Active Agent filters out of the view.
          */
          expect(stored).toEqual(entries);
          expect(countByAgent(stored)).toEqual(countByAgent(entries));

          // And the same filtering over the persisted list yields the same
          // Visible Entries, so the view is a projection and not a subset of
          // what the browser keeps.
          expect(selectVisibleEntries(stored, activeAgentId)).toEqual(expected);
        } finally {
          vi.unstubAllGlobals();
        }
      }),
      { numRuns: 200 },
    );
  });
});
