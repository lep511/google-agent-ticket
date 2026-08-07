/**
 * Agent runner, built on the Strands Agents SDK (TypeScript).
 *
 * This is the only runner: `/api/analyze` builds an agent here and streams it to
 * the browser. The agent loop runs in this process, the model is Gemini reached
 * through the Vercel AI SDK provider, and web research happens through the
 * `google_search` tool in `googleSearchTool.ts`.
 *
 * The SDK stream is mapped onto the `AgentEvent` union the SSE endpoint has
 * always emitted, so the browser contract is unchanged.
 *
 * Docs: https://strandsagents.com/docs/user-guide/quickstart/typescript/
 */

import {
  Agent,
  DefaultModelRetryStrategy,
  ModelThrottledError,
  type AgentStreamEvent,
  type ToolList,
} from '@strands-agents/sdk';
import { VercelModel } from '@strands-agents/sdk/models/vercel';
import type { ZodType } from 'zod';

import type { AgentEvent, AgentUsage } from './agentEvents.ts';
import {
  createGeminiProvider,
  isGeminiConfigured,
  resolveGeminiModelId,
} from './geminiProvider.ts';
import { createGoogleSearchTool } from './googleSearchTool.ts';

/* ────────────────────────────────────────────────────────── */
/*  Configuration                                              */
/* ────────────────────────────────────────────────────────── */

export interface StrandsAgentOptions {
  /** System prompt guiding the agent, normally the agent's `AGENTS.md`. */
  systemPrompt?: string;
  /** Gemini model id. Falls back to `GEMINI_MODEL_ID` and then the default. */
  modelId?: string;
  /** Sampling temperature forwarded to the model. */
  temperature?: number;
  /** Extra function tools created with the SDK's `tool()` helper. */
  tools?: ToolList;
  /** Adds the `google_search` tool. Defaults to `false`. */
  googleSearch?: boolean;
  /** Zod schema the final answer must satisfy, exposed as `result.structuredOutput`. */
  structuredOutputSchema?: ZodType;
}

/** Model attempts before a run gives up, counting the first one. */
export const MAX_MODEL_ATTEMPTS = 4;

/** True when the server has the credentials the runner needs. */
export function isStrandsConfigured(): boolean {
  return isGeminiConfigured();
}

/**
 * Retries throttling, as the SDK does by default, plus transient server errors.
 *
 * A research run makes one model call per tool cycle, so a single 500 or 503 from
 * the Gemini endpoint halfway through would throw away all the searches done so
 * far. Those statuses are transient by definition, so they are worth another
 * attempt with the same backoff.
 */
export class GeminiRetryStrategy extends DefaultModelRetryStrategy {
  protected override isRetryable(error: Error): boolean {
    return super.isRetryable(error) || classifyAgentFailureStatus(error) >= 500;
  }
}

/**
 * Builds an agent backed by Gemini.
 *
 * Console printing is disabled: this server streams events to the browser and
 * writes its own run logs, so the SDK's stdout printer would only duplicate them.
 */
export function createStrandsAgent(options: StrandsAgentOptions = {}): Agent {
  const google = createGeminiProvider();

  const model = new VercelModel({
    provider: google(resolveGeminiModelId(options.modelId)),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
  });

  const tools: ToolList = [
    ...(options.googleSearch ? [createGoogleSearchTool()] : []),
    ...(options.tools ?? []),
  ];

  return new Agent({
    model,
    printer: false,
    // A strategy instance keeps per-turn backoff state, so it belongs to this
    // agent and must not be shared.
    retryStrategy: new GeminiRetryStrategy({ maxAttempts: MAX_MODEL_ATTEMPTS }),
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    ...(tools.length === 0 ? {} : { tools }),
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

    case 'agentResultEvent': {
      const usage = extractUsage(event.result);
      return {
        type: 'complete',
        interaction: {
          stopReason: event.result.stopReason,
          ...(usage === null ? {} : { usage }),
          ...(event.result.structuredOutput === undefined
            ? {}
            : { structuredOutput: event.result.structuredOutput }),
        },
      };
    }

    default:
      return null;
  }
}

/**
 * Runs the agent and yields `AgentEvent`s, closing with a `done` event.
 *
 * Failures are thrown, not turned into events: only the caller knows whether
 * anything has been written to the client yet, and therefore whether the run can
 * still be rejected with an HTTP status or has to be closed inside the stream.
 */
export async function* streamStrandsAgent(
  agent: Agent,
  prompt: string,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  for await (const event of agent.stream(prompt, signal ? { cancelSignal: signal } : {})) {
    const mapped = mapStrandsEvent(event);
    if (mapped) yield mapped;
  }
  yield { type: 'done' };
}

/* ────────────────────────────────────────────────────────── */
/*  Failure classification                                     */
/* ────────────────────────────────────────────────────────── */

/**
 * HTTP status that best describes why a run could not start.
 *
 * The SDK wraps provider failures in its own error types and keeps the original
 * API error as `cause`, so a quota limit stays distinguishable from a broken
 * request and the endpoint can answer 429 instead of a blanket 500.
 */
export function classifyAgentFailureStatus(error: unknown): number {
  if (error instanceof ModelThrottledError) return 429;

  const status = readStatusCode(error) ?? readStatusCode((error as { cause?: unknown })?.cause);
  if (status !== null) return status;

  return 0;
}

/** Reads a provider status code, which the AI SDK exposes as `statusCode`. */
function readStatusCode(value: unknown): number | null {
  const candidate = (value as { statusCode?: unknown; status?: unknown } | null)?.statusCode ??
    (value as { status?: unknown } | null)?.status;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return null;
  return candidate >= 400 && candidate <= 599 ? Math.trunc(candidate) : null;
}

/* ────────────────────────────────────────────────────────── */
/*  Helpers                                                    */
/* ────────────────────────────────────────────────────────── */

/**
 * Readable reason for a failed run.
 *
 * The SDK classifies provider failures into its own error types, and their names
 * are what tells a quota limit apart from a context overflow, so the name travels
 * with the message instead of being dropped.
 */
export function describeAgentFailure(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && error.name && error.name !== 'Error') return `${error.name}: ${message}`;
    if (message) return message;
  }
  return String(error);
}

/** Token accounting of the run, in the shape the frontend already reads. */
function extractUsage(result: { metrics?: unknown }): AgentUsage | null {
  const accumulated = (result.metrics as { accumulatedUsage?: Record<string, unknown> } | undefined)
    ?.accumulatedUsage;
  if (!accumulated) return null;

  const inputTokens = toCount(accumulated['inputTokens']);
  const outputTokens = toCount(accumulated['outputTokens']);
  const totalTokens = toCount(accumulated['totalTokens']) || inputTokens + outputTokens;
  if (totalTokens === 0) return null;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

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
