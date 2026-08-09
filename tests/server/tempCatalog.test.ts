/* ──────────────────────────────────────────────────────────── */
/*  Contract of the shared temporary catalog helper              */
/*                                                               */
/*  Every server test that touches the catalog builds its         */
/*  fixtures with `createTempCatalog`, so a silent drift between   */
/*  the helper and what the server actually requires of an agent   */
/*  folder would weaken all of them at once. These tests pin the   */
/*  helper against the production discovery and validation code.   */
/* ──────────────────────────────────────────────────────────── */

import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { validateAgentFolder } from '../../server/lib/agent/agentManifestValidation.ts';
import { discoverAgentFolders } from '../../server/lib/agent/agentRegistry.ts';
import {
  AGENTS_FILE_NAME,
  MANIFEST_FILE_NAME,
} from '../../server/lib/agent/agentTypes.ts';
import {
  createTempCatalog,
  defaultAgentFiles,
  DEFAULT_PROMPT_FILE,
  DEFAULT_SCHEMA_FILE,
  REQUIRED_AGENT_FILES,
  validManifest,
  type CatalogSpec,
} from '../helpers/tempCatalog.ts';

/** The real catalog shipped in the repository. */
const REAL_AGENTS_DIR = path.join(process.cwd(), 'agent');

/** Validates a single folder of a temporary catalog through the real pipeline. */
function validateOnly(spec: CatalogSpec, folderName: string) {
  const catalog = createTempCatalog(spec);
  const folders = discoverAgentFolders(catalog.agentsDir, null).folders;
  const folder = folders.find((candidate) => candidate.agentId === folderName);
  expect(folder, `folder ${folderName} was not discovered`).toBeDefined();

  return validateAgentFolder(folder!);
}

describe('default agent folder', () => {
  it('materializes exactly the files the server requires', () => {
    const catalog = createTempCatalog({ financial_analyst_agent: {} });
    const dir = catalog.agentDir('financial_analyst_agent');

    expect(fs.readdirSync(dir).sort()).toEqual([...REQUIRED_AGENT_FILES].sort());
    expect(JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE_NAME), 'utf8'))).toMatchObject({
      id: 'financial_analyst_agent',
      inputMode: 'ticker',
    });
  });

  it('passes production validation with no warnings', () => {
    const result = validateOnly({ financial_analyst_agent: {} }, 'financial_analyst_agent');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A degraded optional field would surface here, so the fixture is only
    // "valid" when the server accepts it without complaining about anything.
    expect(result.warnings).toEqual([]);
    expect(result.definition.manifest.promptFile).toBe(DEFAULT_PROMPT_FILE);
    expect(result.definition.manifest.schemaFile).toBe(DEFAULT_SCHEMA_FILE);
  });

  it('writes a prompt template that only uses supported placeholders', () => {
    const template = defaultAgentFiles('some_agent')[DEFAULT_PROMPT_FILE];

    expect(template).toContain('{{input}}');
    expect(template).toContain('{{instruction}}');
    expect(template).toContain('{{schema}}');
    // Anything else would make `buildAgentPrompt` reject the fixture.
    expect(template?.match(/\{\{[^{}]*\}\}/g)).toEqual([
      '{{input}}',
      '{{instruction}}',
      '{{schema}}',
    ]);
  });

  it('writes no file the real catalog folders do not ship', () => {
    const helperFiles = [MANIFEST_FILE_NAME, ...Object.keys(defaultAgentFiles('some_agent'))];
    const realFolders = fs
      .readdirSync(REAL_AGENTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(realFolders.length).toBeGreaterThan(0);

    for (const folderName of realFolders) {
      const realFiles = fs.readdirSync(path.join(REAL_AGENTS_DIR, folderName));
      // Files left over from an earlier project layout would show up as helper
      // defaults that no real agent has any more.
      expect(realFiles).toEqual(expect.arrayContaining(helperFiles));
    }
  });

  // Each generated case materializes a catalog on disk, so the default 5 s
  // budget does not cover the mandated 100 iterations.
  it('validates every generated snake_case folder', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc
            .array(fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), { minLength: 1, maxLength: 3 })
            .map((segments) => segments.join('_')),
          { minLength: 1, maxLength: 3 },
        ),
        fc.integer({ min: 0, max: 9999 }),
        (folderNames, order) => {
          const spec: CatalogSpec = {};
          for (const folderName of folderNames) {
            spec[folderName] = { manifest: validManifest(folderName, { order }) };
          }

          const catalog = createTempCatalog(spec);
          const folders = discoverAgentFolders(catalog.agentsDir, null).folders;

          expect(folders.map((folder) => folder.agentId).sort()).toEqual([...folderNames].sort());
          for (const folder of folders) {
            const result = validateAgentFolder(folder);
            expect(result.ok, JSON.stringify(result.warnings)).toBe(true);
          }

          catalog.cleanup();
        },
      ),
    );
  }, 30_000);
});

describe('folder specs', () => {
  it('allows malformed manifests, extra files and folders with no manifest', () => {
    const catalog = createTempCatalog({
      broken_agent: { manifest: '{ not json' },
      no_manifest_agent: { manifest: null },
      extra_files_agent: {
        manifest: validManifest('extra_files_agent', { order: 5 }),
        files: { 'resources/data.txt': 'content' },
      },
    });

    expect(fs.readFileSync(catalog.filePath('broken_agent', MANIFEST_FILE_NAME), 'utf8')).toBe(
      '{ not json',
    );
    expect(fs.existsSync(catalog.filePath('no_manifest_agent', MANIFEST_FILE_NAME))).toBe(false);
    expect(fs.readFileSync(catalog.filePath('extra_files_agent', 'resources/data.txt'), 'utf8')).toBe(
      'content',
    );
  });

  it('reports the file the server misses when a default file is dropped', () => {
    const result = validateOnly(
      {
        // `withDefaultFiles: false` leaves the manifest without the files it
        // points at, which is what a half-migrated folder looks like on disk.
        naked_agent: { withDefaultFiles: false },
      },
      'naked_agent',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warnings[0].code).toBe('missing_required_file');
    expect(result.warnings[0].message).toContain(AGENTS_FILE_NAME);
  });

  it('lets extra files override the defaults', () => {
    const catalog = createTempCatalog({
      custom_agent: { files: { [DEFAULT_PROMPT_FILE]: 'Only {{input}}\n' } },
    });

    expect(fs.readFileSync(catalog.filePath('custom_agent', DEFAULT_PROMPT_FILE), 'utf8')).toBe(
      'Only {{input}}\n',
    );
  });
});

describe('lifecycle', () => {
  it('adds and removes folders after creation', () => {
    const catalog = createTempCatalog({ first_agent: {} });

    catalog.writeAgent('second_agent');
    expect(discoverAgentFolders(catalog.agentsDir, null).folders.map((f) => f.agentId)).toEqual([
      'first_agent',
      'second_agent',
    ]);

    catalog.removeAgent('first_agent');
    expect(discoverAgentFolders(catalog.agentsDir, null).folders.map((f) => f.agentId)).toEqual([
      'second_agent',
    ]);
  });

  it('deletes the temporary directory on cleanup, idempotently', () => {
    const catalog = createTempCatalog({ some_agent: {} });
    const root = catalog.root;

    catalog.cleanup();
    catalog.cleanup();

    expect(fs.existsSync(root)).toBe(false);
  });
});
