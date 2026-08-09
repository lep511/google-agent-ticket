/* ──────────────────────────────────────────────────────────── */
/*  Interaction history application integration tests           */
/*                                                              */
/*  Feature: interaction-history-panel                          */
/* ──────────────────────────────────────────────────────────── */

import { StrictMode } from 'react';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from './App';
import {
  HISTORY_STORAGE_KEY,
  userHistoryKey,
  type InteractionHistoryEntry,
} from './interactionHistory';
import {
  OUTPUT_RENDERERS,
  type AgentCatalogEntry,
  type AgentCatalogResponse,
  type OutputRenderer,
} from './types';

/**
 * Per-test budget for the asynchronous property tests. Each generated case
 * mounts the whole application and drives real user events, so 100 runs need
 * far more than the default budget when the whole suite runs in parallel.
 */
const PROPERTY_TEST_TIMEOUT_MS = 120_000;

/* ── Storage double ──────────────────────────────────────────── */

/**
 * `Map`-backed `Storage`, the same shape the store tests use. Installing it over
 * `window.localStorage` keeps every mount isolated: no History Entry, no stored
 * agent selection and no auth token leaks from one generated case to the next.
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

/* ── Signed-in session ───────────────────────────────────────── */

/**
 * The application gates its whole interface behind a Cognito session, and it
 * scopes the History Key to the signed-in user. Both come from the same place:
 * an unexpired ID token in `localStorage`. Seeding that token is enough to sign
 * the tests in through the real `getCurrentCognitoUser` path, with no module
 * mock, so a change to how the session is read shows up here.
 */
const TEST_USER_ID = 'test-user-sub';

/** Storage key the application reads and writes for the signed-in user. */
const HISTORY_KEY = userHistoryKey(TEST_USER_ID);

/**
 * Keys a seeded history is written to. The mount reads the history twice: once
 * before the session resolves, under the unscoped key, and again under the key
 * of the signed-in user. Seeding both makes the first committed count already
 * the final one, so the assertions do not depend on which read a given machine
 * commits first.
 */
const SEEDED_HISTORY_KEYS = [HISTORY_STORAGE_KEY, HISTORY_KEY] as const;

/**
 * Unsigned ID token: `getCurrentCognitoUser` only base64-decodes the payload and
 * checks `exp`, so a real signature is not needed to represent a live session.
 */
function fakeIdToken(): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      sub: TEST_USER_ID,
      'cognito:username': 'tester',
      email: 'tester@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  return `${header}.${payload}.signature`;
}

/** Fresh storage double already holding a live session. */
function signedInStorage(): Storage {
  const storage = createStorageDouble();
  storage.setItem('cognito_id_token', fakeIdToken());
  return storage;
}

/* ── Synthetic agent catalog ─────────────────────────────────── */

/** Single catalog entry, enough for the header to render its Agent_Selector. */
const CATALOG_AGENT: AgentCatalogEntry = {
  id: 'financial_analyst_agent',
  name: 'Financial Analyst',
  tagline: 'Finds and synthesizes recent SEC filings.',
  description: 'Locates recent filings and synthesizes them into one report.',
  icon: 'Landmark',
  accentColor: 'rgba(255,255,255,0.12)',
  order: 10,
  isDefault: true,
  inputMode: 'ticker',
  inputPlaceholder: 'TICKER',
  actionLabel: 'Analyze',
  supportsInstruction: true,
  outputRenderer: 'financial_report',
  landing: null,
};

const CATALOG_RESPONSE: AgentCatalogResponse = {
  agents: [CATALOG_AGENT],
  defaultAgentId: CATALOG_AGENT.id,
};

/**
 * `fetch` replacement: it serves the agent catalog the header needs and rejects
 * anything else, so a request the interaction under test is not supposed to
 * issue surfaces as a failure instead of a silent network call.
 */
function installFetchDouble(catalog: AgentCatalogResponse = CATALOG_RESPONSE): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes('/api/agents')) {
        return new Response(JSON.stringify(catalog), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected request to ${url}`);
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal('localStorage', signedInStorage());
  installFetchDouble();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ── Helpers ─────────────────────────────────────────────────── */

/** History_Trigger of the header, identified by its accessible text. */
async function findHistoryTrigger(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: 'History' });
}

/** The History_Panel is identified by its dialog role and accessible name. */
function isHistoryPanelPresent(): boolean {
  return screen.queryByRole('dialog', { name: 'History' }) !== null;
}

/* ── Property 1 ──────────────────────────────────────────────── */

describe('History_Trigger toggling', () => {
  it('Feature: interaction-history-panel, Property 1: History trigger toggling', async () => {
    await fc.assert(
      // Activation counts, including zero, so the closed initial state is part
      // of the input space instead of an assumption.
      fc.asyncProperty(fc.integer({ min: 0, max: 6 }), async (activations) => {
        const user = userEvent.setup({ delay: null });

        try {
          render(<App />);

          const trigger = await findHistoryTrigger();

          // Requirement 1.6: the attribute reflects the closed initial state.
          expect(trigger).toHaveAttribute('aria-expanded', 'false');
          expect(isHistoryPanelPresent()).toBe(false);

          for (let activation = 1; activation <= activations; activation += 1) {
            await user.click(trigger);

            // Requirements 1.4, 1.5: the panel is open if and only if the
            // number of activations so far is odd.
            const expectedOpen = activation % 2 === 1;

            // Requirement 1.6: `aria-expanded` matches that state on every step.
            expect(trigger).toHaveAttribute('aria-expanded', String(expectedOpen));

            if (expectedOpen) {
              expect(isHistoryPanelPresent()).toBe(true);
            } else {
              // The drawer leaves through an exit animation, so its removal is
              // awaited instead of asserted on the same frame.
              await waitFor(() => {
                expect(isHistoryPanelPresent()).toBe(false);
              });
            }
          }

          // Requirements 1.4, 1.5, 1.6: parity of the whole sequence.
          const finalOpen = activations % 2 === 1;
          expect(trigger).toHaveAttribute('aria-expanded', String(finalOpen));
          expect(isHistoryPanelPresent()).toBe(finalOpen);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full application mount plus real user
    // events, do not fit in the default per-test budget.
  }, PROPERTY_TEST_TIMEOUT_MS);
});
/* ── Property 2 ──────────────────────────────────────────────── */

/**
 * Agent identifiers the generated History Entries are tagged with. The first
 * three exist in the synthetic catalog and can therefore become the Active
 * Agent; `agent-orphan` never can, so it always contributes entries that must
 * stay out of the Visible Entries.
 */
const CATALOG_AGENT_IDS = ['agent-alpha', 'agent-beta', 'agent-gamma'] as const;
const ORPHAN_AGENT_ID = 'agent-orphan';

/** Catalog entry built from the template, so only the identity changes. */
function makeCatalogAgent(id: string): AgentCatalogEntry {
  return { ...CATALOG_AGENT, id, name: `Agent ${id}`, isDefault: false };
}

/**
 * Catalog for a generated case. A null Active Agent is produced with an empty
 * catalog, the only state in which `resolveActiveAgentId` yields null; any other
 * choice becomes the catalog `defaultAgentId`, so the Active Agent is exactly
 * the generated one (Requirement 8.5 folded into the input space).
 */
function makeCatalog(activeAgentId: string | null): AgentCatalogResponse {
  if (activeAgentId === null) {
    return { agents: [], defaultAgentId: null };
  }
  return {
    agents: CATALOG_AGENT_IDS.map(makeCatalogAgent),
    defaultAgentId: activeAgentId,
  };
}

const historyMetricsArb = fc.record({
  durationSecs: fc.double({ min: 0, max: 3600, noNaN: true }),
  tokenCount: fc.integer({ min: 0, max: 5_000_000 }),
  toolRuns: fc.integer({ min: 0, max: 500 }),
});

/** History Entry body; the list generator assigns the unique identifiers. */
const historyEntryBodyArb: fc.Arbitrary<Omit<InteractionHistoryEntry, 'id'>> = fc.record({
  // Several agents share the History Key (Requirement 8.3), so the generated
  // list mixes catalog agents with one that is never active.
  agentId: fc.constantFrom(...CATALOG_AGENT_IDS, ORPHAN_AGENT_ID),
  agentName: fc.string({ minLength: 1, maxLength: 20 }),
  outputRenderer: fc.constantFrom(...OUTPUT_RENDERERS),
  query: fc.string({ minLength: 1, maxLength: 40 }),
  instruction: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
  createdAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
  report: fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue(), { maxKeys: 4 }),
  metrics: historyMetricsArb,
});

/**
 * Stored histories, empty ones included: a zero-length list and a list whose
 * entries all belong to other agents must both land on the empty state.
 */
const storedHistoryArb: fc.Arbitrary<InteractionHistoryEntry[]> = fc
  .array(historyEntryBodyArb, { minLength: 0, maxLength: 6 })
  .map((bodies) => bodies.map((body, index) => ({ ...body, id: `entry-${index}` })));

/**
 * Installs a fresh storage double already holding the generated history, so
 * each mounted case starts from its own History Key with no leakage from the
 * previous one.
 */
function seedStoredHistory(entries: InteractionHistoryEntry[]): void {
  const storage = signedInStorage();
  const raw = JSON.stringify(entries);
  for (const key of SEEDED_HISTORY_KEYS) storage.setItem(key, raw);
  vi.stubGlobal('localStorage', storage);
}

/** Count shown by the History_Trigger, or null when it shows no number. */
function historyTriggerCount(trigger: HTMLElement): string | null {
  const digits = (trigger.textContent ?? '').match(/\d+/);
  return digits === null ? null : digits[0];
}

describe('Visible count and the History_Panel branches', () => {
  it('Feature: interaction-history-panel, Property 2: The visible count governs trigger, list and empty state', async () => {
    await fc.assert(
      fc.asyncProperty(
        storedHistoryArb,
        // Active Agent of the case, null included.
        fc.option(fc.constantFrom(...CATALOG_AGENT_IDS), { nil: null }),
        async (entries, activeAgentId) => {
          const user = userEvent.setup({ delay: null });

          seedStoredHistory(entries);
          installFetchDouble(makeCatalog(activeAgentId));

          try {
            render(<App />);

            const trigger = await findHistoryTrigger();

            // Visible Entries: exact `agentId` match, and none at all while the
            // Active Agent is null (Requirement 8.5).
            const visibleCount =
              activeAgentId === null
                ? 0
                : entries.filter((entry) => entry.agentId === activeAgentId).length;

            // Requirement 1.7: the number appears only above zero. The wait
            // covers the catalog request that resolves the Active Agent.
            await waitFor(() => {
              expect(historyTriggerCount(trigger)).toBe(
                visibleCount > 0 ? String(visibleCount) : null,
              );
            });

            await user.click(trigger);
            const panel = await screen.findByRole('dialog', { name: 'History' });

            const rows = within(panel).queryAllByRole('listitem');
            const clearAll = within(panel).queryByRole('button', { name: 'Clear all' });
            const emptyState = within(panel).queryByText('No history yet');

            if (visibleCount > 0) {
              // Requirement 9.3: the list replaces the empty state, one Visible
              // Entry per row.
              expect(rows).toHaveLength(visibleCount);
              expect(emptyState).toBeNull();
              // Requirement 10.5: the clear-all control exists above zero.
              expect(clearAll).not.toBeNull();
            } else {
              // Requirement 9.1: zero Visible Entries means the empty state.
              expect(emptyState).not.toBeNull();
              expect(rows).toHaveLength(0);
              // Requirement 9.2: and no clear-all control.
              expect(clearAll).toBeNull();
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full application mount plus real user
    // events, do not fit in the default per-test budget.
  }, PROPERTY_TEST_TIMEOUT_MS);
});

/* ── Property 3 ──────────────────────────────────────────────── */

/**
 * The four ways of closing the History_Panel named by Property 3. Generating
 * the mode instead of writing four separate tests is what makes the focus round
 * trip a property of the closing act itself rather than of one interaction.
 */
const HISTORY_CLOSE_MODES = ['overlay', 'escape', 'close-control', 'restore'] as const;

type HistoryCloseMode = (typeof HISTORY_CLOSE_MODES)[number];

/**
 * Single Visible Entry of the default catalog agent. The restore mode needs a
 * row to activate, and the other three modes are indifferent to the list, so
 * one fixed entry serves every generated case. `simple_report` keeps the
 * restored view on `SimpleReportView`, which normalizes any snapshot shape.
 */
const FOCUS_ROUND_TRIP_ENTRY: InteractionHistoryEntry = {
  id: 'entry-focus-round-trip',
  agentId: CATALOG_AGENT.id,
  agentName: CATALOG_AGENT.name,
  outputRenderer: 'simple_report',
  query: 'AMZN',
  instruction: null,
  createdAt: 1_700_000_000_000,
  report: { summary: 'Restored snapshot.', key_points: [], sections: [], sources: [] },
  metrics: { durationSecs: 12, tokenCount: 3_400, toolRuns: 2 },
};

/**
 * Darkened overlay of the drawer. It carries no role by design, so it is
 * located by the `aria-hidden` marker plus its own background class; the
 * confirmation layer shares the background but is not `aria-hidden`.
 */
function getHistoryOverlay(): HTMLElement {
  const overlay = document.querySelector<HTMLElement>('div[aria-hidden="true"].bg-black\\/60');
  if (overlay === null) {
    throw new Error('The History_Panel overlay is not present');
  }
  return overlay;
}

/** Closes the open History_Panel through the generated mode. */
async function closeHistoryPanel(
  mode: HistoryCloseMode,
  panel: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  if (mode === 'overlay') {
    // Requirement 2.2
    await user.click(getHistoryOverlay());
    return;
  }
  if (mode === 'escape') {
    // Requirement 2.3
    await user.keyboard('{Escape}');
    return;
  }
  if (mode === 'close-control') {
    // Requirement 2.10
    await user.click(within(panel).getByRole('button', { name: 'Close history' }));
    return;
  }
  // Requirement 5.1: activating an entry restores its report and closes the
  // panel. The row's own button is the first one of the row; the second is the
  // `Delete entry` sibling.
  const row = within(panel).getAllByRole('listitem')[0];
  await user.click(within(row).getAllByRole('button')[0]);
}

describe('Keyboard focus around the History_Panel', () => {
  it('Feature: interaction-history-panel, Property 3: Keyboard focus round trip', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...HISTORY_CLOSE_MODES), async (mode) => {
        const user = userEvent.setup({ delay: null });

        seedStoredHistory([FOCUS_ROUND_TRIP_ENTRY]);

        try {
          render(<App />);

          const trigger = await findHistoryTrigger();

          // The seeded entry becomes visible only once the catalog request has
          // resolved the Active Agent, which is also when the row exists.
          await waitFor(() => {
            expect(historyTriggerCount(trigger)).toBe('1');
          });

          await user.click(trigger);
          const panel = await screen.findByRole('dialog', { name: 'History' });

          // Requirement 2.8: on open, focus lands on an element inside the panel.
          await waitFor(() => {
            expect(document.activeElement).not.toBeNull();
            expect(panel.contains(document.activeElement)).toBe(true);
          });

          await closeHistoryPanel(mode, panel, user);

          // The drawer leaves through an exit animation, so its removal is
          // awaited instead of asserted on the same frame.
          await waitFor(() => {
            expect(isHistoryPanelPresent()).toBe(false);
          });

          if (mode === 'restore') {
            /*
              Requirement 5.1 switches the whole view to the restored report, so
              the header and its History_Trigger leave the document and there is
              no trigger left to receive the focus. What Requirement 2.9 protects
              in this mode is that the focus does not stay inside the panel that
              was just removed.
            */
            expect(screen.queryByRole('button', { name: 'History' })).toBeNull();
            expect(panel.contains(document.activeElement)).toBe(false);
          } else {
            // Requirement 2.9: focus returns to the History_Trigger.
            await waitFor(() => {
              expect(document.activeElement).toBe(trigger);
            });
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full application mount plus real user
    // events, do not fit in the default per-test budget.
  }, PROPERTY_TEST_TIMEOUT_MS);
});
/* ── Property 5 ──────────────────────────────────────────────── */

/**
 * The four run outcomes named by Property 5. Only `promoted` finishes with a
 * Promoted Report; `stream-error` and `http-error` are the two ways a run
 * finishes with an error, `stopped` is the user stop and `not-promoted` is a run
 * that completes with text no renderer can structure.
 */
const RUN_OUTCOMES = [
  'promoted',
  'stream-error',
  'http-error',
  'stopped',
  'not-promoted',
] as const;

type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** Tickers accepted by the `ticker` input mode: 1 to 10 characters of `A-Z0-9`. */
const tickerArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), {
    minLength: 1,
    maxLength: 10,
  })
  .map((characters) => characters.join(''));

/**
 * Report object of the promoted run. It declares a root key of the
 * `financial_report` renderer the catalog agent uses, which is what makes the
 * run promote a report.
 */
const PROMOTED_RUN_REPORT = { verdict: 'Hold', findings: [], deep_insights: [] } as const;

/** Final text of a promoted run: the report inside a fenced JSON block. */
const PROMOTED_RUN_TEXT = ['```json', JSON.stringify(PROMOTED_RUN_REPORT), '```'].join('\n');

/** Final text of a run that promotes nothing: prose with no report object. */
const UNSTRUCTURED_RUN_TEXT = 'The agent answered with prose and no structured report.';

/** One SSE frame in the wire format the application parses. */
function sseFrame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Frames served for each outcome; the stop outcome sends none and stays open. */
function runFrames(outcome: RunOutcome): string[] {
  if (outcome === 'promoted') {
    return [sseFrame({ type: 'text', text: PROMOTED_RUN_TEXT }), 'data: [DONE]\n\n'];
  }
  if (outcome === 'not-promoted') {
    return [sseFrame({ type: 'text', text: UNSTRUCTURED_RUN_TEXT }), 'data: [DONE]\n\n'];
  }
  if (outcome === 'stream-error') {
    return [sseFrame({ type: 'error', message: 'The remote agent failed.' }), 'data: [DONE]\n\n'];
  }
  return [];
}

/**
 * Synthetic SSE response. With `signal` provided the stream stays open until
 * that signal aborts and then fails with an `AbortError`, which is exactly the
 * shape the user-stop path of the application expects.
 */
function makeSseResponse(frames: string[], signal: AbortSignal | null): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }

      if (signal === null) {
        controller.close();
        return;
      }

      const fail = () => {
        try {
          controller.error(new DOMException('The run was aborted.', 'AbortError'));
        } catch {
          // The stream was already closed or errored; nothing left to signal.
        }
      };

      if (signal.aborted) {
        fail();
        return;
      }
      signal.addEventListener('abort', fail, { once: true });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * `fetch` replacement that serves the agent catalog and one `/api/analyze` run
 * shaped by the generated outcome. Any other URL still fails loudly.
 */
function installRunFetchDouble(outcome: RunOutcome): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes('/api/agents')) {
        return new Response(JSON.stringify(CATALOG_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/analyze')) {
        if (outcome === 'http-error') {
          // The run never reaches the stream: the request itself is rejected.
          return new Response(JSON.stringify({ error: 'The upstream agent rejected the run.' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return makeSseResponse(
          runFrames(outcome),
          outcome === 'stopped' ? (init?.signal ?? null) : null,
        );
      }

      throw new Error(`Unexpected request to ${url}`);
    }),
  );
}

/**
 * History Entry already stored before the generated run. Starting from a
 * non-empty history is what turns "the list stays identical" into a real
 * assertion instead of comparing two empty lists.
 */
const PRE_EXISTING_ENTRY: InteractionHistoryEntry = {
  id: 'entry-before-the-run',
  agentId: CATALOG_AGENT.id,
  agentName: CATALOG_AGENT.name,
  outputRenderer: CATALOG_AGENT.outputRenderer,
  query: 'MSFT',
  instruction: null,
  createdAt: 1_700_000_000_000,
  report: { verdict: 'Buy', findings: [] },
  metrics: { durationSecs: 8, tokenCount: 1_200, toolRuns: 1 },
};

/** Content of the History Key as an array, or null when the key is absent. */
function readPersistedHistory(): InteractionHistoryEntry[] | null {
  const raw = localStorage.getItem(HISTORY_KEY);
  return raw === null ? null : (JSON.parse(raw) as InteractionHistoryEntry[]);
}

/** Runs the generated outcome from the input bar and waits for it to finish. */
async function driveRun(
  user: ReturnType<typeof userEvent.setup>,
  ticker: string,
  outcome: RunOutcome,
): Promise<void> {
  await user.type(screen.getByLabelText('Entrada del agente'), ticker);
  await user.click(screen.getByRole('button', { name: CATALOG_AGENT.actionLabel }));

  if (outcome === 'stopped') {
    // The stop needs its confirmation, exactly as a user would give it.
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    await user.click(await screen.findByRole('button', { name: 'Stop Analysis' }));
    /*
      The abort branch of the run leaves this trace in the timeline, so waiting
      for it proves the stopped run reached its end instead of being asserted
      mid-flight.
    */
    await screen.findByText('Run stopped');
    return;
  }

  // The action button comes back only once the run released `running`.
  await waitFor(() => {
    expect(screen.getByRole('button', { name: CATALOG_AGENT.actionLabel })).toBeInTheDocument();
  });
}

describe('Recording a run in the interaction history', () => {
  it('Feature: interaction-history-panel, Property 5: Conditional recording of runs', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...RUN_OUTCOMES), tickerArb, async (outcome, ticker) => {
        const user = userEvent.setup({ delay: null });

        seedStoredHistory([PRE_EXISTING_ENTRY]);
        installRunFetchDouble(outcome);

        try {
          render(<App />);

          const trigger = await findHistoryTrigger();

          // The run must start with the Active Agent already resolved, which is
          // also when the stored entry becomes a Visible Entry.
          await waitFor(() => {
            expect(historyTriggerCount(trigger)).toBe('1');
          });

          const before = readPersistedHistory();
          expect(before).toEqual([PRE_EXISTING_ENTRY]);

          await driveRun(user, ticker, outcome);

          if (outcome === 'promoted') {
            // Requirement 3.1: exactly one History Entry is added, and the
            // count of the trigger is what makes the addition observable.
            await waitFor(() => {
              expect(historyTriggerCount(trigger)).toBe('2');
            });

            const after = readPersistedHistory() ?? [];
            expect(after).toHaveLength(2);
            // Requirement 3.1: the added entry carries this run's snapshot.
            expect(after[0].query).toBe(ticker);
            expect(after[0].report).toEqual(PROMOTED_RUN_REPORT);
            // Nothing but the insertion happened: the previous list is intact.
            expect(after.slice(1)).toEqual([PRE_EXISTING_ENTRY]);
          } else {
            /*
              Requirement 3.6: a run that finished with an error, was stopped by
              the user or promoted no report leaves the History Entries
              identical, in memory and in the History Key.
            */
            expect(readPersistedHistory()).toEqual([PRE_EXISTING_ENTRY]);
            expect(historyTriggerCount(trigger)).toBe('1');
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full application mount plus a driven run,
    // do not fit in the default per-test budget.
  }, PROPERTY_TEST_TIMEOUT_MS);
});

/* ── Property 6 ──────────────────────────────────────────────── */

/**
 * Two catalog agents that differ in `id`, in `name` and in `outputRenderer`.
 * Whichever one serves the run, the other one is a valid later Active Agent
 * whose three identity fields differ from the frozen ones, so "the entry keeps
 * the identity of the run" and "the entry does not take the identity of the
 * Active Agent at the moment of saving" are both observable.
 */
const RUN_IDENTITY_AGENTS: readonly AgentCatalogEntry[] = [
  {
    ...CATALOG_AGENT,
    id: 'agent-financial-desk',
    name: 'Financial Desk',
    outputRenderer: 'financial_report',
    isDefault: false,
  },
  {
    ...CATALOG_AGENT,
    id: 'agent-simple-desk',
    name: 'Simple Desk',
    outputRenderer: 'simple_report',
    isDefault: false,
  },
];

/**
 * Report object per renderer. Each one declares a root key of its renderer,
 * which is what makes the run promote a report under that renderer.
 */
const RENDERER_REPORTS: Record<OutputRenderer, Record<string, unknown>> = {
  financial_report: { verdict: 'Hold', findings: [], deep_insights: [] },
  simple_report: { summary: 'Frozen snapshot.', key_points: [], sections: [], sources: [] },
};

/**
 * Where the identity of the run comes from. With `catalog` the stream sends no
 * `agent_info`, so the run stays tagged with the requested catalog agent; with
 * `stream` an `agent_info` frame confirms the same `agentId` under a different
 * name, which is the accumulator path that must also survive the later change
 * of Active Agent.
 */
const RUN_IDENTITY_SOURCES = ['catalog', 'stream'] as const;

type RunIdentitySource = (typeof RUN_IDENTITY_SOURCES)[number];

/** Name informed by the `agent_info` frame of a `stream` case. */
function streamAgentName(agent: AgentCatalogEntry): string {
  return `${agent.name} (informed by the stream)`;
}

/** Identity the History Entry of this run must carry (Requirement 3.2). */
function expectedRunIdentity(
  agent: AgentCatalogEntry,
  source: RunIdentitySource,
): { agentId: string; agentName: string; outputRenderer: OutputRenderer } {
  return {
    agentId: agent.id,
    agentName: source === 'stream' ? streamAgentName(agent) : agent.name,
    outputRenderer: agent.outputRenderer,
  };
}

/**
 * `fetch` replacement that serves the two-agent catalog with `runAgent` as the
 * default, and one `/api/analyze` run that promotes a report for that agent's
 * renderer. Any other URL still fails loudly, so the restoration-free contract
 * of this property is not silently broken by an extra request.
 */
function installRunIdentityFetchDouble(
  runAgent: AgentCatalogEntry,
  source: RunIdentitySource,
): void {
  const catalog: AgentCatalogResponse = {
    agents: [...RUN_IDENTITY_AGENTS],
    defaultAgentId: runAgent.id,
  };

  const frames: string[] = [];
  if (source === 'stream') {
    // The informed `agentId` equals the requested one, so this frame refreshes
    // the identity of the run without moving the Active Agent.
    frames.push(
      sseFrame({
        type: 'agent_info',
        agentId: runAgent.id,
        agentName: streamAgentName(runAgent),
        outputRenderer: runAgent.outputRenderer,
      }),
    );
  }
  frames.push(
    sseFrame({
      type: 'text',
      text: ['```json', JSON.stringify(RENDERER_REPORTS[runAgent.outputRenderer]), '```'].join(
        '\n',
      ),
    }),
    'data: [DONE]\n\n',
  );

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes('/api/agents')) {
        return new Response(JSON.stringify(catalog), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/analyze')) {
        return makeSseResponse(frames, null);
      }

      throw new Error(`Unexpected request to ${url}`);
    }),
  );
}

/** Selects `agent` through the Agent_Selector of the header. */
async function selectActiveAgent(
  user: ReturnType<typeof userEvent.setup>,
  agent: AgentCatalogEntry,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Seleccionar agente' }));
  const listbox = await screen.findByRole('listbox', { name: 'Agentes disponibles' });
  const option = within(listbox)
    .getAllByRole('option')
    .find((candidate) => (candidate.textContent ?? '').includes(agent.name));

  if (option === undefined) {
    throw new Error(`The Agent_Selector offers no option for ${agent.name}`);
  }
  await user.click(option);
}

describe('Run identity of a recorded History Entry', () => {
  it('Feature: interaction-history-panel, Property 6: Run identity frozen in the entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Which of the two agents serves the run, and where its identity comes
        // from: the requested catalog entry or the `agent_info` frame.
        fc.constantFrom(0, 1),
        fc.constantFrom(...RUN_IDENTITY_SOURCES),
        tickerArb,
        async (runAgentIndex, source, ticker) => {
          const user = userEvent.setup({ delay: null });

          const runAgent = RUN_IDENTITY_AGENTS[runAgentIndex];
          // The later Active Agent: the other agent, so its `agentId`,
          // `agentName` and `outputRenderer` all differ from the run's.
          const laterAgent = RUN_IDENTITY_AGENTS[1 - runAgentIndex];
          const expected = expectedRunIdentity(runAgent, source);

          seedStoredHistory([]);
          installRunIdentityFetchDouble(runAgent, source);

          try {
            render(<App />);

            const trigger = await findHistoryTrigger();

            // The run starts only once the catalog resolved the Active Agent,
            // which is the agent this run is tagged with.
            await screen.findByRole('button', { name: runAgent.actionLabel });
            await waitFor(() => {
              expect(screen.getByRole('button', { name: 'Seleccionar agente' }).textContent).toContain(
                runAgent.name,
              );
            });

            await driveRun(user, ticker, 'promoted');

            // The recording is observable through the count of the trigger,
            // still filtered by the run agent at this point.
            await waitFor(() => {
              expect(historyTriggerCount(trigger)).toBe('1');
            });

            // The later change of Active Agent named by the property.
            await selectActiveAgent(user, laterAgent);
            await waitFor(() => {
              expect(screen.getByRole('button', { name: 'Seleccionar agente' }).textContent).toContain(
                laterAgent.name,
              );
            });

            const persisted = readPersistedHistory() ?? [];
            expect(persisted).toHaveLength(1);

            /*
              Requirement 3.2: the stored entry carries the identity and the
              renderer of the run that produced the report.
            */
            expect(persisted[0].agentId).toBe(expected.agentId);
            expect(persisted[0].agentName).toBe(expected.agentName);
            expect(persisted[0].outputRenderer).toBe(expected.outputRenderer);

            /*
              Requirement 3.2: and not those of the Active Agent at the moment of
              saving, which is now a different agent in all three fields.
            */
            expect(persisted[0].agentId).not.toBe(laterAgent.id);
            expect(persisted[0].agentName).not.toBe(laterAgent.name);
            expect(persisted[0].outputRenderer).not.toBe(laterAgent.outputRenderer);

            // The frozen tag is what the panel filters on, so the entry left
            // the Visible Entries of the new Active Agent instead of following
            // it (Requirement 8.1 seen from Requirement 3.2).
            expect(historyTriggerCount(trigger)).toBeNull();
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full application mount, a driven run and
    // an agent change, do not fit in the default per-test budget.
  }, PROPERTY_TEST_TIMEOUT_MS);
});

/* ── Property 12 ─────────────────────────────────────────────── */

/**
 * Report snapshot per renderer, built so every generated case carries two
 * observable pieces of the stored `report`: the summary and one highlight. The
 * `financial_report` shape declares `verdict`, `findings` and `deep_insights`;
 * the `simple_report` shape declares `summary`, `key_points`, `sections` and
 * `sources`.
 */
function makeRestorableReport(
  renderer: OutputRenderer,
  summary: string,
  highlight: string,
): Record<string, unknown> {
  if (renderer === 'simple_report') {
    return { summary, key_points: [highlight], sections: [], sources: [] };
  }
  return {
    verdict: { summary, conviction_score: 77, key_takeaways: [highlight] },
    findings: [],
    deep_insights: [],
  };
}

/**
 * The single Visible Entry of a generated case. It is tagged with the default
 * catalog agent, so the Active Agent resolved by the catalog request makes it
 * visible, and its `agentName` deliberately differs from the catalog agent's
 * name: that is what proves the restored title comes from the entry.
 */
function makeRestorableEntry(fields: {
  outputRenderer: OutputRenderer;
  agentName: string;
  query: string;
  summary: string;
  highlight: string;
  metrics: { durationSecs: number; tokenCount: number; toolRuns: number };
}): InteractionHistoryEntry {
  return {
    id: 'entry-to-restore',
    agentId: CATALOG_AGENT.id,
    agentName: fields.agentName,
    outputRenderer: fields.outputRenderer,
    query: fields.query,
    instruction: null,
    createdAt: 1_700_000_000_000,
    report: makeRestorableReport(fields.outputRenderer, fields.summary, fields.highlight),
    metrics: fields.metrics,
  };
}

/**
 * Value of one metric cell of the report header. Both report views lay the cell
 * out as a label followed by its value, so the value is read from the sibling of
 * the label instead of matching a bare number that could appear anywhere else on
 * the page.
 */
function readReportMetric(label: string): string {
  const labelNode = screen.getByText(label);
  const valueNode = labelNode.nextElementSibling;
  if (valueNode === null) {
    throw new Error(`The ${label} metric shows no value`);
  }
  return (valueNode.textContent ?? '').trim();
}

/** URLs the mounted application requested through the `fetch` double. */
function requestedUrls(): string[] {
  return (globalThis.fetch as unknown as Mock).mock.calls.map(([input]) => {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return (input as Request).url;
  });
}

describe('Restoring a report from the interaction history', () => {
  it('Feature: interaction-history-panel, Property 12: Faithful restoration with no network', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // Both renderers, so the branch of Requirement 5.2 is generated
          // instead of being fixed by the test.
          outputRenderer: fc.constantFrom(...OUTPUT_RENDERERS),
          // Distinct prefixes keep the title, the identifier and the two report
          // texts apart, so no assertion can pass by matching another one.
          agentNameSuffix: fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
          querySuffix: fc.stringMatching(/^[A-Z0-9]{1,10}$/),
          summarySuffix: fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
          highlightSuffix: fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
          /*
            Every metric is strictly positive, while the live run state of a
            freshly mounted application holds zeros. Reading back these values is
            therefore what separates "the metrics of the entry" from "the metrics
            of the live run" (Requirement 5.3).
          */
          durationSecs: fc.integer({ min: 1, max: 3600 }),
          tokenCount: fc.integer({ min: 1, max: 999_999 }),
          toolRuns: fc.integer({ min: 1, max: 50 }),
        }),
        async (generated) => {
          const user = userEvent.setup({ delay: null });

          const entry = makeRestorableEntry({
            outputRenderer: generated.outputRenderer,
            agentName: `Agent ${generated.agentNameSuffix}`,
            query: `QUERY-${generated.querySuffix}`,
            summary: `Summary ${generated.summarySuffix}`,
            highlight: `Highlight ${generated.highlightSuffix}`,
            metrics: {
              durationSecs: generated.durationSecs,
              tokenCount: generated.tokenCount,
              toolRuns: generated.toolRuns,
            },
          });

          seedStoredHistory([entry]);
          // A fresh `fetch` double per case, so the requests observed below
          // belong to this mount only.
          installFetchDouble();

          try {
            render(<App />);

            const trigger = await findHistoryTrigger();

            // The entry becomes a Visible Entry once the catalog request has
            // resolved the Active Agent, which is also when its row exists.
            await waitFor(() => {
              expect(historyTriggerCount(trigger)).toBe('1');
            });

            await user.click(trigger);
            const panel = await screen.findByRole('dialog', { name: 'History' });

            // The row's own button restores; the second button of the row is
            // the `Delete entry` sibling.
            const row = within(panel).getAllByRole('listitem')[0];
            await user.click(within(row).getAllByRole('button')[0]);

            // Requirement 5.1: the History_Panel ends up closed. Its exit
            // animation is awaited instead of asserted on the same frame.
            await waitFor(() => {
              expect(isHistoryPanelPresent()).toBe(false);
            });

            if (generated.outputRenderer === 'simple_report') {
              /*
                Requirement 5.2: `simple_report` is rendered by
                `SimpleReportView`, identified by its `Summary` card, and never
                by `ReportTemplate`.
              */
              await screen.findByRole('heading', { name: 'Summary' });
              expect(screen.queryByRole('heading', { name: 'Executive Summary' })).toBeNull();
              expect(screen.queryByText('Conviction Score')).toBeNull();

              // Requirement 5.4: the stored `agentName` is the title and the
              // stored `query` the subtitle of that view.
              expect(screen.getAllByText(entry.agentName).length).toBeGreaterThan(0);
              expect(screen.getAllByText(entry.query).length).toBeGreaterThan(0);
            } else {
              /*
                Requirement 5.2: any other renderer is rendered by
                `ReportTemplate`, identified by its `Executive Summary` card, and
                never by `SimpleReportView`.
              */
              await screen.findByRole('heading', { name: 'Executive Summary' });
              expect(screen.queryByRole('heading', { name: 'Summary' })).toBeNull();

              /*
                Requirement 5.4: the stored `query` is the header identifier of
                this view. `ReportTemplate` exposes no separate title slot, so
                the identifier is where the entry's own text has to show up.
              */
              expect(screen.getByText(`${entry.query} Document Analysis`)).toBeInTheDocument();
            }

            // Requirement 5.1: the view shows the `report` object of the entry.
            expect(screen.getByText(`Summary ${generated.summarySuffix}`)).toBeInTheDocument();
            expect(screen.getByText(`Highlight ${generated.highlightSuffix}`)).toBeInTheDocument();

            // Requirement 5.3: the three metrics are the ones frozen in the
            // entry, not the zeros of the untouched live run state.
            expect(readReportMetric('Time')).toBe(`${entry.metrics.durationSecs}s`);
            expect(readReportMetric('Runs')).toBe(String(entry.metrics.toolRuns));
            expect(readReportMetric('Tokens')).toBe(
              `${(entry.metrics.tokenCount / 1000).toFixed(1)}k`,
            );

            // Requirement 5.5: the whole restoration ran without a single
            // request to `/api/analyze`.
            expect(requestedUrls().filter((url) => url.includes('/api/analyze'))).toEqual([]);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full application mount plus a restoration
    // driven through real user events, do not fit in the default per-test budget.
  }, PROPERTY_TEST_TIMEOUT_MS);
});

/* ── Property 14 ─────────────────────────────────────────────── */

/**
 * The interface states a restoration can start from, and therefore the states
 * closing the restored report has to give back (Requirement 5.7):
 *
 * - `landing`: nothing has run yet, so the landing view is on screen.
 * - `run-panel`: a run finished without a Promoted Report, so the execution
 *   panel is on screen with its timeline and no report card.
 * - `run-panel-with-report`: a run finished with a Promoted Report, so the
 *   execution panel also offers the report card of the live run.
 *
 * The live-report view (`isReportOpen === 'flash'`) is not part of this list:
 * that branch returns before the main view, so it renders neither the
 * History_Trigger nor the History_Panel and no restoration can be started from
 * it through the interface.
 */
const PRIOR_INTERFACE_STATES = ['landing', 'run-panel', 'run-panel-with-report'] as const;

type PriorInterfaceState = (typeof PRIOR_INTERFACE_STATES)[number];

/**
 * Observable shape of the interface outside the report views. Comparing this
 * descriptor before the restoration and after closing the restored report is
 * what turns "the interface returns to the previous state" into one assertion
 * over the whole view instead of a per-state checklist.
 */
interface InterfaceStateSnapshot {
  /** Landing view, identified by the title `landingContent` derives from the agent. */
  landingVisible: boolean;
  /** Execution panel, identified by the sparkle image of its header. */
  runPanelVisible: boolean;
  /** Report card of the live run inside the timeline. */
  reportCardVisible: boolean;
  /** Any report view on screen, live or restored: both carry this close control. */
  reportViewVisible: boolean;
  /** Count shown by the History_Trigger, or null when there is no trigger. */
  triggerCount: string | null;
  /** Whether the History_Panel is open. */
  historyPanelOpen: boolean;
}

/**
 * Alt text of the model badge in the execution panel header. That badge is the
 * element unique to the panel, so it is what tells the panel apart from the
 * landing view. It names the model provider, so switching providers in `App.tsx`
 * has to be reflected here.
 */
const RUN_PANEL_MODEL_BADGE_ALT = 'DeepSeek';

function captureInterfaceState(): InterfaceStateSnapshot {
  const trigger = screen.queryByRole('button', { name: 'History' });
  return {
    landingVisible:
      screen.queryByRole('heading', { level: 1, name: CATALOG_AGENT.name }) !== null,
    runPanelVisible: screen.queryByAltText(RUN_PANEL_MODEL_BADGE_ALT) !== null,
    reportCardVisible:
      screen.queryByRole('heading', { name: 'Your report is now ready' }) !== null,
    reportViewVisible: screen.queryByTitle('Close report') !== null,
    triggerCount: trigger === null ? null : historyTriggerCount(trigger),
    historyPanelOpen: isHistoryPanelPresent(),
  };
}

/**
 * Brings the mounted application to the generated prior state. The landing
 * state needs no interaction; the other two drive a run whose outcome decides
 * whether a report is promoted, and a run without a Promoted Report leaves the
 * History Entries untouched (Requirement 3.6).
 */
async function reachPriorState(
  state: PriorInterfaceState,
  user: ReturnType<typeof userEvent.setup>,
  ticker: string,
): Promise<void> {
  if (state === 'landing') {
    /*
      The landing view swaps its content through `AnimatePresence mode="wait"`
      when the catalog resolves the Active Agent, so the agent-derived title
      arrives one animation after the Active Agent itself. Waiting for it here
      is what makes the captured prior state the settled one.
    */
    await screen.findByRole('heading', { level: 1, name: CATALOG_AGENT.name });
    return;
  }
  await driveRun(user, ticker, state === 'run-panel-with-report' ? 'promoted' : 'not-promoted');
}

describe('Closing a report restored from the interaction history', () => {
  it('Feature: interaction-history-panel, Property 14: Closing a restored report returns to the previous state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // The prior interface state the restoration starts from.
          priorState: fc.constantFrom(...PRIOR_INTERFACE_STATES),
          // Both renderers, so the restored view that gets closed is generated
          // instead of fixed (Requirement 5.2 folded into the input space).
          outputRenderer: fc.constantFrom(...OUTPUT_RENDERERS),
          // Distinct texts per case, so the row activated below and the report
          // it opens belong to this generated entry only.
          querySuffix: fc.stringMatching(/^[A-Z0-9]{1,10}$/),
          summarySuffix: fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
          // Ticker of the run that produces the two execution-panel states.
          ticker: tickerArb,
        }),
        async (generated) => {
          const user = userEvent.setup({ delay: null });

          const entry = makeRestorableEntry({
            outputRenderer: generated.outputRenderer,
            agentName: `Agent ${generated.summarySuffix}`,
            // The hyphen keeps this query apart from the run's ticker, which is
            // uppercase alphanumerics only.
            query: `HIST-${generated.querySuffix}`,
            summary: `Summary ${generated.summarySuffix}`,
            highlight: `Highlight ${generated.summarySuffix}`,
            metrics: { durationSecs: 9, tokenCount: 2_500, toolRuns: 3 },
          });

          seedStoredHistory([entry]);
          // The landing state issues no run, so its double still rejects any
          // request to `/api/analyze`; the other two states need it served.
          if (generated.priorState === 'landing') {
            installFetchDouble();
          } else {
            installRunFetchDouble(
              generated.priorState === 'run-panel-with-report' ? 'promoted' : 'not-promoted',
            );
          }

          try {
            render(<App />);

            const trigger = await findHistoryTrigger();

            // The seeded entry becomes a Visible Entry once the catalog request
            // has resolved the Active Agent, which is also when the run may
            // start with that agent.
            await waitFor(() => {
              expect(historyTriggerCount(trigger)).toBe('1');
            });

            await reachPriorState(generated.priorState, user, generated.ticker);

            // The prior state, captured with the History_Panel still closed so
            // it is comparable with the state after the restored report closes.
            const before = captureInterfaceState();
            const historyBefore = readPersistedHistory();

            // The harness really reached the generated state: without this the
            // comparison below could hold between two identical wrong states.
            expect(before.landingVisible).toBe(generated.priorState === 'landing');
            expect(before.runPanelVisible).toBe(generated.priorState !== 'landing');
            expect(before.reportCardVisible).toBe(
              generated.priorState === 'run-panel-with-report',
            );
            expect(before.reportViewVisible).toBe(false);
            expect(before.historyPanelOpen).toBe(false);

            await user.click(trigger);
            const panel = await screen.findByRole('dialog', { name: 'History' });

            // The row of the generated entry: a promoted run adds a second row
            // for its own ticker, so the row is located by its query text
            // instead of by position.
            const row = within(panel)
              .getAllByRole('listitem')
              .find((candidate) => (candidate.textContent ?? '').includes(entry.query));
            if (row === undefined) {
              throw new Error(`The History_Panel shows no row for ${entry.query}`);
            }
            // The row's own button restores; the second button of the row is the
            // `Delete entry` sibling.
            await user.click(within(row).getAllByRole('button')[0]);

            // Requirements 5.1, 5.2: the restored report is on screen under the
            // view its stored renderer selects.
            const restoredHeading =
              generated.outputRenderer === 'simple_report' ? 'Summary' : 'Executive Summary';
            await screen.findByRole('heading', { name: restoredHeading });
            expect(screen.getByText(`Summary ${generated.summarySuffix}`)).toBeInTheDocument();

            // Requirement 5.7: closing the restored report.
            await user.click(screen.getByTitle('Close report'));

            await waitFor(() => {
              // The restored view left the document; the report of the live run,
              // when there is one, is not opened in its place either.
              expect(screen.queryByRole('heading', { name: restoredHeading })).toBeNull();
              // The interface is back to exactly the state it had before the
              // restoration, with the History_Panel closed again.
              expect(captureInterfaceState()).toEqual(before);
            });

            // Requirement 5.7: and no History Entry was deleted along the way.
            expect(readPersistedHistory()).toEqual(historyBefore);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full application mount plus a restoration
    // driven through real user events, do not fit in the default per-test budget.
  }, PROPERTY_TEST_TIMEOUT_MS);
});

/* ── Property 20 ─────────────────────────────────────────────── */

/**
 * History Entry whose only generated trait is the agent that owns it. The
 * identifier, the query and the `createdAt` come from the position, so the
 * generated list is already newest first and every row can be told apart by its
 * query text.
 */
function makeFilteredEntry(agentId: string, index: number): InteractionHistoryEntry {
  return {
    id: `entry-filter-${index}`,
    agentId,
    agentName: `Agent ${agentId}`,
    outputRenderer: 'simple_report',
    query: `QUERY-${index}`,
    instruction: null,
    createdAt: 1_700_000_000_000 - index * 60_000,
    report: { summary: `Snapshot ${index}`, key_points: [], sections: [], sources: [] },
    metrics: { durationSecs: 1, tokenCount: 1_000, toolRuns: 1 },
  };
}

/**
 * Multi-agent stored histories, the empty one included. The orphan agent is
 * never selectable, so its entries have to stay out of every Visible Entries
 * list while remaining in the History Key (Requirement 8.3).
 */
const multiAgentStoredHistoryArb: fc.Arbitrary<InteractionHistoryEntry[]> = fc
  .array(fc.constantFrom<string>(...CATALOG_AGENT_IDS, ORPHAN_AGENT_ID), {
    minLength: 0,
    maxLength: 6,
  })
  .map((agentIds) => agentIds.map(makeFilteredEntry));

/**
 * Independent oracle of Requirements 8.1 and 8.5: the queries of the entries
 * whose `agentId` matches exactly, walked in stored order, and none at all
 * while the Active Agent is null.
 */
function expectedVisibleQueries(
  entries: InteractionHistoryEntry[],
  activeAgentId: string | null,
): string[] {
  if (activeAgentId === null) return [];

  const queries: string[] = [];
  for (const entry of entries) {
    if (entry.agentId === activeAgentId) queries.push(entry.query);
  }
  return queries;
}

/**
 * Queries of the rendered rows, in rendered order. The query is the first
 * paragraph of the row; reading it from the element instead of from the row text
 * keeps the timestamp, which renders as a local date for these stored instants,
 * out of the comparison.
 */
function renderedRowQueries(panel: HTMLElement): string[] {
  return within(panel)
    .queryAllByRole('listitem')
    .map((row) => {
      const queryNode = row.querySelector('p');
      if (queryNode === null) {
        throw new Error('A History_Panel row shows no query text');
      }
      return (queryNode.textContent ?? '').trim();
    });
}

/** Opens the History_Panel through the History_Trigger and returns the drawer. */
async function openHistoryPanel(
  user: ReturnType<typeof userEvent.setup>,
  trigger: HTMLElement,
): Promise<HTMLElement> {
  await user.click(trigger);
  return screen.findByRole('dialog', { name: 'History' });
}

/**
 * Closes the open History_Panel through its close control. The header sits
 * under the drawer overlay, so the Active Agent is changed with the panel
 * closed, exactly as a user has to do it.
 */
async function closeHistoryPanelWithControl(
  user: ReturnType<typeof userEvent.setup>,
  panel: HTMLElement,
): Promise<void> {
  await user.click(within(panel).getByRole('button', { name: 'Close history' }));
  await waitFor(() => {
    expect(isHistoryPanelPresent()).toBe(false);
  });
}

/** Text shown by the Agent_Selector trigger, which names the Active Agent. */
function agentSelectorLabel(): string {
  return screen.getByRole('button', { name: 'Seleccionar agente' }).textContent ?? '';
}

describe('Filtering the interaction history by the Active Agent', () => {
  it('Feature: interaction-history-panel, Property 20: Filtering by active agent', async () => {
    await fc.assert(
      fc.asyncProperty(
        multiAgentStoredHistoryArb,
        // Active Agent the case starts from, null included (Requirement 8.5).
        fc.option(fc.constantFrom(...CATALOG_AGENT_IDS), { nil: null }),
        // Active Agent the case switches to; it may be the same one, in which
        // case the displayed list has to stay put.
        fc.constantFrom(...CATALOG_AGENT_IDS),
        async (entries, initialAgentId, nextAgentId) => {
          const user = userEvent.setup({ delay: null });

          seedStoredHistory(entries);
          installFetchDouble(makeCatalog(initialAgentId));

          try {
            render(<App />);

            const trigger = await findHistoryTrigger();

            // The Active Agent is resolved by the catalog request, so the
            // settled state is awaited through the Agent_Selector label. An
            // empty catalog is the only state that yields a null Active Agent.
            await waitFor(() => {
              expect(agentSelectorLabel()).toContain(
                initialAgentId === null ? 'Sin agente' : `Agent ${initialAgentId}`,
              );
            });

            const initialQueries = expectedVisibleQueries(entries, initialAgentId);

            // Requirement 1.7 seen from the filtering: the count of the trigger
            // is the number of Visible Entries of the Active Agent.
            expect(historyTriggerCount(trigger)).toBe(
              initialQueries.length > 0 ? String(initialQueries.length) : null,
            );

            const panel = await openHistoryPanel(user, trigger);

            /*
              Requirements 8.1, 8.5: the drawer lists exactly the entries whose
              `agentId` matches the Active Agent, in the same relative order,
              and nothing at all while the Active Agent is null. Entries of the
              other agents, the never-selectable one included, are absent.
            */
            expect(renderedRowQueries(panel)).toEqual(initialQueries);

            if (initialAgentId === null) {
              /*
                With no catalog there is no Agent_Selector option to pick, so
                this case ends here: the zero Visible Entries above are the whole
                of Requirement 8.5.
              */
              expect(readPersistedHistory()).toEqual(entries);
              return;
            }

            await closeHistoryPanelWithControl(user, panel);

            // Requirement 8.2: the user changes the Active Agent.
            await selectActiveAgent(user, makeCatalogAgent(nextAgentId));
            await waitFor(() => {
              expect(agentSelectorLabel()).toContain(`Agent ${nextAgentId}`);
            });

            const nextQueries = expectedVisibleQueries(entries, nextAgentId);

            /*
              Requirement 8.2: the interface follows the new Active Agent right
              away, with no reload and no extra interaction — the count of the
              trigger already reports the Visible Entries of the new agent.
            */
            expect(historyTriggerCount(trigger)).toBe(
              nextQueries.length > 0 ? String(nextQueries.length) : null,
            );

            // Requirement 8.2: and the displayed list is the one of the new
            // Active Agent, again as the exact ordered subsequence.
            const refreshedPanel = await openHistoryPanel(user, trigger);
            expect(renderedRowQueries(refreshedPanel)).toEqual(nextQueries);

            /*
              Requirement 8.3: filtering only narrows the view. Every entry of
              every agent, including the ones no Active Agent ever displays, is
              still in the single History Key.
            */
            expect(readPersistedHistory()).toEqual(entries);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full application mount plus an agent
    // change driven through real user events, do not fit in the default
    // per-test budget.
  }, PROPERTY_TEST_TIMEOUT_MS);
});

/* ── Property 23 ─────────────────────────────────────────────── */

/**
 * Stored history of a generated case: entries of any combination of agents with
 * at least one entry of the Active Agent, because the `Clear all` control only
 * exists while there is at least one Visible Entry (Requirement 10.5). The
 * position of that entry is generated too, so the confirmed deletion is never
 * exercised on a first-position entry alone.
 */
function makeClearAllHistory(
  otherAgentIds: readonly string[],
  activeAgentId: string,
  insertAt: number,
): InteractionHistoryEntry[] {
  const agentIds = [...otherAgentIds];
  agentIds.splice(Math.min(insertAt, agentIds.length), 0, activeAgentId);
  return agentIds.map(makeFilteredEntry);
}

/**
 * Confirmation card of the clear-all action. It renders above the drawer and
 * carries no role of its own, so it is located by its own heading; scoping to
 * the card is what tells its confirm button apart from the footer control of
 * the panel, which shares the `Clear all` text.
 */
function getClearAllConfirmation(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'Clear all history?' });
  const card = heading.parentElement;
  if (card === null) {
    throw new Error('The clear-all confirmation shows no card');
  }
  return card;
}

/**
 * Confirmation card of a single-entry deletion. Located the same way as the
 * clear-all one: by its own heading, then scoped to the card so its `Delete`
 * button is told apart from the `Delete entry` control of the row.
 */
function getDeleteEntryConfirmation(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'Delete this entry?' });
  const card = heading.parentElement;
  if (card === null) {
    throw new Error('The delete-entry confirmation shows no card');
  }
  return card;
}

describe('Clearing the whole interaction history', () => {
  it('Feature: interaction-history-panel, Property 23: Clear all', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          /*
            Entries of any combination of agents, the never-selectable one
            included: the full deletion has to reach every agent, not only the
            Active Agent whose rows are on screen (Requirement 10.7).
          */
          otherAgentIds: fc.array(
            fc.constantFrom<string>(...CATALOG_AGENT_IDS, ORPHAN_AGENT_ID),
            { minLength: 0, maxLength: 5 },
          ),
          activeAgentIndex: fc.integer({ min: 0, max: CATALOG_AGENT_IDS.length - 1 }),
          // Distance to the second agent inspected after the deletion, so that
          // agent always differs from the Active Agent of the case.
          otherAgentShift: fc.integer({ min: 1, max: CATALOG_AGENT_IDS.length - 1 }),
          insertAt: fc.nat({ max: 5 }),
        }),
        async (generated) => {
          const user = userEvent.setup({ delay: null });

          const activeAgentId = CATALOG_AGENT_IDS[generated.activeAgentIndex];
          const otherAgentId =
            CATALOG_AGENT_IDS[
              (generated.activeAgentIndex + generated.otherAgentShift) % CATALOG_AGENT_IDS.length
            ];
          const entries = makeClearAllHistory(
            generated.otherAgentIds,
            activeAgentId,
            generated.insertAt,
          );

          seedStoredHistory(entries);
          installFetchDouble(makeCatalog(activeAgentId));

          try {
            render(<App />);

            const trigger = await findHistoryTrigger();

            // The Active Agent is resolved by the catalog request, so the
            // settled state is awaited through the Agent_Selector label.
            await waitFor(() => {
              expect(agentSelectorLabel()).toContain(`Agent ${activeAgentId}`);
            });

            /*
              Starting point of the case: the whole generated history sits in the
              History Key and the Active Agent owns at least one Visible Entry.
              Without this the assertions below could hold over an already empty
              history.
            */
            expect(readPersistedHistory()).toEqual(entries);
            const visibleCount = entries.filter(
              (entry) => entry.agentId === activeAgentId,
            ).length;
            expect(visibleCount).toBeGreaterThan(0);
            expect(historyTriggerCount(trigger)).toBe(String(visibleCount));

            const panel = await openHistoryPanel(user, trigger);
            expect(renderedRowQueries(panel)).toHaveLength(visibleCount);

            // Requirement 10.6: the footer control opens the confirmation layer.
            await user.click(within(panel).getByRole('button', { name: 'Clear all' }));
            const confirmation = getClearAllConfirmation();

            // Requirement 10.7: the user confirms the full deletion.
            await user.click(within(confirmation).getByRole('button', { name: 'Clear all' }));

            // Requirement 10.7: the History Key ends up holding an empty list.
            await waitFor(() => {
              expect(readPersistedHistory()).toEqual([]);
            });

            // The confirmation layer closed itself once confirmed.
            expect(screen.queryByRole('heading', { name: 'Clear all history?' })).toBeNull();

            /*
              Requirement 10.7: the History_Panel stays open and shows the empty
              state, which is only possible with the in-memory list emptied too.
            */
            expect(isHistoryPanelPresent()).toBe(true);
            expect(within(panel).getByText('No history yet')).toBeInTheDocument();
            expect(renderedRowQueries(panel)).toEqual([]);
            // Requirement 9.2: with no Visible Entry left there is no control to
            // clear either, so the footer left with the rows.
            expect(within(panel).queryByRole('button', { name: 'Clear all' })).toBeNull();
            // Requirement 1.7: and the trigger reports no number anymore.
            expect(historyTriggerCount(trigger)).toBeNull();

            /*
              Requirement 10.7 across agents: the entries of another agent, which
              were never on screen, are gone from memory as well. The count and
              the list of that agent are read after a real change of Active Agent,
              so this is the in-memory list talking and not the History Key.
            */
            await closeHistoryPanelWithControl(user, panel);
            await selectActiveAgent(user, makeCatalogAgent(otherAgentId));
            await waitFor(() => {
              expect(agentSelectorLabel()).toContain(`Agent ${otherAgentId}`);
            });

            expect(historyTriggerCount(trigger)).toBeNull();

            const refreshedPanel = await openHistoryPanel(user, trigger);
            expect(renderedRowQueries(refreshedPanel)).toEqual([]);
            expect(within(refreshedPanel).getByText('No history yet')).toBeInTheDocument();

            // Requirement 10.7: and the History Key is still an empty list.
            expect(readPersistedHistory()).toEqual([]);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full application mount plus a confirmed
    // deletion and an agent change driven through real user events, do not fit
    // in the default per-test budget.
  }, PROPERTY_TEST_TIMEOUT_MS);
});

/* ── Property 25 ─────────────────────────────────────────────── */

/**
 * The two ways of deleting the entry a report was restored from
 * (Requirement 10.10): its own row control and the confirmed clear-all action.
 */
const RESTORED_ENTRY_DELETION_MODES = ['single-entry', 'clear-all'] as const;

type RestoredEntryDeletionMode = (typeof RESTORED_ENTRY_DELETION_MODES)[number];

/**
 * Companion entries of the never-selectable agent, so the deletion of the
 * restored entry is exact in the `single-entry` mode and reaches every agent in
 * the `clear-all` mode. They are never Visible Entries, so they add no row the
 * assertions below could confuse with the restored one.
 */
function makeCompanionEntries(count: number): InteractionHistoryEntry[] {
  return Array.from({ length: count }, (_unused, index) =>
    makeFilteredEntry(ORPHAN_AGENT_ID, index),
  );
}

/**
 * Restores the entry of the open panel and deletes it right afterwards, both
 * within a single commit.
 *
 * The restored report takes over the whole view (`if (restoredReport)` returns
 * ahead of the main render), so the History_Panel and its delete controls leave
 * the document on the very commit the restoration produces. Dispatching the two
 * activations inside one `act` scope is therefore the only interleaving in which
 * "delete the entry after restoring it" is reachable at all: both handlers run
 * against live nodes, React batches their updates, and the commit that follows
 * paints the restored report with the entry already gone from memory and from
 * the History Key.
 */
async function restoreThenDelete(
  restoreButton: HTMLElement,
  deletionButton: HTMLElement,
): Promise<void> {
  await act(async () => {
    // Requirement 5.1: the restoration comes first, as the requirement orders it.
    restoreButton.click();
    // Requirement 10.10: and the deletion of that same entry follows it, either
    // through its row control or through the confirmed clear-all action.
    deletionButton.click();
  });
}

describe('Independence of a restored report from the interaction history', () => {
  it('Feature: interaction-history-panel, Property 25: Independence of the restored report from the history', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // Both deletion modes named by the property.
          deletionMode: fc.constantFrom(...RESTORED_ENTRY_DELETION_MODES),
          // Both renderers, so the surviving view is generated instead of fixed.
          outputRenderer: fc.constantFrom(...OUTPUT_RENDERERS),
          // Distinct texts per case, so the title, the subtitle and the two
          // report texts asserted below cannot pass by matching one another.
          agentNameSuffix: fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
          querySuffix: fc.stringMatching(/^[A-Z0-9]{1,10}$/),
          summarySuffix: fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
          highlightSuffix: fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
          /*
            Strictly positive metrics, while the untouched live run state of the
            mount holds zeros: reading these values back after the deletion is
            what separates the frozen snapshot from the live metrics.
          */
          durationSecs: fc.integer({ min: 1, max: 3600 }),
          tokenCount: fc.integer({ min: 1, max: 999_999 }),
          toolRuns: fc.integer({ min: 1, max: 50 }),
          // Entries of another agent that share the History Key.
          companionCount: fc.nat({ max: 2 }),
        }),
        async (generated) => {
          const user = userEvent.setup({ delay: null });

          const entry = makeRestorableEntry({
            outputRenderer: generated.outputRenderer,
            agentName: `Agent ${generated.agentNameSuffix}`,
            query: `QUERY-${generated.querySuffix}`,
            summary: `Summary ${generated.summarySuffix}`,
            highlight: `Highlight ${generated.highlightSuffix}`,
            metrics: {
              durationSecs: generated.durationSecs,
              tokenCount: generated.tokenCount,
              toolRuns: generated.toolRuns,
            },
          });
          const companions = makeCompanionEntries(generated.companionCount);

          seedStoredHistory([entry, ...companions]);
          // A fresh `fetch` double per case, so the requests observed below
          // belong to this mount only.
          installFetchDouble();

          try {
            render(<App />);

            const trigger = await findHistoryTrigger();

            // The entry becomes a Visible Entry once the catalog request has
            // resolved the Active Agent, which is also when its row exists.
            await waitFor(() => {
              expect(historyTriggerCount(trigger)).toBe('1');
            });

            const panel = await openHistoryPanel(user, trigger);
            const row = within(panel).getAllByRole('listitem')[0];
            // The row's own button restores; its sibling deletes the entry.
            const restoreButton = within(row).getAllByRole('button')[0];

            let deletionButton: HTMLElement;
            if (generated.deletionMode === 'single-entry') {
              // Requirement 10.3: the delete control of that same row, whose
              // confirmation layer has to be open before it deletes anything.
              await user.click(within(row).getByRole('button', { name: 'Delete entry' }));
              deletionButton = within(getDeleteEntryConfirmation()).getByRole('button', {
                name: 'Delete',
              });
            } else {
              // Requirement 10.6: the clear-all action needs its confirmation
              // layer open before it can delete anything.
              await user.click(within(panel).getByRole('button', { name: 'Clear all' }));
              deletionButton = within(getClearAllConfirmation()).getByRole('button', {
                name: 'Clear all',
              });
            }

            await restoreThenDelete(restoreButton, deletionButton);

            // The deletion really happened: the History Key lost exactly the
            // restored entry, or every entry of every agent under clear-all.
            await waitFor(() => {
              expect(readPersistedHistory()).toEqual(
                generated.deletionMode === 'single-entry' ? companions : [],
              );
            });

            // The panel left with the restoration, confirmation layer included.
            expect(isHistoryPanelPresent()).toBe(false);
            expect(screen.queryByRole('heading', { name: 'Clear all history?' })).toBeNull();
            expect(screen.queryByRole('heading', { name: 'Delete this entry?' })).toBeNull();

            /*
              Requirement 10.10: the report of the deleted entry is still the one
              on screen, under the view its stored renderer selects, with the
              same title and subtitle it was restored with.
            */
            if (generated.outputRenderer === 'simple_report') {
              await screen.findByRole('heading', { name: 'Summary' });
              expect(screen.queryByRole('heading', { name: 'Executive Summary' })).toBeNull();
              // Stored `agentName` as title and stored `query` as subtitle.
              expect(screen.getAllByText(entry.agentName).length).toBeGreaterThan(0);
              expect(screen.getAllByText(entry.query).length).toBeGreaterThan(0);
            } else {
              await screen.findByRole('heading', { name: 'Executive Summary' });
              expect(screen.queryByRole('heading', { name: 'Summary' })).toBeNull();
              // `ReportTemplate` carries the stored `query` as its identifier.
              expect(screen.getByText(`${entry.query} Document Analysis`)).toBeInTheDocument();
            }

            // Requirement 10.10: and the same report body, taken from the copy
            // the restoration made instead of from the deleted entry.
            expect(screen.getByText(`Summary ${generated.summarySuffix}`)).toBeInTheDocument();
            expect(
              screen.getByText(`Highlight ${generated.highlightSuffix}`),
            ).toBeInTheDocument();

            // Requirement 10.10: and the same three metrics, still the frozen
            // ones and not the zeros of the live run state.
            expect(readReportMetric('Time')).toBe(`${entry.metrics.durationSecs}s`);
            expect(readReportMetric('Runs')).toBe(String(entry.metrics.toolRuns));
            expect(readReportMetric('Tokens')).toBe(
              `${(entry.metrics.tokenCount / 1000).toFixed(1)}k`,
            );

            // The deletion reached the in-memory list too, not only the History
            // Key: closing the restored report gives back a header whose trigger
            // reports no Visible Entry anymore.
            await user.click(screen.getByTitle('Close report'));
            const restoredTrigger = await findHistoryTrigger();
            await waitFor(() => {
              expect(historyTriggerCount(restoredTrigger)).toBeNull();
            });

            // Nothing about this restoration reached the network.
            expect(requestedUrls().filter((url) => url.includes('/api/analyze'))).toEqual([]);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
    // 100 generated cases, each one a full application mount plus a restoration
    // and a deletion driven through real activations, do not fit in the default
    // per-test budget.
  }, PROPERTY_TEST_TIMEOUT_MS);
});

/* ── Application integration examples ────────────────────────── */

/**
 * Direct children of the header. `justify-between` distributes exactly two
 * groups: the left one carries the `Tickr` logo, the Agent_Selector and the
 * History_Trigger, and the right one carries the session controls. The order
 * Requirement 1.1 is about is read from the DOM instead of from the class list.
 */
function headerGroups(): HTMLElement[] {
  const header = document.querySelector('header');
  if (header === null) {
    throw new Error('The application renders no header');
  }
  return Array.from(header.children) as HTMLElement[];
}

describe('History_Trigger in the header', () => {
  it('places the History_Trigger after the Agent_Selector and before the session group', async () => {
    render(<App />);

    const trigger = await findHistoryTrigger();
    const groups = headerGroups();

    // Requirement 1.1: the header distributes two groups, and the trigger
    // travels with the logo and the Agent_Selector in the leading one.
    expect(groups).toHaveLength(2);

    const [leadingGroup, sessionGroup] = groups;
    const agentSelector = screen.getByRole('button', { name: 'Seleccionar agente' });

    expect(leadingGroup).toHaveTextContent('Tickr');
    expect(leadingGroup.contains(agentSelector)).toBe(true);
    expect(leadingGroup.contains(trigger)).toBe(true);

    // The last group is the session one. The tests run signed in, so it carries
    // the identity of the current user and the sign-out control.
    expect(sessionGroup).toHaveTextContent('tester@example.com');
    expect(sessionGroup.contains(screen.getByRole('button', { name: 'Sign Out' }))).toBe(true);

    // Requirement 1.1: document order confirms the placement, right after the
    // Agent_Selector and ahead of the session group.
    expect(agentSelector.compareDocumentPosition(trigger)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(sessionGroup.compareDocumentPosition(trigger)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  });

  it('shows the History icon and exposes the accessible text History', async () => {
    render(<App />);

    const trigger = await findHistoryTrigger();

    // Requirement 1.2: the accessible text comes from `aria-label`, so the
    // trigger keeps its name even when the visible label is hidden on narrow
    // viewports.
    expect(trigger).toHaveAttribute('aria-label', 'History');

    // Requirement 1.2: the `History` icon of `lucide-react`, which renders as an
    // SVG carrying its own icon class.
    const icon = trigger.querySelector('svg.lucide-history');
    expect(icon).not.toBeNull();
    // The icon is decorative: the accessible name is the `aria-label` above.
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies the visual conventions of the header controls', async () => {
    render(<App />);

    const trigger = await findHistoryTrigger();

    // Requirement 1.3: rounded shape, translucent border of the `border-white/10`
    // family, `font-sans` typography and a `text-stone-*` color.
    expect(trigger).toHaveClass('rounded');
    expect(trigger).toHaveClass('border');
    expect(trigger).toHaveClass('border-white/10');
    expect(trigger).toHaveClass('font-sans');
    expect(trigger.className).toMatch(/(?:^|\s)text-stone-\d{3}(?:\s|$)/);
  });
});

/* ── Mount-time hydration ────────────────────────────────────── */

/** Two stored History Entries of the default catalog agent, newest first. */
const HYDRATED_ENTRIES: InteractionHistoryEntry[] = [
  {
    id: 'entry-hydrated-newest',
    agentId: CATALOG_AGENT.id,
    agentName: CATALOG_AGENT.name,
    outputRenderer: 'simple_report',
    query: 'HYDRATED-NEWEST',
    instruction: 'Focus on the latest filing.',
    createdAt: 1_700_000_600_000,
    report: { summary: 'Newest stored snapshot.', key_points: [], sections: [], sources: [] },
    metrics: { durationSecs: 11, tokenCount: 2_100, toolRuns: 2 },
  },
  {
    id: 'entry-hydrated-oldest',
    agentId: CATALOG_AGENT.id,
    agentName: CATALOG_AGENT.name,
    outputRenderer: 'simple_report',
    query: 'HYDRATED-OLDEST',
    instruction: null,
    createdAt: 1_700_000_000_000,
    report: { summary: 'Oldest stored snapshot.', key_points: [], sections: [], sources: [] },
    metrics: { durationSecs: 7, tokenCount: 900, toolRuns: 1 },
  },
];

describe('Hydrating the interaction history on mount', () => {
  it('exposes the stored History Entries right after mounting, with no interaction', async () => {
    const user = userEvent.setup({ delay: null });

    seedStoredHistory(HYDRATED_ENTRIES);
    render(<App />);

    const trigger = await findHistoryTrigger();

    // Requirement 6.2: the mount reads the History Key, so the stored entries
    // are already counted before the panel is ever opened.
    await waitFor(() => {
      expect(historyTriggerCount(trigger)).toBe('2');
    });

    const panel = await openHistoryPanel(user, trigger);

    // Requirement 6.2: the hydrated entries are the ones the drawer lists, in
    // their stored order.
    expect(renderedRowQueries(panel)).toEqual([
      HYDRATED_ENTRIES[0].query,
      HYDRATED_ENTRIES[1].query,
    ]);
    // A non-null `instruction` survived the round trip through storage.
    expect(within(panel).getByText(HYDRATED_ENTRIES[0].instruction as string)).toBeInTheDocument();

    // Requirement 6.2: hydration is a read, so the History Key still holds
    // exactly what was seeded.
    expect(readPersistedHistory()).toEqual(HYDRATED_ENTRIES);
  });

  it('exposes an empty history when the History Key holds no valid content', async () => {
    const user = userEvent.setup({ delay: null });

    // Invalid JSON: the mount has to survive it and expose an empty list
    // (Requirements 6.2, 6.4).
    const storage = signedInStorage();
    for (const key of SEEDED_HISTORY_KEYS) storage.setItem(key, '{not json');
    vi.stubGlobal('localStorage', storage);

    render(<App />);

    const trigger = await findHistoryTrigger();
    await screen.findByRole('button', { name: CATALOG_AGENT.actionLabel });

    // No Visible Entry, so the trigger reports no number.
    expect(historyTriggerCount(trigger)).toBeNull();

    const panel = await openHistoryPanel(user, trigger);
    expect(within(panel).getByText('No history yet')).toBeInTheDocument();

    // Requirement 6.4: the unreadable content was repaired into an empty list.
    expect(readPersistedHistory()).toEqual([]);
  });
});

/* ── StrictMode double invocation ────────────────────────────── */

describe('Recording a run under React StrictMode', () => {
  it('records exactly one History Entry per promoted run under StrictMode double rendering', async () => {
    const user = userEvent.setup({ delay: null });

    seedStoredHistory([PRE_EXISTING_ENTRY]);
    installRunFetchDouble('promoted');

    /*
      StrictMode double-invokes render, effects and state updaters in development,
      which is exactly the shape that turns a careless recording into two
      entries. Mounting the application inside it keeps Requirement 3.1 honest
      about "exactly one" instead of "at least one".
    */
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    const trigger = await findHistoryTrigger();

    // The mount effect also runs twice under StrictMode: the hydrated entry is
    // counted once, not twice.
    await waitFor(() => {
      expect(historyTriggerCount(trigger)).toBe('1');
    });
    expect(readPersistedHistory()).toEqual([PRE_EXISTING_ENTRY]);

    await driveRun(user, 'AMZN', 'promoted');

    // Requirement 3.1: the promoted run added exactly one History Entry.
    await waitFor(() => {
      expect(historyTriggerCount(trigger)).toBe('2');
    });

    const persisted = readPersistedHistory() ?? [];
    expect(persisted).toHaveLength(2);
    expect(persisted[0].query).toBe('AMZN');
    expect(persisted[0].report).toEqual(PROMOTED_RUN_REPORT);
    // The insertion is the only change: the pre-existing entry is untouched.
    expect(persisted.slice(1)).toEqual([PRE_EXISTING_ENTRY]);

    // And the drawer lists two rows, so the in-memory list did not duplicate the
    // entry either.
    const panel = await openHistoryPanel(user, trigger);
    expect(renderedRowQueries(panel)).toEqual(['AMZN', PRE_EXISTING_ENTRY.query]);
  }, PROPERTY_TEST_TIMEOUT_MS);
});
