import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempCatalog, validManifest } from '../helpers/tempCatalog.ts';
import { PROPERTY_RUNS } from '../setup/fastCheck.ts';

describe('tempCatalog', () => {
  it('materializa una carpeta de agente válida con sus archivos por defecto', () => {
    const catalog = createTempCatalog({ financial_analyst_agent: {} });
    const dir = catalog.agentDir('financial_analyst_agent');

    expect(fs.readdirSync(dir).sort()).toEqual([
      'AGENTS.md',
      'agent.yaml',
      'manifest.json',
      'output.schema.json',
      'prompt.md',
      'requirements.txt',
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))).toMatchObject({
      id: 'financial_analyst_agent',
      inputMode: 'ticker',
    });
  });

  it('permite manifiestos malformados, archivos extra y carpetas sin manifiesto', () => {
    const catalog = createTempCatalog({
      broken_agent: { manifest: '{ not json' },
      no_manifest_agent: { manifest: null },
      extra_files_agent: {
        manifest: validManifest('extra_files_agent', { order: 5 }),
        files: { 'resources/data.txt': 'contenido' },
      },
    });

    expect(fs.readFileSync(catalog.filePath('broken_agent', 'manifest.json'), 'utf8')).toBe('{ not json');
    expect(fs.existsSync(catalog.filePath('no_manifest_agent', 'manifest.json'))).toBe(false);
    expect(fs.readFileSync(catalog.filePath('extra_files_agent', 'resources/data.txt'), 'utf8')).toBe('contenido');
  });

  it('borra el directorio temporal al limpiar', () => {
    const catalog = createTempCatalog({ some_agent: {} });
    const root = catalog.root;

    catalog.cleanup();

    expect(fs.existsSync(root)).toBe(false);
  });
});

describe('configuración compartida de fast-check', () => {
  it('exige al menos 100 iteraciones por propiedad', () => {
    expect(PROPERTY_RUNS).toBeGreaterThanOrEqual(100);
  });
});
