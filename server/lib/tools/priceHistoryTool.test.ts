import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MONTHS, MAX_MONTHS, fetchMonthlyCloses, type PriceHistoryDeps } from './priceHistoryTool.ts';

/** Seconds since the epoch of a UTC calendar day. */
const at = (iso: string) => Math.floor(Date.parse(`${iso}T05:00:00Z`) / 1000);

/** Yahoo's shape: one row per month start plus a trailing row for the latest trade. */
function chartBody(rows: Array<[string, number | null]>, meta: Record<string, unknown> = {}) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: 'AMZN', currency: 'USD', regularMarketTime: at('2026-10-15'), ...meta },
          timestamp: rows.map(([day]) => at(day)),
          indicators: { quote: [{ close: rows.map(([, close]) => close) }] },
        },
      ],
      error: null,
    },
  };
}

function deps(body: unknown, status = 200, now = '2026-10-15'): PriceHistoryDeps & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
    now: () => new Date(`${now}T12:00:00Z`),
  };
}

const AMZN_ROWS: Array<[string, number | null]> = [
  ['2025-11-01', 233.22],
  ['2025-12-01', 230.82],
  ['2026-01-01', 239.3],
  ['2026-02-01', 210],
  ['2026-03-01', 208.27],
  ['2026-04-01', 265.06],
  ['2026-05-01', 270.64],
  ['2026-06-01', 238.34],
  ['2026-07-01', 271.58],
  ['2026-08-01', 259.77],
  ['2026-09-01', 249.15],
  ['2026-10-01', 254.76],
  ['2026-10-15', 254.76],
];

describe('fetchMonthlyCloses', () => {
  it('returns the last completed months, oldest to newest, and drops the month in progress', async () => {
    const d = deps(chartBody(AMZN_ROWS));

    const result = await fetchMonthlyCloses('amzn', DEFAULT_MONTHS, d);

    expect(result.error).toBeUndefined();
    expect(result.symbol).toBe('AMZN');
    expect(result.currency).toBe('USD');
    expect(result.asOf).toBe('2026-10-15');
    expect(result.points).toEqual([
      { date: "Jun '26", month: '2026-06', price: 238.34 },
      { date: "Jul '26", month: '2026-07', price: 271.58 },
      { date: "Aug '26", month: '2026-08', price: 259.77 },
      { date: "Sep '26", month: '2026-09', price: 249.15 },
    ]);
    expect(String(d.fetch.mock.calls[0][0])).toContain('/AMZN?range=2y&interval=1mo');
  });

  it('honours the requested number of months within the allowed range', async () => {
    const two = await fetchMonthlyCloses('AMZN', 2, deps(chartBody(AMZN_ROWS)));
    expect(two.points.map((p) => p.month)).toEqual(['2026-08', '2026-09']);

    const capped = await fetchMonthlyCloses('AMZN', 99, deps(chartBody(AMZN_ROWS)));
    expect(capped.points).toHaveLength(Math.min(MAX_MONTHS, 11));
  });

  it('skips months with no close and keeps the later row when a month appears twice', async () => {
    const rows: Array<[string, number | null]> = [
      ['2026-06-01', null],
      ['2026-07-01', 100],
      ['2026-07-20', 101.456],
      ['2026-08-01', 102],
    ];
    const result = await fetchMonthlyCloses('AMZN', 4, deps(chartBody(rows)));
    expect(result.points).toEqual([
      { date: "Jul '26", month: '2026-07', price: 101.46 },
      { date: "Aug '26", month: '2026-08', price: 102 },
    ]);
  });

  it('reports an unknown ticker as an error result instead of throwing', async () => {
    const body = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } };
    const result = await fetchMonthlyCloses('ZZZZQQ', 4, deps(body, 404));

    expect(result.points).toEqual([]);
    expect(result.error).toContain('No data found');
    expect(result.guidance).toContain('Do not call this tool again');
  });

  it('rejects malformed tickers before calling the network', async () => {
    const d = deps(chartBody(AMZN_ROWS));
    const result = await fetchMonthlyCloses('../etc/passwd', 4, d);
    expect(result.error).toContain('not a valid ticker');
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('turns a network failure and a non-JSON body into error results', async () => {
    const offline: PriceHistoryDeps = { fetch: vi.fn(async () => { throw new Error('ECONNRESET'); }), now: () => new Date() };
    expect((await fetchMonthlyCloses('AMZN', 4, offline)).error).toContain('ECONNRESET');

    const html: PriceHistoryDeps = {
      fetch: vi.fn(async () => new Response('<html>blocked</html>', { status: 403 })),
      now: () => new Date(),
    };
    expect((await fetchMonthlyCloses('AMZN', 4, html)).error).toContain('HTTP 403');
  });

  it('reports an error when every row is still in the current month', async () => {
    const result = await fetchMonthlyCloses('AMZN', 4, deps(chartBody([['2026-10-01', 254.76]])));
    expect(result.points).toEqual([]);
    expect(result.error).toContain('no completed-month closes');
  });
});
