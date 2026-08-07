/**
 * Unit tests for the Strands runner: the translation of SDK stream events into
 * the `AgentEvent` contract the browser consumes, the token accounting attached
 * to the `complete` event, and the classification of a failed start.
 */

import { ModelThrottledError } from '@strands-agents/sdk';
import type { Agent, AgentStreamEvent } from '@strands-agents/sdk';
import { describe, expect, it } from 'vitest';

import {
  GeminiRetryStrategy,
  MAX_MODEL_ATTEMPTS,
  classifyAgentFailureStatus,
  describeAgentFailure,
  mapStrandsEvent,
  streamStrandsAgent,
} from './strandsAgent.ts';

/** Builds a stream event without restating the whole SDK type in every test. */
function event(value: unknown): AgentStreamEvent {
  return value as AgentStreamEvent;
}

function textDelta(text: string): AgentStreamEvent {
  return event({
    type: 'modelStreamUpdateEvent',
    event: { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text } },
  });
}

describe('mapStrandsEvent', () => {
  it('maps text deltas to text events', () => {
    expect(mapStrandsEvent(textDelta('Nvidia '))).toEqual({ type: 'text', text: 'Nvidia ' });
  });

  it('maps reasoning deltas to thinking events', () => {
    const mapped = mapStrandsEvent(
      event({
        type: 'modelStreamUpdateEvent',
        event: {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'reasoningContentDelta', text: 'Planning the searches' },
        },
      }),
    );
    expect(mapped).toEqual({ type: 'thinking', text: 'Planning the searches' });
  });

  it('ignores empty deltas and events with no UI representation', () => {
    expect(
      mapStrandsEvent(
        event({
          type: 'modelStreamUpdateEvent',
          event: { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: '' } },
        }),
      ),
    ).toBeNull();
    expect(mapStrandsEvent(event({ type: 'beforeModelCallEvent' }))).toBeNull();
    expect(
      mapStrandsEvent(event({ type: 'contentBlockEvent', contentBlock: { type: 'textBlock', text: 'x' } })),
    ).toBeNull();
  });

  it('maps an assembled tool use block to a tool_call with complete arguments', () => {
    const mapped = mapStrandsEvent(
      event({
        type: 'contentBlockEvent',
        contentBlock: {
          type: 'toolUseBlock',
          name: 'google_search',
          input: { query: 'NVDA 10-Q filetype:pdf' },
          toolUseId: 'call-1',
        },
      }),
    );

    expect(mapped).toEqual({
      type: 'tool_call',
      name: 'google_search',
      arguments: { query: 'NVDA 10-Q filetype:pdf' },
      callId: 'call-1',
    });
  });

  it('wraps a non-object tool input so the contract keeps an arguments object', () => {
    const mapped = mapStrandsEvent(
      event({
        type: 'contentBlockEvent',
        contentBlock: { type: 'toolUseBlock', name: 'noop', input: 'plain', toolUseId: 'call-2' },
      }),
    );
    expect(mapped?.arguments).toEqual({ value: 'plain' });
  });

  it('flattens tool results and reports tool errors with their message', () => {
    expect(
      mapStrandsEvent(
        event({
          type: 'toolResultEvent',
          result: {
            status: 'success',
            toolUseId: 'call-1',
            content: [{ type: 'textBlock', text: 'first ' }, { type: 'jsonBlock', json: { ok: true } }],
          },
        }),
      ),
    ).toEqual({ type: 'tool_result', callId: 'call-1', result: 'first {"ok":true}' });

    expect(
      mapStrandsEvent(
        event({
          type: 'toolResultEvent',
          result: {
            status: 'error',
            toolUseId: 'call-3',
            content: [],
            error: { message: 'search timed out' },
          },
        }),
      ),
    ).toEqual({ type: 'tool_result', callId: 'call-3', result: 'search timed out' });
  });

  it('closes with a complete event carrying the stop reason and the token usage', () => {
    const mapped = mapStrandsEvent(
      event({
        type: 'agentResultEvent',
        result: {
          stopReason: 'endTurn',
          metrics: { accumulatedUsage: { inputTokens: 26, outputTokens: 519, totalTokens: 545 } },
        },
      }),
    );

    expect(mapped).toEqual({
      type: 'complete',
      interaction: {
        stopReason: 'endTurn',
        usage: { input_tokens: 26, output_tokens: 519, total_tokens: 545 },
      },
    });
  });

  it('omits the usage when the run reported no tokens', () => {
    const mapped = mapStrandsEvent(
      event({ type: 'agentResultEvent', result: { stopReason: 'endTurn', metrics: {} } }),
    );
    expect(mapped).toEqual({ type: 'complete', interaction: { stopReason: 'endTurn' } });
  });

  it('forwards the structured output when the agent produced one', () => {
    const mapped = mapStrandsEvent(
      event({
        type: 'agentResultEvent',
        result: { stopReason: 'endTurn', structuredOutput: { summary: 'ok' } },
      }),
    );
    expect(mapped?.interaction).toMatchObject({ structuredOutput: { summary: 'ok' } });
  });
});

describe('streamStrandsAgent', () => {
  /** Minimal agent double: only `stream` is exercised by the runner. */
  function fakeAgent(events: AgentStreamEvent[], failure?: unknown): Agent {
    return {
      async *stream() {
        for (const value of events) yield value;
        if (failure) throw failure;
      },
    } as unknown as Agent;
  }

  it('yields the mapped events and closes with done', async () => {
    const collected = [];
    for await (const emitted of streamStrandsAgent(
      fakeAgent([textDelta('one '), textDelta('two')]),
      'prompt',
    )) {
      collected.push(emitted);
    }

    expect(collected).toEqual([
      { type: 'text', text: 'one ' },
      { type: 'text', text: 'two' },
      { type: 'done' },
    ]);
  });

  it('throws instead of emitting an error event, so the caller decides how to close', async () => {
    const failure = new Error('stream broke');
    const stream = streamStrandsAgent(fakeAgent([textDelta('partial')], failure), 'prompt');

    await expect(stream.next()).resolves.toMatchObject({ value: { type: 'text' } });
    await expect(stream.next()).rejects.toThrow('stream broke');
  });
});

describe('classifyAgentFailureStatus', () => {
  it('reports a throttled model as 429', () => {
    expect(classifyAgentFailureStatus(new ModelThrottledError('quota exceeded'))).toBe(429);
  });

  it('reads the provider status from the error or from its cause', () => {
    expect(classifyAgentFailureStatus(Object.assign(new Error('gone'), { statusCode: 503 }))).toBe(503);

    const wrapped = new Error('model call failed', {
      cause: Object.assign(new Error('bad request'), { statusCode: 400 }),
    });
    expect(classifyAgentFailureStatus(wrapped)).toBe(400);
  });

  it('reports 0 when nothing identifies the failure', () => {
    expect(classifyAgentFailureStatus(new Error('socket hang up'))).toBe(0);
    expect(classifyAgentFailureStatus(Object.assign(new Error('odd'), { statusCode: 200 }))).toBe(0);
    expect(classifyAgentFailureStatus('nope')).toBe(0);
  });
});

describe('describeAgentFailure', () => {
  it('keeps the error class next to the message, since it names the failure mode', () => {
    expect(describeAgentFailure(new ModelThrottledError('quota exceeded'))).toBe(
      'ModelThrottledError: quota exceeded',
    );
    expect(describeAgentFailure(new Error('plain'))).toBe('plain');
    expect(describeAgentFailure('raw string')).toBe('raw string');
  });
});

describe('GeminiRetryStrategy', () => {
  /** Reaches the protected predicate the agent loop consults. */
  function isRetryable(error: Error): boolean {
    const strategy = new GeminiRetryStrategy({ maxAttempts: MAX_MODEL_ATTEMPTS }) as unknown as {
      isRetryable(error: Error): boolean;
    };
    return strategy.isRetryable(error);
  }

  it('keeps retrying throttled calls, as the SDK does by default', () => {
    expect(isRetryable(new ModelThrottledError('quota exceeded'))).toBe(true);
  });

  it('also retries transient server errors, which would waste the run so far', () => {
    for (const status of [500, 502, 503, 504]) {
      const failure = new Error('model call failed', {
        cause: Object.assign(new Error('upstream'), { statusCode: status }),
      });
      expect(isRetryable(failure)).toBe(true);
    }
  });

  it('does not retry a request the model rejected on its merits', () => {
    const badRequest = new Error('model call failed', {
      cause: Object.assign(new Error('invalid argument'), { statusCode: 400 }),
    });
    expect(isRetryable(badRequest)).toBe(false);
    expect(isRetryable(new Error('socket hang up'))).toBe(false);
  });
});
