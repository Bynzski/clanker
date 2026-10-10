import type { NativeAttentionCapability } from '../shared/types/attentionSignal';
import type { TerminalSpawnResolved } from './environment/workspaceEnvironment';
import { findHarnessProvider } from './harnesses/registry';

/** Remote results prove acquisition only. The broker separately records actual signal receipt. */
export function remoteAttentionCapability(harness: string, requested: boolean, available: boolean, result?: Pick<TerminalSpawnResolved, 'attention' | 'attentionEnabled'>): NativeAttentionCapability {
  if (!requested) return { requested, attachment: 'disabled' };
  if (!findHarnessProvider(harness)?.attention?.remote) return { requested, attachment: 'unavailable', reason: 'unsupported' };
  if (!available) return { requested, attachment: 'unavailable', reason: 'transport-unavailable' };
  return result?.attention ?? { requested, attachment: result?.attentionEnabled ? 'prepared' : 'unavailable', ...(result?.attentionEnabled ? {} : { reason: 'preparation-failed' as const }) };
}
