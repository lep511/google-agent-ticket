/**
 * Event contract shared by the agent runner, the SSE endpoint and the browser.
 *
 * The union used to live in `agentClient.ts`, next to the remote Gemini Managed
 * Agents client. That client is gone: agents now run in-process with the Strands
 * Agents SDK, so the contract lives on its own and no longer belongs to any
 * particular transport.
 */

/** Token accounting of a run, in the shape the frontend already reads. */
export interface AgentUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface AgentEvent {
  type:
    | "thinking"
    | "text"
    | "tool_call"
    | "tool_result"
    | "complete"
    | "error"
    | "done";
  text?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  callId?: string;
  result?: string;
  interaction?: Record<string, unknown>;
  message?: string;
}
