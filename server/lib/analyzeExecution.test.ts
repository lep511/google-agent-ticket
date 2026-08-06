/**
 * Pruebas unitarias de las piezas de ejecución de `POST /api/analyze`:
 * el evento `agent_info`, la selección del cliente remoto y la secuencia de
 * cierre del flujo ante un fallo del cliente.
 *
 * Requirements: 5.3, 5.4, 5.5, 5.8, 5.10, 6.1
 */

import { describe, expect, it } from 'vitest';

import {
  AGENT_INFO_EVENT_TYPE,
  DEFAULT_STREAM_FAILURE_MESSAGE,
  buildAgentInfoEvent,
  buildStreamFailureEvents,
  describeStreamFailure,
  isPerseusModel,
  selectAgentClientName,
  toRemoteInlineSources,
} from './analyzeExecution.ts';
import type { AgentInlineSource } from './agentInlineSources.ts';
import type { ResolvedAgentDefinition } from './agentTypes.ts';

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
  it('informa el agentId resuelto, el nombre visible y el renderizador', () => {
    expect(buildAgentInfoEvent(definition())).toEqual({
      type: AGENT_INFO_EVENT_TYPE,
      agentId: 'market_news_agent',
      agentName: 'Market News',
      outputRenderer: 'simple_report',
    });
  });

  it('usa el renderizador del manifiesto del agente resuelto', () => {
    const event = buildAgentInfoEvent(
      definition({ outputRenderer: 'financial_report', name: 'Financial Analyst' }),
    );
    expect(event.outputRenderer).toBe('financial_report');
    expect(event.agentName).toBe('Financial Analyst');
  });

  it('expone solo los campos del contrato, sin rutas del sistema de archivos', () => {
    expect(Object.keys(buildAgentInfoEvent(definition())).sort()).toEqual([
      'agentId',
      'agentName',
      'outputRenderer',
      'type',
    ]);
  });
});

describe('selección del cliente remoto', () => {
  it('elige agentClientPerseus solo con el valor exacto perseus tras recortar', () => {
    for (const model of ['perseus', ' perseus', 'perseus ', '\tperseus\n']) {
      expect(isPerseusModel(model)).toBe(true);
      expect(selectAgentClientName(model)).toBe('agentClientPerseus');
    }
  });

  it('elige agentClient con cualquier otro valor, ausente o vacío', () => {
    const others: unknown[] = [
      undefined,
      null,
      '',
      '   ',
      'Perseus',
      'PERSEUS',
      'perseus2',
      'per seus',
      'gemini',
      42,
      { model: 'perseus' },
    ];
    for (const model of others) {
      expect(isPerseusModel(model)).toBe(false);
      expect(selectAgentClientName(model)).toBe('agentClient');
    }
  });
});

describe('cierre del flujo ante un fallo del cliente remoto', () => {
  it('emite error y a continuación done, en ese orden', () => {
    const events = buildStreamFailureEvents('la conexión se cerró');
    expect(events).toEqual([
      { type: 'error', message: 'la conexión se cerró' },
      { type: 'done' },
    ]);
  });

  it('toma el mensaje de un Error y cae a un motivo genérico si no hay ninguno', () => {
    expect(describeStreamFailure(new Error('socket hang up'))).toBe('socket hang up');
    expect(describeStreamFailure(new Error(''))).toBe(DEFAULT_STREAM_FAILURE_MESSAGE);
    expect(describeStreamFailure(undefined)).toBe(DEFAULT_STREAM_FAILURE_MESSAGE);
    expect(describeStreamFailure('   ')).toBe(DEFAULT_STREAM_FAILURE_MESSAGE);
  });
});

describe('toRemoteInlineSources', () => {
  it('conserva type, content y target y descarta la metadata del registro', () => {
    const sources: AgentInlineSource[] = [
      {
        type: 'inline',
        content: 'base_agent: antigravity',
        target: '/.agents/agent.yaml',
        relativePath: 'agent.yaml',
        bytes: 23,
      },
    ];

    expect(toRemoteInlineSources(sources)).toEqual([
      { type: 'inline', content: 'base_agent: antigravity', target: '/.agents/agent.yaml' },
    ]);
  });

  it('preserva el orden y no muta la lista recibida', () => {
    const sources: AgentInlineSource[] = [
      { type: 'inline', content: 'a', target: '/.agents/a.md', relativePath: 'a.md', bytes: 1 },
      {
        type: 'inline',
        content: 'b',
        target: '/.agents/sub/b.md',
        relativePath: 'sub/b.md',
        bytes: 1,
      },
    ];

    expect(toRemoteInlineSources(sources).map((source) => source.target)).toEqual([
      '/.agents/a.md',
      '/.agents/sub/b.md',
    ]);
    expect(sources[0]).toHaveProperty('relativePath', 'a.md');
  });
});
