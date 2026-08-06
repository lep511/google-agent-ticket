/* ──────────────────────────────────────────────────────────── */
/*  AgentSelector                                               */
/*                                                              */
/*  Selector del agente activo para la cabecera. Muestra un     */
/*  disparador con el icono y el `name` del agente activo y un  */
/*  panel emergente con una tarjeta por agente del catálogo.    */
/*                                                              */
/*  Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7,    */
/*                11.8, 11.9, 11.10                             */
/* ──────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Bot,
  Brain,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code,
  Compass,
  Database,
  FileText,
  Globe,
  HelpCircle,
  Info,
  Landmark,
  Lightbulb,
  LineChart,
  Loader2,
  MessageSquare,
  Newspaper,
  PieChart,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { AgentCatalogEntry, InputMode } from '../types';

/**
 * Iconos que el selector sabe pintar. Es el espejo en el cliente de la lista
 * blanca del registro de agentes (`server/lib/agentTypes.ts`): un manifiesto
 * con un icono fuera de esta lista ni siquiera entra en el catálogo, así que
 * aquí nunca se resuelve un nombre arbitrario (Requirements 11.10, 16.4).
 */
const AGENT_ICONS: Record<string, LucideIcon> = {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Bot,
  Brain,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code,
  Compass,
  Database,
  FileText,
  Globe,
  HelpCircle,
  Info,
  Landmark,
  Lightbulb,
  LineChart,
  MessageSquare,
  Newspaper,
  PieChart,
  Printer,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
};

/** Icono de reserva cuando el nombre declarado no está en la lista permitida. */
const FALLBACK_ICON: LucideIcon = Bot;

/** Resuelve un nombre de icono contra la lista permitida (Requirement 11.10). */
export function resolveAgentIcon(iconName: string | undefined): LucideIcon {
  if (!iconName) return FALLBACK_ICON;
  return AGENT_ICONS[iconName] ?? FALLBACK_ICON;
}

/** Etiqueta visible del tipo de entrada de cada agente (Requirement 11.2). */
const INPUT_MODE_LABELS: Record<InputMode, string> = {
  ticker: 'Ticker',
  text: 'Texto libre',
};

function inputModeLabel(inputMode: string): string {
  return INPUT_MODE_LABELS[inputMode as InputMode] ?? inputMode;
}

/** Estado de la petición del catálogo (Requirements 11.7, 11.8, 11.9). */
export type AgentCatalogStatus = 'loading' | 'ready' | 'error';

export interface AgentSelectorProps {
  /** Catálogo ya ordenado tal como lo devuelve `GET /api/agents`. */
  agents: AgentCatalogEntry[];
  /** Agente activo; nulo mientras no hay catálogo. */
  activeAgentId: string | null;
  /** Agente por defecto del catálogo, para la marca "Predeterminado". */
  defaultAgentId: string | null;
  /** Estado de la petición del catálogo. */
  status: AgentCatalogStatus;
  /** Mensaje del fallo del catálogo, si lo hay. */
  errorMessage?: string | null;
  /** Requirement 11.4: con una ejecución en curso el cambio está bloqueado. */
  running?: boolean;
  /** Selección confirmada por el usuario. */
  onSelect: (agentId: string) => void;
  /** Requirement 11.8: reintento de la petición del catálogo. */
  onRetry: () => void;
}

export function AgentSelector({
  agents,
  activeAgentId,
  defaultAgentId,
  status,
  errorMessage,
  running = false,
  onSelect,
  onRetry,
}: AgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [agents, activeAgentId],
  );

  const isEmptyCatalog = status === 'ready' && agents.length === 0;
  const hasOptions = agents.length > 0;

  const closePanel = useCallback((returnFocus = true) => {
    setOpen(false);
    setFocusIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  /** Requirement 11.5: seleccionar un agente cierra el panel. */
  const confirmSelection = useCallback(
    (agent: AgentCatalogEntry) => {
      onSelect(agent.id);
      closePanel();
    },
    [onSelect, closePanel],
  );

  // Requirement 11.4: si arranca una ejecución con el panel abierto, se cierra.
  useEffect(() => {
    if (running && open) closePanel(false);
  }, [running, open, closePanel]);

  // Requirement 11.5: clic fuera del panel.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        closePanel(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open, closePanel]);

  // Requirement 11.5: `Escape` cierra el panel desde cualquier punto del foco.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closePanel]);

  // Requirement 11.6: al abrir, el foco arranca en el agente activo.
  useEffect(() => {
    if (!open) return;
    if (!hasOptions) {
      setFocusIndex(-1);
      return;
    }
    const activeIndex = agents.findIndex((agent) => agent.id === activeAgentId);
    setFocusIndex(activeIndex >= 0 ? activeIndex : 0);
  }, [open, hasOptions, agents, activeAgentId]);

  useEffect(() => {
    if (!open || focusIndex < 0) return;
    optionRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  /** Requirement 11.6: flechas, `Home`, `End`, `Enter` y `Espacio`. */
  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasOptions) return;
    const lastIndex = agents.length - 1;
    const current = focusIndex < 0 ? 0 : focusIndex;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        setFocusIndex(current >= lastIndex ? 0 : current + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        setFocusIndex(current <= 0 ? lastIndex : current - 1);
        break;
      case 'Home':
        event.preventDefault();
        setFocusIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setFocusIndex(lastIndex);
        break;
      case 'Enter':
      case ' ':
      case 'Spacebar': {
        // `preventDefault` evita el clic sintético del botón: la selección se
        // confirma exactamente una vez.
        event.preventDefault();
        const agent = agents[current];
        if (agent) confirmSelection(agent);
        break;
      }
      default:
        break;
    }
  };

  const TriggerIcon = activeAgent ? resolveAgentIcon(activeAgent.icon) : FALLBACK_ICON;
  const triggerLabel =
    activeAgent?.name ?? (status === 'loading' ? 'Cargando agentes…' : 'Sin agente');

  return (
    <div ref={containerRef} className="group relative font-sans">
      {/* Requirement 11.1: icono, `name` e indicador de despliegue. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closePanel(false) : setOpen(true))}
        disabled={running}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Seleccionar agente"
        aria-describedby={running ? 'agent-selector-locked' : undefined}
        className="flex items-center gap-2 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-stone-800"
      >
        <span
          className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center shrink-0"
          style={activeAgent ? { color: activeAgent.accentColor } : undefined}
        >
          {status === 'loading' && !activeAgent ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-300" />
          ) : (
            <TriggerIcon className="w-3.5 h-3.5" />
          )}
        </span>
        <span className="font-display font-bold text-sm tracking-wide text-white">
          {triggerLabel}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${open ? 'rotate-180' : 'rotate-0'}`}
          aria-hidden="true"
        />
      </button>

      {/*
        Requirement 11.4: motivo del bloqueo durante una ejecución. Se presenta
        como tooltip sobre el disparador: sigue en el DOM mientras `running` es
        verdadero (para `aria-describedby`) y sólo se oculta visualmente, así
        que los lectores de pantalla lo anuncian igual. El hover se toma del
        contenedor porque los botones deshabilitados no emiten eventos de ratón
        en todos los navegadores.
      */}
      {running && (
        <p
          id="agent-selector-locked"
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full mt-2 z-50 w-max max-w-xs px-2.5 py-1.5 bg-stone-800 border border-stone-700 rounded-md shadow-lg shadow-black/50 text-[11px] text-stone-300 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150"
        >
          You can&rsquo;t switch agents while a run is in progress.
        </p>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            onKeyDown={handlePanelKeyDown}
            className="absolute left-0 top-full mt-2 z-50 w-80 max-h-[60vh] overflow-y-auto bg-stone-800 border border-stone-700 rounded-xl shadow-2xl shadow-black/50"
          >
            {/* Requirement 11.7: estado de carga del catálogo. */}
            {status === 'loading' && (
              <div className="p-5 flex items-center gap-3 text-sm text-white/70">
                <Loader2 className="w-4 h-4 animate-spin text-white/70 shrink-0" />
                <span>Cargando agentes…</span>
              </div>
            )}

            {/* Requirement 11.8: estado de error con acción de reintento. */}
            {status === 'error' && (
              <div className="p-5 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-white">
                      No se pudo cargar el catálogo de agentes
                    </p>
                    <p className="text-xs text-white/60 mt-0.5">
                      {errorMessage?.trim()
                        ? errorMessage
                        : 'Seguimos con el último agente conocido.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onRetry}
                  className="self-start flex items-center gap-1.5 text-xs font-medium text-white px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-md transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Reintentar</span>
                </button>
              </div>
            )}

            {/* Requirement 11.9: estado vacío explicativo. */}
            {isEmptyCatalog && (
              <div className="p-5 flex items-start gap-3">
                <Info className="w-4 h-4 text-white/70 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-white">No hay agentes disponibles</p>
                  <p className="text-xs text-white/60 mt-0.5">
                    Añade una carpeta con un <span className="font-mono">manifest.json</span> válido
                    en <span className="font-mono">agent/</span> para poder ejecutar una consulta.
                  </p>
                </div>
              </div>
            )}

            {/* Requirement 11.2: una tarjeta por agente del catálogo. */}
            {hasOptions && (
              <div role="listbox" aria-label="Agentes disponibles" aria-orientation="vertical">
                {agents.map((agent, index) => {
                  const Icon = resolveAgentIcon(agent.icon);
                  const isActive = agent.id === activeAgentId;
                  const isDefault = defaultAgentId !== null && agent.id === defaultAgentId;

                  return (
                    <div key={agent.id}>
                      {index > 0 && <div className="h-px bg-stone-700" aria-hidden="true" />}
                      <button
                        ref={(node) => {
                          optionRefs.current[index] = node;
                        }}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        tabIndex={focusIndex === index ? 0 : -1}
                        onClick={() => confirmSelection(agent)}
                        className={`w-full text-left p-4 flex items-start gap-3 transition-colors hover:bg-white/5 focus:outline-none focus-visible:bg-white/10 ${
                          isActive ? 'bg-white/5 border-l-2' : 'border-l-2 border-transparent'
                        }`}
                        // Requirement 11.3: el acento del agente marca el activo.
                        style={isActive ? { borderLeftColor: agent.accentColor } : undefined}
                      >
                        <span
                          className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0"
                          style={{ color: agent.accentColor }}
                        >
                          <Icon className="w-4 h-4" aria-hidden="true" />
                        </span>

                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white truncate">
                              {agent.name}
                            </span>
                            {isDefault && (
                              <span className="text-[10px] uppercase tracking-wide font-medium text-white/70 px-1.5 py-0.5 bg-white/10 rounded shrink-0">
                                Predeterminado
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-white/60 mt-0.5">
                            {agent.tagline}
                          </span>
                          <span className="mt-2 inline-flex items-center text-[10px] font-medium text-white/60 px-1.5 py-0.5 border border-white/10 rounded">
                            {inputModeLabel(agent.inputMode)}
                          </span>
                        </span>

                        {/* Requirement 11.3: icono de comprobación en el activo. */}
                        {isActive && (
                          <CheckCircle2
                            className="w-4 h-4 shrink-0 mt-0.5"
                            style={{ color: agent.accentColor }}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
