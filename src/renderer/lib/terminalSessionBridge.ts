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
      useAgentAttentionStore.getState().markExited(id);
    }));
  }

  if (typeof window.electronAPI?.onAgentAttentionUpdate === 'function') {
    disposers.push(window.electronAPI.onAgentAttentionUpdate((update) => {
      const state = useWorkspaceStore.getState();
      const workspace = state.workspaces.find((entry) => entry.terminals.some((terminal) => terminal.id === update.terminalId));
      const foreground = workspace?.id === state.activeWorkspaceId
        && workspace?.activeTerminalId === update.terminalId;
      useAgentAttentionStore.getState().applyUpdate(update, foreground);
    }));
  }

  disposers.push(useWorkspaceStore.subscribe((state, previous) => {
    if (state.activeWorkspaceId !== previous.activeWorkspaceId || state.activeTerminalId !== previous.activeTerminalId) {
      const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
      if (active?.activeTerminalId) useAgentAttentionStore.getState().acknowledge(active.activeTerminalId);
    }
    const liveIds = new Set(state.workspaces.flatMap((workspace) => workspace.terminals.map((terminal) => terminal.id)));
    for (const workspace of previous.workspaces) {
      for (const terminal of workspace.terminals) {
        if (!liveIds.has(terminal.id)) useAgentAttentionStore.getState().remove(terminal.id);
      }
    }
  }));

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
