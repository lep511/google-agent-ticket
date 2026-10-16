import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildReportFileName,
  formatDateForFileName,
  printWithFileName,
  slugifyForFileName,
} from './printReport.ts';

describe('buildReportFileName', () => {
  it('names the file after the agent and the local date', () => {
    expect(buildReportFileName('Financial Analyst', new Date(2026, 9, 16))).toBe(
      'report-financial-analyst-2026-10-16',
    );
  });

  it('normalizes accents, symbols and spacing in the agent name', () => {
    expect(slugifyForFileName('  Análisis / Técnico  ')).toBe('analisis-tecnico');
    expect(slugifyForFileName('Web Search')).toBe('web-search');
  });

  it('falls back to a generic name when the agent is unknown', () => {
    expect(buildReportFileName(undefined, new Date(2026, 0, 5))).toBe('report-report-2026-01-05');
    expect(slugifyForFileName('***')).toBe('report');
  });

  it('zero-pads the date parts', () => {
    expect(formatDateForFileName(new Date(2026, 2, 7))).toBe('2026-03-07');
  });
});

describe('printWithFileName', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Minimal window double: a title, the print call and the afterprint event. */
  function windowDouble() {
    const listeners = new Map<string, () => void>();
    const win = {
      document: { title: 'TICKR' },
      print: vi.fn(),
      addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
      setTimeout: vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms)),
    };
    return { win: win as unknown as Window, listeners, raw: win };
  }

  it('prints under the file name and restores the title on afterprint', () => {
    const { win, listeners, raw } = windowDouble();

    printWithFileName('report-financial-analyst-2026-10-16', win);

    expect(raw.print).toHaveBeenCalledTimes(1);
    // The title the browser read when the dialog opened.
    expect(raw.print.mock.invocationCallOrder[0]).toBeGreaterThan(0);
    expect(listeners.has('afterprint')).toBe(true);

    listeners.get('afterprint')?.();
    expect(raw.document.title).toBe('TICKR');
    expect(raw.removeEventListener).toHaveBeenCalledWith('afterprint', expect.any(Function));
  });

  it('sets the title before calling print', () => {
    const { win, raw } = windowDouble();
    let titleAtPrint = '';
    raw.print.mockImplementation(() => {
      titleAtPrint = raw.document.title;
    });

    printWithFileName('report-web-search-2026-10-16', win);

    expect(titleAtPrint).toBe('report-web-search-2026-10-16');
  });

  it('restores the title by timer when afterprint never fires', () => {
    vi.useFakeTimers();
    const { win, raw } = windowDouble();

    printWithFileName('report-web-search-2026-10-16', win);
    expect(raw.document.title).toBe('report-web-search-2026-10-16');

    vi.advanceTimersByTime(60_000);
    expect(raw.document.title).toBe('TICKR');
  });
});
