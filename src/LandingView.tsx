/* ──────────────────────────────────────────────────────────── */
/*  LandingView                                                 */
/*                                                              */
/*  Landing view derived from the active agent. Renders the     */
/*  `title`, `subtitle`, and `highlights` groups from the       */
/*  manifest's `landing` field with the existing two-card       */
/*  composition, and falls back to `name`, `tagline`, and       */
/*  `description` when the manifest omits `landing`.            */
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

/** Neutral copy while no agent is active (catalog loading, empty, or failed). */
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
 * Effective view content: the manifest's `landing` block when present
 * (Requirement 13.1) and, if omitted, the agent's identity with its
 * `description` as the sole highlighted group (Requirement 13.2).
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

/**
 * Punto destacado con subtítulo: icono en círculo, título y subtítulo.
 *
 * The circle is centred on the whole text column, which is what keeps it aligned
 * once the subtitle wraps to a second line on a narrow viewport. `min-w-0` lets
 * that column take the width the icon does not need instead of overflowing the
 * card, and the tighter leading keeps a wrapped row from looking cramped.
 */
function HighlightWithSubtitle({ item }: { item: AgentLandingHighlight }) {
  const Icon = resolveAgentIcon(item.icon);
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white shrink-0">
        <Icon className="w-4 h-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug text-white break-words">{item.title}</div>
        <div className="text-xs leading-snug text-white/70 break-words">{item.subtitle}</div>
      </div>
    </div>
  );
}

/** Highlight with subtitle: icon in circle, title, and subtitle. */
function HighlightPlain({ item }: { item: AgentLandingHighlight }) {
  const Icon = item.icon ? resolveAgentIcon(item.icon) : CheckCircle2;
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-5 h-5 text-stone-300 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm font-medium leading-snug text-white/90 break-words">
        {item.title}
      </div>
    </div>
  );
}

function HighlightCard({ group }: { group: AgentLandingHighlightGroup }) {
  const items = group.items ?? [];
  // Groups with subtitles use the row grid with icon in circle;
  // single-line groups use the centered checklist.
  const hasSubtitles = items.some((item) => Boolean(item.subtitle));

  return (
    <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-none p-5 shadow-2xl flex flex-col hover:bg-black/30 transition-colors sm:p-6">
      <h3 className="text-lg font-medium text-white mb-5 text-left text-pretty sm:text-xl sm:mb-6">
        {group.title}
      </h3>

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
  /** Active agent; null while the catalog does not resolve. */
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
      <div className="flex min-h-full items-center justify-center px-4 py-[clamp(1rem,3vh,2rem)] sm:px-8">
        <AnimatePresence mode="wait">
          <motion.div
            // The agent key reanimates the view on each selection change.
            key={agent?.id ?? '__no_agent__'}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            /* Fluid vertical rhythm: the gap to the header scales with the
               viewport instead of jumping between two fixed values. */
            className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center py-[clamp(1rem,4vh,3rem)]"
          >
            {/* Header */}
            <div className="relative mb-[clamp(2rem,7vh,4rem)] max-w-3xl text-center">
              {/*
                Scrim under the hero copy. The dotted texture of the shell runs
                behind the title, and at mobile sizes those dots read through the
                letterforms; a soft wash of the page background lifts the text off
                the pattern without introducing a visible panel.
              */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-x-6 -inset-y-4"
                style={{
                  background:
                    'radial-gradient(65% 75% at 50% 45%, rgba(28,25,23,0.92) 0%, rgba(28,25,23,0.55) 55%, rgba(28,25,23,0) 100%)',
                }}
              />
              {/*
                `Instrument Serif` ships a single weight, so `font-bold` made the
                browser synthesise the bold by double-stroking the glyphs, which
                is what blurred the title on mobile. The real weight renders crisp,
                and `font-synthesis: none` keeps any future weight class from
                bringing the faux bold back.
              */}
              <h1 className="relative mb-4 font-serif text-[clamp(1.875rem,7vw,3rem)] font-normal leading-[1.1] tracking-tight text-white antialiased text-balance [font-synthesis:none]">
                {title}
              </h1>
              <p className="relative text-base font-medium text-stone-300 text-pretty sm:text-lg">
                {subtitle}
              </p>
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
