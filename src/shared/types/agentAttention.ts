/** Lifecycle decisions already approved by the main-process broker. The
 * renderer projects these; it never correlates sessions or turns itself. */
export type AgentAttentionEvent =
  | 'turn_started'
  | 'input_requested'
  | 'input_resolved'
  | 'turn_completed'
  /** Native root-session boundary; the agent process and its PTY remain alive. */
  | 'session_ended'
  /** The harness process exited to the fallback shell; attention is retired. */
  | 'agent_exited';

export interface AgentAttentionUpdate {
  terminalId: string;
  event: AgentAttentionEvent;
}
