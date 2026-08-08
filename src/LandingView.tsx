/* ──────────────────────────────────────────────────────────── */
/*  LandingView                                                 */
/*                                                              */
/*  Vista de aterrizaje derivada del agente activo. Renderiza    */
/*  `title`, `subtitle` y los grupos de `highlights` del campo   */
/*  `landing` del manifiesto con la composición de dos tarjetas  */
/*  existente, y degrada a `name`, `tagline` y `description`     */
/*  cuando el manifiesto omite `landing`.                        */
/*                                                              */

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
    /*
      Scroll container of the view: it takes the space main leaves above the
      input bar and shows its own scrollbar. Centering lives on the inner
      wrapper with `min-h-full`, because a centered flex child of a scroll
      container has its overflow clipped above the top edge instead of
      becoming reachable, which is what made the agent copy unreadable on
      short windows.
    */
    <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden fade-bottom-edge">
      <div className="flex min-h-full items-center justify-center p-4 sm:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            // La clave por agente reanima la vista en cada cambio de selección.
            key={agent?.id ?? '__no_agent__'}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center py-6 sm:py-12"
          >
            {/* Header */}
            <div className="mb-10 max-w-3xl text-center sm:mb-16">
              <h1 className="mb-4 font-serif text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
                {title}
              </h1>
              <p className="text-lg font-medium text-[#b3b3b3]">{subtitle}</p>
            </div>

            {/* Cards */}
            {groups.length > 0 && (
              <div
                className={`grid w-full grid-cols-1 gap-6 ${
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
    </div>
  );
}
