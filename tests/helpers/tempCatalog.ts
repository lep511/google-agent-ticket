import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

/**
 * Utilidad para materializar catálogos de agentes en un directorio temporal.
 *
 * Cada catálogo se crea bajo un directorio propio de `os.tmpdir()` y se borra
 * automáticamente tras cada prueba: basta con importar este módulo para que el
 * `afterEach` de limpieza quede registrado.
 *
 * Diseño → Testing Strategy: "los generadores cubren catálogos aleatorios en
 * disco temporal".
 */

/** Contenido de un archivo del agente: texto, binario o JSON serializable. */
export type FileContent = string | Buffer;

export interface AgentFolderSpec {
  /**
   * Contenido de `manifest.json`. Un objeto se serializa con `JSON.stringify`;
   * una cadena se escribe literalmente (útil para JSON malformado).
   * `null` omite el archivo por completo.
   */
  manifest?: unknown | string | null;
  /**
   * Archivos adicionales de la carpeta del agente, con rutas relativas
   * (se admiten subcarpetas con `/`). Sobrescriben los valores por defecto.
   */
  files?: Record<string, FileContent>;
  /**
   * Cuando es `false`, no se escriben los archivos por defecto
   * (`agent.yaml`, `AGENTS.md`, `requirements.txt`, `prompt.md`,
   * `output.schema.json`). Por defecto `true`.
   */
  withDefaultFiles?: boolean;
}

/** Especificación de un catálogo: nombre de carpeta → contenido. */
export type CatalogSpec = Record<string, AgentFolderSpec>;

export interface TempCatalog {
  /** Directorio raíz temporal (equivalente a la raíz del repositorio). */
  readonly root: string;
  /** Directorio que hace de `agent/`. */
  readonly agentsDir: string;
  /** Ruta absoluta de la carpeta de un agente. */
  agentDir(folderName: string): string;
  /** Ruta absoluta de un archivo dentro de la carpeta de un agente. */
  filePath(folderName: string, relativePath: string): string;
  /** Añade o reemplaza una carpeta de agente después de crear el catálogo. */
  writeAgent(folderName: string, spec?: AgentFolderSpec): string;
  /** Escribe un archivo suelto relativo a `agentsDir`. */
  writeLooseFile(relativePath: string, content: FileContent): string;
  /** Elimina una carpeta de agente del catálogo. */
  removeAgent(folderName: string): void;
  /** Borra el catálogo del disco. Idempotente. */
  cleanup(): void;
}

export const DEFAULT_PROMPT_FILE = 'prompt.md';
export const DEFAULT_SCHEMA_FILE = 'output.schema.json';

const LUCIDE_SAFE_ICON = 'LineChart';

const createdCatalogs = new Set<TempCatalog>();

/** Manifiesto mínimo válido para la carpeta indicada. */
export function validManifest(
  folderName: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: folderName,
    name: `Agente ${folderName}`,
    tagline: `Resumen de una línea de ${folderName}`,
    description: `Descripción larga del agente ${folderName}.`,
    icon: LUCIDE_SAFE_ICON,
    inputMode: 'ticker',
    inputPlaceholder: 'AAPL',
    actionLabel: 'Analyze',
    outputRenderer: 'financial_report',
    ...overrides,
  };
}

/** Archivos por defecto de una carpeta de agente válida. */
export function defaultAgentFiles(folderName: string): Record<string, string> {
  return {
    'agent.yaml': `id: ${folderName}\nbase_agent: antigravity-preview-05-2026\n`,
    'AGENTS.md': `# ${folderName}\n\nInstrucciones de prueba.\n`,
    'requirements.txt': 'requests\n',
    [DEFAULT_PROMPT_FILE]: 'Entrada: {{input}}\nInstrucción: {{instruction}}\nEsquema: {{schema}}\n',
    [DEFAULT_SCHEMA_FILE]: JSON.stringify({ type: 'object', properties: {} }, null, 2),
  };
}

function writeFileDeep(target: string, content: FileContent): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content as never);
}

function materializeAgent(agentsDir: string, folderName: string, spec: AgentFolderSpec): string {
  const dir = path.join(agentsDir, folderName);
  fs.mkdirSync(dir, { recursive: true });

  const files: Record<string, FileContent> = {
    ...(spec.withDefaultFiles === false ? {} : defaultAgentFiles(folderName)),
    ...(spec.files ?? {}),
  };

  const manifest = spec.manifest === undefined ? validManifest(folderName) : spec.manifest;
  if (manifest !== null) {
    files['manifest.json'] =
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2);
  }

  for (const [relativePath, content] of Object.entries(files)) {
    writeFileDeep(path.join(dir, relativePath), content);
  }

  return dir;
}

/**
 * Crea un catálogo temporal. Devuelve rutas y utilidades de mutación; la
 * limpieza es automática tras cada prueba, pero `cleanup()` está disponible
 * para pruebas que necesiten liberarlo antes.
 */
export function createTempCatalog(spec: CatalogSpec = {}): TempCatalog {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tickr-agents-'));
  const agentsDir = path.join(root, 'agent');
  fs.mkdirSync(agentsDir, { recursive: true });

  for (const [folderName, folderSpec] of Object.entries(spec)) {
    materializeAgent(agentsDir, folderName, folderSpec);
  }

  const catalog: TempCatalog = {
    root,
    agentsDir,
    agentDir: (folderName) => path.join(agentsDir, folderName),
    filePath: (folderName, relativePath) => path.join(agentsDir, folderName, relativePath),
    writeAgent: (folderName, folderSpec = {}) =>
      materializeAgent(agentsDir, folderName, folderSpec),
    writeLooseFile: (relativePath, content) => {
      const target = path.join(agentsDir, relativePath);
      writeFileDeep(target, content);
      return target;
    },
    removeAgent: (folderName) => {
      fs.rmSync(path.join(agentsDir, folderName), { recursive: true, force: true });
    },
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      createdCatalogs.delete(catalog);
    },
  };

  createdCatalogs.add(catalog);
  return catalog;
}

/** Borra todos los catálogos temporales creados hasta el momento. */
export function cleanupTempCatalogs(): void {
  for (const catalog of [...createdCatalogs]) {
    catalog.cleanup();
  }
}

// `globals: false`, así que la limpieza se registra explícitamente al importar.
afterEach(() => {
  cleanupTempCatalogs();
});
