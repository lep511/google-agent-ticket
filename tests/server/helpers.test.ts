import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFakeAgentClients, defaultScript } from '../helpers/fakeAgentClient.ts';
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

describe('fakeAgentClient', () => {
  it('registra las interacciones creadas por cada cliente en orden', async () => {
    const fake = createFakeAgentClients();

    await fake.agentClient.createInteraction({
      prompt: 'prompt por defecto',
      inlineSources: [{ type: 'file', content: 'x', target: '/.agents/AGENTS.md' }],
    });
    await fake.agentClientPerseus.createInteraction({ prompt: 'prompt perseus' });

    expect(fake.interactions.map((i) => [i.client, i.prompt])).toEqual([
      ['agentClient', 'prompt por defecto'],
      ['agentClientPerseus', 'prompt perseus'],
    ]);
    expect(fake.interactions[0].inlineSources[0].target).toBe('/.agents/AGENTS.md');
  });

  it('emite eventos deterministas y un cuerpo SSE consumible', async () => {
    const script = defaultScript('{"summary":"determinista"}');
    const fake = createFakeAgentClients({ events: script });

    const response = await fake.agentClient.createInteraction({ prompt: 'p' });
    const streamed = [];
    for await (const event of fake.agentClient.streamInteraction(response)) {
      streamed.push(event);
    }

    expect(streamed).toEqual(script);

    const second = await fake.agentClient.createInteraction({ prompt: 'p' });
    const body = await second.text();
    expect(body).toContain('data: {"event_type":"step.delta"');
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('simula un fallo del cliente remoto y una interrupción a mitad del flujo', async () => {
    const fake = createFakeAgentClients({ failStatus: 500 });
    const failed = await fake.agentClient.createInteraction({ prompt: 'p' });
    expect(failed.ok).toBe(false);
    expect(failed.status).toBe(500);

    fake.agentClient.script({ events: defaultScript(), breakAfter: 1 });
    const interrupted = await fake.agentClient.createInteraction({ prompt: 'p' });
    const types = [];
    for await (const event of fake.agentClient.streamInteraction(interrupted)) {
      types.push(event.type);
    }
    expect(types).toEqual(['thinking', 'error']);
  });
});

describe('configuración compartida de fast-check', () => {
  it('exige al menos 100 iteraciones por propiedad', () => {
    expect(PROPERTY_RUNS).toBeGreaterThanOrEqual(100);
  });
});
