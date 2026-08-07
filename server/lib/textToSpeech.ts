/**
 * Text-to-speech for `POST /api/tts`.
 *
 * Gemini's TTS models are not part of the agent loop, so they are reached with a
 * plain `fetch` against the Generative Language REST API. This is what the
 * `@google/genai` client did under the hood; calling the endpoint directly keeps
 * the behaviour and removes the dependency.
 *
 * The models answer with raw 16-bit PCM, which browsers cannot play on their own,
 * so the payload is wrapped in a WAV container before it leaves the server.
 */

const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Model used for narration, overridable with `GEMINI_TTS_MODEL_ID`. */
export const DEFAULT_TTS_MODEL_ID = 'gemini-3.1-flash-tts-preview';

/** Voices assigned to the two speakers of the narration. */
export const SPEECH_CONFIG = [
  { speaker: 'Speaker 1', language: 'en-us', voice: 'kore' },
  { speaker: 'Speaker 2', language: 'en-us', voice: 'aoede' },
] as const;

/** Sample rate of the PCM stream Gemini returns, in Hz. */
export const PCM_SAMPLE_RATE = 24000;

export interface SynthesizedSpeech {
  audio: Buffer;
  mimeType: string;
}

/** Failure of a synthesis request, with the status to answer the client with. */
export class TextToSpeechError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TextToSpeechError';
  }
}

/**
 * Narrates `text` and returns playable audio.
 *
 * @throws {TextToSpeechError} when the credential is missing, the API rejects the
 * request, or the answer carries no audio.
 */
export async function synthesizeSpeech(text: string): Promise<SynthesizedSpeech> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new TextToSpeechError(500, 'GEMINI_API_KEY is not configured on the server.');
  }

  const response = await fetch(`${API_BASE_URL}/interactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      model: process.env.GEMINI_TTS_MODEL_ID || DEFAULT_TTS_MODEL_ID,
      input: text,
      response_modalities: ['audio'],
      generation_config: { speech_config: SPEECH_CONFIG },
    }),
  });

  if (!response.ok) {
    // The upstream body stays in the server log: the client only needs to know
    // that narration failed and whether it is worth retrying.
    const detail = await response.text().catch(() => '');
    console.error(`[tts] Upstream rejected the request: ${response.status} ${detail.slice(0, 500)}`);
    throw new TextToSpeechError(
      response.status === 429 ? 429 : 502,
      'The narration service rejected the request.',
    );
  }

  const audio = extractAudio(await response.json());
  if (audio === null) {
    throw new TextToSpeechError(502, 'Failed to generate audio content.');
  }

  return audio;
}

/* ────────────────────────────────────────────────────────── */
/*  Response parsing                                           */
/* ────────────────────────────────────────────────────────── */

interface AudioContent {
  type?: string;
  data?: string;
  mime_type?: string;
}

/** Pulls the first audio part out of the interaction and makes it playable. */
export function extractAudio(payload: unknown): SynthesizedSpeech | null {
  const steps = (payload as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) return null;

  for (const step of steps) {
    if ((step as { type?: string })?.type !== 'model_output') continue;

    const content = (step as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content as AudioContent[]) {
      if (part?.type !== 'audio' || typeof part.data !== 'string' || !part.data) continue;

      const buffer = Buffer.from(part.data, 'base64');
      const mimeType = part.mime_type;

      // Anything already in a container is passed through untouched; bare PCM
      // gets a WAV header so an `<audio>` element can play it.
      if (!mimeType || mimeType.startsWith('audio/l16')) {
        return { audio: wrapPcmAsWav(buffer), mimeType: 'audio/wav' };
      }
      return { audio: buffer, mimeType };
    }
  }

  return null;
}

/**
 * Prepends a 44-byte canonical WAV header to mono 16-bit PCM samples.
 */
export function wrapPcmAsWav(pcm: Buffer, sampleRate = PCM_SAMPLE_RATE): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
