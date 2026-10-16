/**
 * Prompt assembler: builds the final prompt of a run from the resolved agent's
 * template, the effective input value and the optional instruction.
 *
 * Assembly sequence:
 *  1. Read the template from the path of the catalog entry
 *     (`agentRegistry.readAgentPromptTemplate`), which already fails with an
 *     explicit error naming the file when the read fails or the file exceeds
 *     256 KiB.
 *  2. Look for unsupported placeholders **in the template text only**, before
 *     substituting anything, so an input value or an instruction that happens
 *     to contain the `{{...}}` shape does not break the build
 *     (Requirements 7.4, 7.5).
 *  3. Replace every occurrence of `{{input}}` and `{{instruction}}`
 *     (Requirements 7.1, 7.2, 7.6, 7.7).
 *
 * The output contract is no longer part of the prompt. The former `{{schema}}`
 * placeholder and the shared JSON output rules block (Requirements 7.3, 7.8)
 * are superseded by the per-renderer Zod schema in `agent/outputSchemas.ts`,
 * which the Strands SDK enforces through its structured output tool. A
 * template that still carries `{{schema}}` is therefore rejected as an
 * unsupported placeholder: that is what surfaces a stale prompt.
 */

import { readAgentPromptTemplate, type AgentSourceFile } from './agent/agentRegistry.ts';
import type { ResolvedAgentDefinition } from './agent/agentTypes.ts';

/* ────────────────────────────────────────────────────────── */
/*  Supported placeholders                                     */
/* ────────────────────────────────────────────────────────── */

/** Placeholder of the effective input value (Requirement 7.1). */
export const INPUT_PLACEHOLDER = '{{input}}';

/** Placeholder of the optional instruction (Requirements 7.1, 7.6, 7.7). */
export const INSTRUCTION_PLACEHOLDER = '{{instruction}}';

/** The only placeholders a template may use (Requirement 7.4). */
export const SUPPORTED_PLACEHOLDERS = [INPUT_PLACEHOLDER, INSTRUCTION_PLACEHOLDER] as const;

/**
 * The `{{...}}` shape with no `}` inside: matches the supported placeholders
 * and anything else, including spaced variants (`{{ input }}`), which are not
 * supported and therefore stop the build.
 */
const PLACEHOLDER_PATTERN = /\{\{[^{}]*\}\}/g;

/* ────────────────────────────────────────────────────────── */
/*  Errors                                                     */
/* ────────────────────────────────────────────────────────── */

/** Reasons the prompt build cannot complete. */
export type PromptBuildErrorCode = 'unsupported_placeholder';

/**
 * Explicit assembler error: names the unsupported placeholder and the template
 * file by its path relative to the repository root, never by its absolute path
 * (Requirements 7.4, 16.3).
 *
 * Read and size failures of the template propagate as `AgentSourceError` from
 * the registry, which already names the affected file.
 */
export class PromptBuildError extends Error {
  constructor(
    readonly code: PromptBuildErrorCode,
    readonly agentId: string,
    readonly relativePath: string,
    /** Offending placeholder, exactly as it appears in the template. */
    readonly placeholder: string,
    message: string,
  ) {
    super(message);
    this.name = 'PromptBuildError';
  }
}

/* ────────────────────────────────────────────────────────── */
/*  Assembly                                                   */
/* ────────────────────────────────────────────────────────── */

export interface BuildAgentPromptOptions {
  /** Agent resolved by the registry; the manifest and the paths come from it. */
  definition: ResolvedAgentDefinition;
  /** Effective input value, already validated by the endpoint. */
  input: string;
  /**
   * Instruction received in the request. Applied only when the manifest
   * declares `supportsInstruction` true (Requirements 7.6, 7.7).
   */
  instruction?: string | null;
  /** Template already read; read from disk when omitted. */
  template?: AgentSourceFile;
}

export interface BuiltAgentPrompt {
  agentId: string;
  /** Final prompt the agent runs with. */
  prompt: string;
  /** Relative path of the template used, `agent/<agentId>/<promptFile>`. */
  templateRelativePath: string;
  /** Value that replaced `{{instruction}}`; empty when it did not apply. */
  effectiveInstruction: string;
  /** Build duration in milliseconds. */
  durationMs: number;
}

/**
 * Looks for unsupported placeholders in the template text and fails with an
 * error naming the first one found (Requirements 7.4, 7.5). Called before any
 * substitution, so substituted text is never searched.
 */
function assertOnlySupportedPlaceholders(
  templateText: string,
  agentId: string,
  relativePath: string,
): void {
  const supported = new Set<string>(SUPPORTED_PLACEHOLDERS);

  for (const match of templateText.matchAll(PLACEHOLDER_PATTERN)) {
    const placeholder = match[0];
    if (supported.has(placeholder)) continue;

    throw new PromptBuildError(
      'unsupported_placeholder',
      agentId,
      relativePath,
      placeholder,
      `Template "${relativePath}" of agent "${agentId}" contains the unsupported placeholder "${placeholder}"; the supported placeholders are ${[
        ...supported,
      ].join(', ')}.`,
    );
  }
}

/** Replaces every occurrence of a literal, without interpreting `$`. */
function replaceAll(text: string, placeholder: string, value: string): string {
  return text.split(placeholder).join(value);
}

/**
 * Assembles the final prompt of the resolved agent.
 *
 * @throws {PromptBuildError} if the template contains an unsupported placeholder.
 * @throws {AgentSourceError} if the template cannot be read or exceeds 256 KiB.
 */
export function buildAgentPrompt(options: BuildAgentPromptOptions): BuiltAgentPrompt {
  const startedAt = Date.now();
  const { definition, input, instruction } = options;
  const { agentId, manifest } = definition;

  // The read already fails naming the affected file.
  const template = options.template ?? readAgentPromptTemplate(definition);

  // Requirements 7.4, 7.5: only the original template text is examined.
  assertOnlySupportedPlaceholders(template.text, agentId, template.relativePath);

  // Requirements 7.6, 7.7: the instruction applies only when the manifest
  // allows it, and is empty when absent or whitespace only.
  const effectiveInstruction =
    manifest.supportsInstruction && typeof instruction === 'string' ? instruction.trim() : '';

  let prompt = replaceAll(template.text, INPUT_PLACEHOLDER, input.trim());
  prompt = replaceAll(prompt, INSTRUCTION_PLACEHOLDER, effectiveInstruction);

  return {
    agentId,
    prompt,
    templateRelativePath: template.relativePath,
    effectiveInstruction,
    durationMs: Date.now() - startedAt,
  };
}
