/**
 * Tool registry: maps declared tool names to their factory functions.
 *
 * Agents declare which tools they need in their manifest.json via the optional
 * `tools` array (e.g. `"tools": ["search_web", "calculate"]`). At run time the
 * registry resolves those names into Strands SDK tool instances, so adding a
 * new agent with tool access requires no changes to server.ts.
 */

import type { ToolList } from '@strands-agents/sdk';

import { createBraveSearchTool } from './braveSearchTool.ts';
import { createCalculatorTool } from './calculatorTool.ts';

export type ToolFactory = () => ToolList[number];

const TOOL_FACTORIES: Record<string, ToolFactory> = {
  search_web: createBraveSearchTool,
  calculate: createCalculatorTool,
};

export const KNOWN_TOOL_NAMES = Object.keys(TOOL_FACTORIES);

/**
 * Returns true if the name corresponds to a registered tool factory.
 */
export function isKnownToolName(name: unknown): name is string {
  return typeof name === 'string' && name in TOOL_FACTORIES;
}

/**
 * Resolves an array of tool name strings into Strands tool instances.
 * Unknown names are silently skipped (validated at manifest load time).
 */
export function resolveAgentTools(toolNames: readonly string[]): ToolList {
  const tools: ToolList = [];
  for (const name of toolNames) {
    const factory = TOOL_FACTORIES[name];
    if (factory) tools.push(factory());
  }
  return tools;
}
