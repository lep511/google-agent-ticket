import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";

import { createInteraction, streamInteraction } from "./server/lib/agentClient.ts";
import { createInteraction as createInteractionPerseus, streamInteraction as streamInteractionPerseus } from "./server/lib/agentClientPerseus.ts";
import { buildAgentCatalogHttpResult } from "./server/lib/agentCatalog.ts";
import { subAgentsDebugFileName, writeDebugFile } from "./server/lib/debugFiles.ts";
import { agentRegistry } from "./server/lib/agentRegistry.ts";
import {
  buildAgentInfoEvent,
  buildStreamFailureEvents,
  describeStreamFailure,
  isPerseusModel,
  toRemoteInlineSources,
} from "./server/lib/analyzeExecution.ts";
import { validateAnalyzeInput } from "./server/lib/analyzeInput.ts";
import { buildAgentPrompt } from "./server/lib/promptBuilder.ts";
import { resolveRunLogDownload } from "./server/lib/runLogDownload.ts";
import { buildRunLogNames, toLogFileSlug } from "./server/lib/runLogNaming.ts";

/**
 * Mensaje del error de configuración cuando el catálogo no tiene ningún agente
 * válido: se responde antes de abrir el flujo SSE y sin nombrar rutas del
 * sistema de archivos (Requirements 5.6, 16.3).
 */
const NO_AGENTS_AVAILABLE_ERROR =
  "No hay agentes disponibles en el servidor para atender la ejecución.";

/**
 * Mensaje del error con el que se rechaza una ejecución cuyo agente resuelto no
 * puede preparar sus fuentes inline, su plantilla o su esquema: se responde
 * antes de abrir el flujo SSE y sin crear ninguna interacción remota
 * (Requirements 6.7, 7.4, 7.9).
 */
const AGENT_NOT_EXECUTABLE_ERROR = "El agente seleccionado no se puede ejecutar.";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.post("/api/tts", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Missing text." });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const interaction = await ai.interactions.create({
        model: 'gemini-3.1-flash-tts-preview',
        input: text,
        response_modalities: ['audio'],
        generation_config: {
          speech_config: [
            {
              speaker: "Speaker 1",
              language: "en-us",
              voice: "kore"
            },
            {
              speaker: "Speaker 2",
              language: "en-us",
              voice: "aoede"
            }
          ]
        }
      });

      let audioBuffer = null;
      let mimeType = "audio/wav";

      for (const step of interaction.steps) {
        if (step.type === 'model_output') {
          const audioContent = step.content?.find(c => c.type === 'audio');
          if (audioContent && audioContent.data) {
            const pcmBuffer = Buffer.from(audioContent.data, 'base64');
            
            // If it's raw PCM, wrap it in a WAV header so browsers can play it
            if (audioContent.mime_type === 'audio/l16' || !audioContent.mime_type) {
              const sampleRate = 24000;
              const numChannels = 1;
              const wavHeader = Buffer.alloc(44);
              wavHeader.write("RIFF", 0);
              wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
              wavHeader.write("WAVE", 8);
              wavHeader.write("fmt ", 12);
              wavHeader.writeUInt32LE(16, 16);
              wavHeader.writeUInt16LE(1, 20);
              wavHeader.writeUInt16LE(numChannels, 22);
              wavHeader.writeUInt32LE(sampleRate, 24);
              wavHeader.writeUInt32LE(sampleRate * numChannels * 2, 28);
              wavHeader.writeUInt16LE(numChannels * 2, 32);
              wavHeader.writeUInt16LE(16, 34);
              wavHeader.write("data", 36);
              wavHeader.writeUInt32LE(pcmBuffer.length, 40);
              
              audioBuffer = Buffer.concat([wavHeader, pcmBuffer]);
              mimeType = "audio/wav";
            } else {
              audioBuffer = pcmBuffer;
              mimeType = audioContent.mime_type;
            }
          }
        }
      }

      if (audioBuffer) {
        res.setHeader("Content-Type", mimeType);
        res.send(audioBuffer);
      } else {
        res.status(500).json({ error: "Failed to generate audio content" });
      }
    } catch (error: any) {
      console.error("[TTS] Error:", error);
      res.status(500).json({ error: error.message || "TTS Generation failed" });
    }
  });


  app.post("/api/upload_artifact", express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
    try {
        const fileName = req.query.name || 'podcast_briefing.wav';
        const localArtifactsDir = path.join(process.cwd(), 'workspace', 'artifacts');
        if (!fs.existsSync(localArtifactsDir)) {
            fs.mkdirSync(localArtifactsDir, { recursive: true });
        }
        fs.writeFileSync(path.join(localArtifactsDir, fileName as string), req.body);
        console.log(`[upload] Successfully saved ${fileName} (${req.body.length} bytes)`);
        res.json({ success: true });
    } catch (e) {
        console.error("[upload] Error:", e);
        res.status(500).json({ error: String(e) });
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
      const { origin, model } = body as { origin?: string; model?: string };

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
          `[analyze] Petición rechazada por validación (${errorBody.code}, campo "${errorBody.field}").`,
        );
        return res.status(status).json(errorBody);
      }

      const { input, instruction, rawInput } = validation.value;

      console.log(`[analyze] Starting analysis for ${input} with agent ${agent.agentId} using model ${model || 'default'}`);

      // Requirements 5.5, 5.8: `agentClientPerseus` solo cuando `model` es
      // exactamente `perseus` tras recortar los espacios.
      const usePerseus = isPerseusModel(model);

      // Requirements 6.1 a 6.4: las fuentes inline se recorren solo dentro de la
      // carpeta del agente resuelto y su contenido se lee aquí, al resolver la
      // ejecución. Requirements 7.1 a 7.9: el prompt sale de la plantilla y del
      // esquema del agente. Un fallo en cualquiera de los dos pasos se responde
      // antes de las cabeceras SSE y sin crear ninguna interacción remota
      // (Requirements 6.7, 7.4, 7.9).
      let agentFiles;
      let prompt: string;
      try {
        agentFiles = toRemoteInlineSources(agentRegistry.getInlineSources(agent.agentId).sources);
        prompt = buildAgentPrompt({
          definition: agent,
          input,
          // Requirement 5.7: la instrucción llega al ensamblador solo cuando el
          // agente la declara; en otro caso se descarta sin rechazar la petición.
          instruction: agent.manifest.supportsInstruction ? instruction : null,
        }).prompt;
      } catch (preparationError: any) {
        console.error(
          `[analyze] El agente "${agent.agentId}" no se puede ejecutar: ${preparationError?.message || preparationError}`,
        );
        return res.status(500).json({
          error: AGENT_NOT_EXECUTABLE_ERROR,
          detail: preparationError?.message || String(preparationError),
        });
      }

      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const publicUrl = origin || `${protocol}://${host}`;

      let response;
      if (usePerseus) {
        response = await createInteractionPerseus({
          prompt,
          inlineSources: agentFiles,
          tools: [{ type: "google_search" }]
        });
      } else {
        response = await createInteraction({
          prompt,
          inlineSources: agentFiles,
          tools: [{ type: "google_search" }]
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[analyze] createInteraction failed: ${response.status} ${errorText}`);
        return res.status(500).json({ error: "Failed to start agent interaction." });
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

      const stream = usePerseus ? streamInteractionPerseus(response) : streamInteraction(response);
      try {
        for await (const event of stream) {
          sendEvent(event);

          if (event.type === 'complete' && event.interaction) {
              const usage = (event.interaction.usage || event.interaction.usage_metadata) as any;
              if (usage) {
                  totalTokens = usage.total_tokens || usage.totalTokenCount || usage.total_token_count || 0;
              }
          }

          appendJsonlLog(event);

          if (event.type === 'error') {
            // El cliente remoto informó un fallo: el flujo se cierra con `done`
            // y se conservan los eventos y los logs escritos (Requirement 5.10).
            streamFailure = describeStreamFailure(event.message);
            errorEmitted = true;
          } else if (event.type === 'done') {
            doneEmitted = true;
          }

          if (event.type === 'tool_call') {
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
            debugLog += `Result: ${event.result ? String(event.result).substring(0, 500) : ''}...\n\n`;
          } else if (event.type === 'text') {
            debugLog += `[TEXT OUTPUT]\n${event.text}\n\n`;
          } else if (event.type === 'error') {
            debugLog += `[ERROR]\n${event.message}\n\n`;
          }

          if (event.type === 'done' || event.type === 'complete' || event.type === 'error') {
              break;
          }
        }
      } catch (streamError: any) {
        // Requirement 5.10: el cliente remoto se interrumpió después de escribir
        // las cabeceras SSE. No se puede responder un código de estado, así que
        // el motivo viaja en un evento `error` del propio flujo.
        streamFailure = describeStreamFailure(streamError);
        console.error(`[analyze] El flujo del cliente remoto se interrumpió: ${streamFailure}`);
        debugLog += `[ERROR]\n${streamFailure}\n\n`;
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
          summaryLog += `Output Preview: ${resultStr ? resultStr.substring(0, 200).replace(/\n/g, ' ') + '...' : 'None'}\n`;
          summaryLog += `--------------------------------------------------------\n`;
      });
      
      summaryLog += `\n2. OVERALL AGENT STATUS: ${allWorked ? 'SUCCESS' : 'WITH ERRORS'}\n`;
      summaryLog += `\n3. GENERATED MEDIA ARTIFACTS:\n`;
      summaryLog += `Audio Briefing Link: /artifacts/podcast_briefing.wav\n`;
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
  app.use('/latest_log', express.static(process.cwd()));

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
