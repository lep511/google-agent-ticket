/**
 * NVIDIA NIM provider via the OpenAI-compatible endpoint.
 *
 * Connects to https://integrate.api.nvidia.com/v1 using the Strands SDK
 * `OpenAIModel` in Chat Completions mode. Any model hosted on NVIDIA NIM can
 * be selected via the `NVIDIA_MODEL_ID` env var or the request `model` field.
 *
 * Auth: `NVIDIA_API_KEY` (an NVIDIA NGC API key).
 */

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export const DEFAULT_NVIDIA_MODEL_ID = 'nvidia/llama-3.1-nemotron-ultra-253b-v1';

const NVIDIA_MODEL_ID_PATTERN = /^[a-z0-9_-]+\/[a-z0-9._-]{1,100}$/i;

export function isNvidiaConfigured(): boolean {
  return Boolean(process.env.NVIDIA_API_KEY);
}

export function resolveNvidiaModelId(requested?: unknown): string {
  const candidates = [requested, process.env.NVIDIA_MODEL_ID];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (NVIDIA_MODEL_ID_PATTERN.test(trimmed)) return trimmed;
  }

  return DEFAULT_NVIDIA_MODEL_ID;
}
