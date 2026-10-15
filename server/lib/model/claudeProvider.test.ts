import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLAUDE_MODEL_ID,
  DEFAULT_EFFORT,
  claudeRequestFields,
  isClaudeConfigured,
  resolveBedrockRegion,
  resolveClaudeModelId,
  resolveClaudeProvider,
  resolveEffort,
  toBedrockModelId,
} from './claudeProvider.ts';

describe('resolveClaudeProvider', () => {
  it('uses the Anthropic API when a key is present and Bedrock otherwise', () => {
    expect(resolveClaudeProvider({ ANTHROPIC_API_KEY: 'sk-ant-test' })).toBe('anthropic');
    expect(resolveClaudeProvider({})).toBe('bedrock');
  });

  it('lets CLAUDE_PROVIDER force the transport', () => {
    expect(resolveClaudeProvider({ ANTHROPIC_API_KEY: 'sk-ant-test', CLAUDE_PROVIDER: 'bedrock' })).toBe('bedrock');
    expect(resolveClaudeProvider({ CLAUDE_PROVIDER: ' Anthropic ' })).toBe('anthropic');
    expect(resolveClaudeProvider({ CLAUDE_PROVIDER: 'nonsense' })).toBe('bedrock');
  });
});

describe('isClaudeConfigured', () => {
  it('always holds for Bedrock, whose credentials come from the AWS chain', () => {
    expect(isClaudeConfigured({})).toBe(true);
  });

  it('needs the key when the Anthropic transport is forced', () => {
    expect(isClaudeConfigured({ CLAUDE_PROVIDER: 'anthropic' })).toBe(false);
    expect(isClaudeConfigured({ CLAUDE_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' })).toBe(true);
  });
});

describe('resolveClaudeModelId', () => {
  it('prefers the request, then the env var, then the default', () => {
    expect(resolveClaudeModelId('claude-sonnet-5-5', { CLAUDE_MODEL_ID: 'claude-opus-5' })).toBe('claude-sonnet-5-5');
    expect(resolveClaudeModelId(undefined, { CLAUDE_MODEL_ID: ' claude-opus-5 ' })).toBe('claude-opus-5');
    expect(resolveClaudeModelId(undefined, {})).toBe(DEFAULT_CLAUDE_MODEL_ID);
  });

  it('skips malformed candidates', () => {
    expect(resolveClaudeModelId('bad id with spaces', {})).toBe(DEFAULT_CLAUDE_MODEL_ID);
    expect(resolveClaudeModelId(42, { CLAUDE_MODEL_ID: '' })).toBe(DEFAULT_CLAUDE_MODEL_ID);
  });

  it('accepts Bedrock ids and inference profile ARNs', () => {
    const arn = 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-opus-5-5';
    expect(resolveClaudeModelId('anthropic.claude-opus-4-5-20251101-v1:0', {})).toBe('anthropic.claude-opus-4-5-20251101-v1:0');
    expect(resolveClaudeModelId(arn, {})).toBe(arn);
  });
});

describe('toBedrockModelId', () => {
  it('prefixes bare Anthropic ids with the inference profile', () => {
    expect(toBedrockModelId('claude-opus-5-5', {})).toBe('us.anthropic.claude-opus-5-5');
    expect(toBedrockModelId('claude-opus-5-5', { BEDROCK_MODEL_PREFIX: 'global.' })).toBe('global.anthropic.claude-opus-5-5');
  });

  it('leaves ids that already name a Bedrock model alone', () => {
    expect(toBedrockModelId('us.anthropic.claude-opus-5-5', {})).toBe('us.anthropic.claude-opus-5-5');
    expect(toBedrockModelId('anthropic.claude-opus-5-5', {})).toBe('anthropic.claude-opus-5-5');
    const arn = 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-opus-5-5';
    expect(toBedrockModelId(arn, {})).toBe(arn);
  });
});

describe('resolveBedrockRegion and resolveEffort', () => {
  it('reads BEDROCK_REGION before AWS_REGION before the default', () => {
    expect(resolveBedrockRegion({ BEDROCK_REGION: 'eu-west-1', AWS_REGION: 'us-west-2' })).toBe('eu-west-1');
    expect(resolveBedrockRegion({ AWS_REGION: 'us-west-2' })).toBe('us-west-2');
    expect(resolveBedrockRegion({})).toBe('us-east-1');
  });

  it('accepts only the known effort levels', () => {
    expect(resolveEffort({ CLAUDE_EFFORT: 'xhigh' })).toBe('xhigh');
    expect(resolveEffort({ CLAUDE_EFFORT: 'extreme' })).toBe(DEFAULT_EFFORT);
    expect(resolveEffort({})).toBe(DEFAULT_EFFORT);
  });
});

describe('claudeRequestFields', () => {
  it('turns on visible adaptive thinking and sets the effort explicitly', () => {
    expect(claudeRequestFields('medium')).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
    });
  });
});
