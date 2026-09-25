import { create } from 'zustand';
import type { AgentAttentionUpdate } from '../../shared/types/agentAttention';

export type AgentLifecycle = 'unknown' | 'running' | 'needs_input' | 'turn_complete';
export interface TerminalAttention {
  lifecycle: AgentLifecycle;
  unseen: boolean;
  updatedAt: number;
  sessionId?: string;
  turnId?: string;
}

interface AgentAttentionState {
  byTerminalId: Record<string, TerminalAttention>;
  applyUpdate: (update: AgentAttentionUpdate, foreground: boolean) => void;
  acknowledge: (terminalId: string) => void;
  markExited: (terminalId: string) => void;
  remove: (terminalId: string) => void;
}

const UNKNOWN: TerminalAttention = { lifecycle: 'unknown', unseen: false, updatedAt: 0 };

export const useAgentAttentionStore = create<AgentAttentionState>((set) => ({
  byTerminalId: {},
  applyUpdate: (update, foreground) => set((state) => {
    const previous = state.byTerminalId[update.terminalId] ?? UNKNOWN;
    if (previous.sessionId && update.sessionId && previous.sessionId !== update.sessionId) {
      // Completion-only adapters can establish a new TUI session without a start event.
      // Resolution and end events cannot establish the new session's state.
      if (update.event === 'input_resolved' || update.event === 'session_ended') return state;
    }
    let lifecycle: AgentLifecycle;
    switch (update.event) {
      case 'turn_started': lifecycle = 'running'; break;
      case 'input_requested': lifecycle = 'needs_input'; break;
      case 'input_resolved':
        if (previous.lifecycle !== 'needs_input') return state;
        lifecycle = 'running';
        break;
      case 'turn_completed': lifecycle = 'turn_complete'; break;
      case 'session_ended': lifecycle = 'unknown'; break;
    }
    const unseen = (lifecycle === 'needs_input' || lifecycle === 'turn_complete') && !foreground;
    return { byTerminalId: { ...state.byTerminalId, [update.terminalId]: {
      lifecycle, unseen, updatedAt: Date.now(),
      ...(update.sessionId ? { sessionId: update.sessionId } : previous.sessionId ? { sessionId: previous.sessionId } : {}),
      ...(update.turnId ? { turnId: update.turnId } : {}),
    } } };
  }),
  acknowledge: (terminalId) => set((state) => {
    const current = state.byTerminalId[terminalId];
    if (!current?.unseen) return state;
    return { byTerminalId: { ...state.byTerminalId, [terminalId]: { ...current, unseen: false } } };
  }),
  markExited: (terminalId) => set((state) => {
    const current = state.byTerminalId[terminalId];
    if (!current) return state;
    return { byTerminalId: { ...state.byTerminalId, [terminalId]: { ...current, lifecycle: 'unknown', unseen: false } } };
  }),
  remove: (terminalId) => set((state) => {
    if (!state.byTerminalId[terminalId]) return state;
    const next = { ...state.byTerminalId };
    delete next[terminalId];
    return { byTerminalId: next };
  }),
}));

export function attentionCounts(
  terminalIds: string[],
  byTerminalId: Record<string, TerminalAttention>,
): { needsInput: number; completed: number } {
  let needsInput = 0;
  let completed = 0;
  for (const id of terminalIds) {
    const attention = byTerminalId[id];
    if (!attention?.unseen) continue;
    if (attention.lifecycle === 'needs_input') needsInput++;
    if (attention.lifecycle === 'turn_complete') completed++;
  }
  return { needsInput, completed };
}
