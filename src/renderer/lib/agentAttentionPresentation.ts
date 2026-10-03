import { CircleAlert, CircleCheck, CircleDot, CircleHelp } from 'lucide-react';
import type { AgentLifecycle } from '../store/agentAttentionStore';

/** Shared label/icon semantics for an agent's attention lifecycle. */
export function getAttentionPresentation(lifecycle: AgentLifecycle | undefined) {
  switch (lifecycle) {
    case 'needs_input': return { label: 'Needs input', Icon: CircleAlert };
    case 'turn_complete': return { label: 'Turn complete', Icon: CircleCheck };
    case 'running': return { label: 'Running', Icon: CircleDot };
    default: return { label: 'Unknown', Icon: CircleHelp };
  }
}
