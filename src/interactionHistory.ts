/* ──────────────────────────────────────────────────────────── */
/*  Interaction history store                                   */
/*                                                              */
/*  Single source of truth on how a History Entry is created,    */
/*  ordered, capped, validated, persisted and deleted.          */
/*  Everything that can be a pure function is one; the only     */
/*  `localStorage` access lives in `readHistory` and            */
/*  `persistHistory`, which never throw and degrade to memory.  */
/*                                                              */

/*  6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6,     */
/*  7.7, 8.1, 8.3, 8.4, 8.5, 10.3                              */
/* ──────────────────────────────────────────────────────────── */

import { isOutputRenderer, type OutputRenderer } from './types';
import { FALLBACK_OUTPUT_RENDERER } from './resultExtraction';

/** History `localStorage` key (). */
export const HISTORY_STORAGE_KEY = 'tickr.interactionHistory';

export function userHistoryKey(userId?: string | null): string {
  return userId ? `${HISTORY_STORAGE_KEY}.${userId}` : HISTORY_STORAGE_KEY;
}

/** History Limit (Requirements 7.1, 7.2). */
export const HISTORY_LIMIT = 20;

/* ── Data models ─────────────────────────────────────────────── */

/** Metrics of the run that produced the report (Requirements 3.3, 5.3). */
export interface InteractionMetrics {
  durationSecs: number;
  tokenCount: number;
  toolRuns: number;
}

/** Persisted History Entry ( these nine fields). */
export interface InteractionHistoryEntry {
  id: string;
  agentId: string;
  agentName: string;
  outputRenderer: OutputRenderer;
  query: string;
  instruction: string | null;
  createdAt: number;
  /** Snapshot of the report exactly as the run produced it. */
  report: Record<string, unknown>;
  metrics: InteractionMetrics;
}

/** Raw data of a run that has just finished, before normalization. */
export interface HistoryEntryDraft {
  agentId: string;
  agentName: string;
  outputRenderer: OutputRenderer;
  /** Untrimmed input value. */
  query: string;
  /** Untrimmed instruction; may be absent. */
  instruction?: string | null;
  createdAt: number;
  report: Record<string, unknown>;
  metrics: InteractionMetrics;
}

/** Persist result: `persisted` false = list held in memory only. */
export interface HistoryPersistResult {
  entries: InteractionHistoryEntry[];
  persisted: boolean;
}

/* ── Identifiers ─────────────────────────────────────────────── */

/** Entry identifier; `crypto.randomUUID` when available. */
export function newHistoryEntryId(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (typeof uuid === 'string' && uuid.length > 0) return uuid;
  } catch {
    /* crypto unavailable or blocked: fall back to the manual identifier */
  }
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/* ── Entry creation ──────────────────────────────────────────── */

/** Instruction normalization of Requirements 3.4 and 3.5. */
function normalizeInstruction(instruction: string | null | undefined): string | null {
  if (typeof instruction !== 'string') return null;
  const trimmed = instruction.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalizes a draft into a History Entry: trims `query`, turns an empty or
 * whitespace-only instruction into `null` and assigns an `id` that collides
 * with none of `existing` (Requirements 3.3, 3.4, 3.5, 3.7).
 */
export function createHistoryEntry(
  draft: HistoryEntryDraft,
  existing: InteractionHistoryEntry[],
): InteractionHistoryEntry {
  const takenIds = new Set(existing.map((entry) => entry.id));

  // The generated identifier is checked instead of trusted, so uniqueness is an
  // invariant of the store and not a property of the generator ().
  let id = newHistoryEntryId();
  let guard = 0;
  while (takenIds.has(id)) {
    id = `${newHistoryEntryId()}_${guard}`;
    guard += 1;
  }

  return {
    id,
    agentId: draft.agentId,
    agentName: draft.agentName,
    outputRenderer: draft.outputRenderer,
    query: draft.query.trim(),
    instruction: normalizeInstruction(draft.instruction),
    createdAt: draft.createdAt,
    report: draft.report,
    metrics: {
      durationSecs: draft.metrics.durationSecs,
      tokenCount: draft.metrics.tokenCount,
      toolRuns: draft.metrics.toolRuns,
    },
  };
}

/* ── Ordering, limit and deletion ────────────────────────────── */

/** Sorts by `createdAt` descending and trims to the limit (Requirements 7.1, 7.2, 7.6). */
export function capHistory(entries: InteractionHistoryEntry[]): InteractionHistoryEntry[] {
  // The sort runs over a copy so the caller's array is never mutated. `sort` is
  // stable, so entries sharing `createdAt` keep their relative order.
  return [...entries].sort((a, b) => b.createdAt - a.createdAt).slice(0, HISTORY_LIMIT);
}

/** Inserts at the first position and applies the limit (Requirements 3.8, 7.1). */
export function insertEntry(
  entries: InteractionHistoryEntry[],
  entry: InteractionHistoryEntry,
): InteractionHistoryEntry[] {
  return capHistory([entry, ...entries]);
}

/** Removes the entry with the oldest `createdAt` (Requirements 7.3, 7.6). */
export function dropOldest(entries: InteractionHistoryEntry[]): InteractionHistoryEntry[] {
  if (entries.length === 0) return [];

  let oldestIndex = 0;
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index].createdAt < entries[oldestIndex].createdAt) {
      oldestIndex = index;
    }
  }
  return entries.filter((_, index) => index !== oldestIndex);
}

/** Removes exactly the entry with that `id` (Requirement 10.3). */
export function deleteEntry(
  entries: InteractionHistoryEntry[],
  id: string,
): InteractionHistoryEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

/** Visible Entries of the Active Agent, in the received order (Requirements 8.1, 8.5). */
export function selectVisibleEntries(
  entries: InteractionHistoryEntry[],
  activeAgentId: string | null,
): InteractionHistoryEntry[] {
  if (activeAgentId === null) return [];
  return entries.filter((entry) => entry.agentId === activeAgentId);
}

/* ── Validation and repair ───────────────────────────────────── */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Type guard of  (includes 5.8: `report` must be an object). */
export function isHistoryEntry(value: unknown): value is InteractionHistoryEntry {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.agentId) &&
    typeof value.query === 'string' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    isPlainObject(value.report)
  );
}

/** Metrics normalization: a missing or partial object degrades to zeros. */
function normalizeMetrics(value: unknown): InteractionMetrics {
  const source = isPlainObject(value) ? value : {};
  const numberOrZero = (candidate: unknown): number =>
    typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : 0;

  return {
    durationSecs: numberOrZero(source.durationSecs),
    tokenCount: numberOrZero(source.tokenCount),
    toolRuns: numberOrZero(source.toolRuns),
  };
}

/**
 * Completes the four non-essential fields of an already validated entry. A
 * recoverable report is not thrown away over degraded metadata: `agentName`
 * falls back to `agentId`, `outputRenderer` to the fallback renderer,
 * `instruction` to `null` and `metrics` to zeros ().
 */
function normalizeHistoryEntry(value: InteractionHistoryEntry): InteractionHistoryEntry {
  const raw = value as unknown as Record<string, unknown>;

  return {
    id: value.id,
    agentId: value.agentId,
    agentName: isNonEmptyString(raw.agentName) ? raw.agentName : value.agentId,
    outputRenderer: isOutputRenderer(raw.outputRenderer)
      ? raw.outputRenderer
      : FALLBACK_OUTPUT_RENDERER,
    query: value.query,
    instruction: normalizeInstruction(raw.instruction as string | null | undefined),
    createdAt: value.createdAt,
    report: value.report,
    metrics: normalizeMetrics(raw.metrics),
  };
}

/**
 * Interprets the raw content of the History Key.
 * `needsRepair` is true when the content was not valid JSON or was not an
 * array, that is, when the key has to be overwritten ().
 */
export function parseHistoryPayload(raw: string | null): {
  entries: InteractionHistoryEntry[];
  needsRepair: boolean;
} {
  // An absent key is not a corrupt key: there is nothing to repair.
  if (raw === null) return { entries: [], needsRepair: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: [], needsRepair: true }; //  invalid JSON
  }

  if (!Array.isArray(parsed)) {
    return { entries: [], needsRepair: true }; //  not an array
  }

  // Requirements 5.8, 6.3: element-by-element filtering, then normalization of
  // the fields that are allowed to degrade.
  const entries = parsed.filter(isHistoryEntry).map(normalizeHistoryEntry);
  return { entries, needsRepair: false };
}

/* ── Timestamp formatting ────────────────────────────────────── */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/**
 *  `just now` (<60 s), `N minutes ago`, `N hours ago`,
 * `N days ago` and the absolute local date from 7 days on. N is the truncated
 * integer. A `createdAt` in the future relative to `now` is treated as a zero
 * difference. The plural stays fixed because  pins the texts
 * literally.
 */
export function formatRelativeTimestamp(createdAt: number, now: number): string {
  const delta = Math.max(0, now - createdAt);
  if (delta < MINUTE_MS) return 'just now';
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)} minutes ago`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)} hours ago`;
  if (delta < WEEK_MS) return `${Math.floor(delta / DAY_MS)} days ago`;
  return new Date(createdAt).toLocaleDateString();
}

/**  content of the `title` attribute of the timestamp. */
export function formatAbsoluteTimestamp(createdAt: number): string {
  return new Date(createdAt).toLocaleString();
}

/* ── Storage wrappers ────────────────────────────────────────── */

/** Outcome of a single write attempt against the History Key. */
type WriteOutcome = 'ok' | 'quota' | 'unavailable';

/**
 * Recognizes an exhausted quota: `QuotaExceededError`,
 * `NS_ERROR_DOM_QUOTA_REACHED` and `DOMException.code === 22`. Any other
 * failure counts as Storage Unavailable (Requirements 6.6, 7.3).
 */
function isQuotaExceeded(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name === 'QuotaExceededError') return true;
  if (candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  return candidate.code === 22;
}

/** Single write attempt; classifies the failure instead of propagating it. */
function writeRaw(entries: InteractionHistoryEntry[], key = HISTORY_STORAGE_KEY): WriteOutcome {
  try {
    window.localStorage.setItem(key, JSON.stringify(entries));
    return 'ok';
  } catch (err) {
    return isQuotaExceeded(err) ? 'quota' : 'unavailable';
  }
}

/**
 * Reads and validates the history. Returns an empty list on Storage
 * Unavailable, invalid JSON or non-array content, and in those last two cases
 * overwrites the key with `[]` (Requirements 6.2, 6.3, 6.4, 6.5).
 */
export function readHistory(userId?: string | null): InteractionHistoryEntry[] {
  const key = userHistoryKey(userId);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return [];
  }

  const { entries, needsRepair } = parseHistoryPayload(raw);
  if (needsRepair) {
    try {
      window.localStorage.setItem(key, '[]');
    } catch {
      /* the repair is best effort: an unwritable key does not break the read */
    }
  }
  return entries;
}

/**
 * Persists the capped list. On an exhausted quota it removes the oldest entry
 * and retries until the write succeeds or a single entry remains
 * (Requirements 6.1, 6.6, 7.3, 7.4, 7.5).
 */
export function persistHistory(entries: InteractionHistoryEntry[], userId?: string | null): HistoryPersistResult {
  const key = userHistoryKey(userId);
  let candidate = capHistory(entries);

  for (;;) {
    const outcome = writeRaw(candidate, key);
    if (outcome === 'ok') {
      return { entries: candidate, persisted: true };
    }
    if (outcome === 'unavailable') {
      return { entries: candidate, persisted: false };
    }
    if (candidate.length <= 1) {
      return { entries: candidate, persisted: false };
    }
    candidate = dropOldest(candidate);
  }
}
