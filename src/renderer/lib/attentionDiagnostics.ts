import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { paneIsPresented } from '../store/workspacePages';
import { deriveAttention } from './agentAttentionPresentation';

/** Query-only developer view. Nothing here alters authority, acknowledges a turn or starts a timer. */
export async function explainTerminalAttention(terminalId: string) {
  const main = await window.electronAPI.getAgentAttentionDiagnostics(terminalId);
  if (!main) return null; // Main enforces the debug gate too.
  const store = useAgentAttentionStore.getState();
  const state = useWorkspaceStore.getState();
  const workspace = state.workspaces.find((entry) => entry.terminals.some((terminal) => terminal.id === terminalId));
  const terminal = workspace?.terminals.find((entry) => entry.id === terminalId);
  const snapshot = store.byTerminalId[terminalId];
  const seen = store.seenByTerminalId[terminalId];
  const view = deriveAttention(snapshot, seen, terminal?.attention);
  const pane = workspace?.panes.find((entry) => entry.terminalId === terminalId);
  const capability = snapshot?.signal ?? terminal?.attention;
  const eligible = Boolean(terminal?.harnessId && (capability?.requested ?? terminal.attentionEnabled));
  const revision = store.revisionByTerminalId[terminalId] ?? null;
  const mainRevision = main.main?.revision ?? null;
  return {
    ...main,
    renderer: {
      revision, snapshotPresent: Boolean(snapshot), tombstone: revision !== null && !snapshot,
      comparison: mainRevision === null ? 'no-main-registration' : revision === null || revision < mainRevision ? 'renderer-behind' : revision === mainRevision ? 'current' : 'renderer-newer-or-retired',
      runtime: snapshot?.runtime.status ?? null, signal: snapshot?.signal ?? null,
      indicator: eligible ? view?.display ?? null : null,
      suppressed: !eligible ? 'capability-disabled-or-terminal-absent' : view ? null
        : snapshot?.runtime.status === 'idle' && snapshot.lastCompletion && (seen?.completion ?? 0) >= snapshot.lastCompletion.revision ? 'acknowledged-idle'
        : snapshot ? 'no-displayable-lifecycle-fact' : 'no-snapshot',
      workspaceMember: Boolean(workspace), residency: workspace?.runtimeState.residencyState ?? null,
      terminalPanePresented: Boolean(workspace && pane && workspace.id === state.activeWorkspaceId && !useAssistantNavStore.getState().activeAssistantId && paneIsPresented(workspace, pane.id)),
    },
  };
}

export function installAttentionDiagnostics(): () => void {
  let disposed = false;
  const api = { explain: explainTerminalAttention };
  void window.electronAPI.isAttentionDebugEnabled?.().then((enabled) => {
    if (enabled && !disposed) window.clankerAttention = api;
  }).catch(() => undefined);
  return () => { disposed = true; if (window.clankerAttention === api) delete window.clankerAttention; };
}
