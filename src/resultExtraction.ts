/* ──────────────────────────────────────────────────────────── */
/*  Extracción del resultado del texto final                    */
/*                                                              */
/*  Lógica pura del `Result_Extractor`: recibe el texto crudo    */
/*  emitido por el agente y el `outputRenderer` de esa ejecución */
/*  y devuelve el objeto de informe, o nulo si el texto no       */
/*  contiene ninguno válido para ese renderizador.               */
/*                                                              */
/*  Requirements: 14.4, 14.5, 14.6                              */
/* ──────────────────────────────────────────────────────────── */

import type { OutputRenderer } from './types';

/**
 * Claves raíz que identifican un informe válido para cada renderizador
 * (Requirement 14.5). Basta con que el objeto declare una de ellas.
 */
export const REPORT_ROOT_KEYS: Record<OutputRenderer, readonly string[]> = {
  financial_report: ['verdict', 'findings', 'deep_insights'],
  simple_report: ['summary', 'key_points', 'sections', 'sources'],
};

/** Renderizador aplicado cuando la ejecución no informó ninguno. */
export const FALLBACK_OUTPUT_RENDERER: OutputRenderer = 'financial_report';

/** Objeto de informe recién extraído: su forma la valida cada vista. */
export type ExtractedReport = Record<string, unknown>;

/** Claves raíz aceptadas por el renderizador indicado (Requirement 14.5). */
export function reportRootKeys(renderer: OutputRenderer | null | undefined): readonly string[] {
  if (renderer && renderer in REPORT_ROOT_KEYS) {
    return REPORT_ROOT_KEYS[renderer];
  }
  return REPORT_ROOT_KEYS[FALLBACK_OUTPUT_RENDERER];
}

/**
 * Un objeto es un informe del renderizador cuando es un objeto plano y declara
 * al menos una de sus claves raíz con valor presente (Requirement 14.5).
 */
export function matchesRenderer(
  value: unknown,
  renderer: OutputRenderer | null | undefined,
): value is ExtractedReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return reportRootKeys(renderer).some(
    (key) => record[key] !== undefined && record[key] !== null,
  );
}

/** Analiza un fragmento y lo devuelve solo si es un informe del renderizador. */
function parseCandidate(
  candidate: string,
  renderer: OutputRenderer | null | undefined,
): ExtractedReport | null {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return matchesRenderer(parsed, renderer) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Último bloque ```json cuyo contenido es JSON válido y corresponde al
 * renderizador de la ejecución (Requirement 14.4).
 */
function fromFencedBlocks(
  text: string,
  renderer: OutputRenderer | null | undefined,
): ExtractedReport | null {
  const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const found = parseCandidate(matches[i][1], renderer);
    if (found) return found;
  }
  return null;
}

/**
 * Degradación por llaves exteriores: se analiza el tramo entre la primera `{` y
 * la última `}` y, si no es JSON válido, se busca un objeto que arranque con
 * alguna de las claves raíz del renderizador (Requirement 14.4).
 */
function fromOuterBraces(
  text: string,
  renderer: OutputRenderer | null | undefined,
): ExtractedReport | null {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;

  const outer = parseCandidate(text.slice(firstBrace, lastBrace + 1), renderer);
  if (outer) return outer;

  for (const key of reportRootKeys(renderer)) {
    const pattern = new RegExp(`\\{\\s*"${key}"[\\s\\S]*?\\}\\s*\\}`);
    const match = text.match(pattern);
    if (!match) continue;
    const found = parseCandidate(match[0], renderer);
    if (found) return found;
  }

  return null;
}

/**
 * Extrae el informe del texto final de una ejecución: último bloque ```json
 * válido, con degradación a la búsqueda por llaves exteriores. Devuelve nulo
 * cuando el texto no contiene ningún objeto válido para el renderizador, caso
 * en el que no debe promoverse ningún informe (Requirements 14.4, 14.5, 14.6).
 */
export function extractReport(
  text: string | null | undefined,
  renderer: OutputRenderer | null | undefined,
): ExtractedReport | null {
  if (!text) return null;
  try {
    return fromFencedBlocks(text, renderer) ?? fromOuterBraces(text, renderer);
  } catch {
    return null;
  }
}
