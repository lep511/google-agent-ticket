/* ──────────────────────────────────────────────────────────── */
/*  Run diagnostics                                             */
/*                                                              */
/*  Pure helpers that turn what a run reported — its `stopReason` */
/*  and its final text — into a message the user can act on.     */
/*                                                              */
/*  A run that promotes no report used to be able to finish in   */
/*  silence: no report on screen, no warning and no error, while  */
/*  the reason (turns exhausted, output truncated, response the   */
/*  renderer could not structure) was known and simply discarded. */
/*  Everything here exists to make that reason visible.          */
/* ──────────────────────────────────────────────────────────── */

import { reportRootKeys } from './resultExtraction';
import type { OutputRenderer } from './types';

/**
 * Comparison key for a `stopReason`: lowercase, with every separator dropped.
 * The value crosses a model provider, the Strands SDK and the SSE stream, so
 * `max_tokens`, `maxTokens` and `MAX-TOKENS` all have to land on the same entry.
 */
function stopReasonKey(stopReason: string): string {
  return stopReason.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Stop reasons of a run that ended on its own terms. They explain nothing about
 * a missing report, so they never reach the user.
 */
const NORMAL_STOP_REASONS: ReadonlySet<string> = new Set([
  'endturn',
  'end',
  'stop',
  'stopsequence',
  'complete',
  'completed',
]);

/**
 * Why the model stopped, phrased to complete the sentence "The model stopped
 * because ...". Keys are `stopReasonKey` values.
 */
const STOP_REASON_EXPLANATIONS: Readonly<Record<string, string>> = {
  maxtokens: 'it reached its output token ceiling, so the report was cut off mid-write',
  length: 'it reached its output token ceiling, so the report was cut off mid-write',
  maxturns: 'the agent used up every turn of its loop budget before writing the report',
  maxturnsreached:
    'the agent used up every turn of its loop budget before writing the report',
  turnlimitreached:
    'the agent used up every turn of its loop budget before writing the report',
  tooluse: 'the run ended while the agent was still calling tools, before it wrote the report',
  contentfilter: 'the model provider filtered the response',
  contentfiltered: 'the model provider filtered the response',
  guardrailintervened: 'a guardrail stopped the response',
  cancelled: 'the run was cancelled',
  canceled: 'the run was cancelled',
};

/**
 * Reason a run stopped, phrased for a user, or `null` when the run ended
 * normally or reported no reason at all.
 *
 * The `stopReason` travels inside the `complete` event's `interaction`. It is the
 * only signal that tells a truncated report apart from a model that never
 * answered, so a run without a report has to surface it.
 */
export function describeStopReason(stopReason: unknown): string | null {
  if (typeof stopReason !== 'string') return null;

  const trimmed = stopReason.trim();
  if (trimmed.length === 0) return null;

  const key = stopReasonKey(trimmed);
  if (key.length === 0 || NORMAL_STOP_REASONS.has(key)) return null;

  return STOP_REASON_EXPLANATIONS[key] ?? `it reported the stop reason "${trimmed}"`;
}

export interface MissingReportContext {
  /** Text the run accumulated from its `text` events. */
  text: string;
  /** `stopReason` carried by the run's `complete` event, when there was one. */
  stopReason?: unknown;
  /** Renderer whose contract the run's output had to satisfy. */
  renderer: OutputRenderer;
}

/**
 * Message explaining why a finished run put no report on screen.
 *
 * Two shapes, because the two failures need different next steps: a run that
 * produced text failed the renderer's contract and its raw answer is worth
 * reading, while a run that produced no text never got to the answer at all.
 */
export function explainMissingReport(context: MissingReportContext): string {
  const { text, stopReason, renderer } = context;
  const cause = describeStopReason(stopReason);
  const parts: string[] = [];

  if (text.trim().length > 0) {
    parts.push(
      'The agent answered, but the response carries no JSON object with any of the keys ' +
        `this report is built from (${reportRootKeys(renderer).join(', ')}).`,
    );
    if (cause) parts.push(`The model stopped because ${cause}.`);
    parts.push('Its raw answer is kept in the timeline below.');
  } else {
    parts.push('The agent finished without writing a final answer, so there is no report.');
    if (cause) {
      parts.push(`The model stopped because ${cause}.`);
    } else {
      parts.push('It reported no stop reason, so the run left no clue about why.');
    }
    parts.push('The run log holds the full trace.');
  }

  return parts.join(' ');
}
