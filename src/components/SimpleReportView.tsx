/* ──────────────────────────────────────────────────────────── */
/*  SimpleReportView                                            */
/*                                                              */
/*  Renderizador del contrato `simple_report`: muestra el        */
/*  `summary`, todos los `key_points`, el `title` y el `body` de  */
/*  cada sección y todas las `sources` con su `title`, `url` y   */
/*  `date`, reutilizando la estética de tarjetas del informe     */
/*  financiero.                                                  */
/*                                                              */
/*  Todo el contenido procedente del modelo pasa por             */
/*  `FormattedMarkdown` (Markdown sin `rehype-raw`), de modo que  */
/*  ni el HTML ni los scripts que devuelva un agente llegan a     */
/*  ejecutarse; las URLs se filtran a `http` y `https`.           */
/*                                                              */

/* ──────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Calendar, CheckCircle2, FileText, Link as LinkIcon, Printer, X } from 'lucide-react';

import { FormattedMarkdown } from './FormattedMarkdown';
import type { RawSimpleReport, SimpleReportSection, SimpleReportSource } from '../types';

/* ── Normalización defensiva del objeto del modelo ─────────── */

/** Texto utilizable de un valor cualquiera; vacío cuando no aporta contenido. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Lista de textos Markdown, descartando las entradas sin contenido. */
function asTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(asText).filter((text) => text.length > 0);
  }
  const single = asText(value);
  return single ? [single] : [];
}

/** Secciones con `title` y `body`; una sección puede llegar como texto suelto. */
function asSections(value: unknown): SimpleReportSection[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];

  return raw
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        return { title: asText(record.title), body: asText(record.body) };
      }
      return { title: '', body: asText(entry) };
    })
    .filter((section) => section.title.length > 0 || section.body.length > 0);
}

/** Fuentes con `title`, `url` y `date`; una fuente puede llegar como URL suelta. */
function asSources(value: unknown): SimpleReportSource[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];

  return raw
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        return {
          title: asText(record.title),
          url: asText(record.url),
          date: asText(record.date),
        };
      }
      return { title: '', url: asText(entry), date: '' };
    })
    .filter((source) => source.title.length > 0 || source.url.length > 0);
}

export interface NormalizedSimpleReport {
  summary: string;
  keyPoints: string[];
  sections: SimpleReportSection[];
  sources: SimpleReportSource[];
}

/**
 * Forma renderizable del informe simple. El objeto llega recién extraído del
 * texto del modelo, así que cualquier campo puede faltar o venir con otro tipo.
 */
export function normalizeSimpleReport(
  data: RawSimpleReport | Record<string, unknown> | null | undefined,
): NormalizedSimpleReport {
  const record = (data ?? {}) as Record<string, unknown>;

  return {
    summary: asText(record.summary),
    keyPoints: asTextList(record.key_points),
    sections: asSections(record.sections),
    sources: asSources(record.sources),
  };
}

/**
 * URL segura para un `href`: solo `http` y `https`, para que una URL del modelo
 * no pueda introducir un esquema ejecutable (Requirement 14.7).
 */
export function safeHref(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/* ── Tarjetas ──────────────────────────────────────────────── */

interface CardProps {
  title: string;
  children: ReactNode;
  className?: string;
}

/** Tarjeta base, con el mismo tratamiento que las del informe financiero. */
function ReportCard({ title, children, className = '' }: CardProps) {
  return (
    <div
      className={`bg-white rounded-xl p-6 border border-stone-200 flex flex-col print:break-inside-avoid print:mb-6 print:shadow-none print:border-stone-300 ${className}`}
    >
      <h3 className="text-lg font-semibold text-stone-900 mb-4 print:break-after-avoid">{title}</h3>
      <div className="flex-1 w-full flex flex-col">{children}</div>
    </div>
  );
}

/* ── Vista ─────────────────────────────────────────────────── */

export interface SimpleReportViewProps {
  /** Informe extraído del texto final de la ejecución. */
  data: RawSimpleReport | Record<string, unknown> | null | undefined;
  /** Cabecera del informe: normalmente el nombre del agente que lo produjo. */
  title?: string;
  /** Entrada de la ejecución, como texto secundario de la cabecera. */
  subtitle?: string;
  onClose?: () => void;
  durationSecs?: number;
  toolRuns?: number;
  tokenCount?: number;
}

export default function SimpleReportView({
  data,
  title = 'Report',
  subtitle = '',
  onClose,
  durationSecs = 0,
  toolRuns = 0,
  tokenCount = 0,
}: SimpleReportViewProps) {
  const { summary, keyPoints, sections, sources } = normalizeSimpleReport(data);
  const isEmpty =
    !summary && keyPoints.length === 0 && sections.length === 0 && sources.length === 0;

  return (
    <div className="min-h-full bg-[#F6F4F0] text-stone-900 font-sans w-full flex flex-col h-full overflow-y-auto print:h-auto print:overflow-visible print:bg-white print:p-0">
      {/* Cabecera */}
      <div className="w-full border-b border-stone-200 px-[40px] py-4 flex items-center justify-between sticky top-0 z-50 bg-[#F6F4F0] print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <div className="font-display uppercase font-bold text-stone-900 text-lg tracking-wider truncate">
            {title}
          </div>
          {subtitle && (
            <span className="text-xs text-stone-500 font-mono truncate">{subtitle}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium text-xs tracking-wide transition-all shadow-sm cursor-pointer active:scale-95"
            title="Save report as PDF or Print"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            <span>Save as PDF / Print</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-stone-500 hover:text-stone-900 hover:bg-stone-200/80 active:bg-stone-300 rounded-full transition-all flex items-center justify-center p-2 cursor-pointer"
              title="Close report"
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 py-8 px-[40px] w-full max-w-[1200px] mx-auto flex flex-col gap-6 print:py-0 print:px-0 print:max-w-none print:w-full print:block print:gap-0">
        {/* Cabecera de impresión */}
        <div className="hidden print:flex items-center justify-between border-b-2 border-stone-800 pb-4 mb-6 w-full print:break-after-avoid">
          <div>
            <h1 className="font-display uppercase font-bold text-stone-900 text-3xl tracking-wider">
              {title}
            </h1>
            <div className="text-xs text-stone-600 font-mono mt-1">
              {subtitle ? `${subtitle} · ` : ''}
              Generated on {new Date().toLocaleDateString()}
            </div>
          </div>
          <div className="text-right">
            <div className="font-display font-bold text-xl text-stone-900 uppercase tracking-wide">
              Tickr
            </div>
            <div className="text-xs text-stone-600">Agent Report</div>
          </div>
        </div>

        {/* Resumen y métricas de la ejecución */}
        <ReportCard title="Summary" className="w-full print:block print:w-full print:mb-6">
          <div className="bg-stone-50 p-5 rounded-xl border border-stone-100 text-stone-800 leading-relaxed font-medium text-lg w-full print:bg-stone-100/60 print:border-stone-200">
            {summary ? (
              <FormattedMarkdown content={summary} />
            ) : (
              <span className="text-stone-500 italic text-base">No summary available.</span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1 border-t border-stone-100 pt-4 mt-6 w-full print:border-stone-200">
            <div className="flex flex-col items-center">
              <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">
                Time
              </div>
              <div className="text-sm font-mono text-stone-800">{durationSecs}s</div>
            </div>
            <div className="flex flex-col items-center border-l border-stone-100 print:border-stone-200">
              <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">
                Runs
              </div>
              <div className="text-sm font-mono text-stone-800">{toolRuns}</div>
            </div>
            <div className="flex flex-col items-center border-l border-stone-100 print:border-stone-200">
              <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">
                Tokens
              </div>
              <div className="text-sm font-mono text-stone-800">
                {tokenCount > 0 ? `${(tokenCount / 1000).toFixed(1)}k` : '-'}
              </div>
            </div>
          </div>
        </ReportCard>

        {/* Puntos clave */}
        {keyPoints.length > 0 && (
          <ReportCard title="Key Points" className="w-full print:block print:w-full print:mb-6">
            <ul className="space-y-3">
              {keyPoints.map((point, index) => (
                <li key={index} className="flex gap-3 text-base print:break-inside-avoid">
                  <CheckCircle2 className="w-5 h-5 text-[#0b5a4b] shrink-0 mt-0.5" aria-hidden="true" />
                  <FormattedMarkdown
                    content={point}
                    className="flex-1 text-stone-700 leading-relaxed"
                  />
                </li>
              ))}
            </ul>
          </ReportCard>
        )}

        {/* Secciones */}
        {sections.length > 0 && (
          <div className="flex flex-col gap-6 print:gap-4">
            {sections.map((section, index) => (
              <ReportCard
                key={index}
                title={section.title || `Section ${index + 1}`}
                className="w-full print:block print:w-full print:mb-6"
              >
                {section.body ? (
                  <FormattedMarkdown content={section.body} className="text-[15px]" />
                ) : (
                  <span className="text-sm text-stone-400 italic">No content for this section.</span>
                )}
              </ReportCard>
            ))}
          </div>
        )}

        {/* Fuentes */}
        {sources.length > 0 && (
          <ReportCard title="Sources" className="w-full print:block print:w-full print:mb-6">
            <ul className="flex flex-col divide-y divide-stone-100 print:divide-stone-200">
              {sources.map((source, index) => {
                const href = safeHref(source.url);
                return (
                  <li key={index} className="py-3 first:pt-0 last:pb-0 print:break-inside-avoid">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded bg-stone-100 flex items-center justify-center shrink-0 print:bg-stone-200">
                        <FileText className="w-4 h-4 text-stone-600" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {source.title ? (
                          <FormattedMarkdown
                            content={source.title}
                            className="text-sm font-medium text-stone-900"
                          />
                        ) : (
                          <div className="text-sm font-medium text-stone-900 break-all">
                            {source.url}
                          </div>
                        )}
                        {source.date && (
                          <div className="text-xs text-stone-500 font-mono flex items-center gap-1 mt-1">
                            <Calendar className="w-3 h-3" aria-hidden="true" /> {source.date}
                          </div>
                        )}
                        {source.url && (
                          <div className="mt-1.5">
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-mono text-[#0b5a4b] hover:text-emerald-800 underline break-all inline-flex items-center gap-1.5"
                              >
                                <LinkIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
                                {source.url}
                              </a>
                            ) : (
                              // URL con esquema no permitido: se muestra como texto.
                              <span className="text-xs font-mono text-stone-500 break-all">
                                {source.url}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </ReportCard>
        )}

        {isEmpty && (
          <div className="text-stone-500 italic p-8 bg-white rounded-xl border border-stone-200 text-center print:break-inside-avoid">
            The agent returned no report content.
          </div>
        )}
      </div>
    </div>
  );
}
