/**
 * Pure pieces of the `POST /api/analyze` execution.
 *
 * The endpoint keeps its shape (SSE headers, event forwarding, `final_stats`,
 * `run_logs` writing); this module isolates the decisions around it so they can
 * be checked without opening an SSE stream or running an agent:
 *
 *  - The `agent_info` event, emitted exactly once and before any other event of
 *    the run (Requirements 5.3, 5.4).
 *  - The `error` followed by `done` sequence that closes the stream when a run
 *    fails or is interrupted after the SSE headers are written (Requirement 5.10).
 *  - The HTTP answer that rejects a run which never starts, that is, before
 *    those headers are written.
 *
 * Requirements: 5.3, 5.4, 5.6, 5.10
 */

import type { AgentEvent } from './agentEvents.ts';
import type { OutputRenderer, ResolvedAgentDefinition } from './agentTypes.ts';

/* ────────────────────────────────────────────────────────── */
/*  Evento `agent_info`                                        */
/* ────────────────────────────────────────────────────────── */

/** Único tipo de evento SSE que esta especificación añade (Requirement 5.4). */
export const AGENT_INFO_EVENT_TYPE = 'agent_info';

/**
 * Primer evento del flujo de una ejecución: identifica el agente resuelto y el
 * renderizador con el que el frontend debe presentar el resultado, aunque el
 * usuario cambie de agente durante el streaming (Requirement 5.3).
 */
export interface AgentInfoEvent {
  type: typeof AGENT_INFO_EVENT_TYPE;
  /** agentId efectivamente ejecutado, no el recibido en la petición (5.2). */
  agentId: string;
  agentName: string;
  outputRenderer: OutputRenderer;
}

/** Construye el evento `agent_info` del agente resuelto (Requirement 5.3). */
export function buildAgentInfoEvent(definition: ResolvedAgentDefinition): AgentInfoEvent {
  return {
    type: AGENT_INFO_EVENT_TYPE,
    agentId: definition.agentId,
    agentName: definition.manifest.name,
    outputRenderer: definition.manifest.outputRenderer,
  };
}

/* ────────────────────────────────────────────────────────── */
/*  Closing the stream after a failed run                      */
/* ────────────────────────────────────────────────────────── */

/** Generic reason used when the failure carries no message. */
export const DEFAULT_STREAM_FAILURE_MESSAGE =
  'The agent run failed or was interrupted.';

/**
 * Sequence that closes the stream when the run fails or is interrupted after the
 * SSE headers are written: an `error` event with the reason and then a `done`
 * event (Requirement 5.10). Events and logs already written are left untouched.
 */
export function buildStreamFailureEvents(reason: unknown): AgentEvent[] {
  return [
    { type: 'error', message: describeStreamFailure(reason) },
    { type: 'done' },
  ];
}

/** Readable reason for a failed run, without dumping the whole object. */
export function describeStreamFailure(reason: unknown): string {
  if (typeof reason === 'string' && reason.trim().length > 0) return reason;
  if (reason instanceof Error && reason.message.trim().length > 0) return reason.message;
  return DEFAULT_STREAM_FAILURE_MESSAGE;
}

/* ────────────────────────────────────────────────────────── */
/*  Failure to start a run                                     */
/* ────────────────────────────────────────────────────────── */

/**
 * HTTP answer that rejects a run which never produced its first event, that is,
 * before the SSE headers are written.
 */
export interface AgentStartFailure {
  /** Status `POST /api/analyze` answers with. */
  status: number;
  body: {
    error: string;
    /** Stable code, so the client can tell the reason apart without parsing text. */
    code: 'upstream_rate_limited' | 'upstream_unavailable' | 'upstream_error';
    /** Status returned by the model API, kept as diagnostic data. */
    upstreamStatus: number;
    /** True when repeating the same request later can work. */
    retryable: boolean;
  };
}

/**
 * Translates the status with which the model API rejected the start of a run
 * into the answer of `POST /api/analyze`.
 *
 * Collapsing all of these into a single 500 left the client unable to tell a
 * temporary quota limit (retryable) from a real service failure, and the reason
 * only reached the server log.
 */
export function describeAgentStartFailure(upstreamStatus: unknown): AgentStartFailure {
  const status =
    typeof upstreamStatus === 'number' && Number.isFinite(upstreamStatus)
      ? Math.trunc(upstreamStatus)
      : 0;

  if (status === 429) {
    return {
      status: 429,
      body: {
        error:
          'The agent service is rate-limiting requests. Wait a few seconds and try again.',
        code: 'upstream_rate_limited',
        upstreamStatus: status,
        retryable: true,
      },
    };
  }

  if (status === 503 || status === 504) {
    return {
      status: 503,
      body: {
        error:
          'The agent service is currently unavailable. Try again in a few minutes.',
        code: 'upstream_unavailable',
        upstreamStatus: status,
        retryable: true,
      },
    };
  }

  return {
    status: 502,
    body: {
      error: `The agent service rejected the run (status ${status || 'unknown'}).`,
      code: 'upstream_error',
      upstreamStatus: status,
      retryable: false,
    },
  };
}
