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
 * Requirements: 10.1, 10.2
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
 * Convierte el valor de entrada en un fragmento seguro para un nombre de
 * archivo: conserva letras y dígitos tal como llegaron, para no cambiar el
 * nombre de los logs de los agentes de tipo `ticker`, y sustituye cualquier
 * otro carácter, de modo que un texto libre no pueda introducir separadores de
 * ruta ni secuencias de recorrido.
 */
export function toLogFileSlug(rawInput: string): string {
  const slug = rawInput.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (slug.length === 0 ? EMPTY_INPUT_SLUG : slug).slice(0, MAX_LOG_SLUG_LENGTH);
}

/** Datos con los que se nombran los dos archivos de log de una ejecución. */
export interface RunLogNamingInput {
  /** agentId efectivamente ejecutado, no el recibido en la petición. */
  agentId: string;
  /** Valor de entrada tal como llegó, antes de sanear. */
  rawInput: string;
  /** Identificador de la ejecución, común a los dos archivos y a la URL. */
  runId: number | string;
}

/** Nombres de archivo y URL pública de los logs de una ejecución. */
export interface RunLogNames {
  /** `run_log_<agentId>_<input>_<runId>`, sin extensión. */
  baseName: string;
  /** `run_log_<agentId>_<input>_<runId>.jsonl` (Requirement 10.1). */
  jsonlFileName: string;
  /** `run_log_<agentId>_<input>_<runId>.txt` (Requirement 10.1). */
  txtFileName: string;
  /** URL del `.jsonl` de esa ejecución bajo `/run_logs` (Requirement 10.2). */
  jsonlLogUrl: string;
}

/**
 * Nombre base compartido por los dos archivos de log de una ejecución:
 * `run_log_<agentId>_<input>_<runId>` (Requirement 10.1).
 */
export function buildRunLogBaseName({ agentId, rawInput, runId }: RunLogNamingInput): string {
  return `${RUN_LOG_PREFIX}_${agentId}_${toLogFileSlug(rawInput)}_${runId}`;
}

/**
 * Nombres de los dos archivos de log de una ejecución y URL del `.jsonl`. Los
 * dos archivos comparten el mismo `runId`, así que el `.txt` y el `.jsonl` de
 * una ejecución siempre se corresponden (Requirements 10.1, 10.2).
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
