import { getAttentionPresentation } from '../lib/agentAttentionPresentation';
import type { TerminalAttention } from '../store/agentAttentionStore';
import './AgentAttentionIndicators.css';

/** Lifecycle icon for one agent terminal. */
export function AgentAttentionState({ attention, name }: { attention: TerminalAttention | undefined; name: string }) {
  const { label, Icon } = getAttentionPresentation(attention?.lifecycle);
  return (
    <span
      className={`agent-attention-state state-${attention?.lifecycle ?? 'unknown'} ${attention?.unseen ? 'unseen' : ''}`}
      role="img"
      aria-label={`${name}: ${label}`}
      title={label}
    >
      <Icon size={15} strokeWidth={2} aria-hidden="true" />
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
