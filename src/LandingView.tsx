/* ──────────────────────────────────────────────────────────── */
/*  LandingView                                                 */
/*                                                              */
/*  Vista de aterrizaje derivada del agente activo. Renderiza    */
/*  `title`, `subtitle` y los grupos de `highlights` del campo   */
/*  `landing` del manifiesto con la composición de dos tarjetas  */
/*  existente, y degrada a `name`, `tagline` y `description`     */
/*  cuando el manifiesto omite `landing`.                        */
/*                                                              */
/*  Requirements: 13.1, 13.2                                     */
/* ──────────────────────────────────────────────────────────── */

import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2 } from 'lucide-react';

import { resolveAgentIcon } from './components/AgentSelector';
import type {
  AgentCatalogEntry,
  AgentLandingHighlight,
  AgentLandingHighlightGroup,
} from './types';

/** Copia neutra mientras no hay agente activo (catálogo cargando, vacío o fallido). */
const PLACEHOLDER_CONTENT: LandingContent = {
  title: 'Tickr, your intelligent research workspace',
  subtitle: 'Pick an agent to start a run.',
  groups: [],
};

interface LandingContent {
  title: string;
  subtitle: string;
  groups: AgentLandingHighlightGroup[];
}

/**
 * Contenido efectivo de la vista: el bloque `landing` del manifiesto cuando
 * está presente (Requirement 13.1) y, si se omite, la identidad del agente
 * con su `description` como único grupo destacado (Requirement 13.2).
 */
export function landingContent(agent: AgentCatalogEntry | null): LandingContent {
  if (!agent) return PLACEHOLDER_CONTENT;

  if (agent.landing) {
    return {
      title: agent.landing.title,
      subtitle: agent.landing.subtitle,
      groups: agent.landing.highlights ?? [],
    };
  }

  return {
    title: agent.name,
    subtitle: agent.tagline,
    groups: [{ title: agent.description, items: [] }],
  };
}

/** Punto destacado con subtítulo: icono en círculo, título y subtítulo. */
function HighlightWithSubtitle({ item }: { item: AgentLandingHighlight }) {
  const Icon = resolveAgentIcon(item.icon);
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white shrink-0">
        <Icon className="w-4 h-4" aria-hidden="true" />
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium text-white">{item.title}</div>
        <div className="text-xs text-white/60">{item.subtitle}</div>
      </div>
    </div>
  );
}

/** Punto destacado sin subtítulo: marca de comprobación y título. */
function HighlightPlain({ item }: { item: AgentLandingHighlight }) {
  const Icon = item.icon ? resolveAgentIcon(item.icon) : CheckCircle2;
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-5 h-5 text-[#b3b3b3] shrink-0" aria-hidden="true" />
      <div className="text-sm text-white/90 font-medium">{item.title}</div>
    </div>
  );
}

function HighlightCard({ group }: { group: AgentLandingHighlightGroup }) {
  const items = group.items ?? [];
  // Los grupos con subtítulos usan la retícula de filas con icono en círculo;
  // los grupos de una sola línea, la lista de comprobación centrada.
  const hasSubtitles = items.some((item) => Boolean(item.subtitle));

  return (
    <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-none p-6 shadow-2xl flex flex-col hover:bg-black/30 transition-colors">
      <h3 className="text-xl font-medium text-white mb-6 text-left">{group.title}</h3>

      {items.length > 0 && (
        <div
          className={
            hasSubtitles
              ? 'flex-1 flex flex-col gap-3'
              : 'flex-1 flex flex-col gap-4 justify-center'
          }
        >
          {items.map((item, index) => (
            <div key={`${item.title}-${index}`}>
              {index > 0 && (
                <div
                  className={`w-full h-px bg-white/10 ${hasSubtitles ? 'my-1' : 'mb-4'}`}
                  aria-hidden="true"
                />
              )}
              {item.subtitle ? (
                <HighlightWithSubtitle item={item} />
              ) : (
                <HighlightPlain item={item} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface LandingViewProps {
  /** Agente activo; nulo mientras el catálogo no resuelve. */
  agent?: AgentCatalogEntry | null;
}

export function LandingView({ agent = null }: LandingViewProps) {
  const { title, subtitle, groups } = landingContent(agent);

  return (
    <div className="absolute inset-0 flex items-center justify-center p-8 overflow-y-auto no-scrollbar ">
      <AnimatePresence mode="wait">
        <motion.div
          // La clave por agente reanima la vista en cada cambio de selección.
          key={agent?.id ?? '__no_agent__'}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="relative z-10 w-full max-w-4xl mx-auto flex flex-col items-center py-12"
        >
          {/* Header */}
          <div className="text-center mb-16 max-w-3xl">
            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4 font-serif">
              {title}
            </h1>
            <p className="text-lg text-[#b3b3b3] font-medium">{subtitle}</p>
          </div>

          {/* Cards */}
          {groups.length > 0 && (
            <div
              className={`grid grid-cols-1 gap-6 w-full ${
                groups.length === 1 ? 'md:grid-cols-1 max-w-2xl' : 'md:grid-cols-2'
              }`}
            >
              {groups.map((group, index) => (
                <HighlightCard key={`${group.title}-${index}`} group={group} />
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
