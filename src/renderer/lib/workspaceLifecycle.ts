import type { WorkspaceTab } from '../store/workspaceStore';
import { markTerminalDisposed } from '../components/TerminalPane';

export async function terminateWorkspaceTerminals(workspace: WorkspaceTab): Promise<void> {
  for (const terminal of workspace.terminals) {
    try {
      markTerminalDisposed(terminal.id);
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

interface DisposeWorkspaceResourcesOptions {
  isActiveWorkspace: boolean;
}

export async function disposeWorkspaceResources(
  workspace: WorkspaceTab,
  options: DisposeWorkspaceResourcesOptions,
): Promise<void> {
  if (options.isActiveWorkspace && typeof window.electronAPI?.explorerStopWatching === 'function') {
    try {
      await window.electronAPI.explorerStopWatching();
    } catch (err) {
      console.error('Failed to stop explorer watcher:', err);
    }
  }

  await terminateWorkspaceTerminals(workspace);

  if (typeof window.electronAPI?.browserDisposeWorkspace === 'function') {
    try {
      await window.electronAPI.browserDisposeWorkspace(workspace.id);
      return;
    } catch (err) {
      console.error('Failed to dispose browser workspace:', err);
    }
  }

  if (typeof window.electronAPI?.browserHide === 'function') {
    try {
      await window.electronAPI.browserHide(workspace.id);
    } catch (err) {
      console.error('Failed to hide browser workspace:', err);
    }
  }
}
