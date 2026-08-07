/**
 * Unit tests for the `google_search` tool: the contract the agent prompts and the
 * timeline depend on (tool name and `query` argument), the defensive parsing of
 * Gemini's grounding metadata, and the resolution of grounding redirect links.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_SEARCH_QUERY_LENGTH,
  MAX_SEARCH_SOURCES,
  createGoogleSearchTool,
  extractGroundingMetadata,
  resolveRedirect,
} from './googleSearchTool.ts';

const REDIRECT_HOST = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createGoogleSearchTool', () => {
  it('is named google_search and takes a single query, as the prompts expect', () => {
    const spec = createGoogleSearchTool({ search: async () => emptyResult('q') }).toolSpec;

    expect(spec.name).toBe('google_search');
    const properties = (spec.inputSchema as { properties?: Record<string, unknown> }).properties;
    expect(Object.keys(properties ?? {})).toEqual(['query']);
  });

  it('returns the grounded answer and its sources to the agent', async () => {
    const tool = createGoogleSearchTool({
      search: async (query) => ({
        query,
        answer: 'Deliveries reached 497,099 vehicles.',
        searchQueries: ['tesla q3 2025 deliveries'],
        sources: [{ title: 'ir.tesla.com', url: 'https://ir.tesla.com/press-release' }],
      }),
    });

    await expect(tool.invoke({ query: 'Tesla Q3 2025 deliveries' })).resolves.toEqual({
      query: 'Tesla Q3 2025 deliveries',
      answer: 'Deliveries reached 497,099 vehicles.',
      searchQueries: ['tesla q3 2025 deliveries'],
      sources: [{ title: 'ir.tesla.com', url: 'https://ir.tesla.com/press-release' }],
    });
  });

  it('rejects an empty or oversized query before it reaches the search API', async () => {
    const calls: string[] = [];
    const tool = createGoogleSearchTool({
      search: async (query) => {
        calls.push(query);
        return emptyResult(query);
      },
    });

    await expect(tool.invoke({ query: '' })).rejects.toThrow();
    await expect(tool.invoke({ query: 'x'.repeat(MAX_SEARCH_QUERY_LENGTH + 1) })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe('extractGroundingMetadata', () => {
  it('reads the executed queries and the cited pages', () => {
    const parsed = extractGroundingMetadata({
      google: {
        groundingMetadata: {
          webSearchQueries: ['nvda 10-q', 'nvidia quarterly revenue'],
          groundingChunks: [
            { web: { uri: `${REDIRECT_HOST}/aaa`, title: 'q4cdn.com' } },
            { web: { uri: `${REDIRECT_HOST}/bbb` } },
          ],
        },
      },
    });

    expect(parsed.searchQueries).toEqual(['nvda 10-q', 'nvidia quarterly revenue']);
    expect(parsed.sources).toEqual([
      { url: `${REDIRECT_HOST}/aaa`, title: 'q4cdn.com' },
      { url: `${REDIRECT_HOST}/bbb`, title: `${REDIRECT_HOST}/bbb` },
    ]);
  });

  it('caps the reported sources, since grounding returns dozens of them', () => {
    const groundingChunks = Array.from({ length: MAX_SEARCH_SOURCES + 5 }, (_unused, index) => ({
      web: { uri: `${REDIRECT_HOST}/${index}`, title: `source-${index}` },
    }));

    const parsed = extractGroundingMetadata({ google: { groundingMetadata: { groundingChunks } } });
    expect(parsed.sources).toHaveLength(MAX_SEARCH_SOURCES);
  });

  it('degrades to empty results instead of throwing on an unexpected payload', () => {
    for (const payload of [undefined, null, {}, { google: {} }, { google: { groundingMetadata: 7 } }]) {
      expect(extractGroundingMetadata(payload)).toEqual({ searchQueries: [], sources: [] });
    }

    expect(
      extractGroundingMetadata({
        google: {
          groundingMetadata: {
            webSearchQueries: ['fine', 42, null],
            groundingChunks: [null, { web: {} }, { web: { uri: 12 } }],
          },
        },
      }),
    ).toEqual({ searchQueries: ['fine'], sources: [] });
  });
});

describe('resolveRedirect', () => {
  it('leaves a publisher URL untouched, without any request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(resolveRedirect('https://ir.tesla.com/press-release')).resolves.toBe(
      'https://ir.tesla.com/press-release',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('follows a grounding link to the page it points at', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        headers: new Headers({ location: 'https://carbuzz.com/tesla-q3-2025-results/' }),
      })),
    );

    await expect(resolveRedirect(`${REDIRECT_HOST}/aaa`)).resolves.toBe(
      'https://carbuzz.com/tesla-q3-2025-results/',
    );
  });

  it('keeps the original link when the hop fails or leads nowhere usable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(resolveRedirect(`${REDIRECT_HOST}/aaa`)).resolves.toBe(`${REDIRECT_HOST}/aaa`);

    vi.stubGlobal('fetch', vi.fn(async () => ({ headers: new Headers({ location: '/relative' }) })));
    await expect(resolveRedirect(`${REDIRECT_HOST}/bbb`)).resolves.toBe(`${REDIRECT_HOST}/bbb`);
  });
});

function emptyResult(query: string) {
  return { query, answer: '', searchQueries: [], sources: [] };
}
