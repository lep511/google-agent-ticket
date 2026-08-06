/**
 * Reglas de la barra de entrada adaptativa: presentación derivada del
 * manifiesto y validación previa que gobierna el botón de ejecución.
 *
 * Requirements: 8.7, 8.8, 13.3, 13.4, 13.5, 13.6, 13.7
 */

import { describe, expect, it } from 'vitest';

import {
  FALLBACK_INPUT_BAR_CONFIG,
  MAX_INSTRUCTION_LENGTH,
  TEXT_MAX_LENGTH,
  canRun,
  inputBarConfig,
  inputMaxLength,
  isInputValid,
  isInstructionValid,
} from './agentInput';
import type { AgentCatalogEntry } from './types';

function agent(overrides: Partial<AgentCatalogEntry> = {}): AgentCatalogEntry {
  return {
    id: 'financial_analyst_agent',
    name: 'Financial Analyst',
    tagline: 'Informe financiero profundo',
    description: 'Analiza una empresa cotizada.',
    icon: 'LineChart',
    accentColor: 'rgba(255,255,255,0.12)',
    order: 10,
    isDefault: true,
    inputMode: 'ticker',
    inputPlaceholder: 'TICKER',
    actionLabel: 'Analyze',
    supportsInstruction: true,
    outputRenderer: 'financial_report',
    landing: null,
    ...overrides,
  };
}

describe('inputBarConfig', () => {
  it('toma del manifiesto modo, ayuda, etiqueta y campo de instrucción', () => {
    const config = inputBarConfig(
      agent({
        inputMode: 'text',
        inputPlaceholder: 'Nombre de la empresa',
        actionLabel: 'Generar perfil',
        supportsInstruction: false,
      }),
    );

    expect(config).toEqual({
      inputMode: 'text',
      inputPlaceholder: 'Nombre de la empresa',
      actionLabel: 'Generar perfil',
      supportsInstruction: false,
    });
  });

  it('usa la presentación de reserva cuando no hay agente activo', () => {
    expect(inputBarConfig(null)).toEqual(FALLBACK_INPUT_BAR_CONFIG);
  });

  it('longitud máxima del campo según el modo', () => {
    expect(inputMaxLength('ticker')).toBe(10);
    expect(inputMaxLength('text')).toBe(TEXT_MAX_LENGTH);
  });
});

describe('isInputValid en modo `ticker`', () => {
  it('acepta de 1 a 10 caracteres alfanuméricos tras recortar y pasar a mayúsculas', () => {
    expect(isInputValid('tsla', 'ticker')).toBe(true);
    expect(isInputValid('  brk.a  '.replace('.', ''), 'ticker')).toBe(true);
    expect(isInputValid('A', 'ticker')).toBe(true);
    expect(isInputValid('A1B2C3D4E5', 'ticker')).toBe(true);
  });

  it('rechaza vacío, más de 10 caracteres y caracteres fuera del conjunto', () => {
    expect(isInputValid('', 'ticker')).toBe(false);
    expect(isInputValid('   ', 'ticker')).toBe(false);
    expect(isInputValid('A1B2C3D4E5F', 'ticker')).toBe(false);
    expect(isInputValid('BRK.A', 'ticker')).toBe(false);
    expect(isInputValid('TS LA', 'ticker')).toBe(false);
  });
});

describe('isInputValid en modo `text`', () => {
  it('acepta de 1 a 2000 caracteres tras recortar', () => {
    expect(isInputValid('Iberdrola', 'text')).toBe(true);
    expect(isInputValid('x'.repeat(TEXT_MAX_LENGTH), 'text')).toBe(true);
    expect(isInputValid('  perfil de BRK.A  ', 'text')).toBe(true);
  });

  it('rechaza texto vacío tras recortar y texto de más de 2000 caracteres', () => {
    expect(isInputValid('   ', 'text')).toBe(false);
    expect(isInputValid('x'.repeat(TEXT_MAX_LENGTH + 1), 'text')).toBe(false);
  });
});

describe('canRun', () => {
  const config = inputBarConfig(agent());

  it('habilita la ejecución cuando la entrada cumple las reglas del modo', () => {
    expect(canRun({ value: 'tsla', instruction: '', config, isCatalogEmpty: false })).toBe(true);
  });

  it('mantiene la ejecución deshabilitada con entrada inválida', () => {
    expect(canRun({ value: 'BRK.A', instruction: '', config, isCatalogEmpty: false })).toBe(false);
  });

  it('mantiene la ejecución deshabilitada con el catálogo vacío', () => {
    expect(canRun({ value: 'TSLA', instruction: '', config, isCatalogEmpty: true })).toBe(false);
  });

  it('rechaza una instrucción de más de 2000 caracteres solo si el agente la admite', () => {
    const tooLong = 'y'.repeat(MAX_INSTRUCTION_LENGTH + 1);
    expect(isInstructionValid(tooLong)).toBe(false);
    expect(canRun({ value: 'TSLA', instruction: tooLong, config, isCatalogEmpty: false })).toBe(
      false,
    );

    const withoutInstruction = inputBarConfig(agent({ supportsInstruction: false }));
    expect(
      canRun({
        value: 'TSLA',
        instruction: tooLong,
        config: withoutInstruction,
        isCatalogEmpty: false,
      }),
    ).toBe(true);
  });
});
