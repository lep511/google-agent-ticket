import type { VercelRequest, VercelResponse } from '@vercel/node';
import { agentRegistry } from '../server/lib/agent/agentRegistry.ts';
import { buildAgentCatalogHttpResult } from '../server/lib/agent/agentCatalog.ts';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const { status, body } = buildAgentCatalogHttpResult(agentRegistry);
  res.status(status).json(body);
}
