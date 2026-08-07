/**
 * `google_search` tool for the in-process Strands agents.
 *
 * Every agent prompt in `agent/` instructs the model to "use the `google_search`
 * tool", and the timeline in the browser labels its calls by that exact name, so
 * search is exposed as a named function tool instead of as silent Gemini
 * grounding. Each call is one grounded Gemini lookup: the model behind the tool
 * runs the query with Google Search and returns what it found plus the pages it
 * read.
 *
 * Grounding hands back `vertexaisearch.cloud.google.com` redirect links, which
 * are useless in a report, so each one is resolved to the publisher URL it points
 * at before the result goes back to the agent.
 */

import type { LanguageModelV3ProviderTool } from '@ai-sdk/provider';
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

import {
  createGeminiProvider,
  resolveGeminiSearchModelId,
} from './geminiProvider.ts';

/* ────────────────────────────────────────────────────────── */
/*  Limits                                                     */
/* ────────────────────────────────────────────────────────── */

/** Longest query accepted, to keep a runaway prompt out of the search API. */
export const MAX_SEARCH_QUERY_LENGTH = 400;

/** Sources reported per call. Grounding regularly returns dozens. */
export const MAX_SEARCH_SOURCES = 12;

/** Budget for resolving one redirect link, in milliseconds. */
export const REDIRECT_RESOLUTION_TIMEOUT_MS = 5000;

/* ────────────────────────────────────────────────────────── */
/*  Result shape                                               */
/* ────────────────────────────────────────────────────────── */

export interface GoogleSearchSource {
  /** Page title when grounding reports one, otherwise its domain. */
  title: string;
  url: string;
}

export interface GoogleSearchResult {
  query: string;
  /** What the grounded model reported for the query. */
  answer: string;
  /** Queries Google Search actually ran, which can differ from `query`. */
  searchQueries: string[];
  sources: GoogleSearchSource[];
}

/** Performs one grounded lookup. Injectable so tests never hit the network. */
export type GroundedSearchRunner = (
  query: string,
  signal?: AbortSignal,
) => Promise<GoogleSearchResult>;

export interface GoogleSearchToolOptions {
  /** Overrides the grounded lookup, for tests. */
  search?: GroundedSearchRunner;
}

/* ────────────────────────────────────────────────────────── */
/*  Tool                                                       */
/* ────────────────────────────────────────────────────────── */

const TOOL_DESCRIPTION = [
  'Searches the public web with Google and returns what the results say about',
  'the query, together with the source pages. Use one focused query per call and',
  'call it again for each new fact you need. Search operators such as',
  '`filetype:pdf` or `site:` are honoured. Cite only URLs returned in `sources`.',
].join(' ');

/**
 * Builds the `google_search` tool.
 *
 * The name and the `query` argument are part of the contract: the agent prompts
 * name the tool and the timeline renders `arguments.query` as the search label.
 */
export function createGoogleSearchTool(options: GoogleSearchToolOptions = {}) {
  const runSearch = options.search ?? runGroundedSearch;

  return tool({
    name: 'google_search',
    description: TOOL_DESCRIPTION,
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(MAX_SEARCH_QUERY_LENGTH)
        .describe('The search query, as it would be typed into Google.'),
    }),
    callback: async ({ query }, context) => {
      const signal = context?.agent?.cancelSignal;
      const result = await runSearch(query, signal);
      return result as unknown as Record<string, unknown>;
    },
  });
}

/* ────────────────────────────────────────────────────────── */
/*  Grounded lookup                                            */
/* ────────────────────────────────────────────────────────── */

/** Instruction wrapped around the query so the answer stays factual and dense. */
function buildSearchPrompt(query: string): string {
  return [
    `Search the web for: ${query}`,
    '',
    'Report only what the search results state. Include the concrete figures,',
    'dates and publisher names they contain, and say plainly when the results do',
    'not answer the query. Do not add anything from prior knowledge.',
  ].join('\n');
}

/**
 * Gemini's own search tool, declared at the model boundary.
 *
 * It is provider-executed: Gemini runs the search itself while answering, and
 * reports what it read as grounding metadata.
 */
const GOOGLE_SEARCH_PROVIDER_TOOL: LanguageModelV3ProviderTool = {
  type: 'provider',
  id: 'google.google_search',
  name: 'google_search',
  args: {},
};

/** Runs one grounded Gemini lookup through the AI SDK Google provider. */
export const runGroundedSearch: GroundedSearchRunner = async (query, signal) => {
  const model = createGeminiProvider()(resolveGeminiSearchModelId());

  const response = await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: buildSearchPrompt(query) }] }],
    tools: [GOOGLE_SEARCH_PROVIDER_TOOL],
    ...(signal ? { abortSignal: signal } : {}),
  });

  const answer = response.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();

  const grounding = extractGroundingMetadata(response.providerMetadata);

  return {
    query,
    answer,
    searchQueries: grounding.searchQueries,
    sources: await resolveSources(grounding.sources, signal),
  };
};

export interface RawSource {
  title: string;
  url: string;
}

export interface GroundingMetadata {
  searchQueries: string[];
  sources: RawSource[];
}

/**
 * Pulls the search queries and the source links out of the provider metadata.
 * The payload is provider-shaped and only loosely typed, so every field is
 * checked before use. Exported so the parsing can be tested without a network
 * call.
 */
export function extractGroundingMetadata(metadata: unknown): GroundingMetadata {
  const grounding = (metadata as Record<string, Record<string, unknown>> | undefined)?.google?.[
    'groundingMetadata'
  ] as Record<string, unknown> | undefined;

  const rawQueries = grounding?.['webSearchQueries'];
  const searchQueries = Array.isArray(rawQueries)
    ? rawQueries.filter((entry): entry is string => typeof entry === 'string')
    : [];

  const rawChunks = grounding?.['groundingChunks'];
  const sources: RawSource[] = [];
  if (Array.isArray(rawChunks)) {
    for (const chunk of rawChunks) {
      const web = (chunk as { web?: { uri?: unknown; title?: unknown } } | null)?.web;
      if (!web || typeof web.uri !== 'string') continue;
      sources.push({
        url: web.uri,
        title: typeof web.title === 'string' && web.title.trim() ? web.title.trim() : web.uri,
      });
      if (sources.length >= MAX_SEARCH_SOURCES) break;
    }
  }

  return { searchQueries, sources };
}

/** Resolves the redirect links of every source, keeping their order. */
async function resolveSources(
  sources: readonly RawSource[],
  signal?: AbortSignal,
): Promise<GoogleSearchSource[]> {
  const resolved = await Promise.all(
    sources.map(async (source) => ({
      title: source.title,
      url: await resolveRedirect(source.url, signal),
    })),
  );

  // Grounding often cites the same page twice; the agent only needs it once.
  const seen = new Set<string>();
  return resolved.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

/**
 * Follows a single redirect hop and returns its target.
 *
 * Best effort by design: the link is already usable, so a timeout, a network
 * error or a non-redirect answer keeps the original URL rather than failing the
 * whole search.
 */
export async function resolveRedirect(url: string, signal?: AbortSignal): Promise<string> {
  if (!url.includes('vertexaisearch.cloud.google.com')) return url;

  const timeout = AbortSignal.timeout(REDIRECT_RESOLUTION_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const response = await fetch(url, { redirect: 'manual', signal: abort });
    const location = response.headers.get('location');
    if (location && /^https?:\/\//.test(location)) return location;
  } catch {
    // Falls through to the original URL.
  }

  return url;
}
