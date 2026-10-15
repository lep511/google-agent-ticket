/**
 * Live check of the Strands + Claude Opus 5.5 integration: builds the same agent
 * the server uses, with the `calculate` tool, and streams one run through the
 * configured transport (Bedrock unless `ANTHROPIC_API_KEY` is set).
 *
 * Usage: `npm run smoke:claude`
 */
import { createStrandsAgent, streamStrandsAgent } from '../server/lib/model/strandsAgent.ts';
import { createCalculatorTool } from '../server/lib/tools/calculatorTool.ts';
import { resolveClaudeProvider, resolveClaudeModelId, toBedrockModelId } from '../server/lib/model/claudeProvider.ts';

const provider = resolveClaudeProvider();
const modelId = resolveClaudeModelId();
console.log(`provider=${provider} model=${provider === 'bedrock' ? toBedrockModelId(modelId) : modelId}`);

const agent = createStrandsAgent({
  systemPrompt: 'You are a terse assistant. Use the calculate tool for any arithmetic. Answer with one short sentence.',
  tools: [createCalculatorTool()],
});

const seen: Record<string, number> = {};
let text = '';
let thinking = '';
const started = Date.now();
for await (const ev of streamStrandsAgent(agent, 'What is 1234 * 5678? Use the tool, then state the result.')) {
  seen[ev.type] = (seen[ev.type] ?? 0) + 1;
  if (ev.type === 'text') text += ev.text;
  if (ev.type === 'thinking') thinking += ev.text;
  if (ev.type === 'tool_call') console.log('tool_call:', ev.name, JSON.stringify(ev.arguments));
  if (ev.type === 'tool_result') console.log('tool_result:', String(ev.result).slice(0, 120));
  if (ev.type === 'complete') console.log('complete:', JSON.stringify(ev.interaction));
}
console.log('events:', JSON.stringify(seen));
console.log('thinking chars:', thinking.length, thinking ? `| preview: ${thinking.slice(0, 100).replace(/\n/g, ' ')}` : '');
console.log('text:', text.trim());
console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
