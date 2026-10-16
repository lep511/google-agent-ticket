/**
 * Output contract of every agent, one Zod schema per `outputRenderer`.
 *
 * The Strands SDK receives the schema as `structuredOutputSchema`: it registers
 * an internal tool whose input schema is this one, the model submits the final
 * report through that tool, validation errors go back to the model so it can
 * retry, and the validated object surfaces on `result.structuredOutput`.
 *
 * This replaces the former `output.schema.json` example files, the `{{schema}}`
 * placeholder and the shared JSON output rules block (Requirements 7.1, 7.3,
 * 7.8 were met by those; the SDK's structured output tool now enforces the
 * shape). The guidance the prompts used to carry lives in the `.describe()`
 * texts, which the model sees as field descriptions. Only integer ranges are
 * validated: every rejected submission costs the agent a turn, so everything
 * else is advice rather than a constraint. Unknown keys are stripped, not
 * rejected.
 */

import { z, type ZodType } from 'zod';

import type { OutputRenderer } from './agentTypes.ts';

/* ────────────────────────────────────────────────────────── */
/*  simple_report                                              */
/* ────────────────────────────────────────────────────────── */

const simpleReportSourceSchema = z.object({
  title: z.string().describe('Title of the source page or document.'),
  url: z
    .string()
    .describe('Full http(s) URL of the source exactly as the search tool returned it. Never invent a URL.'),
  date: z
    .string()
    .optional()
    .describe('Publication date when known, e.g. "2026-03-14". Omit when unknown.'),
});

const simpleReportSectionSchema = z.object({
  title: z.string().describe('Section heading: a topic, a theme, an idea category, or "Solution".'),
  body: z.string().describe('Section content in Markdown (bold key terms, lists and links are welcome).'),
});

export const simpleReportSchema = z
  .object({
    summary: z
      .string()
      .describe(
        'A 2-4 sentence overview of the result. For a math problem: the final answer. ' +
          'For a brainstorm: the overview and the top recommendation.',
      ),
    key_points: z
      .array(z.string())
      .describe(
        'The most important findings, ideas or solution steps, one per entry, most important ' +
          'first (or in execution order for a step-by-step solution). May be empty.',
      ),
    sections: z
      .array(simpleReportSectionSchema)
      .describe('Thematic sections of the report, in reading order. May be empty.'),
    sources: z
      .array(simpleReportSourceSchema)
      .describe('Sources consulted. Leave empty when no external source was used (calculations, brainstorms).'),
  })
  .describe(
    'The final report. Call this tool exactly once, as your last action, after all research and ' +
      'tool calls are finished. Fill every field; use empty arrays rather than omitting a field.',
  );

export type SimpleReportOutput = z.infer<typeof simpleReportSchema>;

/* ────────────────────────────────────────────────────────── */
/*  financial_report                                           */
/* ────────────────────────────────────────────────────────── */

const verdictSchema = z.object({
  summary: z
    .string()
    .describe(
      'Executive summary in Markdown. Qualitative only: no specific figures, they belong in ' +
        'financial_charts. When 2026 coverage is thin, say so here.',
    ),
  conviction_score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      'Integer 0-100 from the deterministic rubric: start at 50, add up to 20 for growth, add up ' +
        'to 15 for positive management commentary, subtract up to 20 for identified risks.',
    ),
  key_takeaways: z
    .array(z.string())
    .describe('Qualitative key takeaways in Markdown, no specific numbers. May be empty.'),
});

const deepInsightSchema = z.object({
  category: z
    .string()
    .describe('Insight category, e.g. "Risk Assessment", "Growth Drivers", "Management Commentary".'),
  title: z.string().describe('Short title of the insight.'),
  description: z.string().describe('The insight in Markdown, grounded in the filings and searches.'),
  impact_score: z.number().int().min(1).max(10).describe('Integer 1-10 by severity and relevance.'),
});

const documentFindingSchema = z.object({
  documentType: z
    .string()
    .describe(
      'What the document actually is, e.g. "Form 10-K", "Form 8-K", "Prospectus", "Form N-CSR". ' +
        'A research paper about 10-K filings is NOT a Form 10-K.',
    ),
  keyInsights: z.array(z.string()).describe('Key insights extracted from this document.'),
  date: z
    .string()
    .describe('Filing or publication date within 2026, ISO format when known, e.g. "2026-02-15".'),
  sourceUrl: z.string().describe('URL of the document as returned by search_web. Never invent a URL.'),
});

const stockPricePointSchema = z.object({
  date: z.string().describe('Month label, e.g. "Apr \'26".'),
  price: z.number().describe('Closing price on the last trading day of that month.'),
});

const quarterPointSchema = z.object({
  quarter: z.string().describe('Quarter label, e.g. "Q1 2026".'),
  revenue: z
    .number()
    .optional()
    .describe('Revenue in billions. Corporate stocks only; omit for ETFs.'),
  net_income: z
    .number()
    .optional()
    .describe('Net income in billions. Corporate stocks only; omit for ETFs.'),
  distributions: z
    .number()
    .optional()
    .describe('Distribution per share. ETFs only; omit for corporate stocks. Never write 0 as a placeholder.'),
});

export const financialReportSchema = z
  .object({
    verdict: verdictSchema.describe('Overall assessment of the ticker.'),
    deep_insights: z
      .array(deepInsightSchema)
      .describe(
        'Insights drawn from both SEC filings and broader web searches. May be empty when coverage is thin.',
      ),
    findings: z
      .array(documentFindingSchema)
      .describe(
        'Up to 5 documents dated 2026 covering different filing types. Fewer is better than padding ' +
          'with older filings.',
      ),
    financial_charts: z
      .object({
        stock_price_4m: z
          .array(stockPricePointSchema)
          .describe(
            'Month-end closes from the get_price_history tool, oldest to newest, 2026 months only (up to 4). ' +
              'Empty only when the tool reported an error.',
          ),
        financial_performance_4q: z
          .array(quarterPointSchema)
          .describe(
            'Only the 2026 quarters already completed, oldest to newest; fewer than 4 entries is ' +
              'expected. Stocks report revenue and net_income and omit distributions; ETFs report ' +
              'distributions only.',
          ),
      })
      .describe('Quantitative data: prices from the get_price_history tool, quarterly figures from web searches.'),
  })
  .describe(
    'The final financial report. Call this tool exactly once, as your last action, after the ' +
      'research is finished. Fill every field; use empty arrays rather than omitting a field.',
  );

export type FinancialReportOutput = z.infer<typeof financialReportSchema>;

/* ────────────────────────────────────────────────────────── */
/*  Lookup                                                     */
/* ────────────────────────────────────────────────────────── */

/** Keyed by renderer, so adding a renderer without a schema fails to compile. */
const OUTPUT_SCHEMAS: Record<OutputRenderer, ZodType> = {
  simple_report: simpleReportSchema,
  financial_report: financialReportSchema,
};

/** Schema the agent's final report must satisfy, chosen by its renderer. */
export function outputSchemaFor(renderer: OutputRenderer): ZodType {
  return OUTPUT_SCHEMAS[renderer];
}
