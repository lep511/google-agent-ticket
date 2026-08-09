import { describe, expect, it } from 'vitest';
import {
  REPORT_ROOT_KEYS,
  extractReport,
  matchesRenderer,
  reportRootKeys,
} from './resultExtraction';

describe('reportRootKeys', () => {
  it('devuelve las claves financieras y las del informe simple', () => {
    expect(reportRootKeys('financial_report')).toEqual([
      'verdict',
      'findings',
      'deep_insights',
    ]);
    expect(reportRootKeys('simple_report')).toEqual([
      'summary',
      'key_points',
      'sections',
      'sources',
    ]);
  });

  it('degrada al renderizador financiero cuando no hay renderizador', () => {
    expect(reportRootKeys(null)).toEqual(REPORT_ROOT_KEYS.financial_report);
  });
});

describe('matchesRenderer', () => {
  it('acepta un objeto con una clave raíz del renderizador', () => {
    expect(matchesRenderer({ summary: '' }, 'simple_report')).toBe(true);
    expect(matchesRenderer({ verdict: {} }, 'financial_report')).toBe(true);
  });

  it('rechaza objetos con las claves del otro renderizador', () => {
    expect(matchesRenderer({ summary: 'x' }, 'financial_report')).toBe(false);
    expect(matchesRenderer({ verdict: {} }, 'simple_report')).toBe(false);
  });

  it('rechaza valores que no son objetos planos', () => {
    expect(matchesRenderer(null, 'simple_report')).toBe(false);
    expect(matchesRenderer([{ summary: 'x' }], 'simple_report')).toBe(false);
    expect(matchesRenderer('summary', 'simple_report')).toBe(false);
  });
});

describe('extractReport', () => {
  it('devuelve el último bloque json válido del renderizador', () => {
    const text = [
      'Borrador:',
      '```json',
      '{"summary": "primero", "key_points": []}',
      '```',
      'Versión final:',
      '```json',
      '{"summary": "segundo", "key_points": ["a"], "sections": [], "sources": []}',
      '```',
    ].join('\n');

    expect(extractReport(text, 'simple_report')).toEqual({
      summary: 'segundo',
      key_points: ['a'],
      sections: [],
      sources: [],
    });
  });

  it('ignora los bloques cuyas claves no son del renderizador de la ejecución', () => {
    const text = '```json\n{"summary": "resumen"}\n```';

    expect(extractReport(text, 'financial_report')).toBeNull();
    expect(extractReport(text, 'simple_report')).toEqual({ summary: 'resumen' });
  });

  it('degrada a la búsqueda por llaves exteriores sin bloque json', () => {
    const text = 'Resultado: {"verdict": {"summary": "compra"}} — fin';

    expect(extractReport(text, 'financial_report')).toEqual({
      verdict: { summary: 'compra' },
    });
  });

  it('recupera el objeto cuando el tramo entre llaves lleva texto de más', () => {
    const text =
      'notas { sueltas } y el informe {"verdict": {"summary": "venta"}} más ruido }';

    expect(extractReport(text, 'financial_report')).toEqual({
      verdict: { summary: 'venta' },
    });
  });

  it('devuelve nulo cuando no hay objeto válido, texto vacío o json roto', () => {
    expect(extractReport('', 'simple_report')).toBeNull();
    expect(extractReport(null, 'simple_report')).toBeNull();
    expect(extractReport('sin json alguno', 'financial_report')).toBeNull();
    expect(extractReport('```json\n{"summary": \n```', 'simple_report')).toBeNull();
    expect(extractReport('```json\n{"otra": 1}\n```', 'simple_report')).toBeNull();
  });

  /*
    Reports carry Markdown-formatted prose in their fields, so braces, quotes and
    fences inside string literals are ordinary content. The brace-balance scan
    has to read them as content, not as structure.
  */
  it('keeps braces that live inside a string literal out of the structure', () => {
    const text =
      'Here it is: {"verdict": {"summary": "the filing uses { and } as placeholders"}} done.';

    expect(extractReport(text, 'financial_report')).toEqual({
      verdict: { summary: 'the filing uses { and } as placeholders' },
    });
  });

  it('reads escaped quotes and escaped backslashes as string content', () => {
    const text = '{"verdict": {"summary": "management said \\"growth\\" }", "note": "a\\\\b"}}';

    expect(extractReport(text, 'financial_report')).toEqual({
      verdict: { summary: 'management said "growth" }', note: 'a\\b' },
    });
  });

  it('recovers the object when a fence inside a string truncates the fenced block', () => {
    const text = '```json\n{"verdict": {"summary": "wrap it in ``` to fence"}}\n```';

    expect(extractReport(text, 'financial_report')).toEqual({
      verdict: { summary: 'wrap it in ``` to fence' },
    });
  });

  /*
    The shape of a run still streaming: the object has opened and not closed. It
    must not promote anything, or the report would freeze missing whatever the
    model had not written yet.
  */
  it('returns null for an object whose braces never balance', () => {
    expect(extractReport('{"verdict": {"summary": "half of a"}', 'financial_report')).toBeNull();
    expect(extractReport('{"verdict": {"summary": "unterminated', 'financial_report')).toBeNull();
  });

  it('ignores a stray closing brace that precedes the report', () => {
    const text = 'leftover } from earlier, report: {"findings": [{"date": "2024-01-01"}]}';

    expect(extractReport(text, 'financial_report')).toEqual({
      findings: [{ date: '2024-01-01' }],
    });
  });

  it('takes the last balanced object when several match the renderer', () => {
    const text = 'draft {"summary": "first"} then final {"summary": "second"}';

    expect(extractReport(text, 'simple_report')).toEqual({ summary: 'second' });
  });
});
