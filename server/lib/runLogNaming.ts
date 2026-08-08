/**
 * Nombres de los archivos de log de una ejecución y URL pública del `.jsonl`.
 *
 * Toda ejecución escribe dos archivos en `run_logs/` cuyo nombre incorpora el
 * agentId que la ejecutó, el valor de entrada y el `runId`, de modo que dos
 * agentes que analizan la misma entrada no se solapen (Requirement 10.1). El
 * evento `final_stats` publica la URL del `.jsonl` de esa misma ejecución bajo
 * el estático `/run_logs` (Requirement 10.2).
 *
 * El módulo es puro: no toca el sistema de archivos ni el flujo SSE, para que
 * el patrón pueda comprobarse por sí solo.
 *
 
 */

/** Prefijo común de todos los nombres de log, nuevo y heredado. */
export const RUN_LOG_PREFIX = 'run_log';

/** Ruta estática bajo la que se sirven los logs de ejecución. */
export const RUN_LOGS_PUBLIC_PATH = '/run_logs';

/** Longitud máxima del fragmento de entrada que se usa en un nombre de log. */
export const MAX_LOG_SLUG_LENGTH = 40;

/** Fragmento de reemplazo cuando la entrada no aporta ningún carácter usable. */
export const EMPTY_INPUT_SLUG = 'input';

/**
 * Converts a raw input string into a filesystem-safe slug.
 */
export function toLogFileSlug(rawInput: string): string {
  const slug = rawInput.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (slug.length === 0 ? EMPTY_INPUT_SLUG : slug).slice(0, MAX_LOG_SLUG_LENGTH);
}

/**
 * Formats a timestamp as a filesystem-safe datetime string with milliseconds.
 * Example: "2026-08-08_10-15-30-123"
 */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

export interface RunLogNamingInput {
  agentId: string;
  rawInput: string;
  runId: number | string;
}

export interface RunLogNames {
  baseName: string;
  jsonlFileName: string;
  txtFileName: string;
  jsonlLogUrl: string;
}

/**
 * Base name: `run_log_<agentId>_<datetime with ms>`.
 */
export function buildRunLogBaseName({ agentId, runId }: RunLogNamingInput): string {
  const ts = typeof runId === 'number' ? runId : Date.now();
  return `${RUN_LOG_PREFIX}_${agentId}_${formatTimestamp(ts)}`;
}

/**
 * File names and public URL for a run's log files.
 */
export function buildRunLogNames(naming: RunLogNamingInput): RunLogNames {
  const baseName = buildRunLogBaseName(naming);
  const jsonlFileName = `${baseName}.jsonl`;
  return {
    baseName,
    jsonlFileName,
    txtFileName: `${baseName}.txt`,
    jsonlLogUrl: buildJsonlLogUrl(jsonlFileName),
  };
}

/** URL pública del `.jsonl` de una ejecución (Requirement 10.2). */
export function buildJsonlLogUrl(jsonlFileName: string): string {
  return `${RUN_LOGS_PUBLIC_PATH}/${jsonlFileName}`;
}
