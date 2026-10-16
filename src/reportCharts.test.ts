import { describe, expect, it } from 'vitest';

import { hasChartData, isDistributionsSeries } from './reportCharts.ts';

describe('isDistributionsSeries', () => {
  it('keeps a corporate stock in revenue mode even when the model pads distributions with zero', () => {
    expect(
      isDistributionsSeries([
        { quarter: 'Q1 2026', revenue: 181.5, net_income: 30.3, distributions: 0 },
        { quarter: 'Q2 2026', revenue: 200.6, net_income: 62.6, distributions: 0 },
      ]),
    ).toBe(false);
  });

  it('switches to distributions when the series has no revenue figure', () => {
    expect(
      isDistributionsSeries([
        { quarter: 'Q1 2026', distributions: 0.52 },
        { quarter: 'Q2 2026', distributions: 0.55 },
      ]),
    ).toBe(true);
  });

  it('treats an empty or missing series as revenue mode', () => {
    expect(isDistributionsSeries([])).toBe(false);
    expect(isDistributionsSeries(undefined)).toBe(false);
    expect(isDistributionsSeries(null)).toBe(false);
  });

  it('ignores non-numeric values when deciding', () => {
    expect(
      isDistributionsSeries([
        { quarter: 'Q1 2026', revenue: Number.NaN, distributions: 0.5 } as never,
      ]),
    ).toBe(true);
  });
});

describe('hasChartData', () => {
  it('is true only for a non-empty array', () => {
    expect(hasChartData([{ date: "Apr '26", price: 1 }])).toBe(true);
    expect(hasChartData([])).toBe(false);
    expect(hasChartData(undefined)).toBe(false);
    expect(hasChartData('nope' as never)).toBe(false);
  });
});
