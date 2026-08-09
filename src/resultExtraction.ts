/* ──────────────────────────────────────────────────────────── */
/*  Extraction of the result from the final text                */
/*                                                              */
/*  Pure logic of the `Result_Extractor`: it takes the raw text  */
/*  the agent emitted plus the `outputRenderer` of that run and  */
/*  returns the report object, or null when the text holds no    */
/*  valid one for that renderer.                                 */
/*                                                              */
/*  Two passes, in this order: the ```json fenced blocks, then a */
/*  brace-balance scan of the whole text. The scan is the safety */
/*  net for the fence pass, which a stray ``` inside a JSON      */
/*  string is enough to cut short.                               */
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
 * Every balanced `{...}` span the text closes at nesting depth zero, in the
 * order they open.
 *
 * The scan tracks string literals and their escapes, so a brace, a backtick or a
 * ``` fence sitting inside a JSON string never opens or closes a candidate —
 * which matters because reports carry Markdown-formatted prose in their fields.
 * A span whose braces never balance, the shape of a truncated report, is not
 * returned at all: half an object is not a candidate.
 */
function balancedObjectSpans(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      // A `}` at depth zero is prose, not the close of a candidate.
      depth -= 1;
      if (depth === 0 && start !== -1) {
        spans.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return spans;
}

/**
 * Fallback for text with no usable fenced block: the last balanced object that
 * parses and belongs to the renderer (Requirement 14.4).
 *
 * Scanning for balanced spans replaced two brittle heuristics. Slicing from the
 * first `{` to the last `}` broke on any prose brace around the report, and the
 * `\{\s*"key"[\s\S]*?\}\s*\}` rescue regex depended on how the model happened to
 * indent its JSON. Both are gone: a candidate is now delimited by its own braces.
 */
function fromBalancedObjects(
  text: string,
  renderer: OutputRenderer | null | undefined,
): ExtractedReport | null {
  const spans = balancedObjectSpans(text);
  // Last first, matching the fenced pass: a later object supersedes an earlier one.
  for (let i = spans.length - 1; i >= 0; i--) {
    const found = parseCandidate(spans[i], renderer);
    if (found) return found;
  }
  return null;
}

/**
 * Extracts the report from the final text of a run: the last valid ```json
 * block, falling back to the last balanced object in the text. Returns null when
 * the text holds no object valid for the renderer, in which case no report may
 * be promoted (Requirements 14.4, 14.5, 14.6).
 *
 * Meant to run on the complete text of a finished run. On a partial text it
 * either finds nothing (a truncated object never balances) or, if the report
 * happens to be complete already, the same object it would find at the end.
 */
export function extractReport(
  text: string | null | undefined,
  renderer: OutputRenderer | null | undefined,
): ExtractedReport | null {
  if (!text) return null;
  try {
    return fromFencedBlocks(text, renderer) ?? fromBalancedObjects(text, renderer);
  } catch {
    return null;
  }
}
