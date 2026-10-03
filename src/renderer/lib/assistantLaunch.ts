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

type LaunchOwner = { id: string; workspacePath: string; environmentId?: string };

/** The captured initiating workspace, if it still exists with the same identity. */
function currentLaunchOwner(owner: LaunchOwner) {
  const current = useWorkspaceStore.getState().getWorkspaceById(owner.id);
  return current && isSameWorkspaceIdentity(
    { path: owner.workspacePath, environmentId: owner.environmentId },
    { path: current.workspacePath, environmentId: current.environmentId },
  ) ? current : undefined;
}

/**
 * Asynchronous selection authority: a launch result may move the user's selection only while the
 * workspace that initiated it still exists with the same identity AND is still the active workspace.
 * Explicit clicks (e.g. Focus existing) call focusWorkspaceTerminal directly and are not subject to this.
 */
function ownerHasSelectionAuthority(owner: LaunchOwner): boolean {
  return !!currentLaunchOwner(owner) && useWorkspaceStore.getState().activeWorkspaceId === owner.id;
}

/** Capture ownership before the IPC await; UI unmounting must not orphan the PTY. */
export async function attachAssistantTerminal(result: AssistantLaunchResult, owner: LaunchOwner) {
  if (result.action === 'focus') {
    // The terminal belongs to an earlier request, so this request never closes it. It stays available
    // through "Focus existing"; a stale response must not override newer user intent.
    if (!currentLaunchOwner(owner)) throw new Error('Launch workspace was closed or replaced.');
    if (!ownerHasSelectionAuthority(owner)) return;
    if (!focusWorkspaceTerminal(result.workspaceId, result.terminalId)) throw new Error('Owned terminal is unavailable. Refresh profiles and try again.');
    return;
  }
  const current = currentLaunchOwner(owner);
  if (result.workspaceId !== owner.id || !current) {
    await window.electronAPI.killTerminal(result.terminalId);
    throw new Error('Launch workspace was closed or replaced. The new terminal was closed.');
  }
  if (!current.terminals.some((terminal) => terminal.id === result.terminalId)) useWorkspaceStore.getState().addTerminal({
    id: result.terminalId, pid: result.pid, workingDir: current.workspacePath,
    environmentId: current.environmentId || 'local', workspaceId: current.id,
    harnessId: result.harnessId, attentionEnabled: result.attentionEnabled,
  }, owner.id);
  // A late launch may populate its original workspace, but cannot steal newer selection.
  if (ownerHasSelectionAuthority(owner)) focusWorkspaceTerminal(owner.id, result.terminalId);
}
