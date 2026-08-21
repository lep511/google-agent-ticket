/**
 * Fuentes inline de la carpeta de un agente.
 *
 * Este módulo traslada la lógica recursiva que vivía en `loadAgentFiles`
 * dentro de `server.ts` y la acota a la carpeta del agente resuelto: recorre
 * únicamente `agent/<agentId>/`, preserva la ruta relativa de cada archivo
 * bajo el destino `/.agents` y aplica las exclusiones y los límites del
 * catálogo.
 *
 * Reglas que aplica:
 *  - Recorrido recursivo de la carpeta del agente hasta 5 niveles de
 *    subcarpetas y 200 archivos; lo que excede un límite se descarta con una
 *    advertencia que indica la ruta y el límite ().
 *  - Los archivos de metadata del servidor no se suben: `manifest.json` y los
 *    nombres declarados en `promptFile` y `schemaFile` del manifiesto, por
 *    comparación exacta de nombre ().
 *  - Todo archivo cuya ruta resuelta quede fuera de la carpeta del agente se
 *    excluye. Como el recorrido parte de la carpeta del agente, los archivos
 *    sueltos de la raíz de `agent/` y los de otras carpetas de agente quedan
 *    fuera por construcción; los enlaces simbólicos se resuelven y se
 *    descartan cuando apuntan fuera ().
 *  - El contenido se lee solo aquí, durante la resolución de una ejecución: el
 *    descubrimiento del catálogo no llama a este módulo ().
 *  - Un archivo ilegible o mayor de 1 MB se omite con una advertencia que
 *    indica su ruta relativa y el motivo o su tamaño, conservando el resto de
 *    las fuentes (Requirements 6.5, 6.6).
 *  - Si el conjunto queda vacío tras las exclusiones y los límites, se falla
 *    con un error explícito que nombra el agentId ().
 *
 
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AgentRegistryLogger, AgentRegistryWarning } from './agentRegistry.ts';
import {
  MANIFEST_FILE_NAME,
  MAX_RUNTIME_DIR_DEPTH,
  MAX_RUNTIME_FILE_BYTES,
  MAX_RUNTIME_FILE_COUNT,
  type ResolvedAgentDefinition,
} from './agentTypes.ts';

/* ────────────────────────────────────────────────────────── */
/*  Constantes                                                 */
/* ────────────────────────────────────────────────────────── */

/** Destino de las fuentes inline en el entorno remoto (). */
export const INLINE_SOURCE_TARGET_ROOT = '/.agents';

/** Tipo de fuente que espera `agentClient` / `agentClientPerseus`. */
export const INLINE_SOURCE_TYPE = 'inline';

/* ────────────────────────────────────────────────────────── */
/*  Advertencias y errores                                     */
/* ────────────────────────────────────────────────────────── */

/** Motivos por los que un archivo de la carpeta del agente no se sube. */
export type AgentInlineSourceWarningCode =
  /** Subcarpeta más allá de los 5 niveles admitidos (6.1). */
  | 'depth_limit_exceeded'
  /** Archivo más allá de los 200 admitidos (6.1). */
  | 'file_limit_exceeded'
  /** Ruta resuelta fuera de la carpeta del agente, enlaces incluidos (6.3). */
  | 'path_outside_agent_folder'
  /** Error del sistema de archivos al recorrer o leer (6.5). */
  | 'unreadable_runtime_file'
  /** Archivo mayor de 1 MB (6.6). */
  | 'runtime_file_too_large';

/** Único motivo por el que la carga de fuentes inline falla (). */
export type AgentInlineSourcesErrorCode = 'empty_inline_sources';

/**
 * Error explícito de carga de fuentes inline: nombra el agentId y describe la
 * carpeta por su ruta relativa a la raíz del repositorio, nunca por su ruta
 * absoluta (Requirements 6.7, 16.3).
 */
export class AgentInlineSourcesError extends Error {
  constructor(
    readonly code: AgentInlineSourcesErrorCode,
    readonly agentId: string,
    readonly relativePath: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentInlineSourcesError';
  }
}

/* ────────────────────────────────────────────────────────── */
/*  Resultado                                                  */
/* ────────────────────────────────────────────────────────── */

/**
 * Fuente inline lista para `agentClient`: `type`, `content` y `target` son los
 * campos que consume el cliente remoto; `relativePath` y `bytes` acompañan al
 * registro y a las pruebas.
 */
export interface AgentInlineSource {
  type: typeof INLINE_SOURCE_TYPE;
  content: string;
  /** Destino remoto, `/.agents/<ruta relativa>`. */
  target: string;
  /** Ruta relativa a la carpeta del agente, en formato posix. */
  relativePath: string;
  /** Tamaño del archivo en bytes. */
  bytes: number;
}

export interface AgentInlineSourcesResult {
  agentId: string;
  /** Fuentes inline, ordenadas por su ruta relativa; nunca vacío. */
  sources: AgentInlineSource[];
  warnings: AgentRegistryWarning[];
  /** Suma de los tamaños de las fuentes incluidas, en bytes. */
  totalBytes: number;
}

/* ────────────────────────────────────────────────────────── */
/*  Utilidades internas                                        */
/* ────────────────────────────────────────────────────────── */

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Comprueba que `candidate` queda dentro de `root`. Ambas rutas deben venir ya
 * resueltas con `fs.realpathSync`, de modo que la comprobación cubre los
 * enlaces simbólicos que apuntan fuera de la carpeta del agente (6.3).
 */
export function isPathContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '') return false;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** Ruta relativa a la raíz del repositorio, para mensajes de advertencia. */
function repoRelativePath(agentId: string, relativePath: string): string {
  return relativePath === ''
    ? path.posix.join('agent', agentId)
    : path.posix.join('agent', agentId, relativePath);
}

/* ────────────────────────────────────────────────────────── */
/*  Carga de fuentes inline                                    */
/* ────────────────────────────────────────────────────────── */

/**
 * Recorre la carpeta del agente resuelto y devuelve sus fuentes inline con
 * destino `/.agents` (Requirements 6.1, 6.2, 6.3).
 *
 * Se llama únicamente al resolver una ejecución: ninguna petición al endpoint
 * de catálogo pasa por aquí, así que el catálogo no lee el contenido de los
 * archivos de ejecución ().
 *
 * Lanza `AgentInlineSourcesError` si el conjunto queda vacío tras aplicar las
 * exclusiones y los límites ().
 */
export function loadAgentInlineSources(
  definition: ResolvedAgentDefinition,
  logger: AgentRegistryLogger | null = null,
): AgentInlineSourcesResult {
  const { agentId } = definition;
  const warnings: AgentRegistryWarning[] = [];
  const sources: AgentInlineSource[] = [];

  const warn = (
    code: AgentInlineSourceWarningCode,
    relativePath: string,
    message: string,
  ): void => {
    const warning: AgentRegistryWarning = {
      code,
      relativePath: repoRelativePath(agentId, relativePath),
      message,
    };
    warnings.push(warning);
    logger?.(warning);
  };

  /**
   *  se excluyen `manifest.json` y los nombres declarados en
   * `promptFile` y `schemaFile`, por comparación exacta de nombre en cualquier
   * nivel de la carpeta, igual que hacía `loadAgentFiles`.
   */
  const excludedFileNames = new Set<string>([
    MANIFEST_FILE_NAME,
    definition.manifest.promptFile,
    definition.manifest.schemaFile,
  ]);

  // La raíz se resuelve una vez: la contención de cada archivo se comprueba
  // contra la carpeta real del agente (6.3).
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(definition.paths.dir);
  } catch (error) {
    warn(
      'unreadable_runtime_file',
      '',
      `La carpeta del agente "${agentId}" no se pudo recorrer: ${errorMessage(error)}.`,
    );
    throw emptyInlineSourcesError(agentId, warnings);
  }

  const walk = (dir: string, relativeDir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      warn(
        'unreadable_runtime_file',
        relativeDir,
        `Carpeta "${repoRelativePath(agentId, relativeDir)}" omitida por un error del sistema de archivos: ${errorMessage(error)}.`,
      );
      return;
    }

    // Orden por nombre: el recorte a 200 archivos y el conjunto resultante son
    // deterministas entre ejecuciones.
    const names = entries
      .map((entry) => entry.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    for (const name of names) {
      const fullPath = path.join(dir, name);
      const relativePath = relativeDir === '' ? name : path.posix.join(relativeDir, name);

      // `statSync` sigue los enlaces simbólicos: decide entre carpeta y archivo
      // por el destino, no por el enlace.
      let stat: fs.Stats;
      let realPath: string;
      try {
        stat = fs.statSync(fullPath);
        realPath = fs.realpathSync(fullPath);
      } catch (error) {
        warn(
          'unreadable_runtime_file',
          relativePath,
          `Archivo "${repoRelativePath(agentId, relativePath)}" omitido por un error del sistema de archivos: ${errorMessage(error)}.`,
        );
        continue;
      }

      //  la ruta resuelta debe quedar dentro de la carpeta del
      // agente; un enlace que escape se descarta aquí.
      if (!isPathContained(realRoot, realPath)) {
        warn(
          'path_outside_agent_folder',
          relativePath,
          `Archivo "${repoRelativePath(agentId, relativePath)}" omitido: su ruta resuelta queda fuera de la carpeta del agente "${agentId}".`,
        );
        continue;
      }

      if (stat.isDirectory()) {
        //  profundidad máxima de 5 niveles de subcarpetas.
        if (depth + 1 > MAX_RUNTIME_DIR_DEPTH) {
          warn(
            'depth_limit_exceeded',
            relativePath,
            `Carpeta "${repoRelativePath(agentId, relativePath)}" omitida: se supera el límite de ${MAX_RUNTIME_DIR_DEPTH} niveles de subcarpetas.`,
          );
          continue;
        }
        walk(fullPath, relativePath, depth + 1);
        continue;
      }

      if (!stat.isFile()) {
        warn(
          'unreadable_runtime_file',
          relativePath,
          `Entrada "${repoRelativePath(agentId, relativePath)}" omitida: no es un archivo regular.`,
        );
        continue;
      }

      //  metadata del servidor, nunca se sube.
      if (excludedFileNames.has(name)) continue;

      //  máximo de 200 archivos por agente.
      if (sources.length >= MAX_RUNTIME_FILE_COUNT) {
        warn(
          'file_limit_exceeded',
          relativePath,
          `Archivo "${repoRelativePath(agentId, relativePath)}" omitido: se supera el límite de ${MAX_RUNTIME_FILE_COUNT} archivos por agente.`,
        );
        continue;
      }

      //  1 MB por archivo.
      if (stat.size > MAX_RUNTIME_FILE_BYTES) {
        warn(
          'runtime_file_too_large',
          relativePath,
          `Archivo "${repoRelativePath(agentId, relativePath)}" omitido: ocupa ${stat.size} bytes y supera el límite de ${MAX_RUNTIME_FILE_BYTES} bytes.`,
        );
        continue;
      }

      //  un archivo ilegible no invalida el resto.
      let content: string;
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch (error) {
        warn(
          'unreadable_runtime_file',
          relativePath,
          `Archivo "${repoRelativePath(agentId, relativePath)}" omitido por un error del sistema de archivos: ${errorMessage(error)}.`,
        );
        continue;
      }

      sources.push({
        type: INLINE_SOURCE_TYPE,
        content,
        //  destino `/.agents` preservando la ruta relativa.
        target: path.posix.join(INLINE_SOURCE_TARGET_ROOT, relativePath),
        relativePath,
        bytes: stat.size,
      });
    }
  };

  walk(definition.paths.dir, '', 0);

  //  sin fuentes inline no hay ejecución posible.
  if (sources.length === 0) throw emptyInlineSourcesError(agentId, warnings);

  return {
    agentId,
    sources,
    warnings,
    totalBytes: sources.reduce((total, source) => total + source.bytes, 0),
  };
}

/** Error explícito que nombra el agentId cuando no queda ninguna fuente (6.7). */
function emptyInlineSourcesError(
  agentId: string,
  warnings: readonly AgentRegistryWarning[],
): AgentInlineSourcesError {
  const discarded =
    warnings.length === 0
      ? ''
      : ` ${warnings.length} entries were discarded due to exclusions or limits.`;
  return new AgentInlineSourcesError(
    'empty_inline_sources',
    agentId,
    path.posix.join('agent', agentId),
    `Agent "${agentId}" has no runtime files to upload to the remote environment.${discarded}`,
  );
}
