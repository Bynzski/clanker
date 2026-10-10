import type { NativeAttentionCapability } from '../../shared/types/attentionSignal';
import { CircleAlert, CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import type { AgentAttentionSnapshot } from '../../shared/types/agentAttention';
import type { AttentionSeen } from '../store/agentAttentionStore';

/** What an agent's attention indicator shows; `null` view means nothing is shown. */
export type AttentionDisplay = 'provisional' | 'running' | 'needs_input' | 'failed' | 'turn_complete' | 'signal_unavailable' | 'signal_degraded';

export interface AttentionView {
  display: AttentionDisplay;
  /** Needs-input or completion the user has not acknowledged yet. */
  unseen: boolean;
  description?: string;
  signalWarning?: string;
}

/**
 * Pure projection of canonical facts onto presentation. It never correlates sessions, infers
 * turn boundaries or replays events. A provisional stop explicitly supersedes work/wait claims.
 * Otherwise precedence: an actionable request, then active work, then a
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
  const warning = signal?.attachment === 'unavailable'
    ? `Native attention unavailable: ${signal.reason ?? 'preparation-failed'}`
    : snapshot?.signal?.health === 'degraded' || snapshot?.signal?.health === 'lost'
      ? `Native attention ${snapshot.signal.health}: ${snapshot.signal.reason ?? 'unknown'}` : undefined;
  let view: AttentionView | null = null;
  if (snapshot) {
    const { pendingRequest, runtime, lastCompletion, lastOutcome } = snapshot;
    if (runtime.status === 'provisional') view = { display: 'provisional', unseen: false, description: pendingRequest
      ? 'A candidate Stop was observed; execution may continue; request resolution and final outcome are unknown. Check the agent terminal.'
      : 'A candidate Stop was observed; execution may continue. Final outcome is unknown. Check the agent terminal.' };
    else if (pendingRequest && !pendingRequest.resolutionUnknown) view = { display: 'needs_input', unseen: pendingRequest.revision > (seen?.request ?? 0) };
    else if (runtime.status === 'starting' || runtime.status === 'running') view = { display: 'running', unseen: false };
    else if (runtime.status === 'failed') view = { display: 'failed', unseen: false };
    else if (runtime.status === 'idle' && lastCompletion && lastOutcome?.kind === 'completed'
      && lastOutcome.revision === lastCompletion.revision && lastCompletion.revision > (seen?.completion ?? 0)) {
      view = { display: 'turn_complete', unseen: true };
    }
  }
  if (view) return warning ? { ...view, signalWarning: warning, description: `${view.description ?? getAttentionPresentation(view.display).label} · ${warning}` } : view;
  if (warning) return { display: signal?.attachment === 'unavailable' ? 'signal_unavailable' : 'signal_degraded', unseen: false, description: warning };
  return null;
}

/** Shared label/icon semantics for a displayed attention state. */
export function getAttentionPresentation(display: AttentionDisplay) {
  switch (display) {
    case 'provisional': return { label: 'Stop observed · outcome unknown', Icon: CircleAlert };
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
