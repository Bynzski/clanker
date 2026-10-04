import type { AgentAttentionChange, AgentAttentionSnapshot } from '../../src/shared/types/agentAttention';

export type SnapshotKind = 'unverified' | 'idle' | 'starting' | 'running' | 'needs_input' | 'approval' | 'completed' | 'interrupted' | 'failed';

/** Canonical snapshot fixture. The facts mirror what the broker produces for each situation. */
export function snapshot(terminalId: string, kind: SnapshotKind, revision = 1, overrides: Partial<AgentAttentionSnapshot> = {}): AgentAttentionSnapshot {
  const base: AgentAttentionSnapshot = {
    terminalId, revision, sessionId: 'S',
    runtime: { status: 'unverified', turnId: null, startedAt: null },
    pendingRequest: null, lastCompletion: null, lastOutcome: null, location: null,
  };
  switch (kind) {
    case 'unverified': return { ...base, sessionId: null, ...overrides };
    case 'idle': return { ...base, runtime: { status: 'idle', turnId: null, startedAt: null }, ...overrides };
    case 'starting': return { ...base, runtime: { status: 'starting', turnId: null, startedAt: 1 }, ...overrides };
    case 'running': return { ...base, runtime: { status: 'running', turnId: 'T', startedAt: 1 }, ...overrides };
    case 'needs_input':
    case 'approval':
      return {
        ...base, runtime: { status: 'running', turnId: 'T', startedAt: 1 },
        pendingRequest: { id: 'w', turnId: 'T', kind: kind === 'approval' ? 'approval' : 'input', evidence: 'structured', revision, createdAt: 1 },
        ...overrides,
      };
    case 'completed':
      return {
        ...base, runtime: { status: 'idle', turnId: null, startedAt: null },
        lastCompletion: { turnId: 'T', revision, completedAt: 2 }, lastOutcome: { kind: 'completed', turnId: 'T', revision, at: 2 },
        ...overrides,
      };
    case 'interrupted':
      return { ...base, runtime: { status: 'idle', turnId: null, startedAt: null }, lastOutcome: { kind: 'interrupted', turnId: 'T', revision, at: 2 }, ...overrides };
    case 'failed':
      return { ...base, runtime: { status: 'failed', turnId: null, startedAt: null }, lastOutcome: { kind: 'failed', turnId: 'T', revision, at: 2 }, ...overrides };
  }
}

export const change = (value: AgentAttentionSnapshot): AgentAttentionChange => ({ terminalId: value.terminalId, revision: value.revision, snapshot: value });
export const tombstone = (terminalId: string, revision: number): AgentAttentionChange => ({ terminalId, revision, snapshot: null });

/** Seed the renderer store directly with canonical snapshots (and optional acknowledgement). */
export function storeState(snapshots: AgentAttentionSnapshot[], seen: Record<string, { completion: number; request: number }> = {}) {
  return {
    byTerminalId: Object.fromEntries(snapshots.map((s) => [s.terminalId, s])),
    revisionByTerminalId: Object.fromEntries(snapshots.map((s) => [s.terminalId, s.revision])),
    seenByTerminalId: seen,
  };
}
export const EMPTY_ATTENTION = { byTerminalId: {}, revisionByTerminalId: {}, seenByTerminalId: {} };
