import { describe, expect, it } from 'vitest';

import type { AgentSourceFile } from './agent/agentRegistry.ts';
import type { ResolvedAgentDefinition } from './agent/agentTypes.ts';
import { PromptBuildError, SUPPORTED_PLACEHOLDERS, buildAgentPrompt } from './promptBuilder.ts';

function definition(overrides: Partial<ResolvedAgentDefinition['manifest']> = {}): ResolvedAgentDefinition {
  return {
    agentId: 'market_news_agent',
    manifest: {
      id: 'market_news_agent',
      name: 'Market News',
      tagline: 'Summarizes recent news for a ticker.',
      description: 'Summarizes the recent news of a ticker.',
      icon: 'Newspaper',
      accentColor: '#FFFFFF1A',
      order: 100,
      isDefault: false,
      inputMode: 'ticker',
      inputPlaceholder: 'AAPL',
      actionLabel: 'Summarize',
      supportsInstruction: true,
      outputRenderer: 'simple_report',
      promptFile: 'prompt.md',
      modelProvider: 'anthropic',
      modelName: 'claude-opus-5-5',
      tools: [],
      landing: null,
      ...overrides,
    },
    paths: {
      dir: '/tmp/agent/market_news_agent',
      manifestPath: '/tmp/agent/market_news_agent/manifest.json',
      agentsFilePath: '/tmp/agent/market_news_agent/AGENTS.md',
      promptPath: '/tmp/agent/market_news_agent/prompt.md',
    },
  };
}

function template(text: string): AgentSourceFile {
  return {
    agentId: 'market_news_agent',
    fileName: 'prompt.md',
    relativePath: 'agent/market_news_agent/prompt.md',
    text,
  };
}

describe('buildAgentPrompt', () => {
  it('replaces every occurrence of the input and the instruction', () => {
    const built = buildAgentPrompt({
      definition: definition(),
      input: '  AMZN ',
      instruction: ' Focus on cloud. ',
      template: template('Ticker {{input}} again {{input}}.\nNote: {{instruction}}\n'),
    });

    expect(built.prompt).toBe('Ticker AMZN again AMZN.\nNote: Focus on cloud.\n');
    expect(built.effectiveInstruction).toBe('Focus on cloud.');
    expect(built.agentId).toBe('market_news_agent');
    expect(built.templateRelativePath).toBe('agent/market_news_agent/prompt.md');
    expect(built.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('drops the instruction when the manifest does not support it, or when it is blank', () => {
    const unsupported = buildAgentPrompt({
      definition: definition({ supportsInstruction: false }),
      input: 'AMZN',
      instruction: 'Ignored',
      template: template('{{input}} / {{instruction}} /'),
    });
    expect(unsupported.prompt).toBe('AMZN /  /');
    expect(unsupported.effectiveInstruction).toBe('');

    const blank = buildAgentPrompt({
      definition: definition(),
      input: 'AMZN',
      instruction: '   ',
      template: template('{{instruction}}'),
    });
    expect(blank.prompt).toBe('');
  });

  it('rejects a template with an unsupported placeholder, naming it and the file', () => {
    for (const stale of ['{{schema}}', '{{ input }}', '{{ticker}}']) {
      let caught: unknown;
      try {
        buildAgentPrompt({ definition: definition(), input: 'AMZN', template: template(`Use ${stale}`) });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PromptBuildError);
      const error = caught as PromptBuildError;
      expect(error.code).toBe('unsupported_placeholder');
      expect(error.placeholder).toBe(stale);
      expect(error.relativePath).toBe('agent/market_news_agent/prompt.md');
      expect(error.message).toContain(stale);
      expect(error.message).toContain(SUPPORTED_PLACEHOLDERS.join(', '));
    }
  });

  it('only inspects the template: braces inside the input value are fine (Requirement 7.5)', () => {
    const built = buildAgentPrompt({
      definition: definition(),
      input: 'look at {{weird}}',
      template: template('Input: {{input}}'),
    });
    expect(built.prompt).toBe('Input: look at {{weird}}');
  });

  it('appends nothing: the output contract lives in the structured output schema', () => {
    const built = buildAgentPrompt({
      definition: definition(),
      input: 'AMZN',
      template: template('Analyze {{input}}.'),
    });
    expect(built.prompt).toBe('Analyze AMZN.');
    expect(built.prompt).not.toContain('```json');
  });
});
