import type { AgentLocation } from '../../shared/types/agentAttention';
import { useAgentAttentionStore } from '../store/agentAttentionStore';

/** The location one terminal's agent last reported (main resolved its checkout context), or null. */
export function useAgentLocation(terminalId: string | null | undefined): AgentLocation | null {
  return useAgentAttentionStore((state) => (terminalId ? state.byTerminalId[terminalId]?.location ?? null : null));
}
