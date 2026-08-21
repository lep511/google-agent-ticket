/* ──────────────────────────────────────────────────────────── */
/*  AgentSelector                                               */
/*                                                              */
/*  Active agent selector for the header. Displays a trigger    */
/*  with the icon and `name` of the active agent and a popup    */
/*  panel with a card for each agent in the catalog.            */
/*                                                              */

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
 * Icons that the selector can render. This is the client-side mirror of the
 * agent registry's whitelist (`server/lib/agentTypes.ts`): a manifest with an
 * icon outside this list won't even enter the catalog, so an arbitrary name
 * is never resolved here (Requirements 11.10, 16.4).
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

/** Fallback icon when the declared name is not in the allowed list. */
const FALLBACK_ICON: LucideIcon = Bot;

/** Resolves an icon name against the allowed list (Requirement 11.10). */
export function resolveAgentIcon(iconName: string | undefined): LucideIcon {
  if (!iconName) return FALLBACK_ICON;
  return AGENT_ICONS[iconName] ?? FALLBACK_ICON;
}

/** Visible label for each agent's input type (Requirement 11.2). */
const INPUT_MODE_LABELS: Record<InputMode, string> = {
  ticker: 'Ticker',
  text: 'Free text',
};

function inputModeLabel(inputMode: string): string {
  return INPUT_MODE_LABELS[inputMode as InputMode] ?? inputMode;
}

/** Catalog request state (Requirements 11.7, 11.8, 11.9). */
export type AgentCatalogStatus = 'loading' | 'ready' | 'error';

export interface AgentSelectorProps {
  /**
   * Catalog already ordered as `GET /api/agents` returns it. The selector
   * re-orders it for display so the default agent is listed first.
   */
  agents: AgentCatalogEntry[];
  /** Active agent; null while there is no catalog. */
  activeAgentId: string | null;
  /** Default agent from the catalog, for the "Default" badge. */
  defaultAgentId: string | null;
  /** Catalog request state. */
  status: AgentCatalogStatus;
  /** Catalog failure message, if any. */
  errorMessage?: string | null;
  /**  switching is blocked during a run in progress. */
  running?: boolean;
  /** User-confirmed selection. */
  onSelect: (agentId: string) => void;
  /**  catalog request retry. */
  onRetry: () => void;
}

export function AgentSelector({
  agents: catalogAgents,
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

  /*
    Display order: the default agent goes first and the rest keep the catalog
    order untouched. This only affects presentation, so the server contract and
    the catalog total order stay as they are (the "first in order" rule that
    designates the default agent still reads the unmodified catalog).
  */
  const agents = useMemo(() => {
    if (defaultAgentId === null) return catalogAgents;
    const defaultIndex = catalogAgents.findIndex((agent) => agent.id === defaultAgentId);
    if (defaultIndex <= 0) return catalogAgents;
    return [
      catalogAgents[defaultIndex]!,
      ...catalogAgents.slice(0, defaultIndex),
      ...catalogAgents.slice(defaultIndex + 1),
    ];
  }, [catalogAgents, defaultAgentId]);

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

  /**  selecting an agent closes the panel. */
  const confirmSelection = useCallback(
    (agent: AgentCatalogEntry) => {
      onSelect(agent.id);
      closePanel();
    },
    [onSelect, closePanel],
  );

  //  if a run starts with the panel open, it closes.
  useEffect(() => {
    if (running && open) closePanel(false);
  }, [running, open, closePanel]);

  //  click outside the panel.
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

  //  `Escape` closes the panel from any focus point.
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

  //  on open, focus starts on the active agent.
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

  /**  arrows, `Home`, `End`, `Enter`, and `Space`. */
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
        // `preventDefault` prevents the synthetic button click: the selection is
        // confirmed exactly once.
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
    activeAgent?.name ?? (status === 'loading' ? 'Loading agents…' : 'No agent');

  return (
    /*
      Fluid width: `w-56` is the base (and maximum) size, and the flex parent may
      shrink it when the header runs out of room, but never past `min-w`, which is
      75% of that base. The label truncates once the floor is reached.
    */
    <div ref={containerRef} className="group relative w-56 min-w-42 shrink font-sans">
      {/*  icon, `name`, and expand indicator. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closePanel(false) : setOpen(true))}
        disabled={running}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select agent"
        aria-describedby={running ? 'agent-selector-locked' : undefined}
        /*
          The trigger fills the width the container settled on, so the header does
          not reflow when the Active Agent changes: the icon and the chevron never
          shrink and the name takes the remaining space, truncated with an ellipsis.
        */
        title={triggerLabel}
        className="w-full flex items-center gap-2 px-2.5 py-2 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 transition-colors hover:bg-stone-700 hover:border-stone-500 active:bg-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-stone-800 disabled:hover:border-stone-600 sm:px-3"
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
        {/* The full name lives in the trigger's own `title`, so a truncated
            label is still readable on hover from anywhere on the control. */}
        <span className="flex-1 min-w-0 truncate text-left font-display font-bold text-sm tracking-wide text-white">
          {triggerLabel}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-stone-400 transition-transform duration-200 ${open ? 'rotate-180' : 'rotate-0'}`}
          aria-hidden="true"
        />
      </button>

      {/*
         reason for blocking during a run. Presented as a
        tooltip over the trigger: it stays in the DOM while `running` is true
        (for `aria-describedby`) and is only visually hidden, so screen readers
        announce it the same way. The hover is taken from the container because
        disabled buttons do not emit mouse events in all browsers.
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
            /* Never wider than the viewport, so the panel stays on screen at 320px. */
            className="absolute left-0 top-full mt-2 z-50 w-[min(20rem,calc(100vw-1.5rem))] max-h-[60vh] overflow-y-auto overscroll-contain bg-stone-800 border border-stone-700 rounded-xl shadow-2xl shadow-black/50"
          >
            {/*  catalog loading state. */}
            {status === 'loading' && (
              <div className="p-5 flex items-center gap-3 text-sm text-white/70">
                <Loader2 className="w-4 h-4 animate-spin text-white/70 shrink-0" />
                <span>Loading agents…</span>
              </div>
            )}

            {/*  error state with retry action. */}
            {status === 'error' && (
              <div className="p-5 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-white">
                      Could not load the agent catalog
                    </p>
                    <p className="text-xs text-white/60 mt-0.5">
                      {errorMessage?.trim()
                        ? errorMessage
                        : 'Continuing with the last known agent.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onRetry}
                  className="self-start flex items-center gap-1.5 text-xs font-medium text-white px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-md transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Retry</span>
                </button>
              </div>
            )}

            {/*  explanatory empty state. */}
            {isEmptyCatalog && (
              <div className="p-5 flex items-start gap-3">
                <Info className="w-4 h-4 text-white/70 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-white">No agents available</p>
                  <p className="text-xs text-white/60 mt-0.5">
                    Add a folder with a valid <span className="font-mono">manifest.json</span> in{' '}
                    <span className="font-mono">agent/</span> to run a query.
                  </p>
                </div>
              </div>
            )}

            {/*  one card per agent in the catalog. */}
            {hasOptions && (
              <div role="listbox" aria-label="Available agents" aria-orientation="vertical">
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
                        className={`w-full text-left p-4 flex items-start gap-3 transition-colors hover:bg-white/5 active:bg-white/10 focus:outline-none focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-400 ${
                          isActive ? 'bg-white/5 border-l-2' : 'border-l-2 border-transparent'
                        }`}
                        //  the agent's accent marks the active one.
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
                                Default
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

                        {/*  checkmark icon on the active one. */}
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
