import { LandingView } from './LandingView';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { DottedBackground } from './components/PulsatingDots';
import { History, Search, Loader2 } from 'lucide-react';
import ReportTemplate from "./ReportTemplate";
import SimpleReportView, { normalizeSimpleReport } from './components/SimpleReportView';
import { AgentTimeline, TimelineEvent } from './components/AgentTimeline';
import { AgentSelector } from './components/AgentSelector';
import {
  CognitoUserSession,
  getCurrentCognitoUser,
  getIdToken,
  handleOAuthCallback,
  signInWithHostedUI,
  signOutCognito,
} from './cognito';
import {
  AgentCatalogEntry,
  AgentCatalogResponse,
  OutputRenderer,
  RawSimpleReport,
  isOutputRenderer,
} from './types';
import {
  findAgent,
  readStoredAgentId,
  resolveActiveAgentId,
  storeSelectedAgentId,
} from './agentSelection';
import {
  MAX_INSTRUCTION_LENGTH,
  canRun,
  inputBarConfig,
  inputMaxLength,
} from './agentInput';
import { FALLBACK_OUTPUT_RENDERER, extractReport } from './resultExtraction';
import { describeStopReason, explainMissingReport } from './runDiagnostics';
import { HistoryPanel } from './components/HistoryPanel';
import { CookieConsent } from './components/CookieConsent';
import {
  HistoryEntryDraft,
  InteractionHistoryEntry,
  InteractionMetrics,
  createHistoryEntry,
  deleteEntry,
  insertEntry,
  persistHistory,
  readHistory,
  selectVisibleEntries,
} from './interactionHistory';

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

/**
 * Number of documents cited by the report, counted according to the contract of
 * the renderer that produced it.
 */
export function countReportDocuments(
  data: ReportData | Record<string, unknown> | null | undefined,
  renderer: OutputRenderer,
): number {
  if (!data) return 0;
  if (renderer === 'simple_report') {
    return normalizeSimpleReport(data as Record<string, unknown>).sources.length;
  }
  return (data as ReportData).findings?.length ?? 0;
}

async function describeAnalyzeFailure(resp: Response): Promise<string> {
  if (!resp.body) return `The server did not return an event stream (status ${resp.status}).`;

  let payload: { error?: unknown; retryable?: unknown } | null = null;
  try {
    payload = (await resp.clone().json()) as { error?: unknown; retryable?: unknown };
  } catch {
    payload = null;
  }

  const message =
    typeof payload?.error === 'string' && payload.error.trim().length > 0
      ? payload.error.trim()
      : `The server rejected the run (status ${resp.status}).`;

  return payload?.retryable === true ? `${message} (retryable)` : message;
}

// Toggle this to true if you want the JSON logs to be downloaded automatically after a run.
const ENABLE_JSON_DOWNLOAD = false;

const MODEL_ID = 'deepseek-ai/deepseek-v4-flash-0731';
const MODEL_DISPLAY_NAME = 'DeepSeek V4 Flash';

export type CatalogStatus = 'loading' | 'ready' | 'error';

/**
 * Agent that produced the current on-screen result, along with its renderer.
 * Frozen at the start of a run so a later agent change doesn't affect the
 * presentation of that result.
 */
export interface RunAgent {
  agentId: string;
  agentName: string;
  outputRenderer: OutputRenderer;
}

/**
 * Copy of the report snapshot that feeds the restored report view. It is a copy
 * (not a reference to the History Entry) so that deleting that entry or clearing
 * the history leaves the report on screen untouched.
 */
export interface RestoredReport {
  entryId: string;
  report: Record<string, unknown>;
  outputRenderer: OutputRenderer;
  agentName: string;
  query: string;
  metrics: InteractionMetrics;
}

export default function App() {
  const [inputValue, setInputValue] = useState('');
  const [instruction, setInstruction] = useState('');

  // Agent catalog and active agent.
  const [agents, setAgents] = useState<AgentCatalogEntry[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>('loading');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(() => readStoredAgentId());
  const [runAgent, setRunAgent] = useState<RunAgent | null>(null);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  // Reason a finished run put no report on screen, or `null` while there is
  // nothing to explain. Holds the message so the banner never has to guess it.
  const [unstructuredReport, setUnstructuredReport] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const eventIdRef = useRef(0);
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [toolRuns, setToolRuns] = useState<number>(0);
  const [durationSecs, setDurationSecs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  const [isReportOpen, setIsReportOpen] = useState<'flash'|false>(false);
  const [user, setUser] = useState<CognitoUserSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [isStopped, setIsStopped] = useState(false);

  /* ── Interaction history ─────────────────────────────────────── */

  const [historyEntries, setHistoryEntries] = useState<InteractionHistoryEntry[]>([]);
  /**
   * Mirror of `historyEntries` readable outside the render cycle. The recording
   * and deletion paths run inside asynchronous callbacks, where the state
   * captured by a closure can already be stale.
   */
  const historyRef = useRef<InteractionHistoryEntry[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Report restored from the history. It lives beside the live run state
   * and never writes into it, so closing it gives back exactly the previous view.
   */
  const [restoredReport, setRestoredReport] = useState<RestoredReport | null>(null);

  useEffect(() => {
    const stored = readHistory(user?.userId);
    historyRef.current = stored;
    setHistoryEntries(stored);
  }, [user?.userId]);

  /**
   * Single write gate: persists the list and publishes the effective one, which
   * is the trimmed list when the quota forced a trim. Every history mutation
   * goes through here.
   */
  const applyHistory = useCallback((next: InteractionHistoryEntry[]) => {
    const { entries } = persistHistory(next, user?.userId);
    historyRef.current = entries;
    setHistoryEntries(entries);
  }, [user?.userId]);

  const deleteHistoryEntry = useCallback(
    (id: string) => {
      applyHistory(deleteEntry(historyRef.current, id));
    },
    [applyHistory],
  );

  const clearHistory = useCallback(() => {
    applyHistory([]);
  }, [applyHistory]);

  /**
   * Activating a visible entry paints its stored report snapshot and closes the
   * panel. While a run is in progress nothing is restored.
   */
  const restoreEntry = useCallback(
    (entry: InteractionHistoryEntry) => {
      if (running) return;
      setRestoredReport({
        entryId: entry.id,
        report: entry.report,
        outputRenderer: entry.outputRenderer,
        agentName: entry.agentName,
        query: entry.query,
        metrics: entry.metrics,
      });
      setIsHistoryOpen(false);
    },
    [running],
  );

  // Return focus to the history trigger when the panel closes.
  const wasHistoryOpen = useRef(false);
  useEffect(() => {
    if (wasHistoryOpen.current && !isHistoryOpen) {
      historyTriggerRef.current?.focus();
    }
    wasHistoryOpen.current = isHistoryOpen;
  }, [isHistoryOpen]);

  useEffect(() => {
    handleOAuthCallback()
      .then((oauthUser) => {
        if (oauthUser) {
          setUser(oauthUser);
          return;
        }
        return getCurrentCognitoUser().then(setUser);
      })
      .catch((err) => {
        console.error('❌ Error in auth flow:', err);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const handleSignOut = async () => {
    await signOutCognito();
    setUser(null);
    setHistoryEntries([]);
    setReportData(null);
    setEvents([]);
    setError(null);
  };

  const visibleEntries = useMemo(
    () => selectVisibleEntries(historyEntries, activeAgentId),
    [historyEntries, activeAgentId],
  );

  const activeAgent = findAgent(agents, activeAgentId);
  const isCatalogEmpty = catalogStatus === 'ready' && agents.length === 0;
  const executionPanelAgentName = activeAgent?.name ?? runAgent?.agentName ?? 'Agent';

  const { inputMode, inputPlaceholder, actionLabel, supportsInstruction } =
    inputBarConfig(activeAgent);
  const canRunAnalysis = canRun({
    value: inputValue,
    instruction,
    config: { inputMode, inputPlaceholder, actionLabel, supportsInstruction },
    isCatalogEmpty,
  });

  /**
   * Fetches the catalog and sets the active agent: the stored agentId when it
   * exists in the catalog, otherwise the defaultAgentId overwrites storage.
   */
  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    setCatalogStatus('loading');
    setCatalogError(null);
    try {
      const resp = await fetch('/api/agents', { signal });
      if (!resp.ok) {
        throw new Error(`Server responded ${resp.status}`);
      }
      const catalog = (await resp.json()) as AgentCatalogResponse;
      if (signal?.aborted) return;

      const entries = Array.isArray(catalog?.agents) ? catalog.agents : [];
      const resolvedDefaultAgentId =
        typeof catalog?.defaultAgentId === 'string' ? catalog.defaultAgentId : null;

      setAgents(entries);
      setDefaultAgentId(resolvedDefaultAgentId);

      const resolution = resolveActiveAgentId(
        { agents: entries, defaultAgentId: resolvedDefaultAgentId },
        readStoredAgentId(),
      );
      setActiveAgentId(resolution.agentId);
      if (resolution.shouldPersist && resolution.agentId !== null) {
        storeSelectedAgentId(resolution.agentId);
      }
      setCatalogStatus('ready');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      console.error('❌ Failed to load the agent catalog:', e);
      setCatalogError(e?.message || 'Failed to load the agent catalog');
      setCatalogStatus('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal);
    return () => controller.abort();
  }, [loadCatalog]);

  /** Clears report, timeline, metrics, and previous error. */
  const resetRunResults = () => {
    setReportData(null);
    setUnstructuredReport(null);
    setEvents([]);
    setError(null);
    setTokenCount(0);
    setToolRuns(0);
    setDurationSecs(0);
    setStartTime(null);
    setRunAgent(null);
    setIsReportOpen(false);
    setIsStopped(false);
    eventIdRef.current = 0;
  };

  /**
   * User agent selection: persists the agentId and clears the previous result
   * when the active agent changes. During a run the selection is locked.
   */
  const selectAgent = (agentId: string) => {
    if (running) return;
    storeSelectedAgentId(agentId);
    if (agentId === activeAgentId) return;
    setActiveAgentId(agentId);
    // Clear the input bar on agent change: each agent declares its own inputMode,
    // so the previous input may not be valid for the new one.
    setInputValue('');
    setInstruction('');
    resetRunResults();
  };

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

  const parseFinalText = (text: string, renderer: OutputRenderer) =>
    extractReport(text, renderer);

  const startStream = async (
    model: string,
    requestedAgentId: string | null,
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
    setUnstructuredReport(null);
    setEvts([]);
    setTok(0);
    setTRuns(0);
    setDur(0);
    setStart(Date.now());
    eIdRef.current = 0;

    // The run starts tagged with the active agent and its renderer; the
    // `agent_info` event confirms or corrects those values.
    const requestedAgent = findAgent(agents, requestedAgentId);
    setRunAgent(
      requestedAgent
        ? {
            agentId: requestedAgent.id,
            agentName: requestedAgent.name,
            outputRenderer: requestedAgent.outputRenderer,
          }
        : null,
    );

    const controller = new AbortController();
    aRef.current = controller;
    const startTimestamp = Date.now();
    let currentToolRuns = 0;
    // Run-local accumulators for the report snapshot. Every `set*` call schedules
    // an asynchronous state update, so reading React state when the run finishes
    // would snapshot stale values; these mirrors always carry the numbers this
    // run produced.
    let promotedReport: Record<string, unknown> | null = null;
    let currentTokenCount = 0;
    let currentDuration = 0;
    // Identity of the agent that produced the report. Frozen here and only
    // `agent_info` refreshes it.
    let runIdentity: RunAgent | null = requestedAgent
      ? {
          agentId: requestedAgent.id,
          agentName: requestedAgent.name,
          outputRenderer: requestedAgent.outputRenderer,
        }
      : null;
    // Renderer used to interpret the final text of this run. Starts with the
    // requested agent's renderer and is confirmed or corrected by `agent_info`.
    let runRenderer: OutputRenderer = requestedAgent?.outputRenderer ?? FALLBACK_OUTPUT_RENDERER;
    let reportPromoted = false;
    // Error message from the stream's `error` event, when the remote agent failed.
    let streamErrorMessage: string | null = null;
    // `stopReason` reported by the run's `complete` event. It is the only signal
    // that tells a truncated report apart from a model that never answered, so a
    // run that promotes nothing has to be able to name it.
    let runStopReason: unknown = null;
    // Event counter to guarantee there is always a trace in the timeline.
    let eventsPushed = 0;
    const emit = (...args: Parameters<ReturnType<typeof createPushEvent>>) => {
      eventsPushed += 1;
      pushEvt(...args);
    };

    try {
      const idToken = await getIdToken();
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          agentId: requestedAgentId ?? undefined,
          input: inputValue.trim(),
          ticker: inputValue.trim(),
          instruction: supportsInstruction ? instruction.trim() || undefined : undefined,
          origin: window.location.origin,
          model: model
        }),
        signal: controller.signal,
      });

      if (resp.status === 401) {
        const body = await resp.json().catch(() => ({}));
        const msg = body.code === 'token_expired'
          ? 'Session expired. Please sign in again.'
          : 'Authentication required. Please sign in.';
        throw new Error(msg);
      }

      if (!resp.ok || !resp.body) {
        throw new Error(await describeAnalyzeFailure(resp));
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
              if (evt.type === 'agent_info') {
                  const informedAgentId = typeof evt.agentId === 'string' ? evt.agentId : null;
                  if (informedAgentId) {
                    runRenderer = isOutputRenderer(evt.outputRenderer)
                      ? evt.outputRenderer
                      : FALLBACK_OUTPUT_RENDERER;
                    runIdentity = {
                      agentId: informedAgentId,
                      agentName: typeof evt.agentName === 'string' ? evt.agentName : informedAgentId,
                      outputRenderer: runRenderer,
                    };
                    setRunAgent(runIdentity);
                    if (informedAgentId !== requestedAgentId) {
                      setActiveAgentId(informedAgentId);
                      storeSelectedAgentId(informedAgentId);
                    }
                  }
              } else if (evt.type === 'text' && evt.text) {
                  accumulatedText += evt.text;
              } else if (evt.type === 'tool_call') {
                  currentToolRuns += 1;
                  setTRuns(currentToolRuns);
                  const label = evt.name ? `Using tool: ${evt.name}` : 'Tool call';
                  emit('tool_call', label, JSON.stringify(evt.arguments, null, 2), evt.name, evt.callId);
              } else if (evt.type === 'tool_result') {
                  emit('tool_result', `Analysis retrieved`, evt.result, undefined, evt.callId);
              } else if (evt.type === 'thinking') {
                  const label = extractThinkingTitle(evt.text);
                  emit('thinking', label, evt.text);
              } else if (evt.type === 'error') {
                  // The server closes the stream with `error` + `done` when the
                  // remote agent fails. Without this the failure was discarded silently.
                  streamErrorMessage =
                    typeof evt.message === 'string' && evt.message.trim()
                      ? evt.message
                      : 'The agent reported an error with no detail.';
                  console.error('[stream] Agent error event:', streamErrorMessage);
                  emit('error', 'Run failed', streamErrorMessage ?? undefined);
                  setErr(streamErrorMessage);
              } else if (evt.type === 'complete') {
                  if (evt.interaction) {
                      const interaction = evt.interaction;
                      if (interaction.stopReason !== undefined && interaction.stopReason !== null) {
                          runStopReason = interaction.stopReason;
                      }
                      // The server ran its salvage pass: the report exists, but it
                      // was written after the research budget ran out, so it rests
                      // on less than the agent set out to gather.
                      if (interaction.turnLimitReached === true) {
                          emit(
                            'info',
                            'Research cut short',
                            'The agent spent its whole turn budget before writing the report. ' +
                              'It was asked to conclude with what it had already gathered, so this ' +
                              'report may cover fewer documents than usual.',
                          );
                      }
                      const usage = interaction.usage || interaction.usage_metadata || (interaction.metadata && interaction.metadata.usage) || null;
                      if (usage) {
                          const tokens = usage.total_token_count || usage.totalTokenCount || usage.total_tokens || 0;
                          if (tokens > 0) {
                              currentTokenCount = tokens;
                              setTok(tokens);
                          }
                      }
                  }
              } else if (evt.type === 'final_stats') {
                  if (evt.tokens > 0) {
                      currentTokenCount = evt.tokens;
                      setTok(evt.tokens);
                  }
                  if (evt.duration > 0) {
                      currentDuration = Math.round(evt.duration);
                      setDur(currentDuration);
                  }
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
            } catch (parseError) {
              console.warn('[stream] Unreadable SSE event discarded:', dataStr, parseError);
            }
          }
        }

        /*
          No extraction attempt here. The text of a chunk is a prefix of the
          answer, not the answer: running the extractor on it wasted work on
          every chunk and, worse, a prefix that happened to close its braces
          could promote a report missing everything the model had yet to write,
          with no way to take it back. The run's text is only complete once the
          reader is done and the tail of the buffer has been drained.
        */
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
          } catch (tailError) {
              console.warn('[stream] Buffer tail discarded as unreadable:', buffer, tailError);
          }
      }

      // The stream is closed and the buffer drained: this is the run's complete
      // text, and the only text the extractor is asked about.
      if (accumulatedText) {
          const finalData = parseFinalText(accumulatedText, runRenderer);
          if (finalData) {
              promotedReport = finalData;
              setRep(finalData);
              reportPromoted = true;
          }
      }

      /*
        A run that promoted no report always says why. The previous version only
        explained itself when the run produced text, or when it pushed no event
        at all; a run that called tools and then stopped before writing its
        answer — the shape of a turn or token budget running out — finished in
        total silence, with no report, no warning and no error on screen.
      */
      if (!reportPromoted) {
          const stopReasonDetail = describeStopReason(runStopReason);

          if (accumulatedText.trim()) {
              // The raw answer is worth reading, so it stays in the timeline and
              // the banner explains which contract it failed.
              emit('text', 'Unstructured response', accumulatedText);
              setUnstructuredReport(
                explainMissingReport({
                  text: accumulatedText,
                  stopReason: runStopReason,
                  renderer: runRenderer,
                }),
              );
          } else if (streamErrorMessage !== null) {
              // The failure is already in the timeline and in the error banner.
              // Only the stop reason would be lost, so that is all this adds.
              if (stopReasonDetail) {
                  emit('info', 'Stop reason', `The model stopped because ${stopReasonDetail}.`);
              }
          } else {
              const message = explainMissingReport({
                text: accumulatedText,
                stopReason: runStopReason,
                renderer: runRenderer,
              });
              console.error('[stream] Run finished with no report:', message);
              emit('error', 'No report', message);
              setErr(message);
          }
      }

      currentDuration = Math.round((Date.now() - startTimestamp) / 1000);
      setDur(currentDuration);
      setRun(false);

      // Exactly one history entry per run that promoted a report, tagged with
      // the identity frozen for this run.
      if (reportPromoted && promotedReport && runIdentity) {
        const draft: HistoryEntryDraft = {
          agentId: runIdentity.agentId,
          agentName: runIdentity.agentName,
          outputRenderer: runIdentity.outputRenderer,
          query: inputValue,
          instruction: supportsInstruction ? instruction : null,
          createdAt: Date.now(),
          report: promotedReport,
          metrics: {
            durationSecs: currentDuration,
            tokenCount: currentTokenCount,
            toolRuns: currentToolRuns,
          },
        };
        const entries = historyRef.current;
        applyHistory(insertEntry(entries, createHistoryEntry(draft, entries)));
      }

    } catch (e: any) {
      if (e.name === 'AbortError') {
         console.log('Aborted');
         if (eventsPushed === 0) {
            emit('info', 'Run stopped', 'The run was stopped before producing results.');
         }
      } else {
         console.error('[stream] Run interrupted:', e);
         setErr(e.message || 'Unknown error');
         if (eventsPushed === 0) {
            emit('error', 'Run failed', e.message || 'Unknown error');
         }
      }
      setDur(Math.round((Date.now() - startTimestamp) / 1000));
      setRun(false);
    }
  };

  const runAnalysis = () => {
    if (running) return;
    if (!canRunAnalysis) return;
    setIsReportOpen(false);
    setIsStopped(false);

    startStream(MODEL_ID, activeAgentId, setRunning, setError, setReportData, setEvents, pushEvent, setTokenCount, setToolRuns, setDurationSecs, setStartTime, abortRef, eventIdRef);
  };

  // The restored report takes over the view. Closing it only clears
  // `restoredReport`; the live state was never touched.
  if (restoredReport) {
    const restoredRenderer = restoredReport.outputRenderer;
    const { durationSecs: restoredDuration, tokenCount: restoredTokens, toolRuns: restoredToolRuns } =
      restoredReport.metrics;

    return (
      <div className="w-full h-screen print:h-auto print:overflow-visible">
        {restoredRenderer === 'simple_report' ? (
          <SimpleReportView
            data={restoredReport.report as unknown as RawSimpleReport}
            title={restoredReport.agentName}
            subtitle={restoredReport.query}
            onClose={() => setRestoredReport(null)}
            durationSecs={restoredDuration}
            toolRuns={restoredToolRuns}
            tokenCount={restoredTokens}
          />
        ) : (
          <ReportTemplate
            data={restoredReport.report as unknown as ReportData}
            ticker={restoredReport.query}
            onClose={() => setRestoredReport(null)}
            durationSecs={restoredDuration}
            toolRuns={restoredToolRuns}
            tokenCount={restoredTokens}
            documentCount={countReportDocuments(restoredReport.report, restoredRenderer)}
          />
        )}
      </div>
    );
  }

  if (isReportOpen === 'flash' && reportData) {
    const reportRenderer = runAgent?.outputRenderer ?? FALLBACK_OUTPUT_RENDERER;

    return (
      <div className="w-full h-screen print:h-auto print:overflow-visible">
         {reportRenderer === 'simple_report' ? (
           <SimpleReportView
             data={reportData as unknown as RawSimpleReport}
             title={runAgent?.agentName ?? 'Report'}
             subtitle={inputValue}
             onClose={() => setIsReportOpen(false)}
             durationSecs={durationSecs}
             toolRuns={toolRuns}
             tokenCount={tokenCount}
           />
         ) : (
           <ReportTemplate
             data={reportData}
             ticker={inputValue}
             onClose={() => setIsReportOpen(false)}
             durationSecs={durationSecs}
             toolRuns={toolRuns}
             tokenCount={tokenCount}
             documentCount={countReportDocuments(reportData, reportRenderer)}
           />
         )}
      </div>
    );
  }

  if (!authChecked) {
    return (
      <div className="h-dvh bg-stone-900 flex items-center justify-center">
        <span className="font-display font-bold text-2xl tracking-wider uppercase text-white animate-pulse">Tickr</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative h-dvh bg-stone-900 overflow-hidden font-sans text-stone-100 flex flex-col items-center justify-center">
        <DottedBackground />
        <div className="relative z-10 flex flex-col items-center gap-6 p-8">
          <span className="font-display font-bold text-4xl tracking-wider uppercase text-white">Tickr</span>
          <p className="text-stone-400 text-center max-w-md">
            Sign in to access AI agents and run analyses.
          </p>
          <button
            onClick={signInWithHostedUI}
            className="px-6 py-3 bg-white text-black hover:bg-stone-200 rounded-lg font-semibold text-base transition-colors"
          >
            Sign In
          </button>
        </div>
        <CookieConsent />
      </div>
    );
  }

  return (
    <div className="relative h-dvh bg-stone-900 overflow-hidden font-sans text-stone-100 flex flex-col">
      <DottedBackground />

      {/* Header */}
      <header className="relative z-20 flex shrink-0 items-center justify-between gap-3 px-6 py-4 border-b border-white/10 bg-black/20 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <span className="font-display font-bold text-xl tracking-wider uppercase text-white">Tickr</span>
          <AgentSelector
            agents={agents}
            activeAgentId={activeAgentId}
            defaultAgentId={defaultAgentId}
            status={catalogStatus}
            errorMessage={catalogError}
            running={running}
            onSelect={selectAgent}
            onRetry={() => loadCatalog()}
          />
          <button
            ref={historyTriggerRef}
            type="button"
            aria-label="History"
            aria-expanded={isHistoryOpen}
            onClick={() => setIsHistoryOpen((open) => !open)}
            className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-1.5 font-sans text-sm text-stone-300 transition-colors hover:bg-white/10 hover:text-stone-100"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">History</span>
            {visibleEntries.length > 0 && (
              <span className="rounded-full bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] text-stone-200">
                {visibleEntries.length}
              </span>
            )}
          </button>
        </div>
        <div>
          {user ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-stone-400">{user.email || user.username}</span>
              <button onClick={handleSignOut} className="px-3 py-1 bg-stone-800 hover:bg-stone-700 rounded text-stone-200 transition-colors">Sign Out</button>
            </div>
          ) : (
            <button onClick={signInWithHostedUI} className="px-4 py-2 bg-white text-black hover:bg-stone-200 rounded font-medium text-sm transition-colors">
              Sign In
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col pt-4 sm:pt-8 min-h-0">
        {!running && !reportData && events.length === 0 ? (
           <LandingView agent={activeAgent} />
        ) : (
           <div className="flex-1 flex flex-row overflow-hidden min-h-0 w-full px-6">
             <div className="flex-1 flex flex-col bg-stone-900 rounded-xl border border-stone-800 overflow-hidden min-h-0 max-w-4xl mx-auto w-full">
                <div className="p-3 bg-stone-800 border-b border-stone-700 font-bold text-stone-200 text-sm flex justify-between items-center">
                  <div className="flex items-center gap-2 min-w-0">
                    <img src="/deepseek-logo.svg" alt="DeepSeek" className="w-5 h-5 shrink-0" />
                    <span className="truncate">{executionPanelAgentName}</span>
                    <span className="text-xs font-normal text-stone-400 shrink-0">{MODEL_DISPLAY_NAME}</span>
                  </div>
                  {running && <Loader2 className="w-4 h-4 animate-spin text-stone-400" />}
                </div>
                <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                  <AgentTimeline
                    events={events}
                    running={running}
                    hasReport={!!reportData && isReportOpen !== 'flash'}
                    onViewReport={() => setIsReportOpen('flash')}
                    metrics={
                      reportData
                        ? {
                            durationSecs,
                            tokenCount,
                            documentCount: countReportDocuments(
                              reportData,
                              runAgent?.outputRenderer ?? FALLBACK_OUTPUT_RENDERER,
                            ),
                          }
                        : undefined
                    }
                    isStopped={isStopped}
                  />
                </div>
              </div>
           </div>
        )}

        {/* Input bar always visible at the bottom. */}
        <div className="relative z-20 mt-auto w-full shrink-0 bg-gradient-to-t from-stone-900 via-stone-900 to-transparent px-6 pb-4 pt-4 sm:pb-8">
          <div className="max-w-4xl mx-auto w-full">
            {error && (
              <div className="mb-4 bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-3 rounded text-sm">
                {error}
              </div>
            )}

            {unstructuredReport && (
              <div
                role="status"
                className="mb-4 bg-amber-500/10 border border-amber-500/50 text-amber-100 px-4 py-3 rounded text-sm"
              >
                {unstructuredReport}
              </div>
            )}


            <div className="bg-stone-800 border border-stone-700 rounded-xl shadow-2xl p-2 w-full flex items-center gap-2 relative z-30 transition-all focus-within:border-stone-500 focus-within:ring-1 focus-within:ring-stone-500">
              {inputMode === 'ticker' ? (
                <div
                  className={`pl-3 py-2 flex items-center gap-2 transition-colors ${
                    running ? 'text-stone-600' : 'text-stone-400'
                  } ${supportsInstruction ? 'border-r border-stone-700 pr-3' : 'flex-1 pr-3'}`}
                >
                  <Search className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <input
                    type="text"
                    aria-label="Agent input"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                    placeholder={inputPlaceholder}
                    maxLength={inputMaxLength('ticker')}
                    disabled={running}
                    className={`bg-transparent border-none outline-none text-white font-mono uppercase placeholder-stone-600 transition-colors disabled:text-stone-500 disabled:placeholder-stone-700 ${
                      supportsInstruction ? 'w-28' : 'flex-1'
                    }`}
                    onKeyDown={(e) => e.key === 'Enter' && runAnalysis()}
                  />
                </div>
              ) : (
                <input
                  type="text"
                  aria-label="Agent input"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={inputPlaceholder}
                  maxLength={inputMaxLength('text')}
                  disabled={running}
                  className="bg-transparent border-none outline-none flex-1 px-3 py-2 text-stone-100 placeholder-stone-500 transition-colors disabled:text-stone-500 disabled:placeholder-stone-700"
                  onKeyDown={(e) => e.key === 'Enter' && runAnalysis()}
                />
              )}
              {supportsInstruction && (
                <input
                  type="text"
                  aria-label="Additional instruction"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Optional instruction for the agent"
                  maxLength={MAX_INSTRUCTION_LENGTH}
                  disabled={running}
                  className="bg-transparent border-none outline-none flex-1 px-3 py-2 text-stone-200 placeholder-stone-500 transition-colors disabled:text-stone-500 disabled:placeholder-stone-700"
                  onKeyDown={(e) => e.key === 'Enter' && runAnalysis()}
                />
              )}
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
                  disabled={!canRunAnalysis}
                  className="bg-white text-black hover:bg-stone-200 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed px-6 py-2 rounded-lg font-medium transition-colors ml-2 tracking-wide text-sm whitespace-nowrap"
                >
                  {actionLabel}
                </button>
              )}
            </div>

            <div className="text-center mt-4">
              <span className="text-xs text-stone-500 font-mono tracking-wider">This AI can make mistakes, please verify important information.</span>
            </div>
          </div>
        </div>
      </main>

      <HistoryPanel
        open={isHistoryOpen}
        entries={visibleEntries}
        running={running}
        onClose={() => setIsHistoryOpen(false)}
        onRestore={restoreEntry}
        onDelete={deleteHistoryEntry}
        onClearAll={clearHistory}
      />

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
