import { LandingView } from './LandingView';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { DottedBackground } from './components/PulsatingDots';
import { Search, Loader2 } from 'lucide-react';
import ReportTemplate from "./ReportTemplate";
import SimpleReportView from './components/SimpleReportView';
import { AgentTimeline, TimelineEvent } from './components/AgentTimeline';
import { AgentSelector } from './components/AgentSelector';
// DEBUG (provisional): borrar este import junto con el bloque <DebugPanel /> del final.
import { DebugPanel } from './components/DebugPanel';
import {
  CognitoUserSession,
  getCurrentCognitoUser,
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

/** Modelo con el que se ejecutan los agentes desde esta vista. */
const MODEL_ID = 'gemini-3.6-flash';
/** Requirement 12.7: nombre del modelo como texto secundario de la cabecera. */
const MODEL_DISPLAY_NAME = 'Gemini 3.6 Flash';

/** Estado de la petición del catálogo de agentes (Requirements 11.7, 11.8, 11.9). */
export type CatalogStatus = 'loading' | 'ready' | 'error';

/**
 * Agente que produjo el resultado en pantalla, junto con su renderizador. Se
 * congela al iniciar la ejecución para que un cambio de agente posterior no
 * altere la presentación de ese resultado (Requirement 14.1).
 */
export interface RunAgent {
  agentId: string;
  agentName: string;
  outputRenderer: OutputRenderer;
}

export default function App() {
  /** Valor de entrada; su significado depende del `inputMode` del agente activo. */
  const [inputValue, setInputValue] = useState('');
  const [instruction, setInstruction] = useState('');

  // Catálogo de agentes y agente activo.
  const [agents, setAgents] = useState<AgentCatalogEntry[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>('loading');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // Requirement 11.8: el último agente conocido (el almacenado) sigue activo
  // aunque la petición del catálogo falle.
  const [activeAgentId, setActiveAgentId] = useState<string | null>(() => readStoredAgentId());
  // Requirement 14.1: agente y renderizador de la ejecución en curso.
  const [runAgent, setRunAgent] = useState<RunAgent | null>(null);
  
  // Gemini 3.6 Flash state
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  /**
   * Requirement 14.6: el texto final de la ejecución no contenía ningún objeto
   * válido para su renderizador, así que no se promovió informe alguno.
   */
  const [unstructuredReport, setUnstructuredReport] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const eventIdRef = useRef(0);
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [toolRuns, setToolRuns] = useState<number>(0);
  const [durationSecs, setDurationSecs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  const [isReportOpen, setIsReportOpen] = useState<'flash'|false>(false);
  const [user, setUser] = useState<CognitoUserSession | null>(null);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [isStopped, setIsStopped] = useState(false);

  useEffect(() => {
    // Resolve the OAuth callback first, then fall back to an existing session.
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
      });
  }, []);

  const handleSignOut = async () => {
    await signOutCognito();
    setUser(null);
  };

  /** Entrada de catálogo del agente activo; nula mientras no hay catálogo. */
  const activeAgent = findAgent(agents, activeAgentId);
  /** Requirement 11.9: sin agentes válidos no hay nada que ejecutar. */
  const isCatalogEmpty = catalogStatus === 'ready' && agents.length === 0;
  /**
   * Requirement 12.7: nombre que encabeza el panel de ejecución. Es el `name`
   * del agente activo; si el catálogo aún no está disponible se recurre al
   * nombre informado por la ejecución en curso.
   */
  const executionPanelAgentName = activeAgent?.name ?? runAgent?.agentName ?? 'Agente';

  /**
   * Presentación de la barra de entrada declarada por el agente activo:
   * `inputMode`, `inputPlaceholder`, `actionLabel` y `supportsInstruction`
   * (Requirements 13.3, 13.4, 13.5, 13.6, 13.7).
   */
  const { inputMode, inputPlaceholder, actionLabel, supportsInstruction } =
    inputBarConfig(activeAgent);
  /**
   * Requirements 8.7, 8.8: el botón solo se habilita cuando la entrada cumple
   * las reglas de longitud y conjunto de caracteres del `inputMode` activo.
   */
  const canRunAnalysis = canRun({
    value: inputValue,
    instruction,
    config: { inputMode, inputPlaceholder, actionLabel, supportsInstruction },
    isCatalogEmpty,
  });

  /**
   * Pide el catálogo y fija el agente activo: el agentId almacenado cuando está
   * en el catálogo (Requirement 12.1), y el `defaultAgentId` sobrescribiendo el
   * valor almacenado en cualquier otro caso (Requirement 12.2).
   *
   * Si la petición falla, el estado pasa a error y el último agente conocido
   * sigue activo (Requirement 11.8); el selector reintenta con esta función.
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

  /** Vacía informe, línea de tiempo, métricas y error previos. */
  const resetRunResults = () => {
    setReportData(null);
    setUnstructuredReport(false);
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
   * Selección de agente del usuario: persiste el agentId (Requirement 12.3) y
   * vacía el resultado previo cuando el agente activo cambia
   * (Requirement 12.4). Durante una ejecución la selección no se mueve
   * (Requirement 11.4).
   */
  const selectAgent = (agentId: string) => {
    if (running) return;
    storeSelectedAgentId(agentId);
    if (agentId === activeAgentId) return;
    setActiveAgentId(agentId);
    /*
      La barra se vacía al cambiar de agente: cada agente declara su propio
      `inputMode`, así que la entrada anterior puede no ser válida para el nuevo
      (un ticker en un campo de texto libre, por ejemplo). Reseleccionar el
      agente activo no llega aquí y conserva lo escrito.
    */
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

  /**
   * Extractor del texto final parametrizado por el renderizador de la
   * ejecución: las claves raíz aceptadas son las de ese renderizador
   * (Requirements 14.4, 14.5).
   */
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
    setUnstructuredReport(false);
    setEvts([]);
    setTok(0);
    setTRuns(0);
    setDur(0);
    setStart(Date.now());
    eIdRef.current = 0;

    // Requirement 14.1: la ejecución arranca etiquetada con el agente activo y
    // su renderizador; el evento `agent_info` confirma o corrige esos valores.
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
    /**
     * Renderizador con el que se interpreta el texto final de esta ejecución.
     * Arranca con el del agente enviado y lo confirma o corrige `agent_info`
     * (Requirements 14.1, 14.5).
     */
    let runRenderer: OutputRenderer = requestedAgent?.outputRenderer ?? FALLBACK_OUTPUT_RENDERER;
    /** Requirement 14.6: solo se avisa cuando no se promovió ningún informe. */
    let reportPromoted = false;
    /**
     * Mensaje del evento `error` del flujo, cuando el servidor informó un fallo
     * del agente remoto. Sin esto la ejecución terminaba en silencio.
     */
    let streamErrorMessage: string | null = null;
    /**
     * Eventos que esta ejecución dejó en la línea de tiempo. La vista principal
     * deriva la pantalla de `running`, `reportData` y `events.length`, así que
     * terminar con los tres vacíos devuelve al usuario a la vista de aterrizaje
     * sin explicación. Este contador permite garantizar siempre una traza.
     */
    let eventsPushed = 0;
    const emit = (...args: Parameters<ReturnType<typeof createPushEvent>>) => {
      eventsPushed += 1;
      pushEvt(...args);
    };

    try {
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Requirement 12.6: el agentId del agente activo viaja en el cuerpo.
          agentId: requestedAgentId ?? undefined,
          // `input` es el campo principal; `ticker` se mantiene como alias
          // heredado para no romper el contrato anterior (Requirement 9.2).
          input: inputValue.trim(),
          ticker: inputValue.trim(),
          // Requirement 13.6: solo los agentes que declaran `supportsInstruction`
          // muestran el campo, y solo entonces se envía su valor.
          instruction: supportsInstruction ? instruction.trim() || undefined : undefined,
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
              if (evt.type === 'agent_info') {
                  // Requirement 14.1: el renderizador de esta ejecución queda
                  // fijado por el agente que la sirvió.
                  const informedAgentId = typeof evt.agentId === 'string' ? evt.agentId : null;
                  if (informedAgentId) {
                    runRenderer = isOutputRenderer(evt.outputRenderer)
                      ? evt.outputRenderer
                      : FALLBACK_OUTPUT_RENDERER;
                    setRunAgent({
                      agentId: informedAgentId,
                      agentName: typeof evt.agentName === 'string' ? evt.agentName : informedAgentId,
                      outputRenderer: runRenderer,
                    });
                    // Requirements 12.5, 12.6: si el agente ejecutado no es el
                    // enviado, el informado pasa a ser el activo y se almacena.
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
                  let label = "Searching for documents...";
                  if (evt.name === "google_search") {
                    label = `Searching web: ${evt.arguments?.query || ''}`;
                  } else if (evt.name) {
                    label = `Using tool: ${evt.name}`;
                  }
                  emit('tool_call', label, JSON.stringify(evt.arguments, null, 2), evt.name, evt.callId);
              } else if (evt.type === 'tool_result') {
                  emit('tool_result', `Analysis retrieved`, evt.result, undefined, evt.callId);
              } else if (evt.type === 'thinking') {
                  const label = extractThinkingTitle(evt.text);
                  emit('thinking', label, evt.text);
              } else if (evt.type === 'error') {
                  /*
                    El servidor cierra el flujo con `error` + `done` cuando el
                    agente remoto falla. Sin esta rama el fallo se descartaba:
                    ni error visible ni evento en la línea de tiempo, así que la
                    vista volvía a la pantalla inicial sin rastro alguno.
                  */
                  streamErrorMessage =
                    typeof evt.message === 'string' && evt.message.trim()
                      ? evt.message
                      : 'El agente informó un error sin detalle.';
                  console.error('[stream] Evento de error del agente:', streamErrorMessage);
                  emit('error', 'La ejecución falló', streamErrorMessage);
                  setErr(streamErrorMessage);
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
            } catch (parseError) {
              // Un evento ilegible ya no desaparece sin dejar rastro: queda en
              // consola con su carga para poder diagnosticarlo.
              console.warn('[stream] Evento SSE descartado por ilegible:', dataStr, parseError);
            }
          }
        }
        
        if (accumulatedText) {
            const foundData = parseFinalText(accumulatedText, runRenderer);
            if (foundData) {
                setRep(foundData);
                reportPromoted = true;
            }
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
          } catch (tailError) {
              console.warn('[stream] Cola del buffer descartada por ilegible:', buffer, tailError);
          }
      }
      
      if (accumulatedText) {
          const finalData = parseFinalText(accumulatedText, runRenderer);
          if (finalData) {
              setRep(finalData);
              reportPromoted = true;
          }
      }

      /*
        Requirement 14.6: sin objeto válido para el renderizador de la ejecución
        no se promueve informe; el texto crudo queda en la línea de tiempo y el
        aviso explica que no pudo estructurarse.
      */
      if (!reportPromoted && accumulatedText.trim()) {
          emit('text', 'Respuesta sin estructurar', accumulatedText);
          setUnstructuredReport(true);
      }

      /*
        Una ejecución que acaba sin informe, sin texto y sin ningún evento deja
        las tres condiciones de la vista de aterrizaje satisfechas, y el usuario
        vuelve a la pantalla inicial como si nunca hubiera ejecutado nada. Aquí
        se garantiza siempre una traza en la línea de tiempo y un error visible.
      */
      if (!reportPromoted && !accumulatedText.trim() && eventsPushed === 0) {
          const message =
            streamErrorMessage ??
            'El agente terminó sin devolver ninguna respuesta.';
          console.error('[stream] Ejecución terminada sin resultado:', message);
          emit('error', 'Ejecución sin resultado', message);
          setErr(message);
      }

      setDur(Math.round((Date.now() - startTimestamp) / 1000));
      setRun(false);
      
    } catch (e: any) {
      if (e.name === 'AbortError') {
         console.log('Aborted');
         /*
           Detener antes del primer evento también dejaba la pantalla vacía: se
           registra el corte para que la ejecución siga siendo visible.
         */
         if (eventsPushed === 0) {
            emit('info', 'Ejecución detenida', 'La ejecución se detuvo antes de producir resultados.');
         }
      } else {
         console.error('[stream] Ejecución interrumpida:', e);
         setErr(e.message || 'Unknown error');
         if (eventsPushed === 0) {
            emit('error', 'La ejecución falló', e.message || 'Unknown error');
         }
      }
      setDur(Math.round((Date.now() - startTimestamp) / 1000));
      setRun(false);
    }
  };

  const runAnalysis = () => {
    if (running) return;
    // Requirements 8.7, 11.9: sin entrada válida o sin agentes no hay ejecución.
    if (!canRunAnalysis) return;
    setIsReportOpen(false);
    setIsStopped(false);

    startStream(MODEL_ID, activeAgentId, setRunning, setError, setReportData, setEvents, pushEvent, setTokenCount, setToolRuns, setDurationSecs, setStartTime, abortRef, eventIdRef);
  };

  if (isReportOpen === 'flash' && reportData) {
    /*
      Requirement 14.1: el renderizador es el de la ejecución que produjo este
      informe, guardado en `runAgent` al recibir su `agent_info`. Un cambio de
      agente activo posterior no lo altera.
    */
    const reportRenderer = runAgent?.outputRenderer ?? FALLBACK_OUTPUT_RENDERER;

    return (
      <div className="w-full h-screen print:h-auto print:overflow-visible">
         {reportRenderer === 'simple_report' ? (
           /* Requirement 14.3: informe simple con `SimpleReportView`. */
           <SimpleReportView
             /*
               El informe llega recién extraído del texto del modelo, con la
               forma del contrato `simple_report`; la vista normaliza cada campo.
             */
             data={reportData as unknown as RawSimpleReport}
             title={runAgent?.agentName ?? 'Report'}
             subtitle={inputValue}
             onClose={() => setIsReportOpen(false)}
             durationSecs={durationSecs}
             toolRuns={toolRuns}
             tokenCount={tokenCount}
           />
         ) : (
           /* Requirement 14.2: informe financiero con el contrato de props intacto. */
           <ReportTemplate
             data={reportData}
             ticker={inputValue}
             onClose={() => setIsReportOpen(false)}
             durationSecs={durationSecs}
             toolRuns={toolRuns}
             tokenCount={tokenCount}
             documentCount={reportData.findings?.length || 0}
           />
         )}
      </div>
    );
  }


  return (
    <div className="relative h-screen bg-stone-900 overflow-hidden font-sans text-stone-100 flex flex-col">
      <DottedBackground />
      
      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20 backdrop-blur-md">
        <div className="flex items-start gap-4">
          <span className="font-display font-bold text-xl tracking-wider uppercase text-white">Tickr</span>
          {/*
            Requirements 11.1, 11.4: selector del agente activo en la cabecera.
            Con una ejecución en curso queda bloqueado y el propio componente
            explica el motivo.
          */}
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

      <main className="relative z-10 flex-1 flex flex-col pt-8 min-h-0">
        {!running && !reportData && events.length === 0 ? (
           /* Requirements 13.1, 13.2: la vista de aterrizaje describe al agente activo. */
           <LandingView agent={activeAgent} />
        ) : (
           <div className="flex-1 flex flex-row overflow-hidden pb-32 w-full px-6">
             <div className="flex-1 flex flex-col bg-stone-900 rounded-xl border border-stone-800 overflow-hidden min-h-0 max-w-4xl mx-auto w-full">
                <div className="p-3 bg-stone-800 border-b border-stone-700 font-bold text-stone-200 text-sm flex justify-between items-center">
                  {/*
                    Requirement 12.7: el `name` del agente activo encabeza el
                    panel y el nombre del modelo queda como texto secundario.
                  */}
                  <div className="flex items-center gap-2 min-w-0">
                    <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg" alt="Gemini Sparkle" className="w-5 h-5 shrink-0" />
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

            {/*
              Requirement 14.6: aviso de informe no estructurado. El texto crudo
              del agente sigue disponible en la línea de tiempo.
            */}
            {unstructuredReport && (
              <div
                role="status"
                className="mb-4 bg-amber-500/10 border border-amber-500/50 text-amber-100 px-4 py-3 rounded text-sm"
              >
                El informe no pudo estructurarse. La respuesta del agente se conserva sin
                formatear en la línea de tiempo.
              </div>
            )}
            

            <div className="bg-stone-800 border border-stone-700 rounded-xl shadow-2xl p-2 w-full flex items-center gap-2 relative z-30 transition-all focus-within:border-stone-500 focus-within:ring-1 focus-within:ring-stone-500">
              {inputMode === 'ticker' ? (
                /*
                  Requirement 13.3: en modo `ticker`, campo corto en mayúsculas
                  con tipografía monoespaciada e icono de búsqueda.
                */
                <div
                  className={`pl-3 py-2 flex items-center gap-2 transition-colors ${
                    running ? 'text-stone-600' : 'text-stone-400'
                  } ${supportsInstruction ? 'border-r border-stone-700 pr-3' : 'flex-1 pr-3'}`}
                >
                  <Search className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <input
                    type="text"
                    aria-label="Entrada del agente"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                    /* Requirement 13.5: el `inputPlaceholder` del manifiesto. */
                    placeholder={inputPlaceholder}
                    maxLength={inputMaxLength('ticker')}
                    disabled={running}
                    /*
                      El texto introducido se atenúa mientras hay una ejecución
                      en curso: el campo está deshabilitado justo en ese caso.
                    */
                    className={`bg-transparent border-none outline-none text-white font-mono uppercase placeholder-stone-600 transition-colors disabled:text-stone-500 disabled:placeholder-stone-700 ${
                      supportsInstruction ? 'w-28' : 'flex-1'
                    }`}
                    onKeyDown={(e) => e.key === 'Enter' && runAnalysis()}
                  />
                </div>
              ) : (
                /* Requirement 13.4: en modo `text`, campo ancho de texto libre. */
                <input
                  type="text"
                  aria-label="Entrada del agente"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={inputPlaceholder}
                  maxLength={inputMaxLength('text')}
                  disabled={running}
                  className="bg-transparent border-none outline-none flex-1 px-3 py-2 text-stone-100 placeholder-stone-500 transition-colors disabled:text-stone-500 disabled:placeholder-stone-700"
                  onKeyDown={(e) => e.key === 'Enter' && runAnalysis()}
                />
              )}
              {/*
                Requirement 13.6: el campo de instrucción existe solo cuando el
                agente declara `supportsInstruction` verdadero, y entonces está
                habilitado.
              */}
              {supportsInstruction && (
                <input
                  type="text"
                  aria-label="Instrucción adicional"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Instrucción opcional para el agente"
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
                  /*
                    Requirements 8.7, 8.8, 11.9: deshabilitado mientras la
                    entrada no cumple las reglas del `inputMode` activo o el
                    catálogo está vacío.
                  */
                  disabled={!canRunAnalysis}
                  className="bg-white text-black hover:bg-stone-200 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed px-6 py-2 rounded-lg font-medium transition-colors ml-2 tracking-wide text-sm whitespace-nowrap"
                >
                  {/* Requirement 13.7: etiqueta declarada por el agente. */}
                  {actionLabel}
                </button>
              )}
            </div>

            {/* Requirement 13.8: el aviso legal sigue visible bajo la barra. */}
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

      {/* ---------------------------------------------------------------- */}
      {/* DEBUG (provisional): bloque autocontenido. Para desactivarlo pon  */}
      {/* DEBUG_PANEL_ENABLED en false en components/DebugPanel.tsx, o abre */}
      {/* la app con ?nodebug. Para borrarlo, elimina este bloque, el       */}
      {/* import de DebugPanel y el archivo del componente.                */}
      {/* ---------------------------------------------------------------- */}
      <DebugPanel
        state={{
          running,
          isStopped,
          error,
          catalogStatus,
          catalogError,
          agents: agents.length,
          activeAgentId,
          defaultAgentId,
          activeAgentName: activeAgent?.name,
          outputRenderer: activeAgent?.outputRenderer,
          runAgentId: runAgent?.agentId,
          runRenderer: runAgent?.outputRenderer,
          inputMode,
          inputValue,
          instruction,
          canRunAnalysis,
          model: MODEL_ID,
          events: events.length,
          hasReport: !!reportData,
          unstructuredReport,
          reportOpen: isReportOpen,
          durationSecs,
          tokenCount,
          toolRuns,
          startTime,
          user: user?.email ?? user?.username ?? null,
        }}
        events={events}
      />
      {/* ------------------------- FIN DEBUG ---------------------------- */}
    </div>
  );
}
