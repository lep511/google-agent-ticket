/* ──────────────────────────────────────────────────────────── */
/*  Barra de entrada adaptativa                                 */
/*                                                              */
/*  Lógica pura que deriva del manifiesto del agente activo la   */
/*  presentación del campo de entrada y la validación previa que */
/*  gobierna el botón de ejecución. Las reglas replican las del  */
/*  backend (`server/lib/analyzeInput.ts`) para que el cliente   */
/*  no ofrezca ejecuciones que el servidor va a rechazar.        */
/*                                                              */
/*  Requirements: 8.7, 8.8, 13.3, 13.4, 13.5, 13.6, 13.7        */
/* ──────────────────────────────────────────────────────────── */

import type { AgentCatalogEntry, InputMode } from './types';

/** Longitud mínima de un símbolo en modo `ticker` (Requirement 8.1). */
export const TICKER_MIN_LENGTH = 1;

/** Longitud máxima de un símbolo en modo `ticker` (Requirement 8.1). */
export const TICKER_MAX_LENGTH = 10;

/**
 * Símbolo admitido en modo `ticker`: de 1 a 10 caracteres `A`-`Z` y `0`-`9`,
 * comprobado sobre el valor ya recortado y en mayúsculas (Requirement 8.1).
 */
export const TICKER_PATTERN = /^[A-Z0-9]{1,10}$/;

/** Longitud mínima del texto en modo `text` (Requirement 8.2). */
export const TEXT_MIN_LENGTH = 1;

/** Longitud máxima del texto en modo `text` (Requirement 8.2). */
export const TEXT_MAX_LENGTH = 2000;

/** Longitud máxima de la instrucción tras recortar (Requirements 5.9, 8.6). */
export const MAX_INSTRUCTION_LENGTH = 2000;

/** Presentación de la barra de entrada derivada del manifiesto. */
export interface InputBarConfig {
  /** Tipo de campo: corto y monoespaciado, o ancho de texto libre (13.3, 13.4). */
  inputMode: InputMode;
  /** Texto de ayuda del campo de entrada (Requirement 13.5). */
  inputPlaceholder: string;
  /** Etiqueta del botón de ejecución (Requirement 13.7). */
  actionLabel: string;
  /** Campo de instrucción visible solo cuando es verdadero (Requirement 13.6). */
  supportsInstruction: boolean;
}

/**
 * Presentación usada mientras no hay agente activo (catálogo cargando, vacío o
 * fallido). Conserva el comportamiento histórico de la barra: símbolo corto,
 * sin campo de instrucción y botón "Analyze".
 */
export const FALLBACK_INPUT_BAR_CONFIG: InputBarConfig = {
  inputMode: 'ticker',
  inputPlaceholder: 'TICKER',
  actionLabel: 'Analyze',
  supportsInstruction: false,
};

/**
 * Deriva la presentación de la barra del agente activo: `inputMode`,
 * `inputPlaceholder`, `actionLabel` y `supportsInstruction` del manifiesto
 * (Requirements 13.3, 13.4, 13.5, 13.6, 13.7).
 */
export function inputBarConfig(agent: AgentCatalogEntry | null): InputBarConfig {
  if (!agent) return FALLBACK_INPUT_BAR_CONFIG;

  const placeholder = agent.inputPlaceholder?.trim();
  const actionLabel = agent.actionLabel?.trim();

  return {
    inputMode: agent.inputMode === 'text' ? 'text' : 'ticker',
    inputPlaceholder:
      placeholder && placeholder.length > 0
        ? agent.inputPlaceholder
        : FALLBACK_INPUT_BAR_CONFIG.inputPlaceholder,
    actionLabel:
      actionLabel && actionLabel.length > 0
        ? agent.actionLabel
        : FALLBACK_INPUT_BAR_CONFIG.actionLabel,
    supportsInstruction: agent.supportsInstruction === true,
  };
}

/**
 * Longitud máxima admitida por el campo de entrada según el modo, para que el
 * campo no acepte más caracteres de los que el servidor validaría.
 */
export function inputMaxLength(inputMode: InputMode): number {
  return inputMode === 'ticker' ? TICKER_MAX_LENGTH : TEXT_MAX_LENGTH;
}

/**
 * Reglas de longitud y conjunto de caracteres del `inputMode` activo, las
 * mismas que aplica el endpoint de ejecución: en modo `ticker`, de 1 a 10
 * caracteres `A`-`Z` y `0`-`9` tras recortar y pasar a mayúsculas; en modo
 * `text`, de 1 a 2.000 caracteres tras recortar.
 *
 * Requirements: 8.1, 8.2, 8.7, 8.8
 */
export function isInputValid(value: string, inputMode: InputMode): boolean {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (inputMode === 'ticker') {
    return TICKER_PATTERN.test(trimmed.toUpperCase());
  }

  return trimmed.length >= TEXT_MIN_LENGTH && trimmed.length <= TEXT_MAX_LENGTH;
}

/**
 * Instrucción admisible: vacía, o de hasta 2.000 caracteres tras recortar
 * (Requirements 5.9, 8.6).
 */
export function isInstructionValid(instruction: string): boolean {
  const trimmed = typeof instruction === 'string' ? instruction.trim() : '';
  return trimmed.length <= MAX_INSTRUCTION_LENGTH;
}

/**
 * Estado del botón de ejecución: habilitado solo con el catálogo disponible y
 * una entrada que cumple las reglas del `inputMode` activo
 * (Requirements 8.7, 8.8, 11.9).
 */
export function canRun(params: {
  value: string;
  instruction: string;
  config: InputBarConfig;
  isCatalogEmpty: boolean;
}): boolean {
  const { value, instruction, config, isCatalogEmpty } = params;
  if (isCatalogEmpty) return false;
  if (!isInputValid(value, config.inputMode)) return false;
  if (config.supportsInstruction && !isInstructionValid(instruction)) return false;
  return true;
}
