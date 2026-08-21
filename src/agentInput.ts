/* ──────────────────────────────────────────────────────────── */
/*  Adaptive input bar                                          */
/*                                                              */
/*  Pure logic that derives the input field presentation and    */
/*  preliminary validation from the active agent's manifest,    */
/*  which governs the execution button. The rules replicate     */
/*  those of the backend (`server/lib/analyzeInput.ts`) so that */
/*  the client does not offer executions that the server will   */
/*  reject.                                                     */
/*                                                              */

/* ──────────────────────────────────────────────────────────── */

import type { AgentCatalogEntry, InputMode } from './types';

/** Minimum length of a symbol in `ticker` mode (). */
export const TICKER_MIN_LENGTH = 1;

/** Maximum length of a symbol in `ticker` mode (). */
export const TICKER_MAX_LENGTH = 10;

/**
 * Valid symbol in `ticker` mode: 1 to 10 characters `A`-`Z` and `0`-`9`,
 * checked on the already trimmed and uppercased value ().
 */
export const TICKER_PATTERN = /^[A-Z0-9]{1,10}$/;

/** Minimum text length in `text` mode (). */
export const TEXT_MIN_LENGTH = 1;

/** Maximum text length in `text` mode (). */
export const TEXT_MAX_LENGTH = 2000;

/** Maximum instruction length after trimming (Requirements 5.9, 8.6). */
export const MAX_INSTRUCTION_LENGTH = 2000;

/** Input bar presentation derived from the manifest. */
export interface InputBarConfig {
  /** Field type: short and monospaced, or free-text width (13.3, 13.4). */
  inputMode: InputMode;
  /** Input field help text (Requirement 13.5). */
  inputPlaceholder: string;
  /** Execution button label (Requirement 13.7). */
  actionLabel: string;
  /**
   * Instruction field visible only when true (Requirement 13.6). Reserved for
   * `ticker` agents: in `text` mode the bar stays a single field, so this is
   * always false regardless of what the manifest declares.
   */
  supportsInstruction: boolean;
}

/**
 * Presentation used while no agent is active (catalog loading, empty, or
 * failed). Preserves the historical bar behavior: short symbol,
 * no instruction field, and "Analyze" button.
 */
export const FALLBACK_INPUT_BAR_CONFIG: InputBarConfig = {
  inputMode: 'ticker',
  inputPlaceholder: 'TICKER',
  actionLabel: 'Analyze',
  supportsInstruction: false,
};

/**
 * Derives the active agent's bar presentation from the manifest: `inputMode`,
 * `inputPlaceholder`, `actionLabel` and `supportsInstruction`
 * (Requirements 13.3, 13.4, 13.5, 13.6, 13.7).
 *
 * The instruction field is only offered to `ticker` agents. A free-text agent
 * already takes the whole bar for its prompt, so splitting it into input plus
 * optional instruction adds no value there and `supportsInstruction` is forced
 * to false even when the manifest declares it.
 */
export function inputBarConfig(agent: AgentCatalogEntry | null): InputBarConfig {
  if (!agent) return FALLBACK_INPUT_BAR_CONFIG;

  const placeholder = agent.inputPlaceholder?.trim();
  const actionLabel = agent.actionLabel?.trim();
  const inputMode: InputMode = agent.inputMode === 'text' ? 'text' : 'ticker';

  return {
    inputMode,
    inputPlaceholder:
      placeholder && placeholder.length > 0
        ? agent.inputPlaceholder
        : FALLBACK_INPUT_BAR_CONFIG.inputPlaceholder,
    actionLabel:
      actionLabel && actionLabel.length > 0
        ? agent.actionLabel
        : FALLBACK_INPUT_BAR_CONFIG.actionLabel,
    supportsInstruction: inputMode === 'ticker' && agent.supportsInstruction === true,
  };
}

/**
 * Maximum length allowed by the input field according to mode, so that the
 * field does not accept more characters than the server would validate.
 */
export function inputMaxLength(inputMode: InputMode): number {
  return inputMode === 'ticker' ? TICKER_MAX_LENGTH : TEXT_MAX_LENGTH;
}

/**
 * Length and character set rules for the active `inputMode`, the same as
 * those applied by the execution endpoint: in `ticker` mode, 1 to 10
 * characters `A`-`Z` and `0`-`9` after trimming and converting to uppercase;
 * in `text` mode, 1 to 2,000 characters after trimming.
 */
export function isInputValid(value: string, inputMode: InputMode): boolean {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (inputMode === 'ticker') {
    return TICKER_PATTERN.test(trimmed.toUpperCase());
  }

  return trimmed.length >= TEXT_MIN_LENGTH && trimmed.length <= TEXT_MAX_LENGTH;
}

/**
 * Valid instruction: empty, or up to 2,000 characters after trimming
 * (Requirements 5.9, 8.6).
 */
export function isInstructionValid(instruction: string): boolean {
  const trimmed = typeof instruction === 'string' ? instruction.trim() : '';
  return trimmed.length <= MAX_INSTRUCTION_LENGTH;
}

/**
 * Execution button state: enabled only with the catalog available and
 * an input that meets the active `inputMode` rules
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
