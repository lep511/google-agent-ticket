/* ──────────────────────────────────────────────────────────── */
/*  Selección de agente activo                                  */
/*                                                              */
/*  Lógica pura del estado de agente que consume `App.tsx`:     */
/*  lectura y escritura de la selección persistida y resolución */
/*  del agente activo contra el catálogo recibido.              */
/*                                                              */

/* ──────────────────────────────────────────────────────────── */

import type { AgentCatalogEntry, AgentCatalogResponse } from './types';

/** Clave de `localStorage` donde vive la selección del usuario (12.1, 12.3). */
export const SELECTED_AGENT_STORAGE_KEY = 'tickr.selectedAgentId';

/**
 * Lee el agentId almacenado. Devuelve nulo si no hay valor, si está vacío tras
 * recortar espacios o si el almacenamiento no está disponible (modo privado,
 * cuota agotada, entorno sin `window`).
 */
export function readStoredAgentId(): string | null {
  try {
    const raw = window.localStorage.getItem(SELECTED_AGENT_STORAGE_KEY);
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Almacena el agentId seleccionado. Los fallos de almacenamiento no deben
 * interrumpir la interfaz: la selección sigue viva en memoria.
 */
export function storeSelectedAgentId(agentId: string): void {
  try {
    window.localStorage.setItem(SELECTED_AGENT_STORAGE_KEY, agentId);
  } catch {
    /* almacenamiento no disponible: la selección permanece solo en memoria */
  }
}

/** Resultado de resolver el agente activo contra un catálogo. */
export interface AgentSelectionResolution {
  /** Agente activo resultante; nulo solo cuando el catálogo está vacío. */
  agentId: string | null;
  /**
   * Verdadero cuando hay que sobrescribir el valor almacenado, es decir cuando
   * el agentId almacenado no está en el catálogo (Requirement 12.2).
   */
  shouldPersist: boolean;
}

/**
 * Resuelve el agente activo tras recibir el catálogo.
 *
 * - El agentId almacenado gana cuando está en el catálogo (Requirement 12.1).
 * - En cualquier otro caso se fija el `defaultAgentId` del catálogo y se
 *   sobrescribe el valor almacenado (Requirement 12.2).
 * - Con el catálogo vacío no hay agente activo y no se persiste nada
 *   (Requirement 11.9 lo traduce en botón de ejecución deshabilitado).
 */
export function resolveActiveAgentId(
  catalog: Pick<AgentCatalogResponse, 'agents' | 'defaultAgentId'>,
  storedAgentId: string | null,
): AgentSelectionResolution {
  const isInCatalog =
    storedAgentId !== null && catalog.agents.some((agent) => agent.id === storedAgentId);

  if (isInCatalog) {
    return { agentId: storedAgentId, shouldPersist: false };
  }

  const fallback = catalog.defaultAgentId ?? catalog.agents[0]?.id ?? null;
  return { agentId: fallback, shouldPersist: fallback !== null };
}

/** Devuelve la entrada de catálogo del agentId recibido, o nulo. */
export function findAgent(
  agents: AgentCatalogEntry[],
  agentId: string | null,
): AgentCatalogEntry | null {
  if (agentId === null) return null;
  return agents.find((agent) => agent.id === agentId) ?? null;
}
