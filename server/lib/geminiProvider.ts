/**
 * Single place where the server builds a Gemini client.
 *
 * The models are reached through the Vercel AI SDK provider (`@ai-sdk/google`),
 * which the Strands `VercelModel` adapter wraps. That is what lets this project
 * run agents on Gemini without depending on `@google/genai`: the AI SDK provider
 * talks to the Generative Language REST API directly.
 *
 * Docs: https://strandsagents.com/docs/user-guide/concepts/model-providers/vercel/
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';

/** Model the agents run on when nothing overrides it. Matches the UI label. */
export const DEFAULT_GEMINI_MODEL_ID = 'gemini-3.6-flash';

/**
 * Model used by the `google_search` tool for its grounded lookups.
 *
 * Grounding is billed and rate-limited apart from plain generation, so the
 * retrieval step gets its own knob and a cheaper default than the agent loop.
 */
export const DEFAULT_GEMINI_SEARCH_MODEL_ID = 'gemini-2.5-flash';

/** Accepted shape of a Gemini model id, used to validate untrusted input. */
const MODEL_ID_PATTERN = /^gemini-[a-z0-9.-]{1,60}$/;

/** True when the server has the credential the Gemini provider needs. */
export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Provider bound to `GEMINI_API_KEY`.
 *
 * The key is read on every call rather than at import time, so tests and the
 * `dotenv` bootstrap in `server.ts` can set it after this module is loaded.
 */
export function createGeminiProvider() {
  return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });
}

/**
 * Resolves the model id of a run: an explicit request value wins, then
 * `GEMINI_MODEL_ID`, then the default. Values that are not a Gemini model id are
 * ignored instead of reaching the API, since `model` arrives from the request
 * body.
 */
export function resolveGeminiModelId(requested?: unknown): string {
  const candidates = [requested, process.env.GEMINI_MODEL_ID];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (MODEL_ID_PATTERN.test(trimmed)) return trimmed;
  }

  return DEFAULT_GEMINI_MODEL_ID;
}

/** Model id of the grounded search tool, from `GEMINI_SEARCH_MODEL_ID`. */
export function resolveGeminiSearchModelId(): string {
  const configured = process.env.GEMINI_SEARCH_MODEL_ID;
  if (typeof configured === 'string' && MODEL_ID_PATTERN.test(configured.trim())) {
    return configured.trim();
  }
  return DEFAULT_GEMINI_SEARCH_MODEL_ID;
}
