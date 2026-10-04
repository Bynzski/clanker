import { writeCachedTerminalData, writeCachedTerminalExit } from '../components/TerminalPane';
import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Keep terminal output flowing even when the owning workspace is unmounted.
 *
 * TerminalPane keeps the xterm instance cached across workspace switches, but
 * the IPC listeners that receive PTY output need to live at the app level so
 * hidden workspaces still receive data and exit notifications.
 */
export function startTerminalSessionBridge(): () => void {
  const disposers: Array<() => void> = [];

  if (typeof window.electronAPI?.onTerminalData === 'function') {
    disposers.push(window.electronAPI.onTerminalData(({ id, data }) => {
      writeCachedTerminalData(id, data);
    }));
  }

  if (typeof window.electronAPI?.onTerminalExit === 'function') {
    disposers.push(window.electronAPI.onTerminalExit(({ id, exitCode }) => {
      writeCachedTerminalExit(id, exitCode);
      useAgentAttentionStore.getState().retire(id);
    }));
  }

  // Main owns the lifecycle. Subscribe first, then hydrate: revision ordering in the store makes
  // the two safe in either arrival order, and a recreated renderer recovers the live state.
  if (typeof window.electronAPI?.onAgentAttentionChanged === 'function') {
    const isForeground = (terminalId: string): boolean => {
      const state = useWorkspaceStore.getState();
      const workspace = state.workspaces.find((entry) => entry.terminals.some((terminal) => terminal.id === terminalId));
      return workspace?.id === state.activeWorkspaceId && workspace?.activeTerminalId === terminalId;
    };
    disposers.push(window.electronAPI.onAgentAttentionChanged((change) => {
      useAgentAttentionStore.getState().applyChange(change, isForeground(change.terminalId));
    }));
    if (typeof window.electronAPI.getAgentAttentionSnapshots === 'function') {
      let disposed = false;
      disposers.push(() => { disposed = true; });
      // Captured after subscribing and before the request: anything newer than this wins.
      const baseline = useAgentAttentionStore.getState().baseline();
      void window.electronAPI.getAgentAttentionSnapshots()
        .then((snapshots) => { if (!disposed && Array.isArray(snapshots)) useAgentAttentionStore.getState().hydrate(snapshots, isForeground, baseline); })
        .catch(() => undefined);
    }
  }

  disposers.push(useWorkspaceStore.subscribe((state, previous) => {
    if (state.activeWorkspaceId !== previous.activeWorkspaceId || state.activeTerminalId !== previous.activeTerminalId) {
      const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
      if (active?.activeTerminalId) useAgentAttentionStore.getState().acknowledge(active.activeTerminalId);
    }
    const liveIds = new Set(state.workspaces.flatMap((workspace) => workspace.terminals.map((terminal) => terminal.id)));
    for (const workspace of previous.workspaces) {
      for (const terminal of workspace.terminals) {
        if (!liveIds.has(terminal.id)) useAgentAttentionStore.getState().retire(terminal.id);
      }
    }
  }));

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
