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

export function createBraveSearchTool() {
  return tool({
    name: 'search_web',
    description:
      'Searches the web using Brave Search and returns relevant results. ' +
      'Use this tool to find up-to-date information about any topic. ' +
      'Returns titles, URLs, and descriptions of the top results.',
    inputSchema: z.object({
      query: z.string().describe('The search query to look up on the web.'),
      count: z.number().optional().default(5).describe('Number of results to return (1-10, default 5).'),
    }),
    callback: async ({ query, count }) => {
      const apiKey = process.env.BRAVE_API_KEY;
      if (!apiKey) {
        return {
          error: 'BRAVE_API_KEY is not configured. Web search is unavailable.',
          query,
          web_results: [],
          news_results: [],
          total_web: 0,
          total_news: 0,
        } as unknown as Record<string, unknown>;
      }

      const numResults = Math.min(Math.max(count ?? 5, 1), 10);
      const params = new URLSearchParams({ q: query, count: String(numResults) });

      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?${params}`,
        {
          method: 'get',
          headers: { 'X-Subscription-Token': apiKey },
        },
      );

      if (!response.ok) {
        throw new Error(`Brave Search API returned ${response.status}: ${response.statusText}`);
      }

      const body = (await response.json()) as BraveSearchResponse;

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
      } as unknown as Record<string, unknown>;
    },
  });
}
