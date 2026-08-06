/**
 * Registro de agentes: descubrimiento de carpetas y caché por marca de tiempo.
 *
 * Esta primera capa del registro solo enumera las subcarpetas directas de
 * `agent/`, lee el `manifest.json` de cada una y mantiene el resultado en
 * memoria hasta que cambia la marca de tiempo de modificación de `agent/`.
 *
 * Sobre ese descubrimiento, `agentManifestValidation.ts` valida cada manifiesto
 * y resuelve su definición (manifiesto normalizado + rutas); las definiciones
 * válidas se publican aplicando el orden total del catálogo (`order`, luego
 * `name` sin distinguir mayúsculas y minúsculas, luego agentId). Sobre ese
 * catálogo ordenado se resuelve un único agente por defecto por precedencia
 * (único `isDefault`, luego `financial_analyst_agent`, luego la primera
 * entrada del orden total). No se lee el contenido de los archivos de
 * ejecución del agente: esos se cargan solo al resolver una ejecución.
 *
 * Sobre el catálogo publicado, el registro resuelve el `agentId` recibido en
 * una petición por coincidencia exacta con los identificadores descubiertos:
 * todo valor ausente, vacío, con separadores de ruta, secuencias de recorrido o
 * caracteres fuera de snake_case se trata como desconocido y cae en el agente
 * por defecto con una advertencia. Las rutas de archivo se construyen siempre
 * desde la entrada de catálogo, nunca concatenando el valor recibido.
 *
 * Al resolver una ejecución, y solo entonces, el registro carga las fuentes
 * inline del agente resuelto (`agentInlineSources.ts`): recorre únicamente su
 * carpeta, preserva la ruta relativa de cada archivo bajo `/.agents` y aplica
 * las exclusiones de metadata y los límites de profundidad, número y tamaño.
 *
 * Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 2.5, 2.8, 2.9,
 * 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.6, 4.7, 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6,
 * 6.7, 7.9, 7.10, 9.9, 16.1, 16.2
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  loadAgentInlineSources,
  type AgentInlineSourceWarningCode,
  type AgentInlineSourcesResult,
} from './agentInlineSources.ts';
import {
  validateAgentFolders,
  type AgentManifestWarningCode,
} from './agentManifestValidation.ts';
import {
  MANIFEST_FILE_NAME,
  MAX_AGENT_FOLDERS,
  MAX_MANIFEST_BYTES,
  MAX_PROMPT_BYTES,
  MAX_SCHEMA_BYTES,
  type ResolvedAgentDefinition,
} from './agentTypes.ts';

/* ────────────────────────────────────────────────────────── */
/*  Constantes                                                 */
/* ────────────────────────────────────────────────────────── */

/** Raíz del catálogo de agentes en disco. */
export const DEFAULT_AGENTS_DIR = path.join(process.cwd(), 'agent');

/**
 * snake_case: una o más secuencias de `a`-`z` y `0`-`9` separadas por un único
 * `_` (Requirement 1.4). Esta forma también impide separadores de ruta y
 * secuencias de recorrido en el agentId.
 */
export const SNAKE_CASE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** Comprueba que un nombre de carpeta puede ser un agentId. */
export function isSnakeCaseAgentId(value: unknown): value is string {
  return typeof value === 'string' && SNAKE_CASE_PATTERN.test(value);
}

/* ────────────────────────────────────────────────────────── */
/*  Advertencias                                               */
/* ────────────────────────────────────────────────────────── */

/** Motivos por los que el descubrimiento descarta una carpeta o la limita. */
export type AgentDiscoveryWarningCode =
  | 'folder_limit_exceeded'
  | 'invalid_folder_name'
  | 'missing_manifest'
  | 'manifest_too_large'
  | 'duplicate_agent_id'
  | 'filesystem_error'
  | 'enumeration_error';

/** Motivos relativos a la resolución del agente por defecto (Requirements 3.2, 3.3, 3.8). */
export type AgentDefaultWarningCode = 'ambiguous_default_agent' | 'empty_catalog';

/**
 * Motivos por los que un `agentId` recibido no se usa tal cual y la ejecución
 * cae en el agente por defecto (Requirements 5.2, 16.2).
 */
export type AgentResolutionWarningCode =
  | 'missing_agent_id'
  | 'malformed_agent_id'
  | 'unknown_agent_id'
  | 'no_agent_available';

/** Motivos de descarte o degradación, del descubrimiento y de la validación. */
export type AgentRegistryWarningCode =
  | AgentDiscoveryWarningCode
  | AgentManifestWarningCode
  | AgentDefaultWarningCode
  | AgentResolutionWarningCode
  | AgentInlineSourceWarningCode;

export interface AgentRegistryWarning {
  code: AgentRegistryWarningCode;
  /** Ruta relativa a la raíz del catálogo, `agent/<carpeta>` cuando aplica. */
  relativePath: string;
  /** Mensaje legible, ya formateado para consola. */
  message: string;
}

/** Destino de las advertencias del registro; por defecto, la consola. */
export type AgentRegistryLogger = (warning: AgentRegistryWarning) => void;

export const consoleWarningLogger: AgentRegistryLogger = (warning) => {
  console.warn(`[agentRegistry] ${warning.message}`);
};

/* ────────────────────────────────────────────────────────── */
/*  Resultado del descubrimiento                               */
/* ────────────────────────────────────────────────────────── */

/**
 * Carpeta de agente descubierta: identidad, rutas y el texto de su manifiesto.
 * El análisis y la validación del manifiesto ocurren en la capa siguiente.
 */
export interface DiscoveredAgentFolder {
  /** Nombre de la carpeta, ya comprobado como snake_case (Requirement 1.2). */
  agentId: string;
  /** Ruta absoluta de la carpeta del agente. */
  dir: string;
  /** Ruta relativa para mensajes, `agent/<agentId>`. */
  relativeDir: string;
  /** Ruta absoluta de `manifest.json`. */
  manifestPath: string;
  /** Contenido literal de `manifest.json`, con saltos de línea normalizados. */
  manifestText: string;
  /** Tamaño de `manifest.json` en bytes. */
  manifestBytes: number;
}

export interface AgentDiscoveryResult {
  /** Carpetas descubiertas, ordenadas por agentId; cada agentId una sola vez. */
  folders: DiscoveredAgentFolder[];
  warnings: AgentRegistryWarning[];
  /**
   * Error de enumeración de `agent/`: cuando está presente, `folders` está
   * vacío y quien cachea debe conservar el catálogo vigente (Requirement 4.8).
   */
  enumerationError: string | null;
  /** Manifiestos leídos de disco en esta pasada; sirve para verificar la caché. */
  manifestReads: number;
  /** Duración del descubrimiento en milisegundos (Requirements 1.1, 4.7). */
  durationMs: number;
}

/* ────────────────────────────────────────────────────────── */
/*  Descubrimiento                                             */
/* ────────────────────────────────────────────────────────── */

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Enumera hasta `MAX_AGENT_FOLDERS` subcarpetas directas de `agentsDir` y lee
 * el `manifest.json` de cada una (Requirement 1.1).
 *
 * Descarta con una advertencia, conservando el resto del catálogo, las
 * carpetas con nombre fuera de snake_case (1.4), sin `manifest.json` o con un
 * manifiesto mayor de 64 KB (1.5, 9.9) y las que producen un error del sistema
 * de archivos (1.6). Los archivos sueltos de la raíz de `agent/` se ignoran
 * porque solo se recorren directorios (Requirement 6.4), y no se lee ningún
 * archivo de ejecución (Requirement 4.6).
 */
export function discoverAgentFolders(
  agentsDir: string = DEFAULT_AGENTS_DIR,
  logger: AgentRegistryLogger | null = consoleWarningLogger,
): AgentDiscoveryResult {
  const startedAt = Date.now();
  const warnings: AgentRegistryWarning[] = [];
  const folders: DiscoveredAgentFolder[] = [];
  const seenAgentIds = new Set<string>();
  let manifestReads = 0;

  const warn = (
    code: AgentDiscoveryWarningCode,
    relativePath: string,
    message: string,
  ): void => {
    const warning: AgentRegistryWarning = { code, relativePath, message };
    warnings.push(warning);
    logger?.(warning);
  };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  } catch (error) {
    const message = `No se pudo enumerar el catálogo de agentes: ${errorMessage(error)}`;
    warn('enumeration_error', 'agent', message);
    return {
      folders: [],
      warnings,
      enumerationError: message,
      manifestReads,
      durationMs: Date.now() - startedAt,
    };
  }

  // Orden por nombre para que el recorte a 100 carpetas sea determinista.
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const considered = directories.slice(0, MAX_AGENT_FOLDERS);
  for (const skipped of directories.slice(MAX_AGENT_FOLDERS)) {
    warn(
      'folder_limit_exceeded',
      path.posix.join('agent', skipped),
      `Carpeta "${skipped}" omitida: se supera el límite de ${MAX_AGENT_FOLDERS} subcarpetas de agent/.`,
    );
  }

  for (const folderName of considered) {
    const relativeDir = path.posix.join('agent', folderName);

    if (!isSnakeCaseAgentId(folderName)) {
      warn(
        'invalid_folder_name',
        relativeDir,
        `Carpeta "${folderName}" omitida: el nombre no está en snake_case.`,
      );
      continue;
    }

    if (seenAgentIds.has(folderName)) {
      warn(
        'duplicate_agent_id',
        relativeDir,
        `Carpeta "${folderName}" omitida: el agentId ya está en el catálogo.`,
      );
      continue;
    }

    const dir = path.join(agentsDir, folderName);
    const manifestPath = path.join(dir, MANIFEST_FILE_NAME);

    let manifestStat: fs.Stats;
    try {
      manifestStat = fs.statSync(manifestPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        warn(
          'missing_manifest',
          relativeDir,
          `Carpeta "${folderName}" omitida: no contiene ${MANIFEST_FILE_NAME}.`,
        );
      } else {
        warn(
          'filesystem_error',
          relativeDir,
          `Carpeta "${relativeDir}" omitida por un error del sistema de archivos: ${errorMessage(error)}.`,
        );
      }
      continue;
    }

    if (!manifestStat.isFile()) {
      warn(
        'missing_manifest',
        relativeDir,
        `Carpeta "${folderName}" omitida: ${MANIFEST_FILE_NAME} no es un archivo.`,
      );
      continue;
    }

    if (manifestStat.size > MAX_MANIFEST_BYTES) {
      warn(
        'manifest_too_large',
        relativeDir,
        `Carpeta "${folderName}" omitida: ${MANIFEST_FILE_NAME} ocupa ${manifestStat.size} bytes y supera el límite de ${MAX_MANIFEST_BYTES} bytes.`,
      );
      continue;
    }

    let manifestText: string;
    try {
      manifestText = fs.readFileSync(manifestPath, 'utf-8').replace(/\r\n/g, '\n');
      manifestReads += 1;
    } catch (error) {
      warn(
        'filesystem_error',
        relativeDir,
        `Carpeta "${relativeDir}" omitida por un error del sistema de archivos: ${errorMessage(error)}.`,
      );
      continue;
    }

    seenAgentIds.add(folderName);
    folders.push({
      agentId: folderName,
      dir,
      relativeDir,
      manifestPath,
      manifestText,
      manifestBytes: manifestStat.size,
    });
  }

  return {
    folders,
    warnings,
    enumerationError: null,
    manifestReads,
    durationMs: Date.now() - startedAt,
  };
}

/* ────────────────────────────────────────────────────────── */
/*  Orden total del catálogo                                   */
/* ────────────────────────────────────────────────────────── */

/**
 * Colación para el desempate por `name`: alfabética y sin distinguir
 * mayúsculas y minúsculas, pero sensible a los acentos, de modo que dos
 * nombres que solo difieren en la caja se consideren iguales y el desempate
 * pase al agentId (Requirement 1.8).
 */
const CATALOG_NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'accent' });

/** Comparación de dos cadenas por punto de código; determinista y estable. */
function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compara dos `name` del catálogo sin distinguir mayúsculas y minúsculas.
 * Cuando la colación los declara equivalentes se cae a una comparación por
 * punto de código de sus formas en minúsculas, para que el resultado no
 * dependa de la implementación de `Intl` y el orden siga siendo total.
 */
export function compareAgentNames(a: string, b: string): number {
  const collated = CATALOG_NAME_COLLATOR.compare(a, b);
  if (collated !== 0) return collated < 0 ? -1 : 1;
  return compareCodePoints(a.toLowerCase(), b.toLowerCase());
}

/**
 * Orden total del catálogo (Requirements 1.7, 1.8): `order` ascendente, ante
 * empate `name` alfabético sin distinguir mayúsculas y minúsculas, y ante
 * empate de `name` agentId ascendente. Como el agentId es único dentro del
 * catálogo (Requirement 1.11), la comparación solo devuelve 0 para la misma
 * entrada, así que el orden queda determinado sin depender de la estabilidad
 * de `Array.prototype.sort`.
 */
export function compareAgentDefinitions(
  a: ResolvedAgentDefinition,
  b: ResolvedAgentDefinition,
): number {
  if (a.manifest.order !== b.manifest.order) return a.manifest.order - b.manifest.order;

  const byName = compareAgentNames(a.manifest.name, b.manifest.name);
  if (byName !== 0) return byName;

  return compareCodePoints(a.agentId, b.agentId);
}

/** Devuelve una copia ordenada según el orden total del catálogo. */
export function sortAgentDefinitions(
  definitions: readonly ResolvedAgentDefinition[],
): ResolvedAgentDefinition[] {
  return [...definitions].sort(compareAgentDefinitions);
}

/* ────────────────────────────────────────────────────────── */
/*  Agente por defecto                                         */
/* ────────────────────────────────────────────────────────── */

/**
 * agentId que ocupa el segundo lugar de la precedencia del agente por defecto
 * (Requirement 3.2).
 */
export const FINANCIAL_ANALYST_AGENT_ID = 'financial_analyst_agent';

/** Regla de precedencia que determinó el agente por defecto. */
export type DefaultAgentSource =
  /** Exactamente una entrada válida declaró `isDefault` verdadero (3.1). */
  | 'declared'
  /** `isDefault` ambiguo y `financial_analyst_agent` en el catálogo (3.2). */
  | 'financial_fallback'
  /** `isDefault` ambiguo sin agente financiero: primera del orden total (3.3). */
  | 'first_in_order'
  /** No hay entradas válidas: no existe agente por defecto (3.8). */
  | 'empty_catalog';

export interface DefaultAgentResolution {
  /** Único agente por defecto, o `null` cuando el catálogo está vacío. */
  defaultAgentId: string | null;
  source: DefaultAgentSource;
  warnings: AgentRegistryWarning[];
}

/**
 * Resuelve el agente por defecto del catálogo por precedencia
 * (Requirements 3.1, 3.2, 3.3): la única entrada que declara `isDefault`
 * verdadero; si el número de entradas que lo declaran es distinto de uno,
 * `financial_analyst_agent`; y si tampoco está, la primera entrada según el
 * orden total del catálogo. Devuelve exactamente un `defaultAgentId` mientras
 * haya al menos una entrada válida (3.4) y `null` con una advertencia cuando el
 * catálogo queda vacío (3.8).
 *
 * La función es pura respecto al catálogo recibido: se vuelve a llamar en cada
 * reconstrucción (3.6) y su resultado se cachea con el catálogo (3.5).
 */
export function resolveDefaultAgent(
  definitions: readonly ResolvedAgentDefinition[],
  logger: AgentRegistryLogger | null = null,
): DefaultAgentResolution {
  const warnings: AgentRegistryWarning[] = [];
  const warn = (
    code: AgentDefaultWarningCode,
    relativePath: string,
    message: string,
  ): void => {
    const warning: AgentRegistryWarning = { code, relativePath, message };
    warnings.push(warning);
    logger?.(warning);
  };

  // El orden se reafirma aquí para que la regla de la primera entrada no
  // dependa de que el llamador haya ordenado el catálogo (Requirement 3.3).
  const ordered = sortAgentDefinitions(definitions);

  if (ordered.length === 0) {
    warn(
      'empty_catalog',
      'agent',
      'El catálogo no contiene ninguna entrada válida: no hay agente por defecto.',
    );
    return { defaultAgentId: null, source: 'empty_catalog', warnings };
  }

  const declared = ordered.filter((definition) => definition.manifest.isDefault);
  if (declared.length === 1) {
    return { defaultAgentId: declared[0]!.agentId, source: 'declared', warnings };
  }

  const financial = ordered.find(
    (definition) => definition.agentId === FINANCIAL_ANALYST_AGENT_ID,
  );
  if (financial !== undefined) {
    warn(
      'ambiguous_default_agent',
      path.posix.join('agent', financial.agentId),
      `${declared.length} entradas del catálogo declaran isDefault verdadero: se designa "${FINANCIAL_ANALYST_AGENT_ID}" como agente por defecto.`,
    );
    return { defaultAgentId: financial.agentId, source: 'financial_fallback', warnings };
  }

  const first = ordered[0]!;
  warn(
    'ambiguous_default_agent',
    path.posix.join('agent', first.agentId),
    `${declared.length} entradas del catálogo declaran isDefault verdadero y "${FINANCIAL_ANALYST_AGENT_ID}" no está en el catálogo: se designa "${first.agentId}" como agente por defecto.`,
  );
  return { defaultAgentId: first.agentId, source: 'first_in_order', warnings };
}

/* ────────────────────────────────────────────────────────── */
/*  Resolución de un `agentId` recibido                        */
/* ────────────────────────────────────────────────────────── */

/** Forma del valor recibido, antes de buscarlo en el catálogo. */
export type RequestedAgentIdKind =
  /** Ausente, nulo, de otro tipo o vacío tras recortar espacios (5.2). */
  | 'absent'
  /** Cadena con separadores de ruta, recorrido o caracteres fuera de snake_case (16.2). */
  | 'malformed'
  /** Cadena en snake_case: puede buscarse en el catálogo por coincidencia exacta. */
  | 'candidate';

export interface RequestedAgentId {
  kind: RequestedAgentIdKind;
  /** El valor literal cuando es una cadena; `null` en cualquier otro caso. */
  value: string | null;
}

/** Longitud máxima del valor recibido que se reproduce en una advertencia. */
const MAX_LOGGED_AGENT_ID_LENGTH = 120;

/**
 * Describe el valor recibido para una advertencia sin volcarlo tal cual: se
 * recorta y se serializa, de modo que un valor con saltos de línea o comillas
 * no pueda falsear una línea de log.
 */
function describeRequestedAgentId(received: unknown): string {
  if (received === undefined) return 'ausente';
  if (received === null) return 'nulo';
  if (typeof received !== 'string') return `de tipo ${typeof received}`;
  const truncated =
    received.length > MAX_LOGGED_AGENT_ID_LENGTH
      ? `${received.slice(0, MAX_LOGGED_AGENT_ID_LENGTH)}…`
      : received;
  return JSON.stringify(truncated);
}

/**
 * Clasifica un `agentId` recibido sin tocar el catálogo (Requirements 5.2, 16.2).
 *
 * La comparación posterior es exacta: el valor no se recorta ni se normaliza
 * antes de buscarlo, así que cualquier espacio, separador de ruta (`/`, `\`),
 * secuencia de recorrido (`..`) o carácter fuera de snake_case deja el valor
 * como `malformed` y la ejecución cae en el agente por defecto. El recorte solo
 * se usa para detectar el valor vacío.
 */
export function classifyRequestedAgentId(received: unknown): RequestedAgentId {
  if (typeof received !== 'string') return { kind: 'absent', value: null };
  if (received.trim().length === 0) return { kind: 'absent', value: received };
  if (!SNAKE_CASE_PATTERN.test(received)) return { kind: 'malformed', value: received };
  return { kind: 'candidate', value: received };
}

/** Regla que determinó el agente de una ejecución. */
export type AgentResolutionSource =
  /** El valor recibido coincide de forma exacta con un agentId del catálogo (5.1). */
  | 'exact_match'
  /** El valor recibido estaba ausente o vacío: agente por defecto (5.2). */
  | 'default_absent'
  /** El valor recibido no tenía la forma de un agentId: agente por defecto (16.2). */
  | 'default_malformed'
  /** El valor recibido no está en el catálogo: agente por defecto (5.2). */
  | 'default_unknown'
  /** No hay ningún agente disponible: la ejecución no puede continuar (5.6). */
  | 'unavailable';

export interface AgentResolution {
  /** Agente resuelto, o `null` solo cuando el catálogo está vacío (5.6). */
  definition: ResolvedAgentDefinition | null;
  /** agentId efectivamente resuelto, el que se informa en `agent_info` (5.2, 5.3). */
  agentId: string | null;
  /** Valor recibido, tal como llegó, cuando era una cadena; `null` en otro caso. */
  requestedAgentId: string | null;
  source: AgentResolutionSource;
  warnings: AgentRegistryWarning[];
}

/**
 * Resuelve un `agentId` recibido contra un catálogo ya validado
 * (Requirements 5.1, 5.2, 16.1, 16.2).
 *
 * La función es total: mientras el catálogo tenga al menos una entrada válida
 * devuelve exactamente un agente, sea por coincidencia exacta o por caída al
 * agente por defecto con una advertencia. Las rutas de archivo salen siempre de
 * la entrada del catálogo (`definition.paths`); el valor recibido nunca se
 * concatena a una ruta.
 */
export function resolveAgentSelection(
  definitions: readonly ResolvedAgentDefinition[],
  defaultAgentId: string | null,
  receivedAgentId: unknown,
  logger: AgentRegistryLogger | null = null,
): AgentResolution {
  const warnings: AgentRegistryWarning[] = [];
  const warn = (
    code: AgentResolutionWarningCode,
    relativePath: string,
    message: string,
  ): void => {
    const warning: AgentRegistryWarning = { code, relativePath, message };
    warnings.push(warning);
    logger?.(warning);
  };

  const requested = classifyRequestedAgentId(receivedAgentId);
  const received = describeRequestedAgentId(receivedAgentId);

  // Requirements 5.1, 16.1: búsqueda por coincidencia exacta del identificador.
  const matched =
    requested.kind === 'candidate'
      ? definitions.find((definition) => definition.agentId === requested.value)
      : undefined;

  if (matched !== undefined) {
    return {
      definition: matched,
      agentId: matched.agentId,
      requestedAgentId: requested.value,
      source: 'exact_match',
      warnings,
    };
  }

  const fallback =
    defaultAgentId === null
      ? undefined
      : definitions.find((definition) => definition.agentId === defaultAgentId);

  if (fallback === undefined) {
    // Requirement 5.6: sin catálogo no hay agente al que caer.
    warn(
      'no_agent_available',
      'agent',
      `No hay ningún agente disponible para atender la ejecución (agentId recibido: ${received}).`,
    );
    return {
      definition: null,
      agentId: null,
      requestedAgentId: requested.value,
      source: 'unavailable',
      warnings,
    };
  }

  const fallbackPath = path.posix.join('agent', fallback.agentId);
  if (requested.kind === 'absent') {
    warn(
      'missing_agent_id',
      fallbackPath,
      `agentId ${received}: se ejecuta el agente por defecto "${fallback.agentId}".`,
    );
    return {
      definition: fallback,
      agentId: fallback.agentId,
      requestedAgentId: requested.value,
      source: 'default_absent',
      warnings,
    };
  }

  if (requested.kind === 'malformed') {
    // Requirement 16.2: separadores de ruta, recorrido o caracteres fuera de
    // snake_case se tratan como desconocidos, nunca como una ruta.
    warn(
      'malformed_agent_id',
      fallbackPath,
      `agentId ${received} no tiene la forma de un identificador de agente: se trata como desconocido y se ejecuta el agente por defecto "${fallback.agentId}".`,
    );
    return {
      definition: fallback,
      agentId: fallback.agentId,
      requestedAgentId: requested.value,
      source: 'default_malformed',
      warnings,
    };
  }

  warn(
    'unknown_agent_id',
    fallbackPath,
    `agentId ${received} no está en el catálogo: se ejecuta el agente por defecto "${fallback.agentId}".`,
  );
  return {
    definition: fallback,
    agentId: fallback.agentId,
    requestedAgentId: requested.value,
    source: 'default_unknown',
    warnings,
  };
}

/* ────────────────────────────────────────────────────────── */
/*  Plantilla de prompt y esquema de salida                    */
/* ────────────────────────────────────────────────────────── */

/** Motivos por los que no se puede entregar una fuente de un agente. */
export type AgentSourceErrorCode =
  | 'unknown_agent'
  | 'missing_source_file'
  | 'unreadable_source_file'
  | 'empty_source_file'
  | 'source_file_too_large'
  | 'invalid_schema_json';

/**
 * Error explícito de lectura de una fuente del agente: nombra el agentId y el
 * archivo por su ruta relativa a la raíz del repositorio, nunca por su ruta
 * absoluta (Requirements 7.10, 16.3).
 */
export class AgentSourceError extends Error {
  constructor(
    readonly code: AgentSourceErrorCode,
    readonly agentId: string,
    readonly relativePath: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentSourceError';
  }
}

/** Contenido de un archivo de fuente del agente, con su identidad. */
export interface AgentSourceFile {
  agentId: string;
  /** Nombre declarado en el manifiesto, `promptFile` o `schemaFile`. */
  fileName: string;
  /** Ruta relativa para mensajes, `agent/<agentId>/<fileName>`. */
  relativePath: string;
  /** Contenido del archivo, con los saltos de línea normalizados a `\n`. */
  text: string;
}

/** Esquema de salida, con su texto literal y su forma analizada. */
export interface AgentSchemaSource extends AgentSourceFile {
  json: unknown;
}

/**
 * Lee un archivo de la carpeta del agente cuya ruta proviene de la entrada de
 * catálogo (Requirement 16.1) y falla con un error que nombra el archivo si no
 * existe, no se puede leer, está vacío o supera su límite de tamaño (7.9, 7.10).
 */
function readAgentSourceFile(
  definition: ResolvedAgentDefinition,
  filePath: string,
  fileName: string,
  maxBytes: number,
): AgentSourceFile {
  const { agentId } = definition;
  const relativePath = path.posix.join('agent', agentId, fileName);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new AgentSourceError(
        'missing_source_file',
        agentId,
        relativePath,
        `El agente "${agentId}" no tiene el archivo "${relativePath}".`,
      );
    }
    throw new AgentSourceError(
      'unreadable_source_file',
      agentId,
      relativePath,
      `El archivo "${relativePath}" del agente "${agentId}" no se pudo leer: ${errorMessage(error)}.`,
    );
  }

  if (!stat.isFile()) {
    throw new AgentSourceError(
      'missing_source_file',
      agentId,
      relativePath,
      `El archivo "${relativePath}" del agente "${agentId}" no es un archivo.`,
    );
  }

  if (stat.size > maxBytes) {
    throw new AgentSourceError(
      'source_file_too_large',
      agentId,
      relativePath,
      `El archivo "${relativePath}" del agente "${agentId}" ocupa ${stat.size} bytes y supera el límite de ${maxBytes} bytes.`,
    );
  }

  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  } catch (error) {
    throw new AgentSourceError(
      'unreadable_source_file',
      agentId,
      relativePath,
      `El archivo "${relativePath}" del agente "${agentId}" no se pudo leer: ${errorMessage(error)}.`,
    );
  }

  if (text.trim().length === 0) {
    throw new AgentSourceError(
      'empty_source_file',
      agentId,
      relativePath,
      `El archivo "${relativePath}" del agente "${agentId}" está vacío.`,
    );
  }

  return { agentId, fileName, relativePath, text };
}

/**
 * Plantilla de prompt del agente, leída desde `definition.paths.promptPath`
 * (Requirements 7.9, 7.10, 16.1).
 */
export function readAgentPromptTemplate(definition: ResolvedAgentDefinition): AgentSourceFile {
  return readAgentSourceFile(
    definition,
    definition.paths.promptPath,
    definition.manifest.promptFile,
    MAX_PROMPT_BYTES,
  );
}

/**
 * Esquema de salida del agente, leído desde `definition.paths.schemaPath`. Se
 * devuelve el texto literal, que es lo que sustituye a `{{schema}}`, junto con
 * su forma analizada (Requirements 7.1, 7.9, 7.10, 16.1).
 */
export function readAgentSchema(definition: ResolvedAgentDefinition): AgentSchemaSource {
  const source = readAgentSourceFile(
    definition,
    definition.paths.schemaPath,
    definition.manifest.schemaFile,
    MAX_SCHEMA_BYTES,
  );

  let json: unknown;
  try {
    json = JSON.parse(source.text);
  } catch (error) {
    throw new AgentSourceError(
      'invalid_schema_json',
      source.agentId,
      source.relativePath,
      `El archivo de esquema "${source.relativePath}" del agente "${source.agentId}" no contiene JSON válido: ${errorMessage(error)}.`,
    );
  }

  return { ...source, json };
}

/* ────────────────────────────────────────────────────────── */
/*  Fuentes inline del agente                                  */
/* ────────────────────────────────────────────────────────── */

/**
 * La carga de fuentes inline vive en `agentInlineSources.ts` y se reexporta
 * aquí para que los consumidores del registro tengan un único punto de entrada
 * (Requirements 6.1 a 6.7).
 */
export {
  AgentInlineSourcesError,
  INLINE_SOURCE_TARGET_ROOT,
  INLINE_SOURCE_TYPE,
  isPathContained,
  loadAgentInlineSources,
} from './agentInlineSources.ts';
export type {
  AgentInlineSource,
  AgentInlineSourceWarningCode,
  AgentInlineSourcesErrorCode,
  AgentInlineSourcesResult,
} from './agentInlineSources.ts';

/* ────────────────────────────────────────────────────────── */
/*  Caché por marca de tiempo                                  */
/* ────────────────────────────────────────────────────────── */

/** Catálogo descubierto y cacheado, junto con la marca de tiempo que lo fija. */
export interface AgentCatalogSnapshot {
  folders: DiscoveredAgentFolder[];
  /**
   * Definiciones válidas tras la validación del manifiesto, ya ordenadas según
   * el orden total del catálogo (Requirements 1.7, 1.8).
   */
  definitions: ResolvedAgentDefinition[];
  /**
   * Único agente por defecto del catálogo, resuelto por precedencia, o `null`
   * cuando no hay entradas válidas (Requirements 3.4, 3.8).
   */
  defaultAgentId: string | null;
  /** Regla de precedencia que designó el agente por defecto. */
  defaultAgentSource: DefaultAgentSource;
  warnings: AgentRegistryWarning[];
  /** Marca de tiempo de modificación de `agent/` con la que se construyó. */
  dirMtimeMs: number | null;
  /** Momento de construcción, en milisegundos. */
  builtAtMs: number;
  /** Manifiestos leídos durante la construcción. */
  manifestReads: number;
  /** Duración de la construcción, en milisegundos. */
  durationMs: number;
  /** Último error de enumeración observado, o `null`. */
  enumerationError: string | null;
}

const EMPTY_SNAPSHOT: AgentCatalogSnapshot = {
  folders: [],
  definitions: [],
  defaultAgentId: null,
  defaultAgentSource: 'empty_catalog',
  warnings: [],
  dirMtimeMs: null,
  builtAtMs: 0,
  manifestReads: 0,
  durationMs: 0,
  enumerationError: null,
};

export interface AgentRegistryOptions {
  /** Raíz del catálogo; por defecto `agent/` del directorio de trabajo. */
  agentsDir?: string;
  /** Destino de las advertencias; `null` las silencia. */
  logger?: AgentRegistryLogger | null;
}

export interface AgentRegistry {
  readonly agentsDir: string;
  /**
   * Devuelve el catálogo descubierto, reconstruyéndolo solo cuando cambia la
   * marca de tiempo de modificación de `agent/` (Requirements 1.9, 1.10).
   */
  getCatalog(): AgentCatalogSnapshot;
  /** Lista el catálogo vigente en su orden total (Requirements 1.7, 1.8). */
  listAgents(): ResolvedAgentDefinition[];
  /**
   * Devuelve la definición cuyo agentId coincide de forma exacta con el valor
   * recibido, o `null` si no hay coincidencia (Requirements 5.1, 16.1).
   */
  getAgentById(agentId: unknown): ResolvedAgentDefinition | null;
  /** Definición del agente por defecto, o `null` si el catálogo está vacío (3.4, 3.8). */
  getDefaultAgent(): ResolvedAgentDefinition | null;
  /**
   * Único agente por defecto del catálogo vigente: el mismo valor en todas las
   * peticiones mientras el catálogo no se reconstruye (Requirements 3.4, 3.5).
   */
  getDefaultAgentId(): string | null;
  /**
   * Resuelve el `agentId` recibido en una petición: coincidencia exacta, o
   * agente por defecto con advertencia (Requirements 5.1, 5.2, 16.1, 16.2).
   */
  resolveAgent(receivedAgentId: unknown): AgentResolution;
  /**
   * Plantilla de prompt del agente indicado, leída desde la ruta de su entrada
   * de catálogo. Lanza `AgentSourceError` si el agente no existe o el archivo no
   * se puede entregar (Requirements 7.9, 7.10, 16.1).
   */
  getPromptTemplate(agentId: string): AgentSourceFile;
  /**
   * Esquema de salida del agente indicado, con su texto literal y su forma
   * analizada. Lanza `AgentSourceError` en las mismas condiciones (7.1, 7.10).
   */
  getSchema(agentId: string): AgentSchemaSource;
  /**
   * Fuentes inline del agente indicado, con destino `/.agents`: se recorre solo
   * su carpeta y el contenido se lee aquí, durante la resolución de una
   * ejecución (Requirements 6.1, 6.2, 6.3, 6.4). Lanza `AgentSourceError` si el
   * agente no está en el catálogo y `AgentInlineSourcesError` si el conjunto
   * queda vacío tras las exclusiones y los límites (Requirement 6.7).
   */
  getInlineSources(agentId: string): AgentInlineSourcesResult;
  /** Fuerza una reconstrucción en la siguiente lectura del catálogo. */
  invalidate(): void;
  /** Reconstruye el catálogo ahora mismo y lo devuelve. */
  refresh(): AgentCatalogSnapshot;
}

function readDirMtimeMs(agentsDir: string): number | null {
  try {
    return fs.statSync(agentsDir).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Crea un registro con su propia caché. Cada instancia es independiente, de
 * modo que las pruebas pueden apuntar a un catálogo temporal sin tocar el
 * registro del servidor.
 */
export function createAgentRegistry(options: AgentRegistryOptions = {}): AgentRegistry {
  const agentsDir = options.agentsDir ?? DEFAULT_AGENTS_DIR;
  const logger = options.logger === undefined ? consoleWarningLogger : options.logger;

  let snapshot: AgentCatalogSnapshot | null = null;

  const build = (): AgentCatalogSnapshot => {
    // La marca de tiempo se lee antes del recorrido: si `agent/` cambia
    // durante la construcción, la siguiente lectura vuelve a reconstruir.
    const dirMtimeMs = readDirMtimeMs(agentsDir);
    const result = discoverAgentFolders(agentsDir, logger);

    if (result.enumerationError !== null) {
      // Requirement 4.8: se conserva el catálogo vigente y solo se anota el error.
      const previous = snapshot ?? EMPTY_SNAPSHOT;
      snapshot = {
        ...previous,
        warnings: result.warnings,
        dirMtimeMs,
        enumerationError: result.enumerationError,
      };
      return snapshot;
    }

    // Requirements 2.5, 2.8, 2.9: las carpetas inválidas se omiten con una
    // advertencia y las válidas siguen publicándose.
    const validation = validateAgentFolders(result.folders, logger);

    // Requirements 1.7, 1.8: el catálogo se publica con su orden total.
    const definitions = sortAgentDefinitions(validation.definitions);
    // Requirement 3.6: el agente por defecto se resuelve de nuevo en cada
    // reconstrucción, sobre las entradas válidas ya ordenadas.
    const resolvedDefault = resolveDefaultAgent(definitions, logger);

    snapshot = {
      folders: result.folders,
      definitions,
      defaultAgentId: resolvedDefault.defaultAgentId,
      defaultAgentSource: resolvedDefault.source,
      warnings: [...result.warnings, ...validation.warnings, ...resolvedDefault.warnings],
      dirMtimeMs,
      builtAtMs: Date.now(),
      manifestReads: result.manifestReads,
      durationMs: result.durationMs,
      enumerationError: null,
    };
    return snapshot;
  };

  /** Catálogo vigente, reconstruido solo si `agent/` cambió (1.9, 1.10). */
  const current = (): AgentCatalogSnapshot => {
    if (snapshot === null) return build();
    const dirMtimeMs = readDirMtimeMs(agentsDir);
    if (dirMtimeMs !== snapshot.dirMtimeMs) return build();
    return snapshot;
  };

  /** Definición exigida para leer una fuente: si no existe, error explícito. */
  const requireDefinition = (agentId: string): ResolvedAgentDefinition => {
    const definition = current().definitions.find((entry) => entry.agentId === agentId);
    if (definition === undefined) {
      throw new AgentSourceError(
        'unknown_agent',
        typeof agentId === 'string' ? agentId : String(agentId),
        'agent',
        `El agente solicitado no está en el catálogo: ${describeRequestedAgentId(agentId)}.`,
      );
    }
    return definition;
  };

  return {
    agentsDir,
    getCatalog: current,
    listAgents: () => current().definitions,
    getAgentById: (agentId) => {
      const requested = classifyRequestedAgentId(agentId);
      if (requested.kind !== 'candidate') return null;
      // Requirement 16.1: coincidencia exacta contra los ids descubiertos.
      return current().definitions.find((entry) => entry.agentId === requested.value) ?? null;
    },
    getDefaultAgent: () => {
      const snapshot = current();
      if (snapshot.defaultAgentId === null) return null;
      return (
        snapshot.definitions.find((entry) => entry.agentId === snapshot.defaultAgentId) ?? null
      );
    },
    // Requirement 3.5: mismo valor en todas las peticiones sin reconstrucción.
    getDefaultAgentId: () => current().defaultAgentId,
    resolveAgent: (receivedAgentId) => {
      const snapshot = current();
      return resolveAgentSelection(
        snapshot.definitions,
        snapshot.defaultAgentId,
        receivedAgentId,
        logger,
      );
    },
    getPromptTemplate: (agentId) => readAgentPromptTemplate(requireDefinition(agentId)),
    getSchema: (agentId) => readAgentSchema(requireDefinition(agentId)),
    // Requirement 6.4: el contenido de los archivos de ejecución se lee solo
    // aquí, cuando una ejecución resuelve su agente.
    getInlineSources: (agentId) => loadAgentInlineSources(requireDefinition(agentId), logger),
    invalidate: () => {
      snapshot = null;
    },
    refresh: () => build(),
  };
}

/** Registro del servidor, apuntando a `agent/` del directorio de trabajo. */
export const agentRegistry: AgentRegistry = createAgentRegistry();
