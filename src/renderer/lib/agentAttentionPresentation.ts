import type { NativeAttentionCapability } from '../../shared/types/attentionSignal';
import { CircleAlert, CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import type { AgentAttentionSnapshot } from '../../shared/types/agentAttention';
import type { AttentionSeen } from '../store/agentAttentionStore';

/** What an agent's attention indicator shows; `null` view means nothing is shown. */
export type AttentionDisplay = 'running' | 'needs_input' | 'failed' | 'turn_complete' | 'signal_unavailable' | 'signal_degraded';

export interface AttentionView {
  display: AttentionDisplay;
  /** Needs-input or completion the user has not acknowledged yet. */
  unseen: boolean;
  description?: string;
}

/**
 * Pure projection of canonical facts onto presentation. It never correlates sessions, infers
 * turn boundaries or replays events. Precedence: a pending request, then active work, then a
 * proven failure, then a completion that is both the latest outcome and not yet acknowledged.
 * Because active work outranks completion, an old completion needs no explicit clearing, and
 * because Done requires the latest outcome to be that completion, an older one can never
 * resurface after a newer turn was interrupted, failed or ended.
 */
export function deriveAttention(
  snapshot: AgentAttentionSnapshot | undefined,
  seen: AttentionSeen | undefined,
  capability?: NativeAttentionCapability,
): AttentionView | null {
  const signal = snapshot?.signal ?? capability;
  if (signal && !signal.requested) return null;
  if (signal?.attachment === 'unavailable') return { display: 'signal_unavailable', unseen: false, description: `Native attention unavailable: ${signal.reason ?? 'preparation-failed'}` };
  if (snapshot?.signal?.health === 'degraded' || snapshot?.signal?.health === 'lost') return {
    display: 'signal_degraded', unseen: false, description: `Native attention ${snapshot.signal.health}: ${snapshot.signal.reason ?? 'unknown'}`,
  };
  if (!snapshot) return null;
  const { pendingRequest, runtime, lastCompletion, lastOutcome } = snapshot;
  if (pendingRequest) return { display: 'needs_input', unseen: pendingRequest.revision > (seen?.request ?? 0) };
  if (runtime.status === 'starting' || runtime.status === 'running') return { display: 'running', unseen: false };
  if (runtime.status === 'failed') return { display: 'failed', unseen: false };
  if (runtime.status === 'idle' && lastCompletion && lastOutcome?.kind === 'completed'
    && lastOutcome.revision === lastCompletion.revision && lastCompletion.revision > (seen?.completion ?? 0)) {
    return { display: 'turn_complete', unseen: true };
  }
  return null;
}

/** Shared label/icon semantics for a displayed attention state. */
export function getAttentionPresentation(display: AttentionDisplay) {
  switch (display) {
    case 'signal_unavailable': return { label: 'Native attention unavailable', Icon: CircleAlert };
    case 'signal_degraded': return { label: 'Native attention degraded', Icon: CircleAlert };
    case 'needs_input': return { label: 'Needs input', Icon: CircleAlert };
    case 'turn_complete': return { label: 'Turn complete', Icon: CircleCheck };
    case 'failed': return { label: 'Failed', Icon: CircleX };
    case 'running': return { label: 'Running', Icon: LoaderCircle };
  }
}

/** Tooltip/name suffix for an agent, e.g. " · Running"; empty while idle. */
export function getAttentionSuffix(view: AttentionView | null): string {
  return view ? ` · ${getAttentionPresentation(view.display).label}` : '';
}
