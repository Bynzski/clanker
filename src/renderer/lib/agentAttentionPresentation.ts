import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import type { TerminalAttention } from '../store/agentAttentionStore';

/** What an agent's attention indicator shows; `null` means nothing is shown. */
export type AttentionDisplay = 'running' | 'needs_input' | 'turn_complete';

/**
 * Idle agents show nothing. A working agent spins; one waiting on a question stays
 * yellow until it is unblocked; a finished turn is green only until it has been seen
 * (focusing the agent acknowledges it), after which the agent is idle again.
 */
export function getAttentionDisplay(attention: TerminalAttention | undefined): AttentionDisplay | null {
  switch (attention?.lifecycle) {
    case 'running': return 'running';
    case 'needs_input': return 'needs_input';
    case 'turn_complete': return attention.unseen ? 'turn_complete' : null;
    default: return null;
  }
}

/** Shared label/icon semantics for a displayed attention state. */
export function getAttentionPresentation(display: AttentionDisplay) {
  switch (display) {
    case 'needs_input': return { label: 'Needs input', Icon: CircleAlert };
    case 'turn_complete': return { label: 'Turn complete', Icon: CircleCheck };
    case 'running': return { label: 'Running', Icon: LoaderCircle };
  }
}

/** Tooltip/name suffix for an agent, e.g. " · Running"; empty while idle. */
export function getAttentionSuffix(attention: TerminalAttention | undefined): string {
  const display = getAttentionDisplay(attention);
  return display ? ` · ${getAttentionPresentation(display).label}` : '';
}
