import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import express from "express";
import https from "https";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";

import type { AgentEvent } from "./server/lib/agent/agentEvents.ts";
import { buildAgentCatalogHttpResult } from "./server/lib/agent/agentCatalog.ts";
import { subAgentsDebugFileName, writeDebugFile } from "./server/lib/debugFiles.ts";
import { agentRegistry } from "./server/lib/agent/agentRegistry.ts";
import { createCalculatorTool } from "./server/lib/tools/calculatorTool.ts";
import { createBraveSearchTool } from "./server/lib/tools/braveSearchTool.ts";
import {
  classifyAgentFailureStatus,
  createStrandsAgent,
  isStrandsConfigured,
  loadMcpClients,
  streamStrandsAgent,
} from "./server/lib/model/strandsAgent.ts";
import {
  buildAgentInfoEvent,
  buildStreamFailureEvents,
  describeAgentStartFailure,
  describeStreamFailure,
} from "./server/lib/analyzeExecution.ts";
import { validateAnalyzeInput } from "./server/lib/analyzeInput.ts";
import { buildAgentPrompt } from "./server/lib/promptBuilder.ts";
import { resolveRunLogDownload } from "./server/lib/runLogDownload.ts";
import { buildRunLogNames, toLogFileSlug } from "./server/lib/runLogNaming.ts";
import { resolveArtifactPath } from "./server/lib/artifactUpload.ts";
import { isAuthorizedRequest, resolveServerBinding } from "./server/lib/serverAccess.ts";

const NO_AGENTS_AVAILABLE_ERROR =
  "No agents are available on the server to handle this run.";

const AGENT_NOT_EXECUTABLE_ERROR = "The selected agent cannot be executed.";

const MODEL_NOT_CONFIGURED_ERROR =
  "The server does not have the model credential configured (NVIDIA_API_KEY).";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Bind address and access control are resolved before any route is mounted, so
  // the process refuses to start rather than exposing an open server.
  const binding = resolveServerBinding(process.env);
  if (binding.error !== null) {
    console.error(`[server] ${binding.error}`);
    process.exitCode = 1;
    return;
  }
  const bindHost = binding.host as string;

  // A body of a few hundred kilobytes covers every documented payload: the
  // analyze input and instruction are capped at 2000 characters each. The
  // previous 50 MB limit was a free DoS vector on an unauthenticated endpoint.
  app.use(express.json({ limit: '512kb' }));

  // CORS: allow the Vercel-hosted frontend to call this server cross-origin.
  const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.use('/api', (req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  /**
   * Token gate for everything that is not the static frontend.
   *
   * On a loopback server the gate is inert, which keeps `npm run dev` unchanged.
   * On any other address `resolveServerBinding` has already guaranteed a token
   * exists, and it becomes mandatory here.
   */
  if (binding.exposed) {
    const requiredToken = binding.accessToken as string;
    app.use(['/api', '/artifacts', '/run_logs'], (req, res, next) => {
      if (isAuthorizedRequest(req.headers.authorization, requiredToken)) {
        return next();
      }
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        return next();
      }
      res.status(401).json({
        error: 'Missing or invalid API access token.',
        code: 'unauthorized',
      });
    });
  }

  app.post("/api/upload_artifact", express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
    try {
        const localArtifactsDir = path.join(process.cwd(), 'workspace', 'artifacts');

        // The file name is validated against an allow-list and the resolved path
        // is checked to stay inside the artifacts directory, so a name such as
        // `../../server.ts` can no longer overwrite files outside it.
        const target = resolveArtifactPath(localArtifactsDir, req.query.name);
        if (target.rejection !== null) {
            console.warn(`[upload] Rejected artifact name: ${target.rejection.body.code}`);
            return res.status(target.rejection.status).json(target.rejection.body);
        }

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            return res.status(400).json({
                error: 'The request body must be a non-empty binary payload.',
                code: 'empty_artifact_body',
            });
        }

        if (!fs.existsSync(localArtifactsDir)) {
            fs.mkdirSync(localArtifactsDir, { recursive: true });
        }
        fs.writeFileSync(target.absolutePath, req.body);
        console.log(`[upload] Successfully saved ${target.fileName} (${req.body.length} bytes)`);
        res.json({ success: true });
    } catch (e) {
        // The internal message stays in the server log: the client only gets a
        // generic failure, so a stack or a path is never echoed back.
        console.error("[upload] Error:", e);
        res.status(500).json({ error: 'Failed to store the artifact.', code: 'artifact_write_failed' });
    }
  });

  /**
   * Catálogo de agentes disponibles.
   *
   * La respuesta se construye solo desde el catálogo que el registro mantiene
   * en memoria: no se lee ningún archivo de ejecución, prompt ni esquema
   * (Requirement 4.6), y solo se exponen los campos de resumen del agente, sin
   * rutas del sistema de archivos (Requirements 4.2, 4.5, 16.3). Sigue el mismo
   * modelo de acceso que el resto de `/api/*`: sin token (Requirement 16.5).
   */
  app.get("/api/agents", (_req, res) => {
    const { status, body } = buildAgentCatalogHttpResult(agentRegistry);
    res.status(status).json(body);
  });

  /**
   * Descarga del `.jsonl` de una ejecución.
   *
   * Mantiene el parámetro `ticker` y añade `agent` como opcional: con él se
   * entrega el log más reciente de esa entrada y ese agentId (Requirement 10.3);
   * sin él, el más reciente de esa entrada para cualquier agentId
   * (Requirement 10.4). Se reconocen el patrón nuevo y el heredado, con la
   * entrada comparada sin distinguir mayúsculas y minúsculas y quedándose con el
   * `runId` más alto (Requirement 9.6). Un `ticker` inválido se rechaza con 400
   * antes de enumerar la carpeta (Requirement 9.7) y la falta de coincidencias
   * responde 404 (Requirement 10.5). El archivo se entrega con su nombre
   * original, sin renombrarlo (Requirement 9.8).
   */
  app.get("/api/download_jsonl", (req, res) => {
    const runLogsDir = path.join(process.cwd(), 'run_logs');

    const result = resolveRunLogDownload({
      query: req.query as { ticker?: unknown; agent?: unknown },
      // La enumeración es perezosa: solo se lee la carpeta si los parámetros
      // pasaron la validación (Requirement 9.7).
      listFileNames: () => (fs.existsSync(runLogsDir) ? fs.readdirSync(runLogsDir) : []),
    });

    if (result.match === null) {
      return res.status(result.status).json(result.body);
    }

    return res.download(path.join(runLogsDir, result.match.fileName));
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // `origin` still arrives in the body for compatibility, but the server no
      // longer builds any public URL out of it.
      const { model } = body as { model?: string };

      // El agente se resuelve antes de validar la entrada porque las reglas
      // dependen de su `inputMode` y de su `supportsInstruction`
      // (Requirements 5.1, 5.2, 8.1, 8.2). La ruta de la carpeta sale siempre
      // de la entrada de catálogo, nunca del valor recibido (Requirement 16.1).
      const resolution = agentRegistry.resolveAgent(body.agentId);
      if (resolution.definition === null) {
        // Requirement 5.6: sin agentes disponibles no se abre el flujo SSE ni
        // se escribe ningún log de ejecución.
        return res.status(500).json({ error: NO_AGENTS_AVAILABLE_ERROR });
      }
      const agent = resolution.definition;

      // Requirements 8.4, 8.5: la validación ocurre antes de cargar las fuentes
      // inline, antes de ensamblar el prompt y antes de escribir las cabeceras
      // SSE, y su rechazo es una única respuesta 400 no SSE, sin logs.
      const validation = validateAnalyzeInput({
        body,
        inputMode: agent.manifest.inputMode,
        supportsInstruction: agent.manifest.supportsInstruction,
      });
      if (validation.rejection !== null) {
        const { status, body: errorBody } = validation.rejection;
        console.warn(
          `[analyze] Request rejected by validation (${errorBody.code}, field "${errorBody.field}").`,
        );
        return res.status(status).json(errorBody);
      }

      const { input, instruction, rawInput } = validation.value;

      const effectiveModel = model || undefined;
      console.log(`[analyze] Starting analysis for ${input} with agent ${agent.agentId}, model ${effectiveModel || 'default'}`);

      if (!isStrandsConfigured()) {
        console.error(`[analyze] NVIDIA_API_KEY is not configured.`);
        return res.status(500).json({ error: MODEL_NOT_CONFIGURED_ERROR });
      }

      // Requirements 7.1 to 7.9: the prompt comes from the agent template and
      // schema, and its `AGENTS.md` is the system prompt it runs with. A failure
      // in either read is answered before the SSE headers and without running the
      // agent (Requirements 6.7, 7.4, 7.9).
      let systemPrompt: string;
      let prompt: string;
      try {
        systemPrompt = agentRegistry.getInstructions(agent.agentId).text;
        prompt = buildAgentPrompt({
          definition: agent,
          input,
          // Requirement 5.7: la instrucción llega al ensamblador solo cuando el
          // agente la declara; en otro caso se descarta sin rechazar la petición.
          instruction: agent.manifest.supportsInstruction ? instruction : null,
        }).prompt;
      } catch (preparationError: any) {
        console.error(
          `[analyze] Agent "${agent.agentId}" cannot be executed: ${preparationError?.message || preparationError}`,
        );
        return res.status(500).json({
          error: AGENT_NOT_EXECUTABLE_ERROR,
          detail: preparationError?.message || String(preparationError),
        });
      }

      // The agent runs in this process with the Strands SDK. If the client walks
      // away, the loop is cancelled instead of burning tokens on a closed
      // connection.
      // The signal comes from the response: `req`'s `close` fires as soon as the
      // request body has been read, which would cancel every run immediately.
      const runAbort = new AbortController();
      res.on('close', () => runAbort.abort());

      const mcpClients = await loadMcpClients();
      const agentTools = [];
      if (agent.agentId === 'calculator_agent') agentTools.push(createCalculatorTool());
      if (agent.agentId === 'web_search_agent') agentTools.push(createBraveSearchTool());
      const strandsAgent = createStrandsAgent({
        systemPrompt,
        modelId: effectiveModel,
        tools: agentTools.length > 0 ? agentTools : undefined,
        mcpClients: mcpClients.length > 0 ? mcpClients : undefined,
      });

      /*
        The first event is awaited before the headers are written: while there is
        no output nothing has reached the client, so a startup failure (quota,
        unknown model, invalid credential) can still be answered with an HTTP
        status and a stable `code` instead of with an empty SSE stream.
      */
      const agentStream = streamStrandsAgent(strandsAgent, prompt, runAbort.signal);
      let firstEvent: IteratorResult<AgentEvent>;
      try {
        firstEvent = await agentStream.next();
      } catch (startError: any) {
        console.error(`[analyze] The run did not start: ${describeStreamFailure(startError)}`);
        const failure = describeAgentStartFailure(classifyAgentFailureStatus(startError));
        return res.status(failure.status).json(failure.body);
      }

      // Requirement 5.4: las cabeceras SSE se conservan tal como estaban.
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      
      const startTime = Date.now();
      const runLogsDir = path.join(process.cwd(), 'run_logs');
      if (!fs.existsSync(runLogsDir)) {
          fs.mkdirSync(runLogsDir, { recursive: true });
      }

      // Requirement 10.1: los dos archivos de log de la ejecución llevan el
      // agentId, la entrada saneada y el mismo `runId`, de modo que dos agentes
      // sobre la misma entrada no se solapen.
      const runId = Date.now();
      const runLogNames = buildRunLogNames({ agentId: agent.agentId, rawInput, runId });
      const jsonlLogPath = path.join(runLogsDir, runLogNames.jsonlFileName);
      
      let debugLog = `--- Analysis Run for ${input} at ${new Date().toISOString()} ---\n\n`;
      let accumulatedLogText = '';
      const toolExecutions = {};
      let totalTokens = 0;

      const sendEvent = (event: object): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const appendJsonlLog = (event: unknown): void => {
        try {
          fs.appendFileSync(jsonlLogPath, JSON.stringify(event) + '\n', 'utf-8');
        } catch (e) {
          console.error("Failed to write to JSONL log", e);
        }
      };

      // Requirement 5.3: exactamente un evento `agent_info`, con el agentId
      // efectivamente ejecutado, antes de reenviar cualquier otro evento.
      const agentInfoEvent = buildAgentInfoEvent(agent);
      sendEvent(agentInfoEvent);
      appendJsonlLog(agentInfoEvent);

      /** Motivo del fallo del cliente remoto, cuando lo hay (Requirement 5.10). */
      let streamFailure: string | null = null;
      /** Verdadero cuando el propio flujo ya reenvió un evento `error`. */
      let errorEmitted = false;
      /** Verdadero cuando el propio flujo ya emitió su evento `done`. */
      let doneEmitted = false;

      /** Re-emits the already consumed event and continues with the rest. */
      const stream = (async function* (): AsyncGenerator<AgentEvent> {
        if (!firstEvent.done) yield firstEvent.value;
        yield* agentStream;
      })();

      try {
        for await (const event of stream) {
          sendEvent(event);

          if (event.type === 'complete' && event.interaction) {
              const usage = (event.interaction.usage || event.interaction.usage_metadata) as any;
              if (usage) {
                  totalTokens = usage.total_tokens || usage.totalTokenCount || usage.total_token_count || 0;
              }
          }

          if (event.type !== 'text' && event.type !== 'thinking') {
            appendJsonlLog(event);
          }

          if (event.type === 'error') {
            // El cliente remoto informó un fallo: el flujo se cierra con `done`
            // y se conservan los eventos y los logs escritos (Requirement 5.10).
            streamFailure = describeStreamFailure(event.message);
            errorEmitted = true;
          } else if (event.type === 'done') {
            doneEmitted = true;
          }

          if (event.type === 'tool_call') {
            // Flush accumulated text before a tool call
            if (accumulatedLogText) {
              debugLog += `[TEXT OUTPUT]\n${accumulatedLogText}\n\n`;
              accumulatedLogText = '';
            }
            const callId = event.callId || `unknown_${Math.random()}`;
            toolExecutions[callId] = {
              name: event.name || 'code_execution_call',
              args: event.arguments,
              startTime: Date.now()
            };
            debugLog += `[${new Date().toISOString()}] [TOOL CALL START] ${event.name || 'code_execution_call'}\n`;
            debugLog += `Call ID: ${callId}\n`;
            debugLog += `Arguments: ${JSON.stringify(event.arguments, null, 2)}\n\n`;
          } else if (event.type === 'tool_result') {
            const callId = event.callId || 'unknown';
            const execution = toolExecutions[callId];
            const duration = execution ? ((Date.now() - execution.startTime) / 1000).toFixed(2) + 's' : 'unknown';
            if (execution) {
              execution.duration = duration;
              execution.result = event.result;
            }
            debugLog += `[${new Date().toISOString()}] [TOOL RESULT END] ${event.name || 'command'}\n`;
            debugLog += `Call ID: ${callId}\n`;
            debugLog += `Duration: ${duration}\n`;
            debugLog += `Result: ${event.result ? String(event.result) : ''}\n\n`;
          } else if (event.type === 'text') {
            accumulatedLogText += event.text;
          } else if (event.type === 'error') {
            debugLog += `[ERROR]\n${event.message}\n\n`;
          }

          if (event.type === 'done' || event.type === 'complete' || event.type === 'error') {
              break;
          }
        }
      } catch (streamError: any) {
        streamFailure = describeStreamFailure(streamError);
        console.error(`[analyze] Stream interrupted: ${streamFailure}`);
        debugLog += `[ERROR]\n${streamFailure}\n\n`;
      }

      // Flush any remaining accumulated text to the debug log
      if (accumulatedLogText) {
        debugLog += `[TEXT OUTPUT]\n${accumulatedLogText}\n\n`;
        accumulatedLogText = '';
      }

      if (streamFailure !== null) {
        // Requirement 5.10: `error`, después `done`, y se cierra el flujo sin
        // `final_stats`; los eventos y los logs ya escritos se conservan.
        const [errorEvent, doneEvent] = buildStreamFailureEvents(streamFailure);
        if (!errorEmitted) {
          sendEvent(errorEvent);
          appendJsonlLog(errorEvent);
        }
        if (!doneEmitted) {
          sendEvent(doneEvent);
          appendJsonlLog(doneEvent);
        }
      }

      const totalDurationSecs = ((Date.now() - startTime) / 1000);
      const totalDuration = totalDurationSecs.toFixed(2) + 's';
      
      // Send final reliable stats to client
      if (streamFailure === null) {
        // Requirement 10.2: la URL apunta al `.jsonl` de esta misma ejecución
        // bajo el estático `/run_logs`.
        sendEvent({
          type: 'final_stats',
          duration: totalDurationSecs,
          tokens: totalTokens,
          jsonlLogUrl: runLogNames.jsonlLogUrl,
        });
      }

      let summaryLog = `========================================================\n`;
      summaryLog += `                 RUN SUMMARY FOR ${input.slice(0, 80).toUpperCase()}\n`;
      summaryLog += `                 Total Duration: ${totalDuration}\n`;
      summaryLog += `========================================================\n\n`;
      summaryLog += `1. SUB-AGENT EXECUTIONS:\n`;
      summaryLog += `--------------------------------------------------------\n`;
      
      let allWorked = true;
      Object.values(toolExecutions).forEach((exec: any, idx) => {
          const status = exec.result ? 'Completed' : 'Failed/Timeout';
          if (!exec.result || String(exec.result).includes('error') || String(exec.result).includes('traceback')) allWorked = false;
          summaryLog += `Agent Step ${idx + 1}: ${exec.name}\n`;
          summaryLog += `Status: ${status}\n`;
          summaryLog += `Duration: ${exec.duration || 'unknown'}\n`;
          summaryLog += `Arguments: ${JSON.stringify(exec.args)}\n`;
          const resultStr = exec.result ? String(exec.result) : '';
          summaryLog += `Output Preview: ${resultStr ? resultStr.substring(0, 2000).replace(/\n/g, ' ') : 'None'}\n`;
          summaryLog += `--------------------------------------------------------\n`;
      });
      
      summaryLog += `\n2. OVERALL AGENT STATUS: ${allWorked ? 'SUCCESS' : 'WITH ERRORS'}\n`;
      summaryLog += `\n========================================================\n\n`;
      summaryLog += `RAW EXECUTION LOGS:\n\n`;

      try {
        // Requirement 10.1: el `.txt` comparte agentId, entrada y `runId` con el
        // `.jsonl` de la misma ejecución.
        const finalLog = summaryLog + debugLog;
        fs.writeFileSync(path.join(runLogsDir, runLogNames.txtFileName), finalLog, 'utf-8');
        // Copia heredada de la última ejecución por entrada, ahora bajo `debug/`.
        writeDebugFile(subAgentsDebugFileName(toLogFileSlug(rawInput)), finalLog);
      } catch (e) {
        console.error("Failed to write debug log", e);
      }
          
      res.end();
    } catch (err: any) {
      console.error("[analyze] Error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Analyze failed" });
        return;
      }
      // Requirement 5.10: con las cabeceras SSE ya escritas, el motivo viaja en
      // un evento `error` seguido de `done`, y el flujo se cierra.
      for (const event of buildStreamFailureEvents(err)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    }
  });

  const distPath = path.join(process.cwd(), 'dist');
  const indexHtmlExists = fs.existsSync(path.join(distPath, 'index.html'));
  app.use('/artifacts', express.static(path.join(process.cwd(), 'workspace', 'artifacts')));
  app.use('/run_logs', express.static(path.join(process.cwd(), 'run_logs')));
  // `/latest_log` used to be mounted here as `express.static(process.cwd())`,
  // which published the whole working directory over HTTP: the server source,
  // `package-lock.json` and the `agent/*/prompt.md` and `agent/*/output.schema.json`
  // files the catalog deliberately keeps server side. Nothing in the app consumed
  // it, so the mount is gone. Run logs stay available under `/run_logs`.

  if (process.env.NODE_ENV !== "production" || !indexHtmlExists) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // HTTPS when certs are available (required for cross-origin from HTTPS frontends).
  const certDir = path.join(process.cwd(), 'certs');
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  const useHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);

  if (useHttps) {
    const httpsPort = Number(process.env.HTTPS_PORT || 3443);
    const sslOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
    https.createServer(sslOptions, app).listen(httpsPort, bindHost, () => {
      const scope = binding.exposed
        ? `${bindHost} (reachable from the network, API access token required)`
        : `${bindHost} (local only)`;
      console.log(`HTTPS server running on port ${httpsPort} at ${scope}`);
    });
  }

  app.listen(PORT, bindHost, () => {
    const scope = binding.exposed
      ? `${bindHost} (reachable from the network, API access token required)`
      : `${bindHost} (local only)`;
    console.log(`HTTP server running on port ${PORT} at ${scope}`);
  });
}

startServer();
