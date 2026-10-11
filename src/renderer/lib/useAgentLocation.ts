import type { AgentAttentionSnapshot, AgentLocation } from '../../shared/types/agentAttention';
import { useAgentAttentionStore } from '../store/agentAttentionStore';

export function useAgentSnapshot(terminalId: string | null | undefined): AgentAttentionSnapshot | null {
  return useAgentAttentionStore((state) => terminalId ? state.byTerminalId[terminalId] ?? null : null);
}

/** The location one terminal's agent last reported (main resolved its checkout context), or null. */
export function useAgentLocation(terminalId: string | null | undefined): AgentLocation | null {
  return useAgentAttentionStore((state) => (terminalId ? state.byTerminalId[terminalId]?.location ?? null : null));
}
