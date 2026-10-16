import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { OUTPUT_RENDERERS } from './agentTypes.ts';
import { financialReportSchema, outputSchemaFor, simpleReportSchema } from './outputSchemas.ts';

describe('outputSchemaFor', () => {
  it('has a schema for every renderer', () => {
    for (const renderer of OUTPUT_RENDERERS) {
      expect(outputSchemaFor(renderer)).toBeDefined();
    }
    expect(outputSchemaFor('simple_report')).toBe(simpleReportSchema);
    expect(outputSchemaFor('financial_report')).toBe(financialReportSchema);
  });
});

describe('simpleReportSchema', () => {
  it('accepts the web search report shape, sources included', () => {
    const report = {
      summary: 'What was found.',
      key_points: ['First', 'Second'],
      sections: [{ title: 'Topic', body: 'Details.' }],
      sources: [{ title: 'Source', url: 'https://example.com/article', date: '2026-03-14' }],
    };
    expect(simpleReportSchema.parse(report)).toEqual(report);
  });

  it('accepts a calculation report with no sources and no source dates', () => {
    const report = {
      summary: 'The answer is 84.',
      key_points: ['Step 1: 12 × 7', 'Final answer: 84'],
      sections: [{ title: 'Solution', body: '12 × 7 = 84' }],
      sources: [],
    };
    expect(simpleReportSchema.safeParse(report).success).toBe(true);
    expect(
      simpleReportSchema.safeParse({ ...report, sources: [{ title: 'S', url: 'https://e.com' }] }).success,
    ).toBe(true);
  });

  it('rejects a report missing a top-level key', () => {
    const result = simpleReportSchema.safeParse({ summary: 'x', key_points: [], sections: [] });
    expect(result.success).toBe(false);
  });

  it('strips unknown keys instead of failing, so an extra field never costs a retry', () => {
    const parsed = simpleReportSchema.parse({
      summary: 'x',
      key_points: [],
      sections: [],
      sources: [],
      confidence: 0.9,
    });
    expect(parsed).not.toHaveProperty('confidence');
  });
});

describe('financialReportSchema', () => {
  const base = {
    verdict: { summary: 'Constructive.', conviction_score: 66, key_takeaways: ['Growth'] },
    deep_insights: [{ category: 'Risk Assessment', title: 'Capex', description: 'Heavy.', impact_score: 7 }],
    findings: [
      { documentType: 'Form 10-K', keyInsights: ['Revenue up'], date: '2026-02-15', sourceUrl: 'https://sec.gov/x' },
    ],
  };

  it('accepts a corporate stock with revenue and net income and no distributions', () => {
    const report = {
      ...base,
      financial_charts: {
        stock_price_4m: [{ date: "Apr '26", price: 150.5 }],
        financial_performance_4q: [
          { quarter: 'Q1 2026', revenue: 181.5, net_income: 30.3 },
          { quarter: 'Q2 2026', revenue: 200.6, net_income: 62.6 },
        ],
      },
    };
    expect(financialReportSchema.parse(report)).toEqual(report);
  });

  it('accepts an ETF with distributions only and an empty price series', () => {
    const report = {
      ...base,
      financial_charts: {
        stock_price_4m: [],
        financial_performance_4q: [{ quarter: 'Q1 2026', distributions: 0.52 }],
      },
    };
    expect(financialReportSchema.safeParse(report).success).toBe(true);
  });

  it('enforces the integer ranges the rubric states', () => {
    const charts = { stock_price_4m: [], financial_performance_4q: [] };
    const scored = (conviction: number, impact: number) => ({
      ...base,
      verdict: { ...base.verdict, conviction_score: conviction },
      deep_insights: [{ ...base.deep_insights[0], impact_score: impact }],
      financial_charts: charts,
    });
    expect(financialReportSchema.safeParse(scored(101, 7)).success).toBe(false);
    expect(financialReportSchema.safeParse(scored(66, 0)).success).toBe(false);
    expect(financialReportSchema.safeParse(scored(66.5, 7)).success).toBe(false);
    expect(financialReportSchema.safeParse(scored(0, 10)).success).toBe(true);
  });

  it('strips unknown root keys instead of failing', () => {
    const parsed = financialReportSchema.parse({
      ...base,
      financial_charts: { stock_price_4m: [], financial_performance_4q: [] },
      extra: true,
    });
    expect(parsed).not.toHaveProperty('extra');
  });
});

describe('the JSON Schema the model sees', () => {
  it('describes every top-level field and requires all of them', () => {
    for (const schema of [simpleReportSchema, financialReportSchema]) {
      const json = z.toJSONSchema(schema) as unknown as {
        description?: string;
        required?: string[];
        properties: Record<string, { description?: string }>;
      };
      expect(json.description).toMatch(/exactly once, as your last action/);
      expect(json.required?.sort()).toEqual(Object.keys(json.properties).sort());
      for (const property of Object.values(json.properties)) {
        expect(property.description).toBeTruthy();
      }
    }
  });

  it('requires only the quarter label in a quarterly point, so stocks and ETFs both fit', () => {
    const json = z.toJSONSchema(financialReportSchema) as unknown as {
      properties: { financial_charts: { properties: { financial_performance_4q: { items: { required?: string[] } } } } };
    };
    expect(json.properties.financial_charts.properties.financial_performance_4q.items.required).toEqual([
      'quarter',
    ]);
  });
});
