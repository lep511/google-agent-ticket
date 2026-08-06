import { afterEach, describe, expect, it } from 'vitest';

import {
  SELECTED_AGENT_STORAGE_KEY,
  findAgent,
  readStoredAgentId,
  resolveActiveAgentId,
  storeSelectedAgentId,
} from './agentSelection';
import type { AgentCatalogEntry } from './types';

function entry(id: string, overrides: Partial<AgentCatalogEntry> = {}): AgentCatalogEntry {
  return {
    id,
    name: id,
    tagline: 'tagline',
    description: 'description',
    icon: 'Sparkles',
    accentColor: 'rgba(255,255,255,0.12)',
    order: 100,
    isDefault: false,
    inputMode: 'ticker',
    inputPlaceholder: 'TICKER',
    actionLabel: 'Analyze',
    supportsInstruction: false,
    outputRenderer: 'financial_report',
    landing: null,
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('selección persistida', () => {
  it('devuelve nulo cuando no hay valor almacenado', () => {
    expect(readStoredAgentId()).toBeNull();
  });

  it('devuelve nulo cuando el valor almacenado queda vacío tras recortar', () => {
    window.localStorage.setItem(SELECTED_AGENT_STORAGE_KEY, '   ');
    expect(readStoredAgentId()).toBeNull();
  });

  it('lee el agentId almacenado bajo la clave del contrato', () => {
    storeSelectedAgentId('market_news_agent');
    expect(window.localStorage.getItem(SELECTED_AGENT_STORAGE_KEY)).toBe('market_news_agent');
    expect(readStoredAgentId()).toBe('market_news_agent');
  });
});

describe('resolveActiveAgentId', () => {
  const catalog = {
    agents: [entry('financial_analyst_agent'), entry('market_news_agent')],
    defaultAgentId: 'financial_analyst_agent',
  };

  it('conserva el agentId almacenado cuando está en el catálogo, sin reescribirlo', () => {
    expect(resolveActiveAgentId(catalog, 'market_news_agent')).toEqual({
      agentId: 'market_news_agent',
      shouldPersist: false,
    });
  });

  it('fija el agente por defecto y sobrescribe cuando el almacenado no está en el catálogo', () => {
    expect(resolveActiveAgentId(catalog, 'deleted_agent')).toEqual({
      agentId: 'financial_analyst_agent',
      shouldPersist: true,
    });
  });

  it('fija el agente por defecto cuando no hay valor almacenado', () => {
    expect(resolveActiveAgentId(catalog, null)).toEqual({
      agentId: 'financial_analyst_agent',
      shouldPersist: true,
    });
  });

  it('degrada a la primera entrada cuando el catálogo no informa agente por defecto', () => {
    expect(resolveActiveAgentId({ ...catalog, defaultAgentId: null }, null)).toEqual({
      agentId: 'financial_analyst_agent',
      shouldPersist: true,
    });
  });

  it('no fija ningún agente con el catálogo vacío', () => {
    expect(resolveActiveAgentId({ agents: [], defaultAgentId: null }, 'market_news_agent')).toEqual({
      agentId: null,
      shouldPersist: false,
    });
  });
});

describe('findAgent', () => {
  const agents = [entry('financial_analyst_agent'), entry('market_news_agent')];

  it('devuelve la entrada del agentId recibido', () => {
    expect(findAgent(agents, 'market_news_agent')?.id).toBe('market_news_agent');
  });

  it('devuelve nulo con agentId nulo o desconocido', () => {
    expect(findAgent(agents, null)).toBeNull();
    expect(findAgent(agents, 'unknown_agent')).toBeNull();
  });
});
