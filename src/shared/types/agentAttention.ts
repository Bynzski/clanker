export type AgentAttentionEvent =
  | 'turn_started'
  | 'input_requested'
  | 'input_resolved'
  | 'turn_completed'
  | 'session_ended';

export interface AgentAttentionUpdate {
  terminalId: string;
  event: AgentAttentionEvent;
  sessionId?: string;
  turnId?: string;
}
