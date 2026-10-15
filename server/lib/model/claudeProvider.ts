/**
 * Claude Opus 5.5 provider for the Strands agent runner.
 *
 * Two transports reach the same model:
 *
 *  - **Anthropic API** (`AnthropicModel`), chosen when `ANTHROPIC_API_KEY` is set.
 *  - **Amazon Bedrock** (`BedrockModel`), the fallback. Credentials come from
 *    the default AWS chain (instance role, profile, env vars), so a server on
 *    EC2 needs no secret at all. Opus 5.5 is only served through inference
 *    profiles on Bedrock, so bare model ids are prefixed (`us.anthropic.…`).
 *
 * `CLAUDE_PROVIDER` forces one of the two. `CLAUDE_MODEL_ID` overrides the
 * model; the request `model` field takes precedence over both.
 */

import { AnthropicModel } from '@strands-agents/sdk/models/anthropic';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import type { JSONValue, Model } from '@strands-agents/sdk';

export const CLAUDE_PROVIDERS = ['anthropic', 'bedrock'] as const;
export type ClaudeProvider = (typeof CLAUDE_PROVIDERS)[number];

/** Model every run uses unless the request or `CLAUDE_MODEL_ID` says otherwise. */
export const DEFAULT_CLAUDE_MODEL_ID = 'claude-opus-5-5';

/** Region used for Bedrock when neither `BEDROCK_REGION` nor `AWS_REGION` is set. */
export const DEFAULT_BEDROCK_REGION = 'us-east-1';

/**
 * Inference profile prefix applied to bare Anthropic ids on Bedrock. Opus 5.5
 * has no on-demand throughput under its bare id, so `claude-opus-5-5` becomes
 * `us.anthropic.claude-opus-5-5`. Override with `BEDROCK_MODEL_PREFIX`
 * (for instance `global.`).
 */
export const DEFAULT_BEDROCK_MODEL_PREFIX = 'us.';

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * Reasoning effort. Opus 5.5 defaults to `medium`; the agents here write
 * research reports, so the default is raised. Override with `CLAUDE_EFFORT`.
 */
export const DEFAULT_EFFORT: EffortLevel = 'high';

/** Output token ceiling passed to the model on every call. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 65_536;

/**
 * Anthropic ids (`claude-opus-5-5`), Bedrock ids (`us.anthropic.claude-opus-5-5`,
 * `anthropic.claude-opus-4-5-20251101-v1:0`) and inference profile ARNs.
 */
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{1,200}$/i;

const BARE_CLAUDE_ID_PATTERN = /^claude-[a-z0-9.-]+$/i;

/** Picks the transport: a forced `CLAUDE_PROVIDER`, else the key decides. */
export function resolveClaudeProvider(env: NodeJS.ProcessEnv = process.env): ClaudeProvider {
  const forced = env.CLAUDE_PROVIDER?.trim().toLowerCase();
  if (forced === 'anthropic' || forced === 'bedrock') return forced;
  return env.ANTHROPIC_API_KEY ? 'anthropic' : 'bedrock';
}

/**
 * True when a model can be built. Bedrock reads credentials lazily from the
 * AWS chain, so only the Anthropic transport can be ruled out up front.
 */
export function isClaudeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveClaudeProvider(env) === 'bedrock' || Boolean(env.ANTHROPIC_API_KEY);
}

/** First well-formed id among the request, `CLAUDE_MODEL_ID` and the default. */
export function resolveClaudeModelId(
  requested?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const candidate of [requested, env.CLAUDE_MODEL_ID]) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (MODEL_ID_PATTERN.test(trimmed)) return trimmed;
  }
  return DEFAULT_CLAUDE_MODEL_ID;
}

/** Bedrock form of a model id: bare Anthropic ids get the inference profile prefix. */
export function toBedrockModelId(modelId: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!BARE_CLAUDE_ID_PATTERN.test(modelId)) return modelId;
  const prefix = env.BEDROCK_MODEL_PREFIX?.trim() ?? DEFAULT_BEDROCK_MODEL_PREFIX;
  return `${prefix}anthropic.${modelId}`;
}

export function resolveBedrockRegion(env: NodeJS.ProcessEnv = process.env): string {
  return env.BEDROCK_REGION?.trim() || env.AWS_REGION?.trim() || DEFAULT_BEDROCK_REGION;
}

export function resolveEffort(env: NodeJS.ProcessEnv = process.env): EffortLevel {
  const raw = env.CLAUDE_EFFORT?.trim().toLowerCase();
  return (EFFORT_LEVELS as readonly string[]).includes(raw ?? '')
    ? (raw as EffortLevel)
    : DEFAULT_EFFORT;
}

/**
 * Request fields Opus 5.5 needs beyond the SDK defaults, identical on both
 * transports (Bedrock forwards them as `additionalModelRequestFields`).
 *
 *  - Thinking is always on for this model; `display: 'summarized'` is what
 *    makes the reasoning visible, and the UI timeline renders it.
 *  - `effort` is the only depth control: `temperature` and thinking budgets
 *    are rejected with a 400.
 */
export function claudeRequestFields(effort: EffortLevel = resolveEffort()): Record<string, JSONValue> {
  return {
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort },
  };
}

export interface ClaudeModelOptions {
  /** Model id override. Falls back to `CLAUDE_MODEL_ID`, then the default. */
  modelId?: unknown;
  env?: NodeJS.ProcessEnv;
}

/** Builds the Strands model for the configured transport. */
export function createClaudeModel(options: ClaudeModelOptions = {}): Model {
  const env = options.env ?? process.env;
  const modelId = resolveClaudeModelId(options.modelId, env);
  const fields = claudeRequestFields(resolveEffort(env));

  if (resolveClaudeProvider(env) === 'anthropic') {
    return new AnthropicModel({
      modelId,
      apiKey: env.ANTHROPIC_API_KEY,
      maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      params: fields,
    });
  }

  return new BedrockModel({
    modelId: toBedrockModelId(modelId, env),
    region: resolveBedrockRegion(env),
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    additionalRequestFields: fields,
  });
}
