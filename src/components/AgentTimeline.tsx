import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Info, Brain, Code, CheckCircle, MessageSquare, AlertCircle, ChevronDown, HelpCircle } from 'lucide-react';
import { FormattedMarkdown } from './FormattedMarkdown';

export interface TimelineEvent {
  id: number;
  kind: 'info' | 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'error';
  label: string;
  detail?: string;
  toolName?: string;
  startTime?: number;
  endTime?: number;
  callId?: string;
}

const ICONS = {
  info: Info,
  thinking: Brain,
  tool_call: Code,
  tool_result: CheckCircle,
  text: MessageSquare,
  error: AlertCircle,
} as const;

function isToolResultError(event: TimelineEvent): boolean {
  if (event.kind !== 'tool_result' || !event.detail) return false;
  const d = event.detail.toLowerCase();
  return d.includes('"error"') || d.startsWith('error') || d.includes('is not configured') || d.includes('api returned 4') || d.includes('api returned 5');
}

function TimelineItem({ event, running }: { event: TimelineEvent; running: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const toolFailed = isToolResultError(event);
  const Icon = toolFailed ? AlertCircle : (ICONS[event.kind] || Info);
  const now = Date.now();
  const durationMs = event.endTime
    ? event.endTime - (event.startTime || event.endTime)
    : event.startTime && running
    ? Math.max(0, now - event.startTime)
    : 0;
  const durationSec = (durationMs / 1000).toFixed(2);

  const hasDetail = Boolean(event.detail && event.detail.trim());

  // `endTime` is only filled in when the next event arrives, so during a run the
  // only event without a closing time is the one running right now.
  const isActive = running && !event.endTime;
  // Steps that already ran are muted, unless the user opens them to read. The
  // muting uses colour instead of opacity so the card stays solid and neither
  // the timeline line nor the panel behind it shows through.
  const isMuted = !isActive && !expanded;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45 }}
      className={`border rounded-xl w-full flex flex-col overflow-hidden shadow-2xl transition-colors duration-500 ${
        isActive
          ? 'bg-stone-700 border-white/30'
          : 'bg-stone-800 border-stone-700 hover:border-stone-600'
      }`}
    >
      <div 
        className={`p-5 flex flex-col gap-3 ${hasDetail ? 'cursor-pointer select-none' : ''}`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Icon className={`w-5 h-5 shrink-0 transition-colors duration-500 ${isMuted ? 'text-stone-400' : 'text-white'}`} />
            <h3 className={`font-bold text-base tracking-tight transition-colors duration-500 ${isMuted ? 'text-stone-300' : 'text-white'}`}>{event.label}</h3>
          </div>
          {hasDetail && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="text-white/70 hover:text-white flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded-md transition-colors shrink-0"
            >
              <span>{expanded ? 'Hide Details' : 'View Results'}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : 'rotate-0'}`} />
            </button>
          )}
        </div>

        {hasDetail && expanded && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white/5 rounded-lg p-4 flex items-start gap-3 mt-1"
          >
            <div className="shrink-0 mt-0.5">
              {event.kind === 'tool_result' ? (
                toolFailed
                  ? <AlertCircle className="w-4 h-4 text-red-400" />
                  : <CheckCircle className="w-4 h-4 text-emerald-400" />
              ) : (
                <div className="w-4 h-4 border-2 border-white/30 border-dashed rounded-full" />
              )}
            </div>
            <FormattedMarkdown
              content={event.detail}
              variant="dark"
              className="text-[12px] leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-60 overflow-y-auto w-full"
            />
          </motion.div>
        )}
      </div>

      <div 
        className={`border-t border-white/10 bg-black/30 px-6 py-2.5 flex items-center justify-between text-[11px] font-medium text-white/50 ${hasDetail ? 'cursor-pointer hover:bg-black/40 select-none' : ''}`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 text-white/70">
          {event.toolName ? (
            <span className="flex items-center gap-1.5">
              <Code className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-mono text-white/90">{event.toolName}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-stone-400" />
              <span>Event Log</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {hasDetail && (
            <span className="text-white/80 hover:text-white flex items-center gap-1 font-medium">
              <span>{expanded ? 'Hide Results' : 'View Results'}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : 'rotate-0'}`} />
            </span>
          )}
          <span className="tabular-nums text-white/50 font-mono">{durationSec}s</span>
        </div>
      </div>
    </motion.div>
  );
}

export function AgentTimeline({ events, running, paused, hasReport, onViewReport, onDecisionClick, metrics, isStopped }: { events: TimelineEvent[]; running: boolean; paused?: boolean; hasReport?: boolean; onViewReport?: () => void; onDecisionClick?: () => void; metrics?: { durationSecs: number; tokenCount: number; documentCount: number }, isStopped?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const userScrolledUpRef = useRef(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    let timer: any;
    if (running) {
      timer = setInterval(() => {
        setTick(t => t + 1);
      }, 50); // 50ms for smooth 2 decimal places updates
    }
    return () => clearInterval(timer);
  }, [running]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // If user is more than 60px away from bottom, they have scrolled up
    const isUp = distanceFromBottom > 60;
    userScrolledUpRef.current = isUp;
    setShowScrollBottom(isUp);
  };

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
  };

  useEffect(() => {
    if (!userScrolledUpRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div 
      ref={containerRef}
      onScroll={handleScroll}
      /* `fade-bottom-edge`: the events dissolve where the list meets the bar. */
      className="w-full flex-1 overflow-y-auto relative px-6 py-8 flex flex-col items-center fade-bottom-edge"
    >
      <div className="w-full max-w-none relative">
        {/*
          The line lives inside the content wrapper, not in the scroll
          container: an absolute box anchored to the scroller only spans its
          visible height, so the line stopped growing once the events overflowed.
          Anchored here it stretches over the full list and keeps extending as
          new cards arrive.
        */}
        {events.length > 0 && (
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 left-1/2 w-px bg-white/20 -translate-x-1/2 z-0"
          />
        )}

        <div className="space-y-6 relative z-10">
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <TimelineItem key={e.id} event={e} running={running} />
          ))}
        </AnimatePresence>

        {running && !paused && (
           <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             className="bg-stone-800 border border-stone-700 rounded-xl p-6 w-full flex flex-col gap-4 overflow-hidden shadow-2xl"
           >
             <div className="flex items-center gap-3">
               <div className="w-5 h-5 border-2 border-white rounded-full animate-pulse shrink-0" />
               <span className="font-bold text-white text-base tracking-tight">Skill is working...</span>
             </div>
           </motion.div>
        )}

        {paused && (
           <motion.div
             initial={{ opacity: 0, scale: 0.95 }}
             animate={{ opacity: 1, scale: 1 }}
             className="bg-stone-800 border border-yellow-500/50 rounded-xl p-6 w-full flex items-center justify-between cursor-pointer hover:bg-stone-700 transition-colors shadow-lg shadow-black/10 animate-pulse"
             onClick={onDecisionClick}
           >
             <div className="flex items-center gap-3">
               <HelpCircle className="w-5 h-5 text-yellow-500 shrink-0" />
               <div>
                  <h3 className="font-bold text-white text-base tracking-tight">Strategic Decision Required</h3>
                  <p className="text-sm text-white/70 font-medium mt-0.5">I found conflicting reports on their new EV timeline...</p>
               </div>
             </div>
             <ChevronDown className="w-5 h-5 text-white/50 -rotate-90" />
           </motion.div>
        )}

        {hasReport && !isStopped && (
           <motion.div
             initial={{ opacity: 0, y: 16 }}
             animate={{ opacity: 1, y: 0 }}
             className="bg-stone-800 border border-stone-700 rounded-xl w-full flex flex-col cursor-pointer hover:bg-stone-700 transition-colors shadow-2xl"
             onClick={onViewReport}
           >
             <div className="p-6 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <CheckCircle className="w-5 h-5 text-[#34a853] shrink-0" />
                   <div>
                      <h3 className="font-bold text-white text-base tracking-tight">Your report is now ready</h3>
                      <p className="text-sm text-white/70 font-medium mt-0.5">Click to see the final intelligence report.</p>
                   </div>
                 </div>
                 <div className="flex items-center gap-2 text-white font-medium text-sm bg-white/10 px-3 py-1.5 rounded-lg border border-white/10">
                   <span>View Report</span>
                   <ChevronDown className="w-4 h-4 text-white/70 -rotate-90" />
                 </div>
             </div>
             {metrics && (
                 <div className="border-t border-white/10 bg-black/20 px-6 py-3 flex flex-wrap gap-4 text-[11px] font-medium text-white/50">
                    <span className="flex items-center gap-1.5"><span className="text-white/70">Docs:</span> {metrics.documentCount}</span>
                    <span className="flex items-center gap-1.5"><span className="text-white/70">Time:</span> {metrics.durationSecs}s</span>
                    <span className="flex items-center gap-1.5"><span className="text-white/70">Tokens:</span> {metrics.tokenCount.toLocaleString()}</span>
                 </div>
             )}
           </motion.div>
        )}

        {isStopped && (
           <motion.div
             initial={{ opacity: 0, y: 16 }}
             animate={{ opacity: 1, y: 0 }}
             className="bg-stone-800 border border-red-500/50 rounded-xl w-full flex flex-col shadow-2xl"
           >
             <div className="p-6 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <AlertCircle className="w-[#CC3131] h-5 shrink-0 text-[#CC3131]" />
                   <div>
                      <h3 className="font-bold text-[#CC3131] text-base tracking-tight">Analysis Stopped</h3>
                      <p className="text-sm text-white/70 font-medium mt-0.5">The analysis session was stopped by the user.</p>
                   </div>
                 </div>
             </div>
           </motion.div>
        )}

        </div>
      </div>

      {/*
        Bottom breathing room lives outside the wrapper that hosts the line:
        inside it, the spacer stretched the line past the last card and left a
        dangling tail below it.
      */}
      <div ref={endRef} className="h-4 w-full shrink-0" />

      {/* Floating Circular Scroll-to-Bottom Button */}
      <AnimatePresence>
        {showScrollBottom && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            onClick={scrollToBottom}
            /* Above the 2rem fade of `fade-bottom-edge`, so it stays solid. */
            className="sticky bottom-10 z-40 w-12 h-12 p-0 bg-stone-800 hover:bg-stone-700 active:scale-95 text-white border border-stone-600 rounded-full shadow-2xl backdrop-blur-md flex items-center justify-center cursor-pointer transition-all hover:border-white/50 hover:shadow-black/50 shrink-0"
            title="Ir al final"
          >
            <ChevronDown className="w-6 h-6 text-white shrink-0 stroke-[2.5]" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
