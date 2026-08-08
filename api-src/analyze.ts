import type { VercelRequest, VercelResponse } from '@vercel/node';
import { agentRegistry } from '../server/lib/agent/agentRegistry.ts';
import { createCalculatorTool } from '../server/lib/tools/calculatorTool.ts';
import { createBraveSearchTool } from '../server/lib/tools/braveSearchTool.ts';
import {
  classifyAgentFailureStatus,
  createStrandsAgent,
  isStrandsConfigured,
  streamStrandsAgent,
} from '../server/lib/model/strandsAgent.ts';
import {
  buildAgentInfoEvent,
  buildStreamFailureEvents,
  describeAgentStartFailure,
  describeStreamFailure,
} from '../server/lib/analyzeExecution.ts';
import { validateAnalyzeInput } from '../server/lib/analyzeInput.ts';
import { buildAgentPrompt } from '../server/lib/promptBuilder.ts';
import type { AgentEvent } from '../server/lib/agent/agentEvents.ts';

export const config = {
  maxDuration: 60,
};

const NO_AGENTS_AVAILABLE_ERROR =
  'No agents are available on the server to handle this run.';
const AGENT_NOT_EXECUTABLE_ERROR = 'The selected agent cannot be executed.';
const MODEL_NOT_CONFIGURED_ERROR =
  'The server does not have the model credential configured (NVIDIA_API_KEY).';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { model } = body as { model?: string };

    const resolution = agentRegistry.resolveAgent(body.agentId);
    if (resolution.definition === null) {
      return res.status(500).json({ error: NO_AGENTS_AVAILABLE_ERROR });
    }
    const agent = resolution.definition;

    const validation = validateAnalyzeInput({
      body,
      inputMode: agent.manifest.inputMode,
      supportsInstruction: agent.manifest.supportsInstruction,
    });
    if (validation.rejection !== null) {
      const { status, body: errorBody } = validation.rejection;
      return res.status(status).json(errorBody);
    }

    const { input, instruction } = validation.value!;
    const effectiveModel = model || undefined;

    if (!isStrandsConfigured()) {
      return res.status(500).json({ error: MODEL_NOT_CONFIGURED_ERROR });
    }

    let systemPrompt: string;
    let prompt: string;
    try {
      systemPrompt = agentRegistry.getInstructions(agent.agentId).text;
      prompt = buildAgentPrompt({
        definition: agent,
        input,
        instruction: agent.manifest.supportsInstruction ? instruction : null,
      }).prompt;
    } catch (preparationError: any) {
      return res.status(500).json({
        error: AGENT_NOT_EXECUTABLE_ERROR,
        detail: preparationError?.message || String(preparationError),
      });
    }

    const agentTools: any[] = [];
    if (agent.agentId === 'calculator_agent') agentTools.push(createCalculatorTool());
    if (agent.agentId === 'web_search_agent') agentTools.push(createBraveSearchTool());
    const strandsAgent = createStrandsAgent({
      systemPrompt,
      modelId: effectiveModel,
      tools: agentTools.length > 0 ? agentTools : undefined,
    });

    const agentStream = streamStrandsAgent(strandsAgent, prompt);
    let firstEvent: IteratorResult<AgentEvent>;
    try {
      firstEvent = await agentStream.next();
    } catch (startError: any) {
      const failure = describeAgentStartFailure(classifyAgentFailureStatus(startError));
      return res.status(failure.status).json(failure.body);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (event: object): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const agentInfoEvent = buildAgentInfoEvent(agent);
    sendEvent(agentInfoEvent);

    const startTime = Date.now();
    let streamFailure: string | null = null;
    let errorEmitted = false;
    let doneEmitted = false;
    let totalTokens = 0;

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

        if (event.type === 'error') {
          streamFailure = describeStreamFailure(event.message);
          errorEmitted = true;
        } else if (event.type === 'done') {
          doneEmitted = true;
        }

        if (event.type === 'done' || event.type === 'complete' || event.type === 'error') {
          break;
        }
      }
    } catch (streamError: any) {
      streamFailure = describeStreamFailure(streamError);
    }

    if (streamFailure !== null) {
      const [errorEvent, doneEvent] = buildStreamFailureEvents(streamFailure);
      if (!errorEmitted) sendEvent(errorEvent);
      if (!doneEmitted) sendEvent(doneEvent);
    }

    if (streamFailure === null) {
      const totalDurationSecs = (Date.now() - startTime) / 1000;
      sendEvent({
        type: 'final_stats',
        duration: totalDurationSecs,
        tokens: totalTokens,
      });
    }

    res.end();
  } catch (err: any) {
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Analyze failed' });
    }
    for (const event of buildStreamFailureEvents(err)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }
}
