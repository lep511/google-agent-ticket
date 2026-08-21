/**
 * Respuesta pública del catálogo de agentes (`GET /api/agents`).
 *
 * Este módulo proyecta el catálogo que el registro mantiene en memoria a la
 * superficie mínima que consume la interfaz: exactamente los campos declarados
 * en el , sin rutas del sistema de archivos ni contenido de
 * `AGENTS.md`, del archivo de prompt o del archivo de esquema
 * (Requirements 4.5, 4.6, 16.3). La proyección es pura y no toca el disco: el
 * registro ya cacheó las definiciones válidas y su orden total, y el contenido
 * pesado de cada agente solo se lee al resolver una ejecución.
 *
 * El campo `isDefault` de la respuesta no reproduce lo que declaró cada
 * manifiesto: se calcula comparando el agentId con el `defaultAgentId` que
 * resolvió el registro, de modo que exactamente una entrada lo lleve verdadero
 * aunque varios manifiestos lo declaren ().
 *
 
 */

import type { AgentCatalogSnapshot, AgentRegistry } from './agentRegistry.ts';
import type {
  AgentCatalogEntry,
  AgentCatalogResponse,
  AgentLanding,
  AgentLandingHighlight,
  AgentLandingHighlightGroup,
  ResolvedAgentDefinition,
} from './agentTypes.ts';

/**
 * Mensaje del error 500 cuando la enumeración de `agent/` falla: es fijo y no
 * nombra ninguna ruta del sistema de archivos (Requirements 4.8, 16.3). El
 * detalle del error se registra en consola, no se envía al cliente.
 */
export const CATALOG_UNAVAILABLE_ERROR =
  'No se pudo leer el catálogo de agentes en el servidor.';

/**
 * Copia el bloque `landing` campo a campo: `title`, `subtitle` y los grupos de
 * `highlights` con sus elementos (). Al reconstruir el objeto en
 * lugar de reenviar la referencia del manifiesto, ningún campo añadido al
 * manifiesto puede colarse en la respuesta, y el llamador no puede mutar el
 * catálogo cacheado. Devuelve `null` cuando el manifiesto omite el campo.
 */
function toLandingSummary(landing: AgentLanding | null): AgentLanding | null {
  if (landing === null) return null;

  const highlights: AgentLandingHighlightGroup[] = landing.highlights.map((group) => ({
    title: group.title,
    items: group.items.map((item) => {
      const summary: AgentLandingHighlight = { title: item.title };
      if (item.subtitle !== undefined) summary.subtitle = item.subtitle;
      if (item.icon !== undefined) summary.icon = item.icon;
      return summary;
    }),
  }));

  return { title: landing.title, subtitle: landing.subtitle, highlights };
}

/**
 * Proyecta una definición del catálogo a su entrada pública, con los valores
 * por defecto ya resueltos por la validación del manifiesto ()
 * y sin las rutas de `definition.paths` (Requirements 4.5, 16.3).
 */
export function toAgentCatalogEntry(
  definition: ResolvedAgentDefinition,
  defaultAgentId: string | null,
): AgentCatalogEntry {
  const { manifest } = definition;

  return {
    id: definition.agentId,
    name: manifest.name,
    tagline: manifest.tagline,
    description: manifest.description,
    icon: manifest.icon,
    accentColor: manifest.accentColor,
    order: manifest.order,
    //  verdadero solo en el agente por defecto resuelto.
    isDefault: definition.agentId === defaultAgentId,
    inputMode: manifest.inputMode,
    inputPlaceholder: manifest.inputPlaceholder,
    actionLabel: manifest.actionLabel,
    supportsInstruction: manifest.supportsInstruction,
    outputRenderer: manifest.outputRenderer,
    landing: toLandingSummary(manifest.landing),
  };
}

/**
 * Construye la respuesta del catálogo a partir del catálogo en memoria
 * (Requirements 4.1, 4.6). Las definiciones llegan ya ordenadas según el orden
 * total del catálogo y solo contienen las entradas válidas, así que las carpetas
 * descartadas por la validación no aparecen y el resto sí ().
 * Con un catálogo vacío la respuesta es una lista vacía y `defaultAgentId` nulo
 * ().
 */
export function buildAgentCatalogResponse(
  snapshot: Pick<AgentCatalogSnapshot, 'definitions' | 'defaultAgentId'>,
): AgentCatalogResponse {
  const { defaultAgentId } = snapshot;

  const entries = snapshot.definitions.map((definition) =>
    toAgentCatalogEntry(definition, defaultAgentId),
  );

  // Place the default agent first regardless of its catalog order.
  if (defaultAgentId) {
    const idx = entries.findIndex((e) => e.id === defaultAgentId);
    if (idx > 0) {
      const [defaultEntry] = entries.splice(idx, 1);
      entries.unshift(defaultEntry);
    }
  }

  return { agents: entries, defaultAgentId };
}

/** Cuerpo de error del catálogo, sin rutas del sistema de archivos. */
export interface AgentCatalogErrorBody {
  error: string;
}

/** Resultado HTTP del endpoint de catálogo, ya listo para serializar. */
export interface AgentCatalogHttpResult {
  status: number;
  body: AgentCatalogResponse | AgentCatalogErrorBody;
}

/** Destino del detalle del error de enumeración; por defecto, la consola. */
export type CatalogErrorLogger = (message: string) => void;

const consoleErrorLogger: CatalogErrorLogger = (message) => {
  console.error(`[api/agents] ${message}`);
};

/**
 * Atiende una petición del catálogo contra el registro recibido.
 *
 * Devuelve 200 con la lista ordenada y el `defaultAgentId` vigente, incluidos
 * los casos de catálogo vacío () y de catálogo con carpetas
 * descartadas (). Si la enumeración de `agent/` falló, devuelve
 * 500 con un mensaje sin rutas y registra el detalle en consola; el registro
 * conserva en memoria el catálogo vigente anterior al error, así que una
 * petición posterior vuelve a responderlo en cuanto la enumeración se recupera
 * ().
 */
export function buildAgentCatalogHttpResult(
  registry: AgentRegistry,
  logger: CatalogErrorLogger | null = consoleErrorLogger,
): AgentCatalogHttpResult {
  const snapshot = registry.getCatalog();

  if (snapshot.enumerationError !== null) {
    logger?.(snapshot.enumerationError);
    return { status: 500, body: { error: CATALOG_UNAVAILABLE_ERROR } };
  }

  return { status: 200, body: buildAgentCatalogResponse(snapshot) };
}
