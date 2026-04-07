import type { WorkspaceTab } from '../store/workspaceStore';

export async function terminateWorkspaceTerminals(workspace: WorkspaceTab): Promise<void> {
  for (const terminal of workspace.terminals) {
    try {
      await window.electronAPI.killTerminal(terminal.id);
    } catch (err) {
      console.error('Failed to kill terminal:', err);
    }
  }
}
