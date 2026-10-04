import { useMemo } from 'react';
import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { deriveAttention, type AttentionView } from './agentAttentionPresentation';

/** Presentation of one terminal's canonical attention snapshot. */
export function useTerminalAttention(terminalId: string | null | undefined): AttentionView | null {
  const snapshot = useAgentAttentionStore((state) => terminalId ? state.byTerminalId[terminalId] : undefined);
  const seen = useAgentAttentionStore((state) => terminalId ? state.seenByTerminalId[terminalId] : undefined);
  return useMemo(() => deriveAttention(snapshot, seen), [snapshot, seen]);
}
