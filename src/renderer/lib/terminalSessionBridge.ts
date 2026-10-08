import { writeCachedTerminalData, writeCachedTerminalExit } from './terminalRuntimeCache';
import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { paneIsPresented } from '../store/workspacePages';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { applyAgentCheckoutTransition } from './agentCheckoutTransition';

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

  // Main moved a conversation to another checkout: the pane adopts its replacement (this arrives before
  // the old terminal's exit, so the exit is for a terminal the store no longer has).
  if (typeof window.electronAPI?.onAgentCheckoutTransition === 'function') {
    disposers.push(window.electronAPI.onAgentCheckoutTransition(applyAgentCheckoutTransition));
  }

  // Main owns the lifecycle. Subscribe first, then hydrate: revision ordering in the store makes
  // the two safe in either arrival order, and a recreated renderer recovers the live state.
  if (typeof window.electronAPI?.onAgentAttentionChanged === 'function') {
    const isForeground = (terminalId: string): boolean => {
      const state = useWorkspaceStore.getState();
      const workspace = state.workspaces.find((entry) => entry.terminals.some((terminal) => terminal.id === terminalId));
      const pane = workspace?.panes.find((entry) => entry.terminalId === terminalId);
      return !useAssistantNavStore.getState().activeAssistantId && workspace?.id === state.activeWorkspaceId
        && workspace?.activeTerminalId === terminalId && Boolean(pane && (!workspace.pages || paneIsPresented(workspace, pane.id)));
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
    const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    const prior = previous.workspaces.find((workspace) => workspace.id === previous.activeWorkspaceId);
    if (!useAssistantNavStore.getState().activeAssistantId && active?.activeTerminalId) {
      const pane = active.panes.find((entry) => entry.terminalId === active.activeTerminalId);
      const wasVisible = prior?.id === active.id && prior.activeTerminalId === active.activeTerminalId
        && prior.panes.some((entry) => entry.terminalId === active.activeTerminalId && (!prior.pages || paneIsPresented(prior, entry.id)));
      if (!wasVisible && pane && (!active.pages || paneIsPresented(active, pane.id))) useAgentAttentionStore.getState().acknowledge(active.activeTerminalId);
    }
    const liveIds = new Set(state.workspaces.flatMap((workspace) => workspace.terminals.map((terminal) => terminal.id)));
    for (const workspace of previous.workspaces) {
      for (const terminal of workspace.terminals) {
        if (!liveIds.has(terminal.id)) useAgentAttentionStore.getState().retire(terminal.id);
      }
    }
  }));

  disposers.push(useAssistantNavStore.subscribe((state, previous) => {
    if (!previous.activeAssistantId || state.activeAssistantId) return;
    const workspaceState = useWorkspaceStore.getState();
    const active = workspaceState.workspaces.find((workspace) => workspace.id === workspaceState.activeWorkspaceId);
    const pane = active?.panes.find((entry) => entry.terminalId === active.activeTerminalId);
    if (active?.activeTerminalId && pane && (!active.pages || paneIsPresented(active, pane.id))) useAgentAttentionStore.getState().acknowledge(active.activeTerminalId);
  }));

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
