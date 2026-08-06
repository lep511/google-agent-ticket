/**
 * Ubicación única de los archivos de depuración que escribe el servidor.
 *
 * Todo artefacto de depuración vive bajo `debug/` en la raíz del proyecto, en
 * lugar de esparcirse por ella: el `debug_delta.log` de los clientes remotos y
 * la copia heredada `sub_agents_debug_<entrada>.txt` de cada ejecución. Los logs
 * de ejecución con nombre por `runId` siguen en `run_logs/`, porque se sirven
 * como estáticos (ver `runLogNaming.ts`).
 *
 * Escribir depuración nunca debe tumbar una ejecución, así que los fallos de
 * escritura se registran en consola y se descartan.
 */

import fs from 'fs';
import path from 'path';

/** Carpeta, relativa a la raíz del proyecto, de todos los archivos de depuración. */
export const DEBUG_DIR_NAME = 'debug';

/** Registro de deltas crudos de los clientes de agentes remotos. */
export const DELTA_LOG_FILE_NAME = 'debug_delta.log';

/** Prefijo de la copia heredada del log de la última ejecución por entrada. */
export const SUB_AGENTS_DEBUG_PREFIX = 'sub_agents_debug';

/** Ruta absoluta de la carpeta de depuración. */
export function debugDirPath(): string {
  return path.join(process.cwd(), DEBUG_DIR_NAME);
}

/**
 * Ruta absoluta de un archivo de depuración, creando la carpeta si falta. El
 * nombre se reduce a su último segmento para que ningún valor derivado de la
 * entrada del usuario pueda salir de la carpeta.
 */
export function debugFilePath(fileName: string): string {
  const dir = debugDirPath();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, path.basename(fileName));
}

/** Nombre de la copia heredada del log de una entrada ya saneada. */
export function subAgentsDebugFileName(inputSlug: string): string {
  return `${SUB_AGENTS_DEBUG_PREFIX}_${inputSlug}.txt`;
}

/** Añade una línea a un archivo de depuración; un fallo no interrumpe la ejecución. */
export function appendDebugFile(fileName: string, contents: string): void {
  try {
    fs.appendFileSync(debugFilePath(fileName), contents, 'utf-8');
  } catch (e) {
    console.warn(`[debug] No se pudo escribir en ${DEBUG_DIR_NAME}/${fileName}:`, e);
  }
}

/** Reescribe un archivo de depuración; un fallo no interrumpe la ejecución. */
export function writeDebugFile(fileName: string, contents: string): void {
  try {
    fs.writeFileSync(debugFilePath(fileName), contents, 'utf-8');
  } catch (e) {
    console.warn(`[debug] No se pudo escribir en ${DEBUG_DIR_NAME}/${fileName}:`, e);
  }
}
