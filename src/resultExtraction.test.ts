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
});
