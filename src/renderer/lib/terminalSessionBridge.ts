import { installAttentionDiagnostics } from './attentionDiagnostics';
import { deriveAttention } from './agentAttentionPresentation';
import type { AgentAttentionChange } from '../../shared/types/agentAttention';
import type { AttentionReceipt } from '../../shared/types/attentionReceipt';
import { writeCachedTerminalData, writeCachedTerminalExit } from './terminalRuntimeCache';
import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { paneIsPresented } from '../store/workspacePages';
import { useAssistantNavStore } from '../store/assistantNavStore';

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

/** Observe the shared presentation selector; never alter lifecycle or acknowledgement. */
function reportAttentionReceipt(change: AgentAttentionChange, foreground: boolean, prior: number | undefined, priorSnapshot: boolean): void {
  const report = window.electronAPI.reportAgentAttentionReceipt;
  if (!report) return;
  const store = useAgentAttentionStore.getState();
  const terminal = useWorkspaceStore.getState().workspaces.flatMap(workspace => workspace.terminals).find(entry => entry.id === change.terminalId);
  const snapshot = store.byTerminalId[change.terminalId];
  const merge: AttentionReceipt['merge'] = prior !== undefined && change.revision < prior ? 'older'
    : prior === change.revision && change.snapshot && !priorSnapshot ? 'tombstone'
    : prior === change.revision ? 'equal' : 'applied';
  const eligible = Boolean(terminal?.harnessId && ((snapshot?.signal ?? terminal.attention)?.requested ?? terminal.attentionEnabled));
  try {
    report({ terminalId: change.terminalId, receivedRevision: change.revision,
      storedRevision: store.revisionByTerminalId[change.terminalId] ?? null,
      snapshotPresent: Boolean(snapshot), foreground, merge,
      indicator: eligible ? deriveAttention(snapshot, store.seenByTerminalId[change.terminalId], terminal?.attention)?.display ?? 'none' : 'none' });
  } catch { /* Diagnostic delivery must never interfere with terminal state. */ }
}

/**
 * Keep terminal output and attention flowing even when the owning workspace is unmounted.
 * TerminalPane caches xterm across switches; these IPC subscriptions belong at app level.
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

  // Main owns the lifecycle. Subscribe first, then hydrate: revision ordering in the store makes
  // the two safe in either arrival order, and a recreated renderer recovers the live state.
  // A change the user is watching (focused window, presented active pane) is seen on arrival; any
  // other completion or wait lights up until the user goes to that agent.
  if (typeof window.electronAPI?.onAgentAttentionChanged === 'function') {
    const isForeground = (terminalId: string): boolean => windowHasFocus() && presentedActiveTerminalId() === terminalId;
    disposers.push(window.electronAPI.onAgentAttentionChanged((change) => {
      const store = useAgentAttentionStore.getState();
      const prior = store.revisionByTerminalId[change.terminalId];
      const priorSnapshot = Boolean(store.byTerminalId[change.terminalId]);
      const foreground = isForeground(change.terminalId);
      store.applyChange(change, foreground);
      reportAttentionReceipt(change, foreground, prior, priorSnapshot);
    }));
    if (typeof window.electronAPI.getAgentAttentionSnapshots === 'function') {
      let disposed = false;
      disposers.push(() => { disposed = true; });
      // Captured after subscribing and before the request: anything newer than this wins.
      const baseline = useAgentAttentionStore.getState().baseline();
      void window.electronAPI.getAgentAttentionSnapshots()
        .then((snapshots) => {
          if (disposed || !Array.isArray(snapshots)) return;
          const prior = useAgentAttentionStore.getState();
          prior.hydrate(snapshots, isForeground, baseline);
          for (const snapshot of snapshots) reportAttentionReceipt({ terminalId: snapshot.terminalId, revision: snapshot.revision, snapshot }, isForeground(snapshot.terminalId), prior.revisionByTerminalId[snapshot.terminalId], Boolean(prior.byTerminalId[snapshot.terminalId]));
        })
        .catch(() => undefined);
    }
  }

  const reportCached = (id: string | null) => {
    if (!id) return;
    const store = useAgentAttentionStore.getState();
    const revision = store.revisionByTerminalId[id];
    if (revision === undefined) return;
    const snapshot = store.byTerminalId[id];
    reportAttentionReceipt({ terminalId: id, revision, snapshot: snapshot ?? null }, windowHasFocus() && presentedActiveTerminalId() === id, revision, Boolean(snapshot));
  };
  // Also record presentation changes caused by acknowledgement/focus, not only broker pushes.
  disposers.push(useAgentAttentionStore.subscribe((state, previous) => {
    for (const id of Object.keys(state.revisionByTerminalId)) {
      if (state.seenByTerminalId[id] !== previous.seenByTerminalId[id]) reportCached(id);
    }
  }));
  const onWindowBlur = () => reportCached(presentedActiveTerminalId());
  window.addEventListener('blur', onWindowBlur);
  disposers.push(() => window.removeEventListener('blur', onWindowBlur));

  // Returning to the window is going to the agent on screen: clear what it was showing.
  const onWindowFocus = () => {
    const terminalId = presentedActiveTerminalId();
    if (terminalId) useAgentAttentionStore.getState().acknowledge(terminalId);
    reportCached(terminalId);
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
    if (active?.activeTerminalId !== prior?.activeTerminalId || active?.id !== prior?.id || active?.pages !== prior?.pages) {
      reportCached(prior?.activeTerminalId ?? null);
      reportCached(active?.activeTerminalId ?? null);
    }
    const liveIds = new Set(state.workspaces.flatMap((workspace) => workspace.terminals.map((terminal) => terminal.id)));
    for (const workspace of previous.workspaces) {
      for (const terminal of workspace.terminals) {
        if (!liveIds.has(terminal.id)) useAgentAttentionStore.getState().retire(terminal.id);
      }
    }
  }));

  disposers.push(useAssistantNavStore.subscribe((state, previous) => {
    if (state.activeAssistantId !== previous.activeAssistantId) reportCached(useWorkspaceStore.getState().activeTerminalId);
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
