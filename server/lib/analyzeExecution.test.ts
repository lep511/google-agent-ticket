/**
 * Unit tests for the execution pieces of `POST /api/analyze`: the `agent_info`
 * event, the HTTP answer of a run that never starts, and the sequence that
 * closes the stream when a run fails midway.
 *
 
 */

import { describe, expect, it } from 'vitest';

import {
  AGENT_INFO_EVENT_TYPE,
  DEFAULT_STREAM_FAILURE_MESSAGE,
  buildAgentInfoEvent,
  buildStreamFailureEvents,
  describeAgentStartFailure,
  describeStreamFailure,
} from './analyzeExecution.ts';
import type { ResolvedAgentDefinition } from './agent/agentTypes.ts';

function definition(
  overrides: Partial<ResolvedAgentDefinition['manifest']> = {},
): ResolvedAgentDefinition {
  return {
    agentId: 'market_news_agent',
    manifest: {
      id: 'market_news_agent',
      name: 'Market News',
      tagline: 'Noticias del mercado',
      description: 'Resume las noticias recientes de un símbolo.',
      icon: 'Newspaper',
      accentColor: '#FFFFFF1A',
      order: 100,
      isDefault: false,
      inputMode: 'ticker',
      inputPlaceholder: 'AAPL',
      actionLabel: 'Resumir noticias',
      supportsInstruction: false,
      outputRenderer: 'simple_report',
      promptFile: 'prompt.md',
      schemaFile: 'output.schema.json',
      modelProvider: 'gemini',
      modelName: 'gemini-3.6-flash',
      tools: [],
      landing: null,
      ...overrides,
    },
    paths: {
      dir: '/tmp/agent/market_news_agent',
      manifestPath: '/tmp/agent/market_news_agent/manifest.json',
      agentsFilePath: '/tmp/agent/market_news_agent/AGENTS.md',
      promptPath: '/tmp/agent/market_news_agent/prompt.md',
      schemaPath: '/tmp/agent/market_news_agent/output.schema.json',
    },
  };
}

describe('buildAgentInfoEvent', () => {
  it('reports the resolved agentId, the display name and the renderer', () => {
    expect(buildAgentInfoEvent(definition())).toEqual({
      type: AGENT_INFO_EVENT_TYPE,
      agentId: 'market_news_agent',
      agentName: 'Market News',
      outputRenderer: 'simple_report',
    });
  });

  it('uses the renderer of the resolved agent manifest', () => {
    const event = buildAgentInfoEvent(
      definition({ outputRenderer: 'financial_report', name: 'Financial Analyst' }),
    );
    expect(event.outputRenderer).toBe('financial_report');
    expect(event.agentName).toBe('Financial Analyst');
  });

  it('exposes only the contract fields, without filesystem paths', () => {
    expect(Object.keys(buildAgentInfoEvent(definition())).sort()).toEqual([
      'agentId',
      'agentName',
      'outputRenderer',
      'type',
    ]);
  });
});

describe('closing the stream after a run fails', () => {
  it('emits error and then done, in that order', () => {
    const events = buildStreamFailureEvents('la conexión se cerró');
    expect(events).toEqual([
      { type: 'error', message: 'la conexión se cerró' },
      { type: 'done' },
    ]);
  });

  it('takes the message from an Error and falls back to a generic reason', () => {
    expect(describeStreamFailure(new Error('socket hang up'))).toBe('socket hang up');
    expect(describeStreamFailure(new Error(''))).toBe(DEFAULT_STREAM_FAILURE_MESSAGE);
    expect(describeStreamFailure(undefined)).toBe(DEFAULT_STREAM_FAILURE_MESSAGE);
    expect(describeStreamFailure('   ')).toBe(DEFAULT_STREAM_FAILURE_MESSAGE);
  });
});

describe('describeAgentStartFailure', () => {
  it('maps a rate limit to a retryable 429', () => {
    const failure = describeAgentStartFailure(429);
    expect(failure.status).toBe(429);
    expect(failure.body.code).toBe('upstream_rate_limited');
    expect(failure.body.retryable).toBe(true);
    expect(failure.body.upstreamStatus).toBe(429);
  });

  it('maps an unavailable service to a retryable 503', () => {
    for (const upstream of [503, 504]) {
      const failure = describeAgentStartFailure(upstream);
      expect(failure.status).toBe(503);
      expect(failure.body.code).toBe('upstream_unavailable');
      expect(failure.body.retryable).toBe(true);
      expect(failure.body.upstreamStatus).toBe(upstream);
    }
  });

  it('maps anything else to a non-retryable 502, including unknown statuses', () => {
    for (const upstream of [400, 401, 500, undefined, null, 'nope', Number.NaN]) {
      const failure = describeAgentStartFailure(upstream);
      expect(failure.status).toBe(502);
      expect(failure.body.code).toBe('upstream_error');
      expect(failure.body.retryable).toBe(false);
    }
    expect(describeAgentStartFailure(undefined).body.upstreamStatus).toBe(0);
  });
});
