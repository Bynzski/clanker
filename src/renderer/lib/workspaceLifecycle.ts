import type { WorkspaceTab } from '../store/workspaceStore';

export async function terminateWorkspaceTerminals(workspace: WorkspaceTab): Promise<void> {
  for (const terminal of workspace.terminals) {
    try {
      await window.electronAPI.killTerminal(terminal.id);
    } catch (err) {
      console.error('Failed to kill terminal:', err);
    }
  }

  // Final sweep: ensure all terminals are cleaned up even if some kill IPC calls failed
  const terminalIds = workspace.terminals.map((t) => t.id);
  if (terminalIds.length > 0) {
    try {
      await window.electronAPI.cleanupWorkspaceTerminals(terminalIds);
    } catch (err) {
      console.error('Failed to cleanup workspace terminals:', err);
    }
  }
}
