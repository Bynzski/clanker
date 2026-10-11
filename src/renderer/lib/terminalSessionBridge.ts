import { installAttentionDiagnostics } from './attentionDiagnostics';
import { writeCachedTerminalData, writeCachedTerminalExit } from './terminalRuntimeCache';
import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { paneIsPresented } from '../store/workspacePages';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { applyAgentCheckoutTransition } from './agentCheckoutTransition';

/** The user can only be looking at an agent while the Clanker window itself has focus. */
const windowHasFocus = (): boolean => typeof document.hasFocus !== 'function' || document.hasFocus();

/** The terminal the user is looking at right now, if any: active workspace, active pane, presented page. */
function presentedActiveTerminalId(): string | null {
  if (useAssistantNavStore.getState().activeAssistantId) return null;
  const state = useWorkspaceStore.getState();
  const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
  const pane = active?.panes.find((entry) => entry.terminalId === active.activeTerminalId);
  return active?.activeTerminalId && pane && (!active.pages || paneIsPresented(active, pane.id)) ? active.activeTerminalId : null;
}

/**
 * Keep terminal output flowing even when the owning workspace is unmounted.
 *
 * TerminalPane keeps the xterm instance cached across workspace switches, but
 * the IPC listeners that receive PTY output need to live at the app level so
 * hidden workspaces still receive data and exit notifications.
 */
export function startTerminalSessionBridge(): () => void {
  const disposers: Array<() => void> = [installAttentionDiagnostics()];

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
  // A change the user is watching (focused window, presented active pane) is seen on arrival; any
  // other completion or wait lights up until the user goes to that agent.
  if (typeof window.electronAPI?.onAgentAttentionChanged === 'function') {
    const isForeground = (terminalId: string): boolean => windowHasFocus() && presentedActiveTerminalId() === terminalId;
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

  // Returning to the window is going to the agent on screen: clear what it was showing.
  const onWindowFocus = () => {
    const terminalId = presentedActiveTerminalId();
    if (terminalId) useAgentAttentionStore.getState().acknowledge(terminalId);
  };
  window.addEventListener('focus', onWindowFocus);
  disposers.push(() => window.removeEventListener('focus', onWindowFocus));

  disposers.push(useWorkspaceStore.subscribe((state, previous) => {
    const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    const prior = previous.workspaces.find((workspace) => workspace.id === previous.activeWorkspaceId);
    if (!useAssistantNavStore.getState().activeAssistantId && active?.activeTerminalId && windowHasFocus()) {
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
    if (!previous.activeAssistantId || state.activeAssistantId || !windowHasFocus()) return;
    const terminalId = presentedActiveTerminalId();
    if (terminalId) useAgentAttentionStore.getState().acknowledge(terminalId);
  }));

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
