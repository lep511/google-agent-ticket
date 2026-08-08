import { describe, expect, it } from 'vitest';
import * as lucide from 'lucide-react';

import {
  ALLOWED_ICONS,
  FIELD_MAX_LENGTHS,
  INPUT_MODES,
  ORDER_MAX,
  ORDER_MIN,
  MANIFEST_DEFAULTS,
  MAX_AGENT_FOLDERS,
  MAX_MANIFEST_BYTES,
  MAX_PROMPT_BYTES,
  MAX_RUNTIME_DIR_DEPTH,
  MAX_RUNTIME_FILE_BYTES,
  MAX_RUNTIME_FILE_COUNT,
  MAX_SCHEMA_BYTES,
  OUTPUT_RENDERERS,
  isAllowedIconName,
  isInputMode,
  isOutputRenderer,
} from './agentTypes.ts';

describe('enumeraciones del manifiesto', () => {
  it('admite solo ticker y text como inputMode', () => {
    expect([...INPUT_MODES]).toEqual(['ticker', 'text']);
    expect(isInputMode('ticker')).toBe(true);
    expect(isInputMode('text')).toBe(true);
  });

  it('rechaza inputMode con distinta capitalización o valor desconocido', () => {
    expect(isInputMode('Ticker')).toBe(false);
    expect(isInputMode('number')).toBe(false);
    expect(isInputMode(undefined)).toBe(false);
  });

  it('admite solo financial_report y simple_report como outputRenderer', () => {
    expect([...OUTPUT_RENDERERS]).toEqual(['financial_report', 'simple_report']);
    expect(isOutputRenderer('financial_report')).toBe(true);
    expect(isOutputRenderer('simple_report')).toBe(true);
    expect(isOutputRenderer('Simple_Report')).toBe(false);
    expect(isOutputRenderer(null)).toBe(false);
  });
});

describe('lista blanca de iconos', () => {
  it('acepta un icono de la lista con comparación exacta', () => {
    expect(isAllowedIconName('FileText')).toBe(true);
    expect(isAllowedIconName('filetext')).toBe(false);
  });

  it('rechaza cualquier nombre fuera de la lista', () => {
    expect(isAllowedIconName('EvilIcon')).toBe(false);
    expect(isAllowedIconName(42)).toBe(false);
  });

  it('no contiene nombres repetidos', () => {
    expect(new Set(ALLOWED_ICONS).size).toBe(ALLOWED_ICONS.length);
  });

  it('solo contiene nombres exportados por lucide-react', () => {
    const desconocidos = ALLOWED_ICONS.filter((name) => !(name in lucide));
    expect(desconocidos).toEqual([]);
  });
});

describe('valores por defecto y límites', () => {
  it('declara los valores por defecto de los campos opcionales', () => {
    expect(MANIFEST_DEFAULTS).toMatchObject({
      order: 100,
      isDefault: false,
      supportsInstruction: false,
      promptFile: 'prompt.md',
      schemaFile: 'output.schema.json',
      landing: null,
    });
    expect(MANIFEST_DEFAULTS.accentColor).toMatch(/^#FFFFFF[0-9A-F]{2}$/);
  });

  it('declara los límites del catálogo y de las fuentes inline', () => {
    expect(MAX_AGENT_FOLDERS).toBe(100);
    expect(MAX_MANIFEST_BYTES).toBe(64_000);
    expect(MAX_PROMPT_BYTES).toBe(262_144);
    expect(MAX_SCHEMA_BYTES).toBe(262_144);
    expect(MAX_RUNTIME_FILE_BYTES).toBe(1_048_576);
    expect(MAX_RUNTIME_DIR_DEPTH).toBe(5);
    expect(MAX_RUNTIME_FILE_COUNT).toBe(200);
  });

  it('declara las longitudes máximas de los campos obligatorios y el rango de order', () => {
    expect(FIELD_MAX_LENGTHS).toMatchObject({
      id: 64,
      name: 64,
      icon: 64,
      inputMode: 64,
      outputRenderer: 64,
      tagline: 160,
      inputPlaceholder: 160,
      actionLabel: 160,
      description: 1000,
    });
    expect(ORDER_MIN).toBe(0);
    expect(ORDER_MAX).toBe(9999);
  });
});
