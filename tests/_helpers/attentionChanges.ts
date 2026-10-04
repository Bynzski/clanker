import type { AgentAttentionChange, AgentAttentionSnapshot } from '../../src/shared/types/agentAttention';

const active = (snapshot: AgentAttentionSnapshot): boolean => snapshot.runtime.status === 'starting' || snapshot.runtime.status === 'running';

/** Test-only coarse label for what one authoritative change did, derived from the snapshot pair.
 * Production code never does this: the renderer consumes snapshots directly. */
export function labelChange(previous: AgentAttentionSnapshot | null, change: AgentAttentionChange): string {
  const next = change.snapshot;
  if (!next) return 'agent_exited';
  if (next.lastOutcome && next.lastOutcome.revision !== previous?.lastOutcome?.revision) {
    return { completed: 'turn_completed', interrupted: 'turn_interrupted', failed: 'turn_failed', session_ended: 'session_ended' }[next.lastOutcome.kind];
  }
  if (active(next) && (!previous || !active(previous) || (next.runtime.turnId && next.runtime.turnId !== previous.runtime.turnId && previous.runtime.turnId))) {
    return previous && active(previous) && next.runtime.status === 'running' && previous.runtime.status === 'starting' ? 'turn_bound' : 'turn_started';
  }
  if (previous && active(previous) && previous.runtime.status === 'starting' && next.runtime.status === 'running') return 'turn_bound';
  if (!!next.pendingRequest !== !!previous?.pendingRequest) return next.pendingRequest ? 'input_requested' : 'input_resolved';
  if (next.sessionId !== (previous?.sessionId ?? null)) return previous?.sessionId ? 'session_continued' : 'session_bound';
  return 'changed';
}

/** Records every pushed change per terminal, with test-only labels. */
export function attentionRecorder() {
  const changes: AgentAttentionChange[] = [];
  const latest = new Map<string, AgentAttentionSnapshot | null>();
  const labels: string[] = [];
  return {
    changes,
    labels,
    onChange: (change: AgentAttentionChange) => {
      labels.push(labelChange(latest.get(change.terminalId) ?? null, change));
      latest.set(change.terminalId, change.snapshot);
      changes.push(change);
    },
    revisions: () => changes.map((change) => change.revision),
  };
}
