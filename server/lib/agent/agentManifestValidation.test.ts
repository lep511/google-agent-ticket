import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  createTempCatalog,
  validManifest,
  type AgentFolderSpec,
  type CatalogSpec,
} from '../../../tests/helpers/tempCatalog.ts';
import {
  normalizeLanding,
  normalizeOrder,
  validateAgentFolder,
  validateAgentFolders,
  type ManifestValidationResult,
} from './agentManifestValidation.ts';
import { discoverAgentFolders, type AgentRegistryWarning } from './agentRegistry.ts';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_ORDER,
  DEFAULT_PROMPT_FILE,
  DEFAULT_SCHEMA_FILE,
} from './agentTypes.ts';

/** Valida una única carpeta materializada en un catálogo temporal. */
function validateSingle(folderName: string, spec: AgentFolderSpec): ManifestValidationResult {
  const catalog = createTempCatalog({ [folderName]: spec });
  const folders = discoverAgentFolders(catalog.agentsDir, null).folders;
  expect(folders).toHaveLength(1);
  return validateAgentFolder(folders[0]!);
}

function expectSkipped(result: ManifestValidationResult): AgentRegistryWarning {
  expect(result.ok).toBe(false);
  expect(result.warnings).toHaveLength(1);
  return result.warnings[0]!;
}

describe('campos obligatorios del manifiesto', () => {
  it('acepta un manifiesto mínimo válido y resuelve sus rutas', () => {
    const result = validateSingle('good_agent', {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.definition.agentId).toBe('good_agent');
    expect(result.definition.manifest.name).toBe('Agente good_agent');
    expect(result.definition.paths.agentsFilePath).toContain('AGENTS.md');
    expect(result.definition.paths.promptPath).toContain('prompt.md');
    expect(result.definition.paths.schemaPath).toContain('output.schema.json');
  });

  it('omite la carpeta cuando manifest.json no es JSON válido', () => {
    const warning = expectSkipped(validateSingle('broken_agent', { manifest: '{ "id": ' }));

    expect(warning.code).toBe('invalid_manifest_json');
    expect(warning.relativePath).toBe('agent/broken_agent');
  });

  it('omite la carpeta y nombra el primer campo obligatorio ausente', () => {
    const manifest = validManifest('gap_agent');
    delete manifest.tagline;

    const warning = expectSkipped(validateSingle('gap_agent', { manifest }));

    expect(warning.code).toBe('missing_required_field');
    expect(warning.message).toContain('"tagline"');
  });

  it('nombra el primer campo causante cuando varios son inválidos', () => {
    const warning = expectSkipped(
      validateSingle('multi_agent', {
        manifest: validManifest('multi_agent', { name: '   ', tagline: 42 }),
      }),
    );

    expect(warning.message).toContain('"name"');
    expect(warning.message).not.toContain('"tagline"');
  });

  it('omite la carpeta cuando un campo obligatorio no es cadena', () => {
    const warning = expectSkipped(
      validateSingle('typed_agent', { manifest: validManifest('typed_agent', { name: 7 }) }),
    );

    expect(warning.code).toBe('invalid_field_value');
    expect(warning.message).toContain('no es una cadena');
  });

  it('omite la carpeta cuando un campo obligatorio supera su longitud máxima', () => {
    const warning = expectSkipped(
      validateSingle('long_agent', {
        manifest: validManifest('long_agent', { tagline: 'x'.repeat(161) }),
      }),
    );

    expect(warning.code).toBe('invalid_field_value');
    expect(warning.message).toContain('161');
    expect(warning.message).toContain('160');
  });

  it('acepta el campo obligatorio justo en su longitud máxima', () => {
    const result = validateSingle('edge_agent', {
      manifest: validManifest('edge_agent', { tagline: 'x'.repeat(160) }),
    });

    expect(result.ok).toBe(true);
  });

  it('omite la carpeta cuando id no coincide carácter a carácter con la carpeta', () => {
    const warning = expectSkipped(
      validateSingle('mismatch_agent', {
        manifest: validManifest('mismatch_agent', { id: 'Mismatch_Agent' }),
      }),
    );

    expect(warning.code).toBe('id_folder_mismatch');
    expect(warning.message).toContain('Mismatch_Agent');
    expect(warning.relativePath).toBe('agent/mismatch_agent');
  });

  it('rechaza inputMode, outputRenderer e icon fuera de sus valores permitidos', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['inputMode', { inputMode: 'Ticker' }],
      ['inputMode', { inputMode: 'audio' }],
      ['outputRenderer', { outputRenderer: 'Financial_Report' }],
      ['icon', { icon: 'NotAnIcon' }],
      ['icon', { icon: 'linechart' }],
    ];

    for (const [field, overrides] of cases) {
      const warning = expectSkipped(
        validateSingle('enum_agent', { manifest: validManifest('enum_agent', overrides) }),
      );
      expect(warning.code).toBe('invalid_field_value');
      expect(warning.message).toContain(`"${field}"`);
    }
  });
});

describe('archivos requeridos del agente', () => {
  it('omite la carpeta cuando falta AGENTS.md', () => {
    const catalog = createTempCatalog({ no_agents_agent: {} });
    fs.rmSync(catalog.filePath('no_agents_agent', 'AGENTS.md'));
    const folders = discoverAgentFolders(catalog.agentsDir, null).folders;

    const warning = expectSkipped(validateAgentFolder(folders[0]!));

    expect(warning.code).toBe('missing_required_file');
    expect(warning.message).toContain('AGENTS.md');
  });

  it('omite la carpeta cuando el archivo de prompt está vacío', () => {
    const warning = expectSkipped(
      validateSingle('empty_prompt_agent', { files: { 'prompt.md': '' } }),
    );

    expect(warning.code).toBe('empty_required_file');
    expect(warning.message).toContain('prompt.md');
  });

  it('omite la carpeta cuando el esquema no contiene JSON válido', () => {
    const warning = expectSkipped(
      validateSingle('bad_schema_agent', { files: { 'output.schema.json': '{ "type": ' } }),
    );

    expect(warning.code).toBe('invalid_schema_json');
    expect(warning.message).toContain('output.schema.json');
  });

  it('usa los archivos declarados en promptFile y schemaFile', () => {
    const result = validateSingle('custom_files_agent', {
      manifest: validManifest('custom_files_agent', {
        promptFile: 'plantilla.md',
        schemaFile: 'salida.json',
      }),
      files: {
        'plantilla.md': 'Entrada: {{input}}\n',
        'salida.json': '{"type":"object"}',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.manifest.promptFile).toBe('plantilla.md');
    expect(result.definition.paths.promptPath).toContain('plantilla.md');
    expect(result.definition.paths.schemaPath).toContain('salida.json');
  });
});

describe('valores por defecto y degradación de campos opcionales', () => {
  it('aplica los valores por defecto cuando el manifiesto omite los opcionales', () => {
    const result = validateSingle('defaults_agent', {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { manifest } = result.definition;
    expect(manifest.order).toBe(DEFAULT_ORDER);
    expect(manifest.isDefault).toBe(false);
    expect(manifest.supportsInstruction).toBe(false);
    expect(manifest.promptFile).toBe(DEFAULT_PROMPT_FILE);
    expect(manifest.schemaFile).toBe(DEFAULT_SCHEMA_FILE);
    expect(manifest.accentColor).toBe(DEFAULT_ACCENT_COLOR);
    expect(manifest.landing).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('degrada con advertencia el campo opcional con tipo incorrecto y conserva la entrada', () => {
    const result = validateSingle('degraded_agent', {
      manifest: validManifest('degraded_agent', {
        isDefault: 'true',
        supportsInstruction: 1,
        accentColor: 42,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.manifest.isDefault).toBe(false);
    expect(result.definition.manifest.supportsInstruction).toBe(false);
    expect(result.definition.manifest.accentColor).toBe(DEFAULT_ACCENT_COLOR);
    expect(result.warnings.map((w) => w.code)).toEqual([
      'invalid_optional_field',
      'invalid_optional_field',
      'invalid_optional_field',
    ]);
    expect(result.warnings.every((w) => w.relativePath === 'agent/degraded_agent')).toBe(true);
    expect(result.warnings[0]?.message).toContain('"isDefault"');
  });

  it('degrada promptFile con separadores de ruta al valor por defecto', () => {
    const result = validateSingle('traversal_agent', {
      manifest: validManifest('traversal_agent', { promptFile: '../../etc/passwd' }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.manifest.promptFile).toBe(DEFAULT_PROMPT_FILE);
    expect(result.warnings[0]?.code).toBe('invalid_optional_field');
    expect(result.warnings[0]?.message).toContain('"promptFile"');
  });

  it('conserva el accentColor hexadecimal declarado', () => {
    const result = validateSingle('accent_agent', {
      manifest: validManifest('accent_agent', { accentColor: '#1E90FF' }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.manifest.accentColor).toBe('#1E90FF');
    expect(result.warnings).toEqual([]);
  });

  it('degrada a nulo el bloque landing malformado y conserva la entrada', () => {
    const result = validateSingle('landing_agent', {
      manifest: validManifest('landing_agent', { landing: { title: 'Hola' } }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.manifest.landing).toBeNull();
    expect(result.warnings[0]?.message).toContain('"landing"');
  });

  it('conserva el bloque landing bien formado y descarta iconos fuera de la lista', () => {
    const result = validateSingle('landing_ok_agent', {
      manifest: validManifest('landing_ok_agent', {
        landing: {
          title: 'Título',
          subtitle: 'Subtítulo',
          highlights: [
            {
              title: 'Grupo',
              items: [
                { title: 'Punto', subtitle: 'Detalle', icon: 'FileText' },
                { title: 'Otro', icon: 'NotAnIcon' },
              ],
            },
          ],
        },
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const landing = result.definition.manifest.landing;
    expect(landing?.highlights[0]?.items[0]).toEqual({
      title: 'Punto',
      subtitle: 'Detalle',
      icon: 'FileText',
    });
    expect(landing?.highlights[0]?.items[1]).toEqual({ title: 'Otro' });
  });
});

describe('normalizeOrder', () => {
  it('conserva los enteros dentro del rango 0-9999', () => {
    expect(normalizeOrder(0)).toEqual({ order: 0, degraded: 'none' });
    expect(normalizeOrder(10)).toEqual({ order: 10, degraded: 'none' });
    expect(normalizeOrder(9999)).toEqual({ order: 9999, degraded: 'none' });
  });

  it('aplica 100 cuando order falta, no es entero o está fuera de rango', () => {
    expect(normalizeOrder(undefined).order).toBe(DEFAULT_ORDER);
    expect(normalizeOrder(null).order).toBe(DEFAULT_ORDER);
    expect(normalizeOrder(1.5).order).toBe(DEFAULT_ORDER);
    expect(normalizeOrder(-1).order).toBe(DEFAULT_ORDER);
    expect(normalizeOrder(10000).order).toBe(DEFAULT_ORDER);
    expect(normalizeOrder(Number.NaN).order).toBe(DEFAULT_ORDER);
    expect(normalizeOrder('10').order).toBe(DEFAULT_ORDER);
  });

  it('distingue la degradación por tipo de la degradación por rango', () => {
    expect(normalizeOrder('10').degraded).toBe('type');
    expect(normalizeOrder(10000).degraded).toBe('range');
    expect(normalizeOrder(undefined).degraded).toBe('omitted');
  });

  it('normaliza el order del manifiesto y advierte cuando queda fuera de rango', () => {
    const result = validateSingle('order_agent', {
      manifest: validManifest('order_agent', { order: 20000 }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.manifest.order).toBe(DEFAULT_ORDER);
    expect(result.warnings[0]?.code).toBe('order_out_of_range');
  });
});

describe('normalizeLanding', () => {
  it('devuelve nulo para valores que no son objetos con la forma esperada', () => {
    for (const value of [null, 'landing', 3, [], {}, { title: 'a', subtitle: 'b' }]) {
      expect(normalizeLanding(value)).toBeNull();
    }
  });
});

describe('validación del catálogo completo', () => {
  it('omite las carpetas inválidas con una advertencia y conserva las válidas', () => {
    const spec: CatalogSpec = {
      good_agent: {},
      broken_json_agent: { manifest: '{' },
      mismatch_agent: { manifest: validManifest('otro_id') },
      another_good_agent: {},
    };
    const catalog = createTempCatalog(spec);
    const folders = discoverAgentFolders(catalog.agentsDir, null).folders;
    const collected: AgentRegistryWarning[] = [];

    const result = validateAgentFolders(folders, (w) => collected.push(w));

    expect(result.definitions.map((d) => d.agentId)).toEqual([
      'another_good_agent',
      'good_agent',
    ]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.map((w) => w.relativePath).sort()).toEqual([
      'agent/broken_json_agent',
      'agent/mismatch_agent',
    ]);
    expect(collected).toEqual(result.warnings);
  });

  it('captura una excepción inesperada de la validación y continúa con las demás', () => {
    const catalog = createTempCatalog({ good_agent: {}, exploding_agent: {} });
    const folders = discoverAgentFolders(catalog.agentsDir, null).folders;
    const exploding = folders.find((f) => f.agentId === 'exploding_agent')!;
    // `manifestText` se lee durante la validación: un getter que lanza simula
    // una excepción inesperada dentro del proceso de validación.
    Object.defineProperty(exploding, 'manifestText', {
      get() {
        throw new Error('fallo inesperado');
      },
    });

    const result = validateAgentFolders(folders, null);

    expect(result.definitions.map((d) => d.agentId)).toEqual(['good_agent']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('validation_exception');
    expect(result.warnings[0]?.relativePath).toBe('agent/exploding_agent');
  });
});
