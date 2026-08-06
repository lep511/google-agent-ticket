/**
 * Resolución de `GET /api/download_jsonl`: qué archivo `.jsonl` de `run_logs/`
 * corresponde a los parámetros recibidos.
 *
 * El endpoint mantiene su parámetro `ticker` y añade `agent` como opcional: con
 * `agent` se devuelve el `.jsonl` más reciente de esa entrada y ese agentId
 * (Requirement 10.3); sin él, el más reciente de esa entrada para cualquier
 * agentId (Requirement 10.4). Se reconocen los dos patrones de nombre: el nuevo
 * `run_log_<agentId>_<input>_<runId>` y el heredado `run_log_<input>_<runId>`,
 * comparando la entrada sin distinguir mayúsculas y minúsculas y quedándose con
 * el `runId` más alto (Requirement 9.6). Sin coincidencias se responde 404
 * (Requirement 10.5).
 *
 * La validación del parámetro `ticker` ocurre antes de mirar el disco: el
 * llamador entrega la enumeración de `run_logs/` como una función perezosa, de
 * modo que un `ticker` ausente, vacío o con caracteres fuera de `A`-`Z`, `a`-`z`
 * y `0`-`9` se rechaza con 400 sin enumerar la carpeta (Requirement 9.7). Los
 * mensajes de error no nombran rutas del sistema de archivos (Requirement 16.3).
 *
 * Sobre la ambigüedad del patrón nuevo: el agentId es snake_case y contiene
 * guiones bajos, así que `run_log_<agentId>_<input>_<runId>` no se puede partir
 * por separadores. La separación se hace desde el valor buscado: como `ticker`
 * solo admite letras y dígitos, un nombre coincide únicamente cuando el
 * fragmento de entrada del nombre es exactamente ese valor, y lo que queda
 * delante es el agentId de la ejecución (vacío en los logs heredados). Así el
 * agentId se deduce del propio nombre, sin depender de que el agente siga en el
 * catálogo, y los logs de entradas con separadores (agentes de tipo `text`)
 * quedan fuera del endpoint y solo accesibles por el estático `/run_logs`.
 *
 * El módulo es puro: no toca el sistema de archivos ni construye rutas.
 *
 * Requirements: 9.6, 9.7, 10.3, 10.4, 10.5, 16.3
 */

import { RUN_LOG_PREFIX } from './runLogNaming.ts';

/* ────────────────────────────────────────────────────────── */
/*  Parámetros y patrones                                      */
/* ────────────────────────────────────────────────────────── */

/** Parámetro obligatorio con el valor de entrada buscado (Requirement 9.7). */
export const TICKER_PARAM = 'ticker';

/** Parámetro opcional con el agentId por el que filtrar (Requirements 10.3, 10.4). */
export const AGENT_PARAM = 'agent';

/** Extensión de los logs que este endpoint entrega. */
export const JSONL_EXTENSION = '.jsonl';

/** Conjunto de caracteres admitido en `ticker`: `A`-`Z`, `a`-`z` y `0`-`9`. */
export const TICKER_PARAM_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * Nombre de un log `.jsonl`: prefijo común, un fragmento intermedio que reúne
 * agentId y entrada, y el `runId` como último grupo de dígitos. El fragmento
 * intermedio es codicioso, así que el `runId` es siempre el último bloque
 * numérico del nombre.
 */
const RUN_LOG_JSONL_PATTERN = new RegExp(
  `^${RUN_LOG_PREFIX}_(.+)_(\\d+)\\${JSONL_EXTENSION}$`,
  'i',
);

/* ────────────────────────────────────────────────────────── */
/*  Nombres de archivo                                         */
/* ────────────────────────────────────────────────────────── */

/** Partes de un nombre de log `.jsonl`, antes de separar agentId y entrada. */
export interface ParsedRunLogFileName {
  /** Fragmento entre el prefijo y el `runId`: `<agentId>_<input>` o `<input>`. */
  middle: string;
  /** `runId` tal como aparece en el nombre, sin convertir a número. */
  runId: string;
}

/**
 * Descompone un nombre de log `.jsonl` en su fragmento intermedio y su `runId`.
 * Devuelve `null` cuando el nombre no sigue el patrón, no es un `.jsonl` o
 * incluye separadores de ruta.
 */
export function parseRunLogFileName(fileName: string): ParsedRunLogFileName | null {
  if (typeof fileName !== 'string') return null;
  // Los nombres llegan de la enumeración de la carpeta, pero se comprueba de
  // todos modos que no aporten separadores ni recorridos (Requirement 16.1).
  if (fileName.includes('/') || fileName.includes('\\')) return null;

  const match = RUN_LOG_JSONL_PATTERN.exec(fileName);
  if (match === null) return null;

  return { middle: match[1], runId: match[2] };
}

/** Log candidato: el archivo, el agente que lo escribió y su `runId`. */
export interface RunLogMatch {
  /** Nombre del archivo tal como está en la carpeta, sin renombrar. */
  fileName: string;
  /** agentId deducido del nombre; `null` en un log con el patrón heredado. */
  agentId: string | null;
  /** Fragmento de entrada del nombre, tal como se escribió. */
  input: string;
  /** `runId` tal como aparece en el nombre. */
  runId: string;
}

/**
 * Comprueba si un nombre de log corresponde al valor de entrada buscado y, en
 * ese caso, deduce el agentId que lo escribió (Requirement 9.6).
 *
 * La comparación de la entrada no distingue mayúsculas y minúsculas, de modo que
 * `run_log_AMZN_1.jsonl` y `run_log_amzn_2.jsonl` cuentan como logs de la misma
 * entrada.
 */
export function matchRunLogFileName(fileName: string, targetInput: string): RunLogMatch | null {
  const parsed = parseRunLogFileName(fileName);
  if (parsed === null) return null;

  const target = targetInput.trim();
  if (target.length === 0) return null;

  const { middle, runId } = parsed;
  if (middle.length < target.length) return null;

  const input = middle.slice(middle.length - target.length);
  if (input.toLowerCase() !== target.toLowerCase()) return null;

  const prefix = middle.slice(0, middle.length - target.length);

  // Patrón heredado `run_log_<input>_<runId>`: no hay agentId en el nombre.
  if (prefix.length === 0) return { fileName, agentId: null, input, runId };

  // Patrón nuevo `run_log_<agentId>_<input>_<runId>`: lo que queda delante de la
  // entrada, sin su separador, es el agentId de la ejecución.
  if (!prefix.endsWith('_')) return null;
  const agentId = prefix.slice(0, -1);
  if (agentId.length === 0) return null;

  return { fileName, agentId, input, runId };
}

/**
 * Ordena dos `runId` como números, sin convertirlos: compara la longitud de sus
 * dígitos significativos y, a igual longitud, su orden lexicográfico. Así un
 * `runId` más largo que el rango seguro de un número sigue comparándose bien.
 * Devuelve un valor negativo cuando `a` es más antiguo que `b`.
 */
export function compareRunIds(a: string, b: string): number {
  const left = a.replace(/^0+(?=\d)/, '');
  const right = b.replace(/^0+(?=\d)/, '');
  if (left.length !== right.length) return left.length - right.length;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Filtros con los que se elige el log a devolver. */
export interface RunLogSelectionFilters {
  /** Valor de entrada buscado, ya validado. */
  input: string;
  /** agentId por el que filtrar, o `null` para cualquiera (Requirement 10.4). */
  agentId: string | null;
}

/**
 * Elige el log `.jsonl` más reciente entre los nombres recibidos: el del `runId`
 * más alto entre los que coinciden con la entrada y, cuando se indica, con el
 * agentId (Requirements 9.6, 10.3, 10.4). A igual `runId`, gana el nombre mayor,
 * de modo que el resultado no depende del orden de la enumeración. Devuelve
 * `null` cuando ningún nombre coincide (Requirement 10.5).
 */
export function selectLatestRunLog(
  fileNames: readonly string[],
  filters: RunLogSelectionFilters,
): RunLogMatch | null {
  const wantedAgentId = filters.agentId === null ? null : filters.agentId.trim().toLowerCase();

  let latest: RunLogMatch | null = null;

  for (const fileName of fileNames) {
    const candidate = matchRunLogFileName(fileName, filters.input);
    if (candidate === null) continue;

    if (wantedAgentId !== null) {
      // Requirement 10.3: con `agent`, solo los logs de ese agentId. Los logs
      // heredados no llevan agentId, así que quedan fuera del filtro.
      if (candidate.agentId === null) continue;
      if (candidate.agentId.toLowerCase() !== wantedAgentId) continue;
    }

    if (latest === null) {
      latest = candidate;
      continue;
    }

    const byRunId = compareRunIds(candidate.runId, latest.runId);
    if (byRunId > 0 || (byRunId === 0 && candidate.fileName > latest.fileName)) {
      latest = candidate;
    }
  }

  return latest;
}

/* ────────────────────────────────────────────────────────── */
/*  Validación de los parámetros                               */
/* ────────────────────────────────────────────────────────── */

/** Motivos por los que la petición no llega a mirar la carpeta de logs. */
export type RunLogDownloadErrorCode =
  /** `ticker` ausente, nulo o vacío tras recortar (Requirement 9.7). */
  | 'missing_ticker'
  /** `ticker` presente pero no es una cadena (Requirement 9.7). */
  | 'invalid_ticker_type'
  /** `ticker` con caracteres fuera del conjunto admitido (Requirement 9.7). */
  | 'invalid_ticker_format'
  /** No hay ningún `.jsonl` para los parámetros recibidos (Requirement 10.5). */
  | 'log_not_found';

/**
 * Cuerpo de error del endpoint: mensaje legible, motivo y parámetro causante,
 * sin nombrar rutas del sistema de archivos (Requirement 16.3).
 */
export interface RunLogDownloadErrorBody {
  error: string;
  code: RunLogDownloadErrorCode;
  /** Parámetro que identifica el error. */
  param: typeof TICKER_PARAM | typeof AGENT_PARAM;
}

/** Parámetros de consulta tal como llegan, sin validar. */
export interface RunLogDownloadQuery {
  ticker?: unknown;
  agent?: unknown;
}

/** Parámetros aceptados, listos para filtrar la enumeración. */
export interface ValidatedRunLogDownloadQuery {
  /** Valor de entrada buscado, recortado. */
  input: string;
  /** agentId recibido y recortado, o `null` cuando el parámetro está ausente. */
  agentId: string | null;
}

/** Resultado de validar los parámetros: o el filtro, o el rechazo 400. */
export interface RunLogDownloadQueryValidation {
  ok: boolean;
  value: ValidatedRunLogDownloadQuery | null;
  rejection: { status: 400; body: RunLogDownloadErrorBody } | null;
}

function rejectQuery(
  code: RunLogDownloadErrorCode,
  error: string,
): RunLogDownloadQueryValidation {
  return { ok: false, value: null, rejection: { status: 400, body: { error, code, param: TICKER_PARAM } } };
}

/**
 * Valida los parámetros de la descarga (Requirement 9.7).
 *
 * `ticker` debe ser una cadena con al menos un carácter tras recortar los
 * espacios y solo con letras y dígitos. `agent` es opcional: se toma como filtro
 * cuando llega como cadena con contenido, y se ignora cuando está ausente, vacío
 * o repetido, caso en el que la búsqueda abarca cualquier agentId
 * (Requirement 10.4).
 */
export function validateRunLogDownloadQuery(
  query: RunLogDownloadQuery,
): RunLogDownloadQueryValidation {
  const receivedTicker = query?.[TICKER_PARAM];

  if (receivedTicker === undefined || receivedTicker === null) {
    return rejectQuery(
      'missing_ticker',
      `Falta el parámetro "${TICKER_PARAM}", que debe tener al menos 1 carácter A-Z, a-z o 0-9.`,
    );
  }

  if (typeof receivedTicker !== 'string') {
    return rejectQuery(
      'invalid_ticker_type',
      `El parámetro "${TICKER_PARAM}" debe llegar una sola vez y como texto.`,
    );
  }

  const input = receivedTicker.trim();

  if (input.length === 0) {
    return rejectQuery(
      'missing_ticker',
      `El parámetro "${TICKER_PARAM}" queda vacío tras recortar los espacios.`,
    );
  }

  if (!TICKER_PARAM_PATTERN.test(input)) {
    return rejectQuery(
      'invalid_ticker_format',
      `El parámetro "${TICKER_PARAM}" solo admite caracteres A-Z, a-z y 0-9.`,
    );
  }

  const receivedAgent = query?.[AGENT_PARAM];
  const agent = typeof receivedAgent === 'string' ? receivedAgent.trim() : '';

  return { ok: true, value: { input, agentId: agent.length === 0 ? null : agent }, rejection: null };
}

/* ────────────────────────────────────────────────────────── */
/*  Resolución completa                                        */
/* ────────────────────────────────────────────────────────── */

/** Mensaje del 404 cuando no hay ningún log para los parámetros recibidos. */
export const LOG_NOT_FOUND_ERROR =
  'No hay ningún log de ejecución para los parámetros indicados.';

/** Petición a resolver: los parámetros y la enumeración perezosa de los logs. */
export interface ResolveRunLogDownloadOptions {
  query: RunLogDownloadQuery;
  /**
   * Nombres de archivo de la carpeta de logs. Se invoca solo si los parámetros
   * son válidos, de modo que un rechazo 400 no enumera la carpeta
   * (Requirement 9.7). Debe devolver una lista vacía si la carpeta no existe.
   */
  listFileNames: () => readonly string[];
}

/**
 * Resultado HTTP del endpoint: o el archivo a entregar, o el error a responder.
 * Exactamente uno de `match` y `body` está presente.
 */
export interface RunLogDownloadResult {
  status: 200 | 400 | 404;
  /** Log elegido, con su nombre sin renombrar; `null` en los errores. */
  match: RunLogMatch | null;
  /** Cuerpo del error; `null` cuando hay un archivo que entregar. */
  body: RunLogDownloadErrorBody | null;
}

/**
 * Resuelve una petición de descarga contra la carpeta de logs.
 *
 * Valida primero los parámetros (Requirement 9.7) y solo entonces enumera los
 * nombres, para elegir el `.jsonl` del `runId` más alto entre los que coinciden
 * con la entrada y, si se indicó, con el agentId (Requirements 9.6, 10.3, 10.4).
 * Sin coincidencias devuelve 404 (Requirement 10.5).
 */
export function resolveRunLogDownload(
  options: ResolveRunLogDownloadOptions,
): RunLogDownloadResult {
  const validation = validateRunLogDownloadQuery(options.query);
  if (validation.rejection !== null) {
    return { status: 400, match: null, body: validation.rejection.body };
  }

  const filters = validation.value as ValidatedRunLogDownloadQuery;
  const match = selectLatestRunLog(options.listFileNames(), filters);

  if (match === null) {
    return {
      status: 404,
      match: null,
      body: {
        error: LOG_NOT_FOUND_ERROR,
        code: 'log_not_found',
        param: filters.agentId === null ? TICKER_PARAM : AGENT_PARAM,
      },
    };
  }

  return { status: 200, match, body: null };
}
