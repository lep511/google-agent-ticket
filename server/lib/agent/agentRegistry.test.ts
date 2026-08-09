import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createTempCatalog, validManifest } from '../../../tests/helpers/tempCatalog.ts';
import { MAX_MANIFEST_BYTES, MAX_PROMPT_BYTES } from './agentTypes.ts';
import {
  AgentSourceError,
  classifyRequestedAgentId,
  compareAgentNames,
  createAgentRegistry,
  discoverAgentFolders,
  isSnakeCaseAgentId,
  resolveAgentSelection,
  resolveDefaultAgent,
  type AgentRegistryWarning,
} from './agentRegistry.ts';

/** Recolector de advertencias para no ensuciar la salida de las pruebas. */
function collector(): { warnings: AgentRegistryWarning[]; log: (w: AgentRegistryWarning) => void } {
  const warnings: AgentRegistryWarning[] = [];
  return { warnings, log: (w) => warnings.push(w) };
}

/** Toca la marca de tiempo de modificación de `agent/` de forma observable. */
function touch(dir: string): void {
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(dir, future, future);
}

describe('descubrimiento de carpetas de agente', () => {
  it('incluye una entrada por carpeta con manifiesto, con el nombre de la carpeta como agentId', () => {
    const catalog = createTempCatalog({
      financial_analyst_agent: {},
      market_news_agent: {},
    });
    const { warnings, log } = collector();

    const result = discoverAgentFolders(catalog.agentsDir, log);

    expect(result.folders.map((f) => f.agentId)).toEqual([
      'financial_analyst_agent',
      'market_news_agent',
    ]);
    expect(result.enumerationError).toBeNull();
    expect(warnings).toEqual([]);
    expect(result.folders[0]?.relativeDir).toBe('agent/financial_analyst_agent');
    expect(JSON.parse(result.folders[0]!.manifestText).id).toBe('financial_analyst_agent');
  });

  it('publica cada agentId una sola vez', () => {
    const catalog = createTempCatalog({ alpha_agent: {}, beta_agent: {}, gamma_agent: {} });

    const ids = discoverAgentFolders(catalog.agentsDir, null).folders.map((f) => f.agentId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('descarta con advertencia la carpeta sin manifest.json y conserva el resto', () => {
    const catalog = createTempCatalog({
      good_agent: {},
      no_manifest_agent: { manifest: null },
    });
    const { warnings, log } = collector();

    const result = discoverAgentFolders(catalog.agentsDir, log);

    expect(result.folders.map((f) => f.agentId)).toEqual(['good_agent']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('missing_manifest');
    expect(warnings[0]?.relativePath).toBe('agent/no_manifest_agent');
  });

  it('descarta con advertencia el manifiesto mayor de 64 KB', () => {
    const oversized = JSON.stringify({
      ...validManifest('big_agent'),
      padding: 'x'.repeat(MAX_MANIFEST_BYTES),
    });
    const catalog = createTempCatalog({ big_agent: { manifest: oversized }, good_agent: {} });
    const { warnings, log } = collector();

    const result = discoverAgentFolders(catalog.agentsDir, log);

    expect(result.folders.map((f) => f.agentId)).toEqual(['good_agent']);
    expect(warnings[0]?.code).toBe('manifest_too_large');
    expect(warnings[0]?.message).toContain(String(MAX_MANIFEST_BYTES));
  });

  it('descarta con advertencia las carpetas con nombre fuera de snake_case', () => {
    const catalog = createTempCatalog({
      good_agent: {},
      'Bad-Name': { manifest: validManifest('Bad-Name') },
      __leading: { manifest: validManifest('__leading') },
    });
    const { warnings, log } = collector();

    const result = discoverAgentFolders(catalog.agentsDir, log);

    expect(result.folders.map((f) => f.agentId)).toEqual(['good_agent']);
    expect(warnings.map((w) => w.code)).toEqual(['invalid_folder_name', 'invalid_folder_name']);
  });

  it('ignora los archivos sueltos de la raíz de agent/', () => {
    const catalog = createTempCatalog({ good_agent: {} });
    catalog.writeLooseFile('AGENTS.md', '# suelto\n');
    catalog.writeLooseFile('manifest.json', JSON.stringify(validManifest('loose')));
    const { warnings, log } = collector();

    const result = discoverAgentFolders(catalog.agentsDir, log);

    expect(result.folders.map((f) => f.agentId)).toEqual(['good_agent']);
    expect(warnings).toEqual([]);
  });

  it('does not read the contents of the runtime files', () => {
    const catalog = createTempCatalog({
      // A sentinel instead of a default file: the assertion then holds whatever
      // the shared helper decides to ship in a default agent folder.
      good_agent: { files: { 'runtime/notes.md': 'RUNTIME_FILE_SENTINEL' } },
    });

    const result = discoverAgentFolders(catalog.agentsDir, null);

    expect(result.manifestReads).toBe(1);
    const serialized = JSON.stringify(result.folders);
    expect(serialized).not.toContain('RUNTIME_FILE_SENTINEL');
    expect(serialized).not.toContain('Test instructions');
  });

  it('registra el error y devuelve un catálogo vacío cuando agent/ no se puede enumerar', () => {
    const catalog = createTempCatalog({});
    const { warnings, log } = collector();

    const result = discoverAgentFolders(path.join(catalog.agentsDir, 'inexistente'), log);

    expect(result.folders).toEqual([]);
    expect(result.enumerationError).not.toBeNull();
    expect(warnings[0]?.code).toBe('enumeration_error');
  });

  // Materializing 102 folders on disk is what costs the time here, not the
  // enumeration under test, and it does not fit the default 5 s budget.
  it('enumerates at most 100 subfolders and warns about the rest', () => {
    const spec: Record<string, Record<string, never>> = {};
    for (let i = 0; i < 102; i += 1) {
      spec[`agent_${String(i).padStart(3, '0')}`] = {};
    }
    const catalog = createTempCatalog(spec);
    const { warnings, log } = collector();

    const result = discoverAgentFolders(catalog.agentsDir, log);

    expect(result.folders).toHaveLength(100);
    expect(warnings.map((w) => w.code)).toEqual([
      'folder_limit_exceeded',
      'folder_limit_exceeded',
    ]);
  }, 30_000);

  // The 3 s budget is the measured enumeration itself (`durationMs`), so the
  // wall-clock timeout only has to leave room for building the fixture.
  it('rebuilds 50 folders in under 3 s', () => {
    const spec: Record<string, Record<string, never>> = {};
    for (let i = 0; i < 50; i += 1) spec[`agent_${String(i).padStart(2, '0')}`] = {};
    const catalog = createTempCatalog(spec);

    const result = discoverAgentFolders(catalog.agentsDir, null);

    expect(result.folders).toHaveLength(50);
    expect(result.durationMs).toBeLessThan(3000);
  }, 30_000);
});

describe('isSnakeCaseAgentId', () => {
  it('acepta secuencias de minúsculas y dígitos separadas por un único guion bajo', () => {
    expect(isSnakeCaseAgentId('financial_analyst_agent')).toBe(true);
    expect(isSnakeCaseAgentId('agent2')).toBe(true);
  });

  it('rechaza mayúsculas, dobles guiones bajos, separadores de ruta y recorridos', () => {
    for (const value of ['Agent', 'agent__x', 'agent-x', 'a/b', '..', '_agent', 'agent_', '']) {
      expect(isSnakeCaseAgentId(value)).toBe(false);
    }
  });
});

describe('orden total del catálogo', () => {
  /** agentIds del catálogo publicado, en el orden en que se exponen. */
  function catalogIds(agentsDir: string): string[] {
    const registry = createAgentRegistry({ agentsDir, logger: null });
    return registry.getCatalog().definitions.map((d) => d.agentId);
  }

  it('ordena por order ascendente por delante del nombre y del agentId', () => {
    const catalog = createTempCatalog({
      alpha_agent: { manifest: validManifest('alpha_agent', { name: 'Alfa', order: 300 }) },
      beta_agent: { manifest: validManifest('beta_agent', { name: 'Zeta', order: 10 }) },
      gamma_agent: { manifest: validManifest('gamma_agent', { name: 'Mu', order: 100 }) },
    });

    expect(catalogIds(catalog.agentsDir)).toEqual(['beta_agent', 'gamma_agent', 'alpha_agent']);
  });

  it('ante order igual ordena por name sin distinguir mayúsculas y minúsculas', () => {
    const catalog = createTempCatalog({
      first_agent: { manifest: validManifest('first_agent', { name: 'zeta report', order: 5 }) },
      second_agent: { manifest: validManifest('second_agent', { name: 'Alfa report', order: 5 }) },
      third_agent: { manifest: validManifest('third_agent', { name: 'mu report', order: 5 }) },
    });

    expect(catalogIds(catalog.agentsDir)).toEqual(['second_agent', 'third_agent', 'first_agent']);
  });

  it('ante order y name iguales ordena por agentId ascendente', () => {
    const catalog = createTempCatalog({
      zulu_agent: { manifest: validManifest('zulu_agent', { name: 'informe', order: 42 }) },
      mike_agent: { manifest: validManifest('mike_agent', { name: 'Informe', order: 42 }) },
      alpha_agent: { manifest: validManifest('alpha_agent', { name: 'INFORME', order: 42 }) },
    });

    expect(catalogIds(catalog.agentsDir)).toEqual(['alpha_agent', 'mike_agent', 'zulu_agent']);
  });

  it('sitúa el order por defecto 100 entre los valores menores y mayores', () => {
    const catalog = createTempCatalog({
      // `order` ausente y fuera de rango degradan ambos a 100 (Requirement 1.7).
      omitted_agent: { manifest: validManifest('omitted_agent', { name: 'Bravo' }) },
      out_of_range_agent: {
        manifest: validManifest('out_of_range_agent', { name: 'Alfa', order: 99999 }),
      },
      early_agent: { manifest: validManifest('early_agent', { name: 'Zeta', order: 0 }) },
      late_agent: { manifest: validManifest('late_agent', { name: 'Alfa', order: 9999 }) },
    });

    expect(catalogIds(catalog.agentsDir)).toEqual([
      'early_agent',
      'out_of_range_agent',
      'omitted_agent',
      'late_agent',
    ]);
  });

  it('mantiene el mismo orden tras reconstruir el catálogo', () => {
    const catalog = createTempCatalog({
      alpha_agent: { manifest: validManifest('alpha_agent', { name: 'Zeta', order: 100 }) },
      beta_agent: { manifest: validManifest('beta_agent', { name: 'Alfa', order: 100 }) },
    });
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    const first = registry.getCatalog().definitions.map((d) => d.agentId);
    const second = registry.refresh().definitions.map((d) => d.agentId);

    expect(first).toEqual(['beta_agent', 'alpha_agent']);
    expect(second).toEqual(first);
  });

  it('compara nombres sin distinguir mayúsculas y minúsculas', () => {
    expect(compareAgentNames('alfa', 'Beta')).toBeLessThan(0);
    expect(compareAgentNames('Beta', 'alfa')).toBeGreaterThan(0);
    expect(compareAgentNames('Informe', 'informe')).toBe(0);
  });
});

describe('resolución del agente por defecto', () => {
  it('designa la única entrada que declara isDefault verdadero', () => {
    const catalog = createTempCatalog({
      alpha_agent: { manifest: validManifest('alpha_agent', { order: 1 }) },
      beta_agent: { manifest: validManifest('beta_agent', { order: 500, isDefault: true }) },
    });
    const { warnings, log } = collector();
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: log });

    const snapshot = registry.getCatalog();

    expect(snapshot.defaultAgentId).toBe('beta_agent');
    expect(snapshot.defaultAgentSource).toBe('declared');
    expect(warnings).toEqual([]);
  });

  it('cae en financial_analyst_agent con advertencia cuando varias entradas declaran isDefault', () => {
    const catalog = createTempCatalog({
      alpha_agent: { manifest: validManifest('alpha_agent', { order: 1, isDefault: true }) },
      beta_agent: { manifest: validManifest('beta_agent', { order: 2, isDefault: true }) },
      financial_analyst_agent: {
        manifest: validManifest('financial_analyst_agent', { order: 900 }),
      },
    });
    const { warnings, log } = collector();

    const snapshot = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: log }).getCatalog();

    expect(snapshot.defaultAgentId).toBe('financial_analyst_agent');
    expect(snapshot.defaultAgentSource).toBe('financial_fallback');
    expect(warnings.map((w) => w.code)).toEqual(['ambiguous_default_agent']);
    expect(warnings[0]?.message).toContain('2 entradas');
  });

  it('cae en financial_analyst_agent cuando ninguna entrada declara isDefault', () => {
    const catalog = createTempCatalog({
      alpha_agent: { manifest: validManifest('alpha_agent', { order: 1 }) },
      financial_analyst_agent: {
        manifest: validManifest('financial_analyst_agent', { order: 900 }),
      },
    });
    const { warnings, log } = collector();

    const snapshot = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: log }).getCatalog();

    expect(snapshot.defaultAgentId).toBe('financial_analyst_agent');
    expect(warnings[0]?.message).toContain('0 entradas');
  });

  it('cae en la primera entrada del orden total cuando no hay agente financiero', () => {
    const catalog = createTempCatalog({
      zulu_agent: { manifest: validManifest('zulu_agent', { name: 'Informe', order: 5 }) },
      mike_agent: { manifest: validManifest('mike_agent', { name: 'informe', order: 5 }) },
    });
    const { warnings, log } = collector();

    const snapshot = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: log }).getCatalog();

    expect(snapshot.defaultAgentId).toBe('mike_agent');
    expect(snapshot.defaultAgentSource).toBe('first_in_order');
    expect(warnings[0]?.code).toBe('ambiguous_default_agent');
    expect(warnings[0]?.message).toContain('mike_agent');
  });

  it('no expone agente por defecto y advierte cuando el catálogo queda vacío', () => {
    const catalog = createTempCatalog({ broken_agent: { manifest: '{ no es json' } });
    const { warnings, log } = collector();

    const snapshot = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: log }).getCatalog();

    expect(snapshot.definitions).toEqual([]);
    expect(snapshot.defaultAgentId).toBeNull();
    expect(snapshot.defaultAgentSource).toBe('empty_catalog');
    expect(warnings.map((w) => w.code)).toContain('empty_catalog');
  });

  it('expone el mismo defaultAgentId mientras el catálogo no se reconstruye', () => {
    const catalog = createTempCatalog({
      alpha_agent: { manifest: validManifest('alpha_agent', { order: 10 }) },
      beta_agent: { manifest: validManifest('beta_agent', { order: 20 }) },
    });
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    const snapshot = registry.getCatalog();
    const first = registry.getDefaultAgentId();
    const second = registry.getDefaultAgentId();

    expect(first).toBe('alpha_agent');
    expect(second).toBe(first);
    // Mismo catálogo en memoria: el valor no se vuelve a resolver.
    expect(registry.getCatalog()).toBe(snapshot);
  });

  it('vuelve a resolver el agente por defecto en cada reconstrucción', () => {
    const catalog = createTempCatalog({
      alpha_agent: { manifest: validManifest('alpha_agent', { order: 10 }) },
    });
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    expect(registry.getDefaultAgentId()).toBe('alpha_agent');

    catalog.writeAgent('beta_agent', {
      manifest: validManifest('beta_agent', { order: 20, isDefault: true }),
    });
    touch(catalog.agentsDir);

    expect(registry.getDefaultAgentId()).toBe('beta_agent');
  });

  it('resuelve un único agente por defecto sin depender del orden recibido', () => {
    const catalog = createTempCatalog({
      zulu_agent: { manifest: validManifest('zulu_agent', { name: 'Zeta', order: 300 }) },
      alpha_agent: { manifest: validManifest('alpha_agent', { name: 'Alfa', order: 7 }) },
    });
    const definitions = createAgentRegistry({
      agentsDir: catalog.agentsDir,
      logger: null,
    }).getCatalog().definitions;

    const forward = resolveDefaultAgent(definitions);
    const reversed = resolveDefaultAgent([...definitions].reverse());

    expect(forward.defaultAgentId).toBe('alpha_agent');
    expect(reversed.defaultAgentId).toBe(forward.defaultAgentId);
  });
});

describe('caché por marca de tiempo de agent/', () => {
  it('sirve el catálogo desde memoria mientras la marca de tiempo no cambia', () => {
    const catalog = createTempCatalog({ good_agent: {} });
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    const first = registry.getCatalog();
    const second = registry.getCatalog();

    expect(second).toBe(first);
    expect(second.manifestReads).toBe(1);
  });

  it('reconstruye el catálogo cuando cambia la marca de tiempo de agent/', () => {
    const catalog = createTempCatalog({ good_agent: {} });
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    const first = registry.getCatalog();
    catalog.writeAgent('second_agent');
    touch(catalog.agentsDir);
    const second = registry.getCatalog();

    expect(first.folders.map((f) => f.agentId)).toEqual(['good_agent']);
    expect(second.folders.map((f) => f.agentId)).toEqual(['good_agent', 'second_agent']);
    expect(second.dirMtimeMs).not.toBe(first.dirMtimeMs);
  });

  it('conserva el catálogo vigente cuando la enumeración falla después de una construcción válida', () => {
    const catalog = createTempCatalog({ good_agent: {} });
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    const first = registry.getCatalog();
    fs.rmSync(catalog.agentsDir, { recursive: true, force: true });
    const afterError = registry.refresh();

    expect(first.folders.map((f) => f.agentId)).toEqual(['good_agent']);
    expect(afterError.folders.map((f) => f.agentId)).toEqual(['good_agent']);
    expect(afterError.enumerationError).not.toBeNull();
  });

  it('vuelve a leer los manifiestos tras invalidar la caché', () => {
    const catalog = createTempCatalog({ good_agent: {} });
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    const first = registry.getCatalog();
    registry.invalidate();
    const second = registry.getCatalog();

    expect(second).not.toBe(first);
    expect(second.folders.map((f) => f.agentId)).toEqual(['good_agent']);
  });
});

describe('clasificación del agentId recibido', () => {
  it('trata como ausente el valor omitido, nulo, de otro tipo o vacío tras recortar', () => {
    for (const value of [undefined, null, 42, {}, [], '', '   ', '\n\t']) {
      expect(classifyRequestedAgentId(value).kind).toBe('absent');
    }
  });

  it('trata como mal formado el valor con separadores, recorridos o caracteres fuera de snake_case', () => {
    for (const value of [
      'agent/../secret',
      '../financial_analyst_agent',
      'agent\\financial_analyst_agent',
      '/etc/passwd',
      'C:\\agent\\x',
      'Financial_Analyst_Agent',
      ' financial_analyst_agent ',
      'financial_analyst_agent\n',
      'agent-x',
      'agent__x',
      '.',
      '..',
    ]) {
      expect(classifyRequestedAgentId(value)).toEqual({ kind: 'malformed', value });
    }
  });

  it('acepta como candidato el valor en snake_case', () => {
    expect(classifyRequestedAgentId('financial_analyst_agent')).toEqual({
      kind: 'candidate',
      value: 'financial_analyst_agent',
    });
  });
});

describe('resolución del agentId recibido', () => {
  /** Catálogo con dos agentes y `alpha_agent` como agente por defecto. */
  function twoAgentCatalog() {
    return createTempCatalog({
      alpha_agent: { manifest: validManifest('alpha_agent', { order: 10, isDefault: true }) },
      beta_agent: { manifest: validManifest('beta_agent', { order: 20 }) },
    });
  }

  it('resuelve por coincidencia exacta sin advertencias', () => {
    const catalog = twoAgentCatalog();
    const { warnings, log } = collector();
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: log });

    const resolution = registry.resolveAgent('beta_agent');

    expect(resolution.source).toBe('exact_match');
    expect(resolution.agentId).toBe('beta_agent');
    expect(resolution.definition?.paths.dir).toBe(catalog.agentDir('beta_agent'));
    expect(warnings).toEqual([]);
  });

  it('cae en el agente por defecto con advertencia cuando el agentId está ausente o vacío', () => {
    const catalog = twoAgentCatalog();
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    for (const received of [undefined, null, '', '   ', 7]) {
      const resolution = registry.resolveAgent(received);

      expect(resolution.source).toBe('default_absent');
      expect(resolution.agentId).toBe('alpha_agent');
      expect(resolution.warnings.map((w) => w.code)).toEqual(['missing_agent_id']);
    }
  });

  it('cae en el agente por defecto con advertencia cuando el agentId no está en el catálogo', () => {
    const catalog = twoAgentCatalog();
    const { warnings, log } = collector();
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: log });

    const resolution = registry.resolveAgent('gamma_agent');

    expect(resolution.source).toBe('default_unknown');
    expect(resolution.agentId).toBe('alpha_agent');
    expect(resolution.requestedAgentId).toBe('gamma_agent');
    expect(warnings.map((w) => w.code)).toEqual(['unknown_agent_id']);
    expect(warnings[0]?.message).toContain('gamma_agent');
  });

  it('trata como desconocido el agentId con separadores o recorridos y mantiene la ruta dentro del catálogo', () => {
    const catalog = twoAgentCatalog();
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    for (const received of [
      '../beta_agent',
      'beta_agent/../../etc',
      'beta_agent\\..\\alpha_agent',
      '/absolute/path',
      'Beta_Agent',
      ' beta_agent',
    ]) {
      const resolution = registry.resolveAgent(received);

      expect(resolution.source).toBe('default_malformed');
      expect(resolution.agentId).toBe('alpha_agent');
      expect(resolution.warnings.map((w) => w.code)).toEqual(['malformed_agent_id']);
      // La ruta sale de la entrada de catálogo, nunca del valor recibido.
      expect(resolution.definition?.paths.dir).toBe(catalog.agentDir('alpha_agent'));
      const relative = path.relative(catalog.agentsDir, resolution.definition!.paths.dir);
      expect(relative.startsWith('..')).toBe(false);
      expect(path.isAbsolute(relative)).toBe(false);
    }
  });

  it('no reproduce en la advertencia un valor recibido de longitud arbitraria', () => {
    const catalog = twoAgentCatalog();
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    const resolution = registry.resolveAgent(`${'x'.repeat(5000)}\n`);

    expect(resolution.source).toBe('default_malformed');
    expect(resolution.warnings[0]?.message.length).toBeLessThan(400);
    expect(resolution.warnings[0]?.message).not.toContain('\n');
  });

  it('no resuelve ningún agente cuando el catálogo está vacío', () => {
    const catalog = createTempCatalog({ broken_agent: { manifest: '{ no es json' } });
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    const resolution = registry.resolveAgent('broken_agent');

    expect(resolution.definition).toBeNull();
    expect(resolution.agentId).toBeNull();
    expect(resolution.source).toBe('unavailable');
    expect(resolution.warnings.map((w) => w.code)).toEqual(['no_agent_available']);
  });

  it('resuelve exactamente un agente para cualquier valor recibido mientras el catálogo no esté vacío', () => {
    const catalog = twoAgentCatalog();
    const definitions = createAgentRegistry({
      agentsDir: catalog.agentsDir,
      logger: null,
    }).listAgents();

    for (const received of [undefined, null, '', 'alpha_agent', 'beta_agent', 'nope', '../x', 3]) {
      const resolution = resolveAgentSelection(definitions, 'alpha_agent', received);

      expect(resolution.definition).not.toBeNull();
      expect(definitions.filter((d) => d.agentId === resolution.agentId)).toHaveLength(1);
    }
  });
});

describe('operaciones del catálogo por identificador', () => {
  function catalogWithDefault() {
    return createTempCatalog({
      alpha_agent: { manifest: validManifest('alpha_agent', { order: 10, isDefault: true }) },
      beta_agent: { manifest: validManifest('beta_agent', { order: 20 }) },
    });
  }

  it('lista el catálogo en su orden total', () => {
    const catalog = catalogWithDefault();
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    expect(registry.listAgents().map((d) => d.agentId)).toEqual(['alpha_agent', 'beta_agent']);
  });

  it('obtiene el agente por id solo con coincidencia exacta', () => {
    const catalog = catalogWithDefault();
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    expect(registry.getAgentById('beta_agent')?.agentId).toBe('beta_agent');
    for (const value of ['Beta_Agent', ' beta_agent', '../beta_agent', 'beta_agent/', '', null]) {
      expect(registry.getAgentById(value)).toBeNull();
    }
  });

  it('obtiene el agente por defecto y nulo cuando el catálogo está vacío', () => {
    const catalog = catalogWithDefault();
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });
    const empty = createAgentRegistry({
      agentsDir: createTempCatalog({}).agentsDir,
      logger: null,
    });

    expect(registry.getDefaultAgent()?.agentId).toBe('alpha_agent');
    expect(empty.getDefaultAgent()).toBeNull();
  });

  it('entrega la plantilla y el esquema desde los archivos declarados en el manifiesto', () => {
    const catalog = createTempCatalog({
      alpha_agent: {
        manifest: validManifest('alpha_agent', {
          promptFile: 'custom_prompt.md',
          schemaFile: 'custom_schema.json',
        }),
        files: {
          'custom_prompt.md': 'Entrada: {{input}}\nEsquema: {{schema}}\n',
          'custom_schema.json': '{ "type": "object" }',
        },
      },
    });
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    const template = registry.getPromptTemplate('alpha_agent');
    const schema = registry.getSchema('alpha_agent');

    expect(template.fileName).toBe('custom_prompt.md');
    expect(template.relativePath).toBe('agent/alpha_agent/custom_prompt.md');
    expect(template.text).toContain('{{input}}');
    expect(schema.fileName).toBe('custom_schema.json');
    expect(schema.text).toBe('{ "type": "object" }');
    expect(schema.json).toEqual({ type: 'object' });
  });

  it('falla con un error explícito cuando el agente no está en el catálogo', () => {
    const catalog = catalogWithDefault();
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    expect(() => registry.getPromptTemplate('../beta_agent')).toThrowError(AgentSourceError);
    expect(() => registry.getSchema('gamma_agent')).toThrowError(/not in the catalog/);
  });

  it('falla nombrando el archivo cuando la plantilla supera su límite de tamaño', () => {
    const catalog = createTempCatalog({
      alpha_agent: { files: { 'prompt.md': 'x'.repeat(MAX_PROMPT_BYTES + 1) } },
    });
    const registry = createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });

    try {
      registry.getPromptTemplate('alpha_agent');
      expect.unreachable('la lectura debía fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentSourceError);
      expect((error as AgentSourceError).code).toBe('source_file_too_large');
      expect((error as AgentSourceError).relativePath).toBe('agent/alpha_agent/prompt.md');
    }
  });
});
