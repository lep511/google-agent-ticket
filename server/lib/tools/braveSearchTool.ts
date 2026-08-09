/**
 * `search_web` tool, backed by Brave Search.
 *
 * Two properties matter as much as the results themselves, because this tool runs
 * inside an agent loop with a finite turn budget:
 *
 *  - Requests are serialized and spaced. Brave's free tier allows about one
 *    request per second, and an agent asked to research several documents fires
 *    them back to back, so unspaced calls answer 429 almost immediately.
 *  - A failure is a result, not an exception. A thrown tool error comes back to
 *    the model as an error tool result with nothing else to go on, and the model
 *    retries the same query; each retry costs a turn, and a run could spend its
 *    whole budget that way and end with no report. The payload below tells the
 *    model what happened and what to do instead.
 */

import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  page_age?: string;
}

interface BraveNewsResult {
  title: string;
  url: string;
  description: string;
  page_age?: string;
  age?: string;
}

interface BraveSearchResponse {
  web?: { results: BraveWebResult[] };
  news?: { results: BraveNewsResult[] };
}

/* ────────────────────────────────────────────────────────── */
/*  Request pacing                                             */
/* ────────────────────────────────────────────────────────── */

/** Minimum gap between two Brave requests, just over the free tier's 1 req/s. */
export const MIN_REQUEST_SPACING_MS = 1_100;

/** Attempts per search, the first one included. */
export const MAX_SEARCH_ATTEMPTS = 3;

/** Base backoff between attempts; grows with the attempt number. */
const RETRY_BASE_DELAY_MS = 1_200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tail of the request chain and the moment the last one was issued. Module state
 * on purpose: the quota belongs to the API key, so concurrent runs on this
 * server have to queue behind each other too.
 */
let requestChain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/** Runs `work` after every request already queued, honouring the spacing. */
function schedule<T>(work: () => Promise<T>): Promise<T> {
  const scheduled = requestChain.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_SPACING_MS - Date.now();
    if (wait > 0) await delay(wait);
    lastRequestAt = Date.now();
    return work();
  });

  // The chain has to survive a rejected call, or one failure would poison every
  // search that comes after it.
  requestChain = scheduled.then(
    () => undefined,
    () => undefined,
  );

  return scheduled;
}

/* ────────────────────────────────────────────────────────── */
/*  Tool                                                       */
/* ────────────────────────────────────────────────────────── */

/** Shape returned to the model, successful or not. */
interface SearchToolResult extends Record<string, unknown> {
  query: string;
  web_results: unknown[];
  news_results: unknown[];
  total_web: number;
  total_news: number;
}

/** Empty result carrying the reason and what the model should do next. */
function failedSearch(query: string, reason: string): SearchToolResult {
  return {
    error: reason,
    guidance:
      'Do not repeat this query. Either continue with the information you already have, ' +
      'or try a clearly different query.',
    query,
    web_results: [],
    news_results: [],
    total_web: 0,
    total_news: 0,
  };
}

/**
 * Answer of a search request. One shape with both fields nullable rather than a
 * discriminated union, because this project compiles without `strictNullChecks`
 * and narrowing by a boolean discriminant does not hold under it.
 */
interface BraveOutcome {
  /** Parsed body, or null when the request never produced one. */
  body: BraveSearchResponse | null;
  /** Why it failed, or null when it succeeded. */
  reason: string | null;
}

/** Retries 429 and 5xx, and reports anything else on the first answer. */
async function requestBrave(url: string, apiKey: string): Promise<BraveOutcome> {
  let lastReason = 'Web search failed for an unknown reason.';

  for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { method: 'get', headers: { 'X-Subscription-Token': apiKey } });
    } catch (networkError) {
      lastReason = `Web search could not reach Brave Search: ${
        networkError instanceof Error ? networkError.message : String(networkError)
      }`;
      if (attempt === MAX_SEARCH_ATTEMPTS) break;
      await delay(RETRY_BASE_DELAY_MS * attempt);
      continue;
    }

    if (response.ok) {
      try {
        return { body: (await response.json()) as BraveSearchResponse, reason: null };
      } catch {
        return { body: null, reason: 'Brave Search answered with a body that is not valid JSON.' };
      }
    }

    lastReason =
      response.status === 429
        ? 'Web search is being rate-limited by Brave Search (HTTP 429).'
        : `Brave Search returned HTTP ${response.status} ${response.statusText}.`;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_SEARCH_ATTEMPTS) break;
    await delay(RETRY_BASE_DELAY_MS * attempt);
  }

  return { body: null, reason: lastReason };
}

export function createBraveSearchTool() {
  return tool({
    name: 'search_web',
    description:
      'Searches the web using Brave Search and returns relevant results. ' +
      'Use this tool to find up-to-date information about any topic. ' +
      'Returns titles, URLs, and descriptions of the top results. ' +
      'On failure it returns an "error" field and empty results instead of failing: ' +
      'read it and move on rather than repeating the same query.',
    inputSchema: z.object({
      query: z.string().describe('The search query to look up on the web.'),
      count: z.number().optional().default(5).describe('Number of results to return (1-10, default 5).'),
    }),
    callback: async ({ query, count }) => {
      const apiKey = process.env.BRAVE_API_KEY;
      if (!apiKey) {
        return failedSearch(
          query,
          'BRAVE_API_KEY is not configured. Web search is unavailable for this run.',
        );
      }

      const numResults = Math.min(Math.max(count ?? 5, 1), 10);
      const params = new URLSearchParams({ q: query, count: String(numResults) });
      const url = `https://api.search.brave.com/res/v1/web/search?${params}`;

      const outcome: BraveOutcome = await schedule(() => requestBrave(url, apiKey));
      if (outcome.body === null) {
        const reason = outcome.reason ?? 'Web search failed for an unknown reason.';
        console.warn(`[search_web] "${query}" failed: ${reason}`);
        return failedSearch(query, reason);
      }

      const body = outcome.body;

      const webResults = (body.web?.results ?? []).slice(0, numResults).map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description.replace(/<\/?strong>/g, ''),
        date: r.page_age ?? null,
      }));

      const newsResults = (body.news?.results ?? []).slice(0, 3).map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description.replace(/<\/?strong>/g, ''),
        age: r.age ?? r.page_age ?? null,
      }));

      return {
        query,
        web_results: webResults,
        news_results: newsResults,
        total_web: webResults.length,
        total_news: newsResults.length,
      } as SearchToolResult;
    },
  });
}
