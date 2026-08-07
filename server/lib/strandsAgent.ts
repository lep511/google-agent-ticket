/**
 * Strands Agents SDK integration (TypeScript).
 *
 * Runs an agent in-process with the Strands SDK against Gemini, as an
 * alternative to the remote Gemini Managed Agents path in `agentClient.ts`.
 * The stream is mapped onto the same `AgentEvent` union the SSE endpoint
 * already emits, so both runners are interchangeable for the caller.
 *
 * Credentials: the Google provider reads `GEMINI_API_KEY` from the environment
 * when no explicit `apiKey` is passed, which is the variable this project
 * already configures.
 *
 * Docs: https://strandsagents.com/docs/user-guide/quickstart/typescript/
 */

import { Agent, type AgentStreamEvent, type ToolList } from '@strands-agents/sdk';
import { GoogleModel } from '@strands-agents/sdk/models/google';
import type { ZodType } from 'zod';

import type { AgentEvent } from './agentClient.ts';

/* ────────────────────────────────────────────────────────── */
/*  Configuration                                              */
/* ────────────────────────────────────────────────────────── */

/** Model used when neither the caller nor `STRANDS_MODEL_ID` provides one. */
export const DEFAULT_STRANDS_MODEL_ID = 'gemini-2.5-flash';

export interface StrandsAgentOptions {
  /** System prompt guiding the agent. */
  systemPrompt?: string;
  /** Gemini model id. Defaults to `STRANDS_MODEL_ID` or `DEFAULT_STRANDS_MODEL_ID`. */
  modelId?: string;
  /** Sampling temperature forwarded to the Gemini API. */
  temperature?: number;
  /** Custom function tools created with the SDK's `tool()` helper. */
  tools?: ToolList;
  /** Enables Gemini's built-in Google Search tool. Defaults to `false`. */
  googleSearch?: boolean;
  /** Zod schema the final answer must satisfy, exposed as `result.structuredOutput`. */
  structuredOutputSchema?: ZodType;
}

/** True when the server has the credentials the Google provider needs. */
export function isStrandsConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Builds a Strands agent backed by the Gemini provider.
 *
 * Console printing is disabled: this server streams events to the browser and
 * writes its own run logs, so the SDK's stdout printer would only duplicate them.
 */
export function createStrandsAgent(options: StrandsAgentOptions = {}): Agent {
  const model = new GoogleModel({
    modelId: options.modelId ?? process.env.STRANDS_MODEL_ID ?? DEFAULT_STRANDS_MODEL_ID,
    ...(options.temperature === undefined
      ? {}
      : { params: { temperature: options.temperature } }),
    ...(options.googleSearch ? { builtInTools: [{ googleSearch: {} }] } : {}),
  });

  return new Agent({
    model,
    printer: false,
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.structuredOutputSchema === undefined
      ? {}
      : { structuredOutputSchema: options.structuredOutputSchema }),
  });
}

/* ────────────────────────────────────────────────────────── */
/*  Event mapping                                              */
/* ────────────────────────────────────────────────────────── */

/**
 * Translates a single Strands stream event into the project's `AgentEvent`,
 * or `null` for events with no UI representation.
 */
export function mapStrandsEvent(event: AgentStreamEvent): AgentEvent | null {
  switch (event.type) {
    // Incremental model output: plain text and reasoning deltas.
    case 'modelStreamUpdateEvent': {
      if (event.event.type !== 'modelContentBlockDeltaEvent') return null;
      const delta = event.event.delta;

      if (delta.type === 'textDelta' && delta.text) {
        return { type: 'text', text: delta.text };
      }
      if (delta.type === 'reasoningContentDelta' && delta.text) {
        return { type: 'thinking', text: delta.text };
      }
      return null;
    }

    // A tool call becomes visible once its block is fully assembled, so the
    // arguments are complete JSON rather than a partial fragment.
    case 'contentBlockEvent': {
      const block = event.contentBlock;
      if (block.type !== 'toolUseBlock') return null;
      return {
        type: 'tool_call',
        name: block.name,
        arguments: toArgumentsRecord(block.input),
        callId: block.toolUseId,
      };
    }

    case 'toolResultEvent': {
      const result = event.result;
      if (result.status === 'error') {
        return {
          type: 'tool_result',
          callId: result.toolUseId,
          result: result.error?.message ?? extractToolResultText(result.content),
        };
      }
      return {
        type: 'tool_result',
        callId: result.toolUseId,
        result: extractToolResultText(result.content),
      };
    }

    case 'agentResultEvent':
      return {
        type: 'complete',
        interaction: {
          stopReason: event.result.stopReason,
          ...(event.result.structuredOutput === undefined
            ? {}
            : { structuredOutput: event.result.structuredOutput }),
        },
      };

    default:
      return null;
  }
}

/**
 * Runs the agent and yields `AgentEvent`s, closing with a `done` event.
 * Errors are surfaced as an `error` event instead of throwing, matching the
 * behaviour of `streamInteraction` in `agentClient.ts`.
 */
export async function* streamStrandsAgent(
  agent: Agent,
  prompt: string,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  try {
    for await (const event of agent.stream(prompt, signal ? { cancelSignal: signal } : {})) {
      const mapped = mapStrandsEvent(event);
      if (mapped) yield mapped;
    }
    yield { type: 'done' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[strandsAgent] Agent stream failed:', message);
    yield { type: 'error', message };
  }
}

/* ────────────────────────────────────────────────────────── */
/*  Helpers                                                    */
/* ────────────────────────────────────────────────────────── */

/** Tool input is any JSON value; the event contract expects an object. */
function toArgumentsRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { value: input ?? null };
}

/** Concatenates the text parts of a tool result, falling back to JSON. */
function extractToolResultText(content: readonly unknown[]): string {
  const parts = content.map((part) => {
    if (part && typeof part === 'object' && 'type' in part) {
      const block = part as { type: string; text?: string; json?: unknown };
      if (block.type === 'textBlock' && typeof block.text === 'string') return block.text;
      if (block.type === 'jsonBlock') return JSON.stringify(block.json);
    }
    return JSON.stringify(part);
  });
  return parts.join('');
}
