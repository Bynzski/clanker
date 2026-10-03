import type { AssistantLaunchResult } from '../../shared/types/assistants';
import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';
import { useWorkspaceStore } from '../store/workspaceStore';
import { markTerminalDisposed } from '../components/TerminalPane';

/** A user-requested close ends the owned PTY; hiding or switching never calls this. */
export async function closeAssistantTerminal(workspaceId: string, terminalId: string) {
  const original = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
  if (!original?.terminals.some((terminal) => terminal.id === terminalId)) throw new Error('Owned terminal is unavailable. Refresh profiles and try again.');
  const result = await window.electronAPI.killTerminal(terminalId);
  if (!result.success) throw new Error('Terminal could not be closed.');
  markTerminalDisposed(terminalId);
  const state = useWorkspaceStore.getState();
  const current = state.getWorkspaceById(workspaceId);
  if (current && isSameWorkspaceIdentity(
    { path: current.workspacePath, environmentId: current.environmentId },
    { path: original.workspacePath, environmentId: original.environmentId },
  )) state.removeTerminal(terminalId, workspaceId);
}

export function focusWorkspaceTerminal(workspaceId: string, terminalId: string): boolean {
  const state = useWorkspaceStore.getState();
  if (!state.getWorkspaceById(workspaceId)?.terminals.some((terminal) => terminal.id === terminalId)) return false;
  state.selectWorkspace(workspaceId, terminalId);
  return true;
}

/** Capture ownership before the IPC await; UI unmounting must not orphan the PTY. */
export async function attachAssistantTerminal(result: AssistantLaunchResult, owner: { id: string; workspacePath: string; environmentId?: string }) {
  const state = useWorkspaceStore.getState();
  if (result.action === 'focus') {
    if (!focusWorkspaceTerminal(result.workspaceId, result.terminalId)) throw new Error('Owned terminal is unavailable. Refresh profiles and try again.');
    return;
  }
  const current = state.getWorkspaceById(owner.id);
  if (result.workspaceId !== owner.id || !current || !isSameWorkspaceIdentity(
    { path: owner.workspacePath, environmentId: owner.environmentId },
    { path: current.workspacePath, environmentId: current.environmentId },
  )) {
    await window.electronAPI.killTerminal(result.terminalId);
    throw new Error('Launch workspace was closed or replaced. The new terminal was closed.');
  }
  if (!current.terminals.some((terminal) => terminal.id === result.terminalId)) state.addTerminal({
    id: result.terminalId, pid: result.pid, workingDir: current.workspacePath,
    environmentId: current.environmentId || 'local', workspaceId: current.id,
    harnessId: result.harnessId, attentionEnabled: result.attentionEnabled,
  }, owner.id);
  // A late launch may populate its original workspace, but cannot steal newer selection.
  if (useWorkspaceStore.getState().activeWorkspaceId === owner.id) focusWorkspaceTerminal(owner.id, result.terminalId);
}
