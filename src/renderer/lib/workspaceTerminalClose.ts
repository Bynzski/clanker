import { markTerminalDisposed } from './terminalRuntimeCache';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useNotificationStore } from '../store/notificationStore';

/** Identity is captured before the await, including when the terminal has no mounted visible pane. */
export async function closeWorkspaceTerminal(workspaceId: string, terminalId: string): Promise<void> {
  const state = useWorkspaceStore.getState();
  const workspace = state.getWorkspaceById(workspaceId);
  const legacy = !state.workspaces.length && state.activeWorkspaceId === null;
  const terminals = workspace?.terminals ?? (legacy ? state.terminals : []);
  if (!terminals.some((terminal) => terminal.id === terminalId)) return;
  const paneId = (workspace?.panes ?? state.panes).find((pane) => pane.terminalId === terminalId)?.id;
  try {
    await window.electronAPI.killTerminal(terminalId);
    markTerminalDisposed(terminalId);
    const live = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
    if (live?.terminals.some((terminal) => terminal.id === terminalId) || (legacy && !useWorkspaceStore.getState().workspaces.length)) {
      useWorkspaceStore.getState().removeTerminal(terminalId);
      if (legacy && paneId) useWorkspaceStore.getState().removePane(paneId);
    }
  } catch (error) {
    console.error('Failed to kill terminal:', error);
    useNotificationStore.getState().show({ tone: 'warning', workspaceId, message: `Could not close terminal: ${error instanceof Error ? error.message : String(error)}` });
  }
}
