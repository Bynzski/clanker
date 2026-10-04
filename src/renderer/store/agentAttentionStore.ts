import { create } from 'zustand';
import type { AgentAttentionChange, AgentAttentionSnapshot } from '../../shared/types/agentAttention';
import { deriveAttention } from '../lib/agentAttentionPresentation';

/** UI acknowledgement watermarks: revisions of the canonical facts the user has already seen.
 * They never feed back into lifecycle; a later completion or request carries a higher revision
 * and so is unseen again. */
export interface AttentionSeen {
  completion: number;
  request: number;
}

/**
 * Cache of main's canonical attention snapshots plus UI-only acknowledgement. There is no
 * lifecycle logic here: main (the broker) decides what happened, this store only keeps the
 * newest revision it has been told about. A retirement is remembered as a revision with no
 * snapshot, so a stale in-flight or hydrated snapshot cannot resurrect an exited agent.
 */
interface AgentAttentionState {
  byTerminalId: Record<string, AgentAttentionSnapshot>;
  /** Newest accepted revision per terminal, including retirements. */
  revisionByTerminalId: Record<string, number>;
  seenByTerminalId: Record<string, AttentionSeen>;
  /** Accept an equal or newer revision; `foreground` panes acknowledge what they are already showing. */
  applyChange: (change: AgentAttentionChange, foreground: boolean) => void;
  /** Merge a full hydration set by the same revision ordering as pushes. */
  hydrate: (snapshots: AgentAttentionSnapshot[], isForeground: (terminalId: string) => boolean) => void;
  acknowledge: (terminalId: string) => void;
  /** The terminal or its agent is gone locally: drop the snapshot, keep the revision floor. */
  retire: (terminalId: string) => void;
}

function acknowledged(snapshot: AgentAttentionSnapshot, seen: AttentionSeen | undefined): AttentionSeen | undefined {
  const completion = Math.max(seen?.completion ?? 0, snapshot.lastCompletion?.revision ?? 0);
  const request = Math.max(seen?.request ?? 0, snapshot.pendingRequest?.revision ?? 0);
  if (seen && seen.completion === completion && seen.request === request) return seen;
  return completion === 0 && request === 0 ? seen : { completion, request };
}

type Slice = Pick<AgentAttentionState, 'byTerminalId' | 'revisionByTerminalId' | 'seenByTerminalId'>;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function merge(state: Slice, change: AgentAttentionChange, foreground: boolean): Slice {
  const known = state.revisionByTerminalId[change.terminalId];
  if (known !== undefined && change.revision < known) return state;
  const revisionByTerminalId = { ...state.revisionByTerminalId, [change.terminalId]: change.revision };
  if (!change.snapshot) {
    return {
      byTerminalId: without(state.byTerminalId, change.terminalId),
      revisionByTerminalId,
      seenByTerminalId: without(state.seenByTerminalId, change.terminalId),
    };
  }
  const seen = foreground ? acknowledged(change.snapshot, state.seenByTerminalId[change.terminalId]) : state.seenByTerminalId[change.terminalId];
  return {
    byTerminalId: { ...state.byTerminalId, [change.terminalId]: change.snapshot },
    revisionByTerminalId,
    seenByTerminalId: seen ? { ...state.seenByTerminalId, [change.terminalId]: seen } : state.seenByTerminalId,
  };
}

export const useAgentAttentionStore = create<AgentAttentionState>((set) => ({
  byTerminalId: {},
  revisionByTerminalId: {},
  seenByTerminalId: {},
  applyChange: (change, foreground) => set((state) => merge(state, change, foreground)),
  hydrate: (snapshots, isForeground) => set((state) => {
    let next: Slice = state;
    for (const snapshot of snapshots) {
      next = merge(next, { terminalId: snapshot.terminalId, revision: snapshot.revision, snapshot }, isForeground(snapshot.terminalId));
    }
    return next === state ? state : { ...state, ...next };
  }),
  acknowledge: (terminalId) => set((state) => {
    const snapshot = state.byTerminalId[terminalId];
    if (!snapshot) return state;
    const current = state.seenByTerminalId[terminalId];
    const seen = acknowledged(snapshot, current);
    if (!seen || seen === current) return state;
    return { seenByTerminalId: { ...state.seenByTerminalId, [terminalId]: seen } };
  }),
  retire: (terminalId) => set((state) => {
    if (!state.byTerminalId[terminalId] && !state.seenByTerminalId[terminalId]) return state;
    return merge(state, { terminalId, revision: state.revisionByTerminalId[terminalId] ?? 0, snapshot: null }, false);
  }),
}));

/** Workspace aggregate of unseen attention, projected through the shared selector. */
export function attentionCounts(
  terminalIds: string[],
  byTerminalId: Record<string, AgentAttentionSnapshot>,
  seenByTerminalId: Record<string, AttentionSeen>,
): { needsInput: number; completed: number } {
  let needsInput = 0;
  let completed = 0;
  for (const id of terminalIds) {
    const view = deriveAttention(byTerminalId[id], seenByTerminalId[id]);
    if (!view?.unseen) continue;
    if (view.display === 'needs_input') needsInput++;
    if (view.display === 'turn_complete') completed++;
  }
  return { needsInput, completed };
}
