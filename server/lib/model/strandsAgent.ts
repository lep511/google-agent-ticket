/**
 * Agent runner, built on the Strands Agents SDK (TypeScript).
 *
 * This is the only runner: `/api/analyze` builds an agent here and streams it to
 * the browser. The agent loop runs in this process.
 *
 * Model provider: NVIDIA NIM via the OpenAI-compatible endpoint at
 * integrate.api.nvidia.com, using the Strands `OpenAIModel` in Chat Completions
 * mode. Configured through `NVIDIA_API_KEY` and `NVIDIA_MODEL_ID` env vars.
 *
 * Docs: https://strandsagents.com/docs/user-guide/quickstart/typescript/
 */

import {
  Agent,
  DefaultModelRetryStrategy,
  McpClient,
  ModelThrottledError,
  type AgentStreamEvent,
  type ToolList,
} from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import type { ZodType } from 'zod';

import type { AgentEvent, AgentUsage } from '../agent/agentEvents.ts';
import {
  NVIDIA_BASE_URL,
  isNvidiaConfigured,
  resolveNvidiaModelId,
} from './nvidiaProvider.ts';

/* ────────────────────────────────────────────────────────── */
/*  Configuration                                              */
/* ────────────────────────────────────────────────────────── */

export interface StrandsAgentOptions {
  /** System prompt guiding the agent, normally the agent's `AGENTS.md`. */
  systemPrompt?: string;
  /** Model id override. Falls back to NVIDIA_MODEL_ID env var. */
  modelId?: string;
  /** Sampling temperature forwarded to the model. */
  temperature?: number;
  /** Extra function tools created with the SDK's `tool()` helper. */
  tools?: ToolList;
  /** Zod schema the final answer must satisfy, exposed as `result.structuredOutput`. */
  structuredOutputSchema?: ZodType;
  /** MCP clients to attach to the agent. */
  mcpClients?: McpClient[];
}

/** Model attempts before a run gives up, counting the first one. */
export const MAX_MODEL_ATTEMPTS = 4;

/** Output token ceiling passed to the model on every call. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 65_536;

/** True when the server has the NVIDIA API key configured. */
export function isStrandsConfigured(): boolean {
  return isNvidiaConfigured();
}

/**
 * Retries throttling, transient server errors, and malformed function calls.
 */
export class RetryStrategy extends DefaultModelRetryStrategy {
  protected override isRetryable(error: Error): boolean {
    if (super.isRetryable(error)) return true;
    if (classifyAgentFailureStatus(error) >= 500) return true;
    if (error.message?.includes('MALFORMED_FUNCTION_CALL')) return true;
    return false;
  }
}

/**
 * Builds an agent backed by NVIDIA NIM (OpenAI-compatible).
 *
 * Console printing is disabled: this server streams events to the browser and
 * writes its own run logs, so the SDK's stdout printer would only duplicate them.
 */
export function createStrandsAgent(options: StrandsAgentOptions = {}): Agent {
  const model = new OpenAIModel({
    api: 'chat',
    modelId: resolveNvidiaModelId(options.modelId),
    apiKey: process.env.NVIDIA_API_KEY,
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    clientConfig: { baseURL: NVIDIA_BASE_URL },
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
  });

  const tools: ToolList = [...(options.tools ?? [])];

  return new Agent({
    model,
    printer: false,
    retryStrategy: new RetryStrategy({ maxAttempts: MAX_MODEL_ATTEMPTS }),
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    ...(tools.length === 0 ? {} : { tools }),
    ...(options.mcpClients?.length ? { mcpClients: options.mcpClients } : {}),
    ...(options.structuredOutputSchema === undefined
      ? {}
      : { structuredOutputSchema: options.structuredOutputSchema }),
  });
}

/* ────────────────────────────────────────────────────────── */
/*  MCP client loading                                         */
/* ────────────────────────────────────────────────────────── */

let _mcpClientsPromise: Promise<McpClient[]> | null = null;

/**
 * Lazily loads MCP clients from the config file at `MCP_CONFIG_PATH`.
 * Returns an empty array when the env var is unset. Caches the result.
 */
export async function loadMcpClients(): Promise<McpClient[]> {
  if (_mcpClientsPromise) return _mcpClientsPromise;

  const configPath = process.env.MCP_CONFIG_PATH;
  if (!configPath) return [];

  _mcpClientsPromise = McpClient.loadServers(configPath);
  return _mcpClientsPromise;
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
 * Maximum number of agent-loop turns (one model call + tool execution each).
 * Prevents runaway loops when the model keeps calling tools without producing
 * a final answer — e.g. retrying a rate-limited search tool indefinitely.
 *
 * The ceiling has to leave room for the turn that writes the final answer, on
 * top of every research turn the agent needs. Research-heavy agents spend one
 * turn per tool call: `financial_analyst_agent` alone asks for several filings
 * plus separate searches for monthly closing prices and quarterly figures, so a
 * tight ceiling ended the loop before the report was ever written. The run then
 * finished with tool traces and no final text, which is indistinguishable from
 * a model that simply said nothing.
 */
export const MAX_AGENT_TURNS = 50;

/** `stopReason` the SDK reports when `limits.turns` trips. */
export const TURN_LIMIT_STOP_REASON = 'limitTurns';

/**
 * Turn budget of the salvage pass. Two turns, so a model that answers with one
 * last tool call still gets a turn to write the report from its result.
 */
export const SALVAGE_TURNS = 2;

/**
 * Prompt of the salvage pass. Nothing new is researched: the point is to spend
 * what was already gathered instead of throwing the whole run away.
 */
export const SALVAGE_PROMPT = [
  'You have run out of research turns. Stop searching now.',
  'Do NOT call any tool again.',
  'Write the final report from the information you have already gathered, following the',
  'output format you were given, and leave out or mark as unavailable whatever you could',
  'not confirm.',
].join(' ');

/** Adds up the token accounting of the passes a run went through. */
function mergeUsage(first: AgentUsage | null, second: AgentUsage | null): AgentUsage | null {
  if (first === null) return second;
  if (second === null) return first;
  return {
    input_tokens: first.input_tokens + second.input_tokens,
    output_tokens: first.output_tokens + second.output_tokens,
    total_tokens: first.total_tokens + second.total_tokens,
  };
}

/**
 * Runs the agent and yields `AgentEvent`s, closing with a `done` event.
 *
 * When the turn budget trips, the SDK cuts the loop at the top of the next
 * iteration and returns `stopReason: 'limitTurns'` without ever asking the model
 * for an answer, so everything the agent had researched was lost and the run
 * ended with tool traces and no report. This runs a salvage pass in that case:
 * the agent keeps its conversation, so one more invocation asking it to write the
 * report with no further tool calls turns a wasted run into a report built from
 * partial research.
 *
 * Exactly one `complete` event reaches the caller, because that is the event the
 * SSE endpoint closes the stream on. The result of the first pass is therefore
 * held back until it is known whether a salvage pass follows, and the `complete`
 * finally emitted carries the tokens of every pass.
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
  const options = (turns: number) => ({
    ...(signal ? { cancelSignal: signal } : {}),
    limits: { turns },
  });

  /**
   * Consumes one pass, yielding everything but its result event, and returns
   * that result so the caller decides when — and as what — it is emitted.
   */
  async function* runPass(
    passPrompt: string,
    turns: number,
  ): AsyncGenerator<AgentEvent, AgentEvent | null> {
    let result: AgentEvent | null = null;

    for await (const event of agent.stream(passPrompt, options(turns))) {
      const mapped = mapStrandsEvent(event);
      if (mapped === null) continue;
      if (mapped.type === 'complete') {
        result = mapped;
        continue;
      }
      yield mapped;
    }

    return result;
  }

  const first = yield* runPass(prompt, MAX_AGENT_TURNS);
  let outcome = first;

  if (first?.interaction?.stopReason === TURN_LIMIT_STOP_REASON) {
    console.warn(
      `[agent] Turn budget of ${MAX_AGENT_TURNS} spent with no report; asking for a final answer from what was gathered.`,
    );
    const salvaged = yield* runPass(SALVAGE_PROMPT, SALVAGE_TURNS);

    if (salvaged !== null) {
      outcome = {
        ...salvaged,
        interaction: {
          ...salvaged.interaction,
          // The tokens of both passes, so the reported cost is the run's real one.
          ...(() => {
            const usage = mergeUsage(
              (first.interaction?.usage as AgentUsage | undefined) ?? null,
              (salvaged.interaction?.usage as AgentUsage | undefined) ?? null,
            );
            return usage === null ? {} : { usage };
          })(),
          // Kept so the browser can tell the user the report came out of a run
          // whose research was cut short.
          turnLimitReached: true,
        },
      };
    }
  }

  if (outcome !== null) yield outcome;
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
