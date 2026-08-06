import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import SimpleReportView, { normalizeSimpleReport, safeHref } from './SimpleReportView';
import type { SimpleReport } from '../types';

const report: SimpleReport = {
  summary: 'La compañía **cerró** el trimestre con ingresos récord.',
  key_points: ['Ingresos +12% interanual', 'Margen bruto estable', 'Nueva línea de negocio'],
  sections: [
    { title: 'Resultados', body: 'Los ingresos alcanzaron 4.200 M$.' },
    { title: 'Riesgos', body: 'Concentración de clientes en un solo sector.' },
  ],
  sources: [
    { title: 'Nota de prensa Q3', url: 'https://example.com/q3', date: '2026-02-11' },
    { title: 'Presentación a inversores', url: 'https://example.com/deck', date: '2026-02-12' },
  ],
};

afterEach(() => {
  cleanup();
});

describe('SimpleReportView', () => {
  it('renderiza el resumen, todos los puntos clave, las secciones y las fuentes', () => {
    render(<SimpleReportView data={report} title="Market News Digest" subtitle="TSLA" />);

    expect(screen.getByText(/cerró/)).toBeTruthy();

    for (const point of report.key_points) {
      expect(screen.getByText(point)).toBeTruthy();
    }

    for (const section of report.sections) {
      expect(screen.getByText(section.title)).toBeTruthy();
      expect(screen.getByText(section.body)).toBeTruthy();
    }

    for (const source of report.sources) {
      expect(screen.getByText(source.title)).toBeTruthy();
      const link = screen.getByRole('link', { name: new RegExp(source.url) });
      expect(link.getAttribute('href')).toBe(source.url);
      expect(screen.getByText(source.date!)).toBeTruthy();
    }
  });

  it('no inserta HTML procedente del contenido del modelo', () => {
    const { container } = render(
      <SimpleReportView
        data={{
          summary: '<script>window.__pwned = true;</script><img src=x onerror="alert(1)">',
          key_points: ['<b>negrita cruda</b>'],
          sections: [{ title: 'Sección', body: '<iframe src="https://evil.test"></iframe>' }],
          sources: [{ title: 'Fuente', url: 'javascript:alert(1)', date: '' }],
        }}
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    // Una URL con esquema no permitido nunca se convierte en enlace.
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeTruthy();
  });

  it('degrada campos ausentes o con tipos inesperados sin romper la vista', () => {
    render(<SimpleReportView data={{ key_points: 'un único punto', sections: null }} />);

    expect(screen.getByText('No summary available.')).toBeTruthy();
    expect(screen.getByText('un único punto')).toBeTruthy();
  });

  it('avisa cuando el informe no trae contenido', () => {
    render(<SimpleReportView data={{}} />);
    expect(screen.getByText('The agent returned no report content.')).toBeTruthy();
  });
});

describe('normalizeSimpleReport', () => {
  it('conserva todos los elementos de un informe conforme al contrato', () => {
    const normalized = normalizeSimpleReport(report);

    expect(normalized.summary).toBe(report.summary);
    expect(normalized.keyPoints).toEqual(report.key_points);
    expect(normalized.sections).toEqual(report.sections);
    expect(normalized.sources).toEqual(report.sources);
  });

  it('descarta entradas vacías y admite valores sueltos', () => {
    const normalized = normalizeSimpleReport({
      summary: '  resumen  ',
      key_points: ['  ', 'válido'],
      sections: [{ title: '', body: '' }, 'cuerpo suelto'],
      sources: ['https://example.com/a', { title: '', url: '' }],
    } as Record<string, unknown>);

    expect(normalized.summary).toBe('resumen');
    expect(normalized.keyPoints).toEqual(['válido']);
    expect(normalized.sections).toEqual([{ title: '', body: 'cuerpo suelto' }]);
    expect(normalized.sources).toEqual([{ title: '', url: 'https://example.com/a', date: '' }]);
  });
});

describe('safeHref', () => {
  it('acepta http y https y rechaza cualquier otro esquema', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('http://example.com/a')).toBe('http://example.com/a');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>1</script>')).toBeNull();
    expect(safeHref('no es una url')).toBeNull();
    expect(safeHref('')).toBeNull();
  });
});
