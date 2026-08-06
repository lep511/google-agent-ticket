import { useRef, useState } from 'react';

/*
 * ---------------------------------------------------------------------------
 * PANEL DE DEPURACIÓN PROVISIONAL
 * ---------------------------------------------------------------------------
 * Para DESACTIVARLO: pon `DEBUG_PANEL_ENABLED` en `false` (una línea).
 * Para desactivarlo sin recompilar: abre la app con `?nodebug` en la URL.
 * Para BORRARLO: elimina este archivo y las dos referencias en `App.tsx`
 * (el `import` y el bloque `<DebugPanel ... />` al final del árbol).
 *
 * No lee ningún estado por su cuenta: todo entra por props, así que quitarlo
 * no puede romper el comportamiento de la aplicación.
 * ---------------------------------------------------------------------------
 */
export const DEBUG_PANEL_ENABLED = true;

/** Evento mínimo que el panel sabe listar (compatible con `TimelineEvent`). */
interface DebugEvent {
  id: number;
  kind: string;
  label: string;
  startTime?: number;
  endTime?: number;
}

export interface DebugPanelProps {
  /** Pares clave/valor que se muestran tal cual, en el orden dado. */
  state: Record<string, unknown>;
  /** Cola de eventos de la línea de tiempo, si la hay. */
  events?: DebugEvent[];
}

const STORAGE_KEY = 'debug-panel-open';

function formatValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value === '' ? '""' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function valueClass(value: unknown): string {
  if (value === true) return 'text-emerald-400';
  if (value === false) return 'text-stone-500';
  if (value === null || value === undefined) return 'text-stone-500';
  if (typeof value === 'number') return 'text-amber-300';
  return 'text-sky-300';
}

export function DebugPanel({ state, events = [] }: DebugPanelProps) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Contador de renders: sirve para detectar bucles de re-render.
  const renderCount = useRef(0);
  renderCount.current += 1;

  const disabledByUrl =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nodebug');

  if (!DEBUG_PANEL_ENABLED || disabledByUrl) return null;

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* localStorage no disponible: el estado vive sólo en memoria. */
      }
      return next;
    });
  };

  const copyState = () => {
    const payload = JSON.stringify({ state, events }, null, 2);
    navigator.clipboard?.writeText(payload).catch(() => {
      console.log('[debug] estado:', payload);
    });
  };

  const tail = events.slice(-6);

  return (
    <div className="fixed bottom-3 right-3 z-40 font-mono text-[11px] print:hidden">
      {open ? (
        <div className="w-96 max-h-[55vh] flex flex-col bg-stone-950 border border-stone-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-stone-900 border-b border-stone-700 shrink-0">
            <span className="font-bold tracking-wider text-amber-400 uppercase">Debug</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyState}
                className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded transition-colors"
              >
                copy
              </button>
              <button
                type="button"
                onClick={toggle}
                className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded transition-colors"
                aria-label="Cerrar panel de depuración"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="overflow-y-auto p-3 flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              {Object.entries(state).map(([key, value]) => (
                <div key={key} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-stone-500 shrink-0 w-32 truncate" title={key}>
                    {key}
                  </span>
                  <span className={`flex-1 min-w-0 break-all ${valueClass(value)}`}>
                    {formatValue(value)}
                  </span>
                </div>
              ))}
              <div className="flex items-start gap-2 leading-relaxed">
                <span className="text-stone-500 shrink-0 w-32">renders</span>
                <span className="flex-1 text-amber-300">{renderCount.current}</span>
              </div>
            </div>

            {tail.length > 0 && (
              <div className="flex flex-col gap-0.5 border-t border-stone-800 pt-2">
                <span className="text-stone-500 mb-1">
                  últimos eventos ({events.length} en total)
                </span>
                {tail.map((event) => {
                  const ms =
                    event.endTime && event.startTime ? event.endTime - event.startTime : null;
                  return (
                    <div key={event.id} className="flex items-start gap-2">
                      <span className="text-stone-600 shrink-0 w-6 text-right">{event.id}</span>
                      <span className="text-purple-300 shrink-0 w-20 truncate" title={event.kind}>
                        {event.kind}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-stone-300" title={event.label}>
                        {event.label}
                      </span>
                      <span className="text-stone-500 shrink-0 tabular-nums">
                        {ms === null ? '…' : `${(ms / 1000).toFixed(2)}s`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={toggle}
          className="px-2.5 py-1 bg-stone-950/90 border border-stone-700 text-amber-400 rounded shadow-lg hover:bg-stone-900 hover:border-stone-600 transition-colors font-bold tracking-wider uppercase"
          title="Abrir panel de depuración"
        >
          debug
        </button>
      )}
    </div>
  );
}
