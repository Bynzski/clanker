import type { NativeAttentionCapability } from '../../shared/types/attentionSignal';
import { useMemo } from 'react';
import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { deriveAttention, type AttentionView } from './agentAttentionPresentation';

/** Presentation of one terminal's canonical attention snapshot. */
export function useTerminalAttention(terminalId: string | null | undefined, capability?: NativeAttentionCapability, legacyEnabled?: boolean): AttentionView | null {
  const snapshot = useAgentAttentionStore((state) => terminalId ? state.byTerminalId[terminalId] : undefined);
  const seen = useAgentAttentionStore((state) => terminalId ? state.seenByTerminalId[terminalId] : undefined);
  return useMemo(() => deriveAttention(snapshot, seen, capability ?? (legacyEnabled === undefined ? undefined : { requested: legacyEnabled, attachment: legacyEnabled ? 'prepared' : 'disabled' })), [snapshot, seen, capability, legacyEnabled]);
}
