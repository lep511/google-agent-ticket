/**
 * `get_price_history` tool for the Strands agent.
 *
 * Month-end closing prices of a ticker, for the stock price chart of the
 * financial report. Web search cannot provide them: search engines return page
 * snippets, and a price history page's snippet only quotes the latest close.
 * This tool reads Yahoo Finance's public chart endpoint instead, which needs no
 * API key and returns one row per month.
 *
 * Only completed months are reported: the row for the month in progress holds
 * the latest trade, not a month-end close, and would mislead the chart.
 *
 * Failures come back as a result with an `error` field and no points, like
 * `search_web` does: a thrown tool error reaches the model with nothing to act
 * on, and the retries it triggers each cost a turn.
 */

import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

export const PRICE_HISTORY_TOOL_NAME = 'get_price_history';

/** Months reported when the model does not ask for a number. */
export const DEFAULT_MONTHS = 4;
export const MAX_MONTHS = 12;

/** Yahoo Finance chart endpoint; `range=2y` leaves room for 12 completed months. */
export const PRICE_HISTORY_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Tickers are short exchange symbols; this keeps the URL free of path tricks. */
const TICKER_PATTERN = /^[A-Z0-9.\-^=]{1,15}$/;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MonthlyClose {
  /** Chart label, e.g. "Apr '26". */
  date: string;
  /** Calendar month, `YYYY-MM`. */
  month: string;
  /** Closing price on the last trading day of the month. */
  price: number;
}

export interface PriceHistoryResult {
  symbol: string;
  currency: string | null;
  /** Date of the latest trade the source knew about, ISO `YYYY-MM-DD`. */
  asOf: string | null;
  source: string;
  /** Oldest to newest. Empty when the lookup failed. */
  points: MonthlyClose[];
  error?: string;
  guidance?: string;
}

/** The parts of Yahoo's chart response this tool reads. */
interface ChartResponse {
  chart?: {
    result?: Array<{
      meta?: { symbol?: string; currency?: string; regularMarketTime?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

export interface PriceHistoryDeps {
  fetch: typeof fetch;
  /** Current time, injected so tests can pin the month in progress. */
  now: () => Date;
}

const DEFAULT_DEPS: PriceHistoryDeps = { fetch: (input, init) => fetch(input, init), now: () => new Date() };

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  return `${MONTH_NAMES[date.getUTCMonth()]} '${String(date.getUTCFullYear()).slice(-2)}`;
}

function failure(symbol: string, error: string): PriceHistoryResult {
  return {
    symbol,
    currency: null,
    asOf: null,
    source: 'Yahoo Finance',
    points: [],
    error,
    guidance:
      'Do not call this tool again for the same ticker. Leave stock_price_4m empty and say in the ' +
      'summary that no verified month-end prices were available.',
  };
}

/**
 * Month-end closes of `ticker` for the last `months` completed months, oldest
 * to newest. Rows that fall in the month in progress, or with no close, are
 * dropped; a month is "in progress" relative to `deps.now()`.
 */
export async function fetchMonthlyCloses(
  ticker: string,
  months: number = DEFAULT_MONTHS,
  deps: PriceHistoryDeps = DEFAULT_DEPS,
): Promise<PriceHistoryResult> {
  const symbol = ticker.trim().toUpperCase();
  if (!TICKER_PATTERN.test(symbol)) {
    return failure(symbol, `"${ticker}" is not a valid ticker symbol.`);
  }
  const wanted = Math.min(MAX_MONTHS, Math.max(1, Math.trunc(months) || DEFAULT_MONTHS));

  const url = `${PRICE_HISTORY_ENDPOINT}/${encodeURIComponent(symbol)}?range=2y&interval=1mo`;
  let response: Response;
  try {
    response = await deps.fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Tickr/1.0)' },
    });
  } catch (networkError) {
    return failure(
      symbol,
      `Price history could not reach Yahoo Finance: ${networkError instanceof Error ? networkError.message : String(networkError)}`,
    );
  }

  let body: ChartResponse;
  try {
    body = (await response.json()) as ChartResponse;
  } catch {
    return failure(symbol, `Yahoo Finance returned HTTP ${response.status} with a body that is not JSON.`);
  }

  const result = body.chart?.result?.[0];
  if (!response.ok || !result) {
    const description = body.chart?.error?.description ?? `HTTP ${response.status}`;
    return failure(symbol, `No price history for "${symbol}": ${description}.`);
  }

  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const currentMonth = monthKey(deps.now());

  const byMonth = new Map<string, MonthlyClose>();
  timestamps.forEach((seconds, index) => {
    const close = closes[index];
    if (typeof close !== 'number' || !Number.isFinite(close)) return;
    const date = new Date(seconds * 1000);
    const month = monthKey(date);
    if (month >= currentMonth) return;
    // Yahoo may list a month twice (month start plus a later partial row); the
    // later row wins, as it carries the more complete month.
    byMonth.set(month, { date: monthLabel(date), month, price: Math.round(close * 100) / 100 });
  });

  const points = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-wanted);
  const marketTime = result.meta?.regularMarketTime;

  return {
    symbol: result.meta?.symbol ?? symbol,
    currency: result.meta?.currency ?? null,
    asOf: typeof marketTime === 'number' ? new Date(marketTime * 1000).toISOString().slice(0, 10) : null,
    source: 'Yahoo Finance',
    points,
    ...(points.length === 0 ? { error: `Yahoo Finance returned no completed-month closes for "${symbol}".` } : {}),
  };
}

export function createPriceHistoryTool(deps: PriceHistoryDeps = DEFAULT_DEPS) {
  return tool({
    name: PRICE_HISTORY_TOOL_NAME,
    description:
      'Returns the month-end closing prices of a stock or ETF for the most recent completed months, ' +
      'oldest to newest, from Yahoo Finance. Use it for the stock price chart instead of web search: ' +
      'search snippets never contain monthly closes. ' +
      'On failure it returns an "error" field and no points instead of failing: read it and move on.',
    inputSchema: z.object({
      ticker: z.string().describe('Exchange ticker symbol, e.g. "AMZN" or "VOO".'),
      months: z
        .number()
        .int()
        .min(1)
        .max(MAX_MONTHS)
        .optional()
        .default(DEFAULT_MONTHS)
        .describe(`How many completed months to return (1-${MAX_MONTHS}, default ${DEFAULT_MONTHS}).`),
    }),
    callback: async ({ ticker, months }) =>
      (await fetchMonthlyCloses(ticker, months, deps)) as unknown as Record<string, unknown>,
  });
}
