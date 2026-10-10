import { getAttentionPresentation, type AttentionView } from '../lib/agentAttentionPresentation';
import './AgentAttentionIndicators.css';

/** Lifecycle icon for one agent terminal; renders nothing while the agent is idle. */
export function AgentAttentionState({ attention, name }: { attention: AttentionView | null; name: string }) {
  if (!attention) return null;
  const { display } = attention;
  const { label, Icon } = getAttentionPresentation(display);
  return (
    <span
      className={`agent-attention-state state-${display}${attention.unseen ? ' unseen' : ''}`}
      role="img"
      aria-label={`${name}: ${label}`}
      title={attention.description ?? label}
    >
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

/** Aggregate unseen attention for a workspace; renders nothing when there is none. */
export function WorkspaceAttentionBadge({ counts }: { counts: { needsInput: number; completed: number } }) {
  if (counts.needsInput === 0 && counts.completed === 0) return null;
  return (
    <span
      className={`workspace-attention-badge ${counts.needsInput > 0 ? 'needs-input' : 'complete'}`}
      aria-label={`${counts.needsInput} agents need input, ${counts.completed} turns complete`}
      title={`${counts.needsInput} need input · ${counts.completed} complete`}
    >
      {counts.needsInput > 0 ? `! ${counts.needsInput}` : `✓ ${counts.completed}`}
    </span>
  );
}
