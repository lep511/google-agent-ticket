import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

import {
  AGENTS_FILE_NAME,
  DEFAULT_PROMPT_FILE,
  DEFAULT_SCHEMA_FILE,
  MANIFEST_FILE_NAME,
  type AllowedIconName,
  type InputMode,
  type OutputRenderer,
} from '../../server/lib/agent/agentTypes.ts';

/**
 * Materializes agent catalogs in a temporary directory.
 *
 * Every catalog lives under its own directory inside `os.tmpdir()` and is
 * removed after each test: importing this module is enough to register the
 * cleanup `afterEach`.
 *
 * Design → Testing Strategy: "the generators cover random catalogs on a
 * temporary disk".
 *
 * The default folder holds exactly the four files the server requires of a real
 * agent (`manifest.json`, `AGENTS.md`, the prompt file and the schema file), and
 * the file names come from the production constants, so a rename on the server
 * side cannot leave this helper behind.
 */

/** Content of an agent file: text or binary. */
export type FileContent = string | Buffer;

export interface AgentFolderSpec {
  /**
   * Content of `manifest.json`. An object is serialized with `JSON.stringify`;
   * a string is written verbatim (handy for malformed JSON). `null` omits the
   * file entirely.
   */
  manifest?: unknown | string | null;
  /**
   * Extra files for the agent folder, keyed by relative path (subfolders with
   * `/` are supported). They override the defaults.
   */
  files?: Record<string, FileContent>;
  /**
   * When `false`, the default files (`AGENTS.md`, the prompt file and the schema
   * file) are not written. Defaults to `true`.
   */
  withDefaultFiles?: boolean;
}

/** Catalog specification: folder name → content. */
export type CatalogSpec = Record<string, AgentFolderSpec>;

export interface TempCatalog {
  /** Temporary root directory (stands in for the repository root). */
  readonly root: string;
  /** Directory that plays the role of `agent/`. */
  readonly agentsDir: string;
  /** Absolute path of an agent folder. */
  agentDir(folderName: string): string;
  /** Absolute path of a file inside an agent folder. */
  filePath(folderName: string, relativePath: string): string;
  /** Adds or replaces an agent folder after the catalog was created. */
  writeAgent(folderName: string, spec?: AgentFolderSpec): string;
  /** Writes a loose file relative to `agentsDir`. */
  writeLooseFile(relativePath: string, content: FileContent): string;
  /** Removes an agent folder from the catalog. */
  removeAgent(folderName: string): void;
  /** Deletes the catalog from disk. Idempotent. */
  cleanup(): void;
}

export { DEFAULT_PROMPT_FILE, DEFAULT_SCHEMA_FILE };

/**
 * Field values of the default manifest, typed against the production unions so
 * `tsc --noEmit` fails if any of them ever leaves its allow-list.
 */
const DEFAULT_ICON: AllowedIconName = 'LineChart';
const DEFAULT_INPUT_MODE: InputMode = 'ticker';
const DEFAULT_OUTPUT_RENDERER: OutputRenderer = 'financial_report';

/** File names of a valid agent folder, in the order the server checks them. */
export const REQUIRED_AGENT_FILES = [
  MANIFEST_FILE_NAME,
  AGENTS_FILE_NAME,
  DEFAULT_PROMPT_FILE,
  DEFAULT_SCHEMA_FILE,
] as const;

const createdCatalogs = new Set<TempCatalog>();

/** Minimal valid manifest for the given folder. */
export function validManifest(
  folderName: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: folderName,
    name: `Agent ${folderName}`,
    tagline: `One-line summary of ${folderName}`,
    description: `Long description of the ${folderName} agent.`,
    icon: DEFAULT_ICON,
    inputMode: DEFAULT_INPUT_MODE,
    inputPlaceholder: 'AAPL',
    actionLabel: 'Analyze',
    outputRenderer: DEFAULT_OUTPUT_RENDERER,
    ...overrides,
  };
}

/**
 * Default files of a valid agent folder, mirroring what the real folders under
 * `agent/` ship. `manifest.json` is written separately because a spec can
 * replace or omit it.
 */
export function defaultAgentFiles(folderName: string): Record<string, string> {
  return {
    [AGENTS_FILE_NAME]: `# ${folderName}\n\nTest instructions.\n`,
    [DEFAULT_PROMPT_FILE]: 'Input: {{input}}\nInstruction: {{instruction}}\nSchema: {{schema}}\n',
    [DEFAULT_SCHEMA_FILE]: JSON.stringify({ type: 'object', properties: {} }, null, 2),
  };
}

function writeFileDeep(target: string, content: FileContent): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
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
    files[MANIFEST_FILE_NAME] =
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2);
  }

  for (const [relativePath, content] of Object.entries(files)) {
    writeFileDeep(path.join(dir, relativePath), content);
  }

  return dir;
}

/**
 * Creates a temporary catalog. Returns paths and mutation helpers; cleanup runs
 * automatically after each test, but `cleanup()` is available for tests that
 * need to release it earlier.
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

/** Deletes every temporary catalog created so far. */
export function cleanupTempCatalogs(): void {
  for (const catalog of [...createdCatalogs]) {
    catalog.cleanup();
  }
}

// `globals: false`, so the cleanup is registered explicitly on import.
afterEach(() => {
  cleanupTempCatalogs();
});
