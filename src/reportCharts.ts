/**
 * Decisions the financial report makes about its charts, kept out of the
 * component so they can be tested against the shapes the model actually
 * produces.
 */

export interface QuarterPoint {
  quarter: string;
  revenue?: number;
  net_income?: number;
  distributions?: number;
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * True when the quarterly series should be drawn as fund distributions rather
 * than revenue and net income.
 *
 * The schema example lists every key, and the prompt forbids omitting keys, so
 * models routinely fill `distributions: 0` for a corporate stock. Checking that
 * key alone turned Amazon into an ETF with $0 bars. A series is a distributions
 * series only when it carries distributions and no revenue figure at all.
 */
export function isDistributionsSeries(quarters: readonly QuarterPoint[] | null | undefined): boolean {
  if (!Array.isArray(quarters) || quarters.length === 0) return false;
  const hasRevenue = quarters.some((q) => isNumber(q.revenue) || isNumber(q.net_income));
  const hasDistributions = quarters.some((q) => isNumber(q.distributions));
  return hasDistributions && !hasRevenue;
}

/** True when a chart series has at least one point to draw. */
export function hasChartData(points: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(points) && points.length > 0;
}
