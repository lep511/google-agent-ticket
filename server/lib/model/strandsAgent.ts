/**
 * Agent runner, built on the Strands Agents SDK (TypeScript).
 *
 * This is the only runner: `/api/analyze` builds an agent here and streams it to
 * the browser. The agent loop runs in this process.
 *
 * Model: Claude Opus 5.5, through the Anthropic API when `ANTHROPIC_API_KEY` is
 * set and through Amazon Bedrock otherwise. See `claudeProvider.ts` for the
 * transport choice and the request fields the model needs.
 *
 * Final answer: the agent is given `structuredOutputSchema`, so the SDK
 * registers an internal tool the model calls with the finished report and the
 * validated object surfaces on `complete.interaction.structuredOutput`. That
 * tool's call and result are filtered out of the event stream here, so the
 * timeline shows only the agent's own tools.
 *
 * Docs: https://strandsagents.com/docs/user-guide/quickstart/typescript/
 */

import {
  Agent,
  DefaultModelRetryStrategy,
  InvokeModelStage,
  McpClient,
  Message,
  ModelThrottledError,
  TextBlock,
  type AgentStreamEvent,
  type InvokeModelContext,
  type ToolList,
} from '@strands-agents/sdk';
import type { ZodType } from 'zod';

import type { AgentEvent, AgentUsage } from '../agent/agentEvents.ts';
import { createClaudeModel, isClaudeConfigured } from './claudeProvider.ts';

export { DEFAULT_MAX_OUTPUT_TOKENS } from './claudeProvider.ts';

/* ────────────────────────────────────────────────────────── */
/*  Configuration                                              */
/* ────────────────────────────────────────────────────────── */

export interface StrandsAgentOptions {
  /** System prompt guiding the agent, normally the agent's `AGENTS.md`. */
  systemPrompt?: string;
  /** Model id override. Falls back to the `CLAUDE_MODEL_ID` env var. */
  modelId?: string;
  /** Extra function tools created with the SDK's `tool()` helper. */
  tools?: ToolList;
  /** Zod schema the final answer must satisfy, exposed as `result.structuredOutput`. */
  structuredOutputSchema?: ZodType;
  /** MCP clients to attach to the agent. */
  mcpClients?: McpClient[];
}

/** Model attempts before a run gives up, counting the first one. */
export const MAX_MODEL_ATTEMPTS = 4;

/**
 * Name of the tool the SDK registers for `structuredOutputSchema`. Declared in
 * `node_modules/@strands-agents/sdk/dist/src/tools/structured-output-tool.js`
 * but not re-exported from the package root, and the package `exports` block
 * the deep path, so it is mirrored here. `strandsAgent.test.ts` checks the
 * literal against the SDK source.
 */
export const STRUCTURED_OUTPUT_TOOL_NAME = 'strands_structured_output';

/**
 * Appended to the last user message when the SDK wants to force the structured
 * output tool. Claude Opus 5.5 rejects a forced `toolChoice` (`tool` and `any`
 * both return a 400, on the Anthropic API and on Bedrock), so the force becomes
 * `auto` plus this instruction.
 */
export const STRUCTURED_OUTPUT_REMINDER =
  `Submit the final report now by calling the ${STRUCTURED_OUTPUT_TOOL_NAME} tool. Do not answer in text.`;

/** True when a Claude model can be built with the current environment. */
export function isStrandsConfigured(): boolean {
  return isClaudeConfigured();
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
 * Builds an agent backed by Claude Opus 5.5.
 *
 * Console printing is disabled: this server streams events to the browser and
 * writes its own run logs, so the SDK's stdout printer would only duplicate them.
 */
export function createStrandsAgent(options: StrandsAgentOptions = {}): Agent {
  const model = createClaudeModel({ modelId: options.modelId });

  const tools: ToolList = [...(options.tools ?? [])];

  const agent = new Agent({
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

  if (options.structuredOutputSchema !== undefined) {
    agent.addMiddleware(InvokeModelStage.Input, relaxForcedStructuredOutput);
  }

  return agent;
}

/**
 * Model-call middleware: turns the SDK's forced structured output call into a
 * plain request.
 *
 * When the model ends a turn in prose instead of calling the structured output
 * tool, the SDK drops that answer and retries with `toolChoice` pinned to the
 * tool. Claude Opus 5.5 answers that pin with a 400, which would end the run
 * with the report one call away. The pin is removed and the same demand is made
 * in words, appended to the last user message the model is about to read. Any
 * other `toolChoice` passes through untouched.
 */
export function relaxForcedStructuredOutput(context: InvokeModelContext): InvokeModelContext {
  const forced = (context.toolChoice as { tool?: { name?: string } } | undefined)?.tool?.name;
  if (forced !== STRUCTURED_OUTPUT_TOOL_NAME) return context;

  const messages = [...context.messages];
  const last = messages[messages.length - 1];
  if (last !== undefined && last.role === 'user') {
    messages[messages.length - 1] = new Message({
      role: 'user',
      content: [...last.content, new TextBlock(STRUCTURED_OUTPUT_REMINDER)],
    });
  }

  return { ...context, toolChoice: undefined, messages };
}

/**
 * Decides which SDK events belong to the structured output tool, so the stream
 * can drop them. The tool use block carries the name but its result carries
 * only the `toolUseId`, so the ids seen on the way in are remembered until the
 * matching result goes by. A rejected submission is logged: the model retries
 * it at the cost of a turn, and nothing else makes that visible.
 */
export function createStructuredOutputFilter(): (event: AgentStreamEvent) => boolean {
  const pending = new Set<string>();

  return (event) => {
    if (event.type === 'contentBlockEvent') {
      const block = event.contentBlock;
      if (block.type === 'toolUseBlock' && block.name === STRUCTURED_OUTPUT_TOOL_NAME) {
        pending.add(block.toolUseId);
        return true;
      }
      return false;
    }

    if (event.type === 'toolResultEvent' && pending.delete(event.result.toolUseId)) {
      if (event.result.status === 'error') {
        console.warn(
          `[agent] Structured output rejected, the model will retry: ${event.result.error?.message ?? extractToolResultText(event.result.content)}`,
        );
      }
      return true;
    }

    return false;
  };
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
 * Turn budget of the salvage pass. Three turns: one call to the structured
 * output tool, one retry if that submission fails validation, and one more in
 * case the model answers in prose first and has to be asked again.
 */
export const SALVAGE_TURNS = 3;

/**
 * Prompt of the salvage pass. Nothing new is researched: the point is to spend
 * what was already gathered instead of throwing the whole run away. The report
 * still has to go through the structured output tool, so research tools are
 * what is forbidden, not tools as such.
 */
export const SALVAGE_PROMPT = [
  'You have run out of research turns. Stop searching now.',
  'Do not call any research tool again.',
  'Submit the final report through the structured output tool, built from the information you',
  'have already gathered, and leave out or mark as unavailable whatever you could not confirm.',
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
 * report with no further research turns a wasted run into a report built from
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

  // One filter for the whole run: a structured output call started in the
  // first pass is never answered in the salvage pass, but sharing it costs
  // nothing and keeps the two passes indistinguishable to the caller.
  const isStructuredOutputEvent = createStructuredOutputFilter();

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
      if (isStructuredOutputEvent(event)) continue;
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

/**
 * Reads a provider status code. The Anthropic SDK exposes it as `status`, the
 * AWS SDK (Bedrock) as `$metadata.httpStatusCode`.
 */
function readStatusCode(value: unknown): number | null {
  const record = value as
    | { statusCode?: unknown; status?: unknown; $metadata?: { httpStatusCode?: unknown } }
    | null;
  const candidate = record?.statusCode ?? record?.status ?? record?.$metadata?.httpStatusCode;
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
