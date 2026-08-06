/**
 * Piezas puras de la ejecución de `POST /api/analyze`.
 *
 * El endpoint conserva su forma actual (cabeceras SSE, reenvío de eventos,
 * `final_stats`, escritura de `run_logs`); este módulo aísla las decisiones que
 * introduce el catálogo de agentes, para que puedan comprobarse sin abrir un
 * flujo SSE ni tocar el cliente remoto:
 *
 *  - El evento `agent_info`, único tipo de evento nuevo, que se emite una sola
 *    vez y antes de cualquier otro evento de la ejecución (Requirements 5.3, 5.4).
 *  - La elección del cliente remoto según el campo `model`: `agentClientPerseus`
 *    solo cuando el valor recortado es exactamente `perseus`, y `agentClient` en
 *    cualquier otro caso (Requirements 5.5, 5.8).
 *  - La secuencia `error` seguida de `done` con la que se cierra el flujo cuando
 *    el cliente remoto falla o se interrumpe después de escribir las cabeceras
 *    SSE (Requirement 5.10).
 *  - El recorte de las fuentes inline a los campos que consume el cliente
 *    remoto, sin metadata del servidor (Requirement 6.1).
 *
 * Requirements: 5.3, 5.4, 5.5, 5.6, 5.8, 5.10, 6.1
 */

import type { AgentEvent } from './agentClient.ts';
import type { AgentInlineSource } from './agentInlineSources.ts';
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
/*  Selección del cliente remoto                               */
/* ────────────────────────────────────────────────────────── */

/** Valor de `model` que selecciona el cliente alternativo (Requirement 5.5). */
export const PERSEUS_MODEL_ID = 'perseus';

/** Nombres de los dos clientes remotos disponibles. */
export type AgentClientName = 'agentClient' | 'agentClientPerseus';

/**
 * Indica si la petición pide el cliente alternativo: comparación exacta y
 * sensible a mayúsculas y minúsculas del valor recortado (Requirements 5.5, 5.8).
 * Un `model` ausente, vacío o con cualquier otro valor usa `agentClient`.
 */
export function isPerseusModel(model: unknown): boolean {
  return typeof model === 'string' && model.trim() === PERSEUS_MODEL_ID;
}

/** Cliente remoto que debe atender la ejecución (Requirements 5.5, 5.8). */
export function selectAgentClientName(model: unknown): AgentClientName {
  return isPerseusModel(model) ? 'agentClientPerseus' : 'agentClient';
}

/* ────────────────────────────────────────────────────────── */
/*  Cierre del flujo ante un fallo del cliente remoto          */
/* ────────────────────────────────────────────────────────── */

/** Motivo genérico cuando el fallo del cliente remoto no trae mensaje. */
export const DEFAULT_STREAM_FAILURE_MESSAGE =
  'La ejecución del agente remoto falló o se interrumpió.';

/**
 * Secuencia con la que se cierra el flujo cuando el cliente remoto falla o se
 * interrumpe después de escribir las cabeceras SSE: un evento `error` con el
 * motivo y, a continuación, un evento `done` (Requirement 5.10). Los eventos y
 * los logs ya escritos no se tocan.
 */
export function buildStreamFailureEvents(reason: unknown): AgentEvent[] {
  return [
    { type: 'error', message: describeStreamFailure(reason) },
    { type: 'done' },
  ];
}

/** Motivo legible de un fallo del cliente remoto, sin volcar el objeto entero. */
export function describeStreamFailure(reason: unknown): string {
  if (typeof reason === 'string' && reason.trim().length > 0) return reason;
  if (reason instanceof Error && reason.message.trim().length > 0) return reason.message;
  return DEFAULT_STREAM_FAILURE_MESSAGE;
}

/* ────────────────────────────────────────────────────────── */
/*  Fuentes inline para el cliente remoto                      */
/* ────────────────────────────────────────────────────────── */

/** Forma exacta que `agentClient` envía al entorno remoto. */
export interface RemoteInlineSource {
  type: string;
  content: string;
  target: string;
}

/**
 * Recorta las fuentes inline del registro a los campos que consume el cliente
 * remoto: la metadata que el registro añade para las advertencias y las pruebas
 * (`relativePath`, `bytes`) no viaja al entorno del agente.
 */
export function toRemoteInlineSources(
  sources: readonly AgentInlineSource[],
): RemoteInlineSource[] {
  return sources.map(({ type, content, target }) => ({ type, content, target }));
}

/* ────────────────────────────────────────────────────────── */
/*  Fallo al crear la interacción remota                       */
/* ────────────────────────────────────────────────────────── */

/**
 * Respuesta HTTP con la que se rechaza una ejecución cuando el cliente remoto
 * no llega a crear la interacción, es decir, antes de escribir las cabeceras
 * SSE.
 */
export interface CreateInteractionFailure {
  /** Código con el que responde `POST /api/analyze`. */
  status: number;
  body: {
    error: string;
    /** Código estable para que el cliente distinga el motivo sin parsear texto. */
    code: 'upstream_rate_limited' | 'upstream_unavailable' | 'upstream_error';
    /** Estado devuelto por el servicio remoto, como dato de diagnóstico. */
    upstreamStatus: number;
    /** Verdadero cuando repetir la misma petición más tarde puede funcionar. */
    retryable: boolean;
  };
}

/**
 * Traduce el estado con el que el servicio remoto rechazó la creación de la
 * interacción a la respuesta de `POST /api/analyze`.
 *
 * Colapsar todos estos casos en un 500 con un texto único dejaba al cliente sin
 * forma de distinguir un límite de cuota temporal (reintentable) de un fallo
 * real del servicio, y el motivo solo quedaba en el log del servidor.
 */
export function describeCreateInteractionFailure(
  upstreamStatus: unknown,
): CreateInteractionFailure {
  const status =
    typeof upstreamStatus === 'number' && Number.isFinite(upstreamStatus)
      ? Math.trunc(upstreamStatus)
      : 0;

  if (status === 429) {
    return {
      status: 429,
      body: {
        error:
          'El servicio del agente está limitando las peticiones. Espera unos segundos y vuelve a intentarlo.',
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
          'El servicio del agente no está disponible en este momento. Vuelve a intentarlo en unos minutos.',
        code: 'upstream_unavailable',
        upstreamStatus: status,
        retryable: true,
      },
    };
  }

  return {
    status: 502,
    body: {
      error: `El servicio del agente rechazó la ejecución (estado ${status || 'desconocido'}).`,
      code: 'upstream_error',
      upstreamStatus: status,
      retryable: false,
    },
  };
}
