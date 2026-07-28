import { LandingView } from './LandingView';
import React, { useState, useRef, useEffect } from 'react';
import { PulsatingDotsBackground } from './components/PulsatingDots';
import { Search, Loader2 } from 'lucide-react';
import ReportTemplate from "./ReportTemplate";
import { AgentTimeline, TimelineEvent } from './components/AgentTimeline';
import { auth, signInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export interface DocumentFinding {
  documentType?: string;
  document_type?: string;
  keyInsights?: string[];
  key_insights?: string[];
  date?: string;
  sourceUrl?: string;
  source_url?: string;
}

export interface DeepInsight {
  category: string;
  title: string;
  description: string;
  impact_score: number;
}

export interface ReportData {
  verdict?: {
    summary: string;
    conviction_score: number;
    key_takeaways: string[];
  };
  deep_insights?: DeepInsight[];
  findings?: DocumentFinding[];
  financial_charts?: {
    stock_price_4m: { date: string; price: number }[];
    financial_performance_4q: { quarter: string; revenue?: number; net_income?: number; distributions?: number }[];
  };
}

// Toggle this to true if you want the JSON logs to be downloaded automatically after a run.
const ENABLE_JSON_DOWNLOAD = false;

export default function App() {
  const [ticker, setTicker] = useState('');
  const [instruction, setInstruction] = useState('');
  
  // Gemini 3.6 Flash state
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const eventIdRef = useRef(0);
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [toolRuns, setToolRuns] = useState<number>(0);
  const [durationSecs, setDurationSecs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  const [isReportOpen, setIsReportOpen] = useState<'flash'|false>(false);
  const [user, setUser] = useState<User | null>(null);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [isStopped, setIsStopped] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (running && startTime) {
      interval = setInterval(() => {
        setDurationSecs(Math.round((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [running, startTime]);

  const stopAgent = () => {
    if (abortRef.current) abortRef.current.abort();
    setRunning(false);
    setIsStopped(true);
  };

  const createPushEvent = (setEvts: any, idRef: any) => (kind: TimelineEvent['kind'], label: string, detail?: string, toolName?: string, callId?: string) => {
    const now = Date.now();
    setEvts((prev: any) => {
      const newEvents = [...prev];
      if (newEvents.length > 0) {
        const lastIndex = newEvents.length - 1;
        if (!newEvents[lastIndex].endTime) {
          newEvents[lastIndex] = { ...newEvents[lastIndex], endTime: now };
        }
      }
      newEvents.push({ id: idRef.current++, kind, label, detail, toolName, startTime: now, callId });
      return newEvents;
    });
  };
  
  const pushEvent = createPushEvent(setEvents, eventIdRef);

  const extractThinkingTitle = (text: string) => {
    if (!text) return 'Analyzing...';
    const boldMatch = text.match(/\*\*(.*?)\*\*/);
    if (boldMatch && boldMatch[1]) {
      const rawTitle = boldMatch[1].trim();
      if (/^analyzing/i.test(rawTitle)) {
        return rawTitle;
      }
      return `Analyzing ${rawTitle}`;
    }
    const firstLine = text.split('\n')[0].replace(/[*#_]/g, '').trim();
    if (firstLine && firstLine.length > 0 && firstLine.length <= 60) {
      if (/^analyzing/i.test(firstLine)) {
        return firstLine;
      }
      return `Analyzing ${firstLine}`;
    }
    return 'Analyzing...';
  };

  const parseFinalText = (text: string) => {
            if (!text) return null;
            try {
                let foundData = null;
                const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
                for (let i = matches.length - 1; i >= 0; i--) {
                    try {
                        const parsed = JSON.parse(matches[i][1]);
                        if (parsed && (parsed.verdict || parsed.findings || parsed.deep_insights)) {
                            foundData = parsed;
                            break;
                        }
                    } catch (e) {}
                }
                
                if (!foundData) {
                    const firstBrace = text.indexOf('{');
                    const lastBrace = text.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace > firstBrace) {
                        try {
                            const possibleJson = text.slice(firstBrace, lastBrace + 1);
                            const parsed = JSON.parse(possibleJson);
                            if (parsed && (parsed.verdict || parsed.findings || parsed.deep_insights)) {
                                foundData = parsed;
                            }
                        } catch (e) {
                            const match = text.match(/\{\s*"verdict"[\s\S]*?\}\s*\}/);
                            if (match) {
                                try {
                                    const parsed = JSON.parse(match[0]);
                                    if (parsed && parsed.verdict) {
                                        foundData = parsed;
                                    }
                                } catch(e2) {}
                            }
                        }
                    }
                }
                return foundData;
            } catch (e) {
                return null;
            }
        };

  const startStream = async (
    model: string,
    setRun: any,
    setErr: any,
    setRep: any,
    setEvts: any,
    pushEvt: any,
    setTok: any,
    setTRuns: any,
    setDur: any,
    setStart: any,
    aRef: any,
    eIdRef: any
  ) => {
    setRun(true);
    setErr(null);
    setRep(null);
    setEvts([]);
    setTok(0);
    setTRuns(0);
    setDur(0);
    setStart(Date.now());
    eIdRef.current = 0;

    const controller = new AbortController();
    aRef.current = controller;
    const startTimestamp = Date.now();
    let currentToolRuns = 0;

    try {
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker.trim(),
          instruction: instruction.trim() || undefined,
          origin: window.location.origin,
          model: model
        }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`Server responded ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';

      while (true) {
        if (controller.signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
              const evt = JSON.parse(dataStr);
              if (evt.type === 'text' && evt.text) {
                  accumulatedText += evt.text;
              } else if (evt.type === 'tool_call') {
                  currentToolRuns += 1;
                  setTRuns(currentToolRuns);
                  let label = "Searching for documents...";
                  if (evt.name === "google_search") {
                    label = `Searching web: ${evt.arguments?.query || ''}`;
                  } else if (evt.name) {
                    label = `Using tool: ${evt.name}`;
                  }
                  pushEvt('tool_call', label, JSON.stringify(evt.arguments, null, 2), evt.name, evt.callId);
              } else if (evt.type === 'tool_result') {
                  pushEvt('tool_result', `Analysis retrieved`, evt.result, undefined, evt.callId);
              } else if (evt.type === 'thinking') {
                  const label = extractThinkingTitle(evt.text);
                  pushEvt('thinking', label, evt.text);
              } else if (evt.type === 'complete') {
                  if (evt.interaction) {
                      const interaction = evt.interaction;
                      const usage = interaction.usage || interaction.usage_metadata || (interaction.metadata && interaction.metadata.usage) || null;
                      if (usage) {
                          const tokens = usage.total_token_count || usage.totalTokenCount || usage.total_tokens || 0;
                          if (tokens > 0) {
                              setTok(tokens);
                          }
                      }
                  }
              } else if (evt.type === 'final_stats') {
                  if (evt.tokens > 0) setTok(evt.tokens);
                  if (evt.duration > 0) setDur(Math.round(evt.duration));
                  if (ENABLE_JSON_DOWNLOAD && evt.jsonlLogUrl) {
                      fetch(evt.jsonlLogUrl)
                        .then(res => res.blob())
                        .then(blob => {
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = evt.jsonlLogUrl.split('/').pop() || 'run_log.jsonl';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            window.URL.revokeObjectURL(url);
                        })
                        .catch(err => console.error('Failed to download log:', err));
                  }
              }
            } catch { /* skip malformed */ }
          }
        }
        
        if (accumulatedText) {
            const foundData = parseFinalText(accumulatedText);
            if (foundData) setRep(foundData);
        }
      }
      
      if (buffer) {
          try {
              const lines = buffer.split('\n\n');
              for (const line of lines) {
                  if (line.startsWith('data: ')) {
                      const dataStr = line.slice(6);
                      if (dataStr === '[DONE]') continue;
                      const evt = JSON.parse(dataStr);
                      if (evt.type === 'text' && evt.text) {
                          accumulatedText += evt.text;
                      }
                  }
              }
          } catch(e) {}
      }
      
      if (accumulatedText) {
          const finalData = parseFinalText(accumulatedText);
          if (finalData) setRep(finalData);
      }
      
      setDur(Math.round((Date.now() - startTimestamp) / 1000));
      setRun(false);
      
    } catch (e: any) {
      if (e.name === 'AbortError') {
         console.log('Aborted');
      } else {
         setErr(e.message || 'Unknown error');
      }
      setDur(Math.round((Date.now() - startTimestamp) / 1000));
      setRun(false);
    }
  };

  const runAnalysis = () => {
    if (!ticker.trim() || running) return;
    setIsReportOpen(false);
    setIsStopped(false);
    
    startStream('gemini-3.6-flash', setRunning, setError, setReportData, setEvents, pushEvent, setTokenCount, setToolRuns, setDurationSecs, setStartTime, abortRef, eventIdRef);
  };

  if (isReportOpen === 'flash' && reportData) {
    return (
      <div className="w-full h-screen print:h-auto print:overflow-visible">
         <ReportTemplate 
           data={reportData} 
           ticker={ticker} 
           onClose={() => setIsReportOpen(false)}
           durationSecs={durationSecs}
           toolRuns={toolRuns}
           tokenCount={tokenCount}
           documentCount={reportData.findings?.length || 0}
         />
      </div>
    );
  }


  return (
    <div className="relative h-screen bg-stone-900 overflow-hidden font-sans text-stone-100 flex flex-col">
      <PulsatingDotsBackground />
      
      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-xl tracking-wider uppercase text-white">Tickr</span>
        </div>
        <div>
          {user ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-stone-400">{user.email}</span>
              <button onClick={logOut} className="px-3 py-1 bg-stone-800 hover:bg-stone-700 rounded text-stone-200 transition-colors">Sign Out</button>
            </div>
          ) : (
            <button onClick={signInWithGoogle} className="px-4 py-2 bg-white text-black hover:bg-stone-200 rounded font-medium text-sm transition-colors">
              Sign In with Google
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col pt-8 min-h-0">
        {!running && !reportData && events.length === 0 ? (
           <LandingView />
        ) : (
           <div className="flex-1 flex flex-row overflow-hidden pb-32 w-full px-6">
             <div className="flex-1 flex flex-col bg-stone-900 rounded-xl border border-stone-800 overflow-hidden min-h-0 max-w-4xl mx-auto w-full">
                <div className="p-3 bg-stone-800 border-b border-stone-700 font-bold text-stone-200 text-sm flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg" alt="Gemini Sparkle" className="w-5 h-5" />
                    <span>Gemini 3.6 Flash</span>
                  </div>
                  {running && <Loader2 className="w-4 h-4 animate-spin text-stone-400" />}
                </div>
                <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                  <AgentTimeline 
                    events={events} 
                    running={running} 
                    hasReport={!!reportData && isReportOpen !== 'flash'}
                    onViewReport={() => setIsReportOpen('flash')}
                    metrics={reportData ? { durationSecs, tokenCount, documentCount: reportData.findings?.length || 0 } : undefined}
                    isStopped={isStopped}
                  />
                </div>
              </div>
           </div>
        )}

        {/* Input area fixed at bottom */}
        <div className="mt-auto px-6 pb-8 pt-4 bg-gradient-to-t from-stone-900 via-stone-900 to-transparent w-full fixed bottom-0 z-20">
          <div className="max-w-4xl mx-auto w-full">
            {error && (
              <div className="mb-4 bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-3 rounded text-sm">
                {error}
              </div>
            )}
            

            <div className="bg-stone-800 border border-stone-700 rounded-xl shadow-2xl p-2 w-full flex items-center gap-2 relative z-30 transition-all focus-within:border-stone-500 focus-within:ring-1 focus-within:ring-stone-500">
              <div className="pl-3 py-2 flex items-center gap-2 text-stone-400 border-r border-stone-700 pr-3">
                 <Search className="w-5 h-5" />
                 <input 
                   type="text" 
                   value={ticker}
                   onChange={(e) => setTicker(e.target.value)}
                   placeholder="TICKER" 
                   disabled={running}
                   className="bg-transparent border-none outline-none w-20 text-white font-mono uppercase placeholder-stone-600"
                   onKeyDown={(e) => e.key === 'Enter' && runAnalysis()}
                 />
              </div>
              <input 
                type="text" 
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                disabled
                className="bg-transparent border-none outline-none flex-1 px-3 py-2 text-stone-200 placeholder-stone-500"
                onKeyDown={(e) => e.key === 'Enter' && runAnalysis()}
              />
              {running ? (
                <button 
                  onClick={() => setShowStopConfirm(true)}
                  className="bg-[#CC3131] text-white hover:bg-[#aa2929] px-6 py-2 rounded-lg font-medium transition-colors ml-2 tracking-wide text-sm"
                >
                  Stop
                </button>
              ) : (
                <button 
                  onClick={runAnalysis}
                  disabled={!ticker.trim()}
                  className="bg-white text-black hover:bg-stone-200 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed px-6 py-2 rounded-lg font-medium transition-colors ml-2 tracking-wide text-sm"
                >
                  Analyze
                </button>
              )}
            </div>
            
            <div className="text-center mt-4">
              <span className="text-xs text-stone-500 font-mono tracking-wider">Gemini can make mistakes, don’t rely on it for financial advice.</span>
            </div>
          </div>
        </div>
      </main>

      {showStopConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-stone-900 border border-stone-800 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-white mb-2">Stop Analysis?</h3>
            <p className="text-stone-400 text-sm mb-6">Are you sure you want to stop the current analysis? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowStopConfirm(false)}
                className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-white rounded-lg font-medium transition-colors text-sm"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  stopAgent();
                  setShowStopConfirm(false);
                }}
                className="px-4 py-2 bg-[#CC3131] hover:bg-[#aa2929] text-white rounded-lg font-medium transition-colors text-sm"
              >
                Stop Analysis
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
