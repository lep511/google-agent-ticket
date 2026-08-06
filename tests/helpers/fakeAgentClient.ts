import type { AgentEvent, InteractionOptions } from '../../server/lib/agentClient.ts';

/**
 * Doble de prueba de `agentClient` / `agentClientPerseus`.
 *
 * - Registra cada interacción creada (prompt, fuentes inline, herramientas).
 * - Emite una secuencia de eventos SSE determinista, definible por prueba.
 * - El cuerpo de la respuesta se escribe en el formato de cable de Gemini, de
 *   modo que el `streamInteraction` real también puede consumirlo.
 *
 * Diseño → Testing Strategy: "el cliente remoto se sustituye por un doble de
 * prueba para que las propiedades no dependan del servicio de Gemini".
 */

export type FakeClientName = 'agentClient' | 'agentClientPerseus';

export interface RecordedInteraction {
  /** Cliente que recibió la llamada. */
  client: FakeClientName;
  /** Opciones tal como las recibió el cliente. */
  options: InteractionOptions;
  /** Atajos de lectura frecuente. */
  prompt: string;
  inlineSources: NonNullable<InteractionOptions['inlineSources']>;
  /** Orden de llegada, empezando en 0. */
  index: number;
}

export interface FakeAgentClientOptions {
  /** Eventos emitidos por la siguiente interacción. */
  events?: AgentEvent[];
  /**
   * Cuando se indica, `createInteraction` devuelve una respuesta con ese
   * código de estado y un cuerpo de error, sin abrir ningún flujo.
   */
  failStatus?: number;
  /** Cuerpo devuelto cuando `failStatus` está presente. */
  failBody?: string;
  /**
   * Cuando se indica, el flujo se rompe después de emitir ese número de
   * eventos, simulando una interrupción del cliente remoto.
   */
  breakAfter?: number;
}

export interface FakeAgentClient {
  readonly name: FakeClientName;
  /** Interacciones registradas por este cliente. */
  readonly interactions: RecordedInteraction[];
  /** Sustituto de `createInteraction`. */
  createInteraction(options: InteractionOptions): Promise<Response>;
  /** Sustituto de `streamInteraction`. */
  streamInteraction(response: Response): AsyncGenerator<AgentEvent>;
  /** Redefine el guion de eventos y el modo de fallo para las siguientes llamadas. */
  script(options: FakeAgentClientOptions): void;
  /** Vacía el registro de interacciones. */
  reset(): void;
}

export interface FakeAgentClientPair {
  agentClient: FakeAgentClient;
  agentClientPerseus: FakeAgentClient;
  /** Registro compartido, en orden de llegada, de ambos clientes. */
  readonly interactions: RecordedInteraction[];
  reset(): void;
}

/** Guion por defecto: un pensamiento, un texto final y el cierre del flujo. */
export function defaultScript(finalText = '{"summary":"ok"}'): AgentEvent[] {
  return [
    { type: 'thinking', text: 'Analizando la entrada.' },
    { type: 'text', text: finalText },
    { type: 'complete', interaction: { id: 'fake-interaction', usage: { total_tokens: 42 } } },
    { type: 'done' },
  ];
}

/** Traduce un `AgentEvent` a los eventos de cable que produce Gemini. */
function toWireEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'thinking':
      return sse({ event_type: 'step.delta', delta: { type: 'thought_summary', text: event.text ?? '' } });
    case 'text':
      return sse({ event_type: 'step.delta', delta: { type: 'text', text: event.text ?? '' } });
    case 'tool_call':
      return sse({
        event_type: 'step.delta',
        delta: {
          type: 'function_call',
          name: event.name ?? 'google_search',
          arguments: event.arguments ?? {},
          call_id: event.callId ?? 'fake_call',
        },
      });
    case 'tool_result':
      return sse({
        event_type: 'step.delta',
        delta: {
          name: event.name ?? 'google_search',
          result: event.result ?? '',
          call_id: event.callId ?? 'fake_call',
        },
      });
    case 'complete':
      return sse({ event_type: 'interaction.completed', interaction: event.interaction ?? {} });
    case 'error':
      return sse({ event_type: 'error', error: { message: event.message ?? 'fake failure' } });
    case 'done':
      return 'data: [DONE]\n\n';
  }
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Eventos que este doble entregará al consumir una respuesta concreta. */
const scriptsByResponse = new WeakMap<Response, { events: AgentEvent[]; breakAfter?: number }>();

function buildSseResponse(events: AgentEvent[], breakAfter?: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let emitted = 0;
      for (const event of events) {
        if (breakAfter !== undefined && emitted >= breakAfter) {
          controller.error(new Error('fake stream interrupted'));
          return;
        }
        controller.enqueue(encoder.encode(toWireEvent(event)));
        emitted += 1;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

export function createFakeAgentClient(
  name: FakeClientName = 'agentClient',
  options: FakeAgentClientOptions = {},
  sharedLog?: RecordedInteraction[],
): FakeAgentClient {
  const interactions: RecordedInteraction[] = [];
  let current: FakeAgentClientOptions = { ...options };

  const client: FakeAgentClient = {
    name,
    interactions,
    async createInteraction(opts: InteractionOptions): Promise<Response> {
      const record: RecordedInteraction = {
        client: name,
        options: opts,
        prompt: opts.prompt,
        inlineSources: opts.inlineSources ?? [],
        index: sharedLog ? sharedLog.length : interactions.length,
      };
      interactions.push(record);
      sharedLog?.push(record);

      if (current.failStatus !== undefined) {
        return new Response(current.failBody ?? 'fake remote failure', {
          status: current.failStatus,
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      const events = current.events ?? defaultScript();
      const response = buildSseResponse(events, current.breakAfter);
      scriptsByResponse.set(response, { events, breakAfter: current.breakAfter });
      return response;
    },
    async *streamInteraction(response: Response): AsyncGenerator<AgentEvent> {
      const script = scriptsByResponse.get(response);
      if (!script) {
        throw new Error(
          'fakeAgentClient.streamInteraction recibió una respuesta que no creó este doble',
        );
      }

      let emitted = 0;
      for (const event of script.events) {
        if (script.breakAfter !== undefined && emitted >= script.breakAfter) {
          yield { type: 'error', message: 'fake stream interrupted' };
          return;
        }
        yield event;
        emitted += 1;
        if (event.type === 'done') return;
      }
    },
    script(next: FakeAgentClientOptions): void {
      current = { ...next };
    },
    reset(): void {
      interactions.length = 0;
    },
  };

  return client;
}

/** Crea el par de clientes (`agentClient` y `agentClientPerseus`) con registro compartido. */
export function createFakeAgentClients(
  options: FakeAgentClientOptions = {},
): FakeAgentClientPair {
  const interactions: RecordedInteraction[] = [];
  const agentClient = createFakeAgentClient('agentClient', options, interactions);
  const agentClientPerseus = createFakeAgentClient('agentClientPerseus', options, interactions);

  return {
    agentClient,
    agentClientPerseus,
    interactions,
    reset(): void {
      interactions.length = 0;
      agentClient.reset();
      agentClientPerseus.reset();
    },
  };
}
