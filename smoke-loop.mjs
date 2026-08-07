import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { createStrandsAgent, streamStrandsAgent } from './server/lib/strandsAgent.ts';

// Log every request body sent to Gemini, to inspect the conversation shape.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('generativelanguage') && init?.body) {
    const body = JSON.parse(init.body);
    console.log('--- REQUEST ---');
    console.log(JSON.stringify(body.contents ?? body, null, 1).slice(0, 2500));
  }
  const res = await realFetch(input, init);
  if (!res.ok) console.log('!!! HTTP', res.status, (await res.clone().text()).slice(0, 400));
  return res;
};

const fakeSearch = tool({
  name: 'google_search',
  description: 'Searches the web.',
  inputSchema: z.object({ query: z.string() }),
  callback: ({ query }) => ({
    query,
    answer: `Result for ${query}: revenue was 25.2 billion dollars on 2026-07-23.`,
    sources: [{ title: 'ir.tesla.com', url: 'https://ir.tesla.com/press' }],
  }),
});

const agent = createStrandsAgent({
  systemPrompt: 'You are a research agent. Use google_search for every claim.',
  modelId: 'gemini-2.5-flash',
  tools: [fakeSearch],
});

for await (const event of streamStrandsAgent(
  agent,
  'Run two separate google_search calls about TSLA revenue, then answer in one sentence.'
)) {
  console.log(event.type, JSON.stringify(event).slice(0, 160));
}
