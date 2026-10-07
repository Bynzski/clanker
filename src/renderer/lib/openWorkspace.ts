import { isSameWorkspaceIdentity, normalizeWorkspacePath } from '../../shared/workspaceIdentity';
import type { GitWorktree } from '../../shared/types/git';
import type { WorkspaceLocation } from '../../shared/types/environments';
import { createMainCheckoutContext, mainCheckoutContextId } from '../../shared/checkoutContext';
import { useWorkspaceStore } from '../store/workspaceStore';
import { createDefaultEditorState, createDefaultExplorerState, createDefaultNotesState, DEFAULT_RUNTIME_STATE } from '../store/workspaceStoreHelpers';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { getWorkspaceNameFromPath } from './workspaceLabels';
import { findGeneratedWorktreeContainerOwner } from './worktreeContainer';

export function workspaceLocation(workspace: WorkspaceTab): WorkspaceLocation {
  return { environmentId: workspace.environmentId || 'local', path: workspace.workspacePath };
}
export function findOpenWorkspace(location: WorkspaceLocation, workspaces = useWorkspaceStore.getState().workspaces): WorkspaceTab | undefined {
  return workspaces.find((workspace) => isSameWorkspaceIdentity(workspaceLocation(workspace), location));
}
export async function unregisterWorkspaceShell(workspace: WorkspaceTab): Promise<void> {
  await window.electronAPI.unregisterOpenWorkspace(workspace.id).catch((error: unknown) => {
    console.error('Could not unregister prepared workspace:', error);
  });
}

/** Revalidate identity through main. This prepares authority and an empty shell, never runtime work. */
export async function prepareWorkspaceShell(location: WorkspaceLocation): Promise<WorkspaceTab> {
  const id = crypto.randomUUID();
  let registered = false;
  try {
    const registration = await window.electronAPI.registerOpenWorkspace(id, location.path, location.environmentId);
    if (!registration.success) throw new Error(registration.error || 'Could not register workspace');
    registered = true;
    if (!registration.location?.path || registration.location.environmentId !== location.environmentId) {
      throw new Error('Workspace registration returned an unexpected environment or no canonical path');
    }
    const canonicalPath = registration.location.path;
    if (location.environmentId === 'local') {
      const owner = await findGeneratedWorktreeContainerOwner(canonicalPath);
      if (owner) throw new Error(`This folder holds worktrees for ${getWorkspaceNameFromPath(owner)}. Choose a checkout inside it, or open the repository and use New isolated agent.`);
    }
    // Non-Git directories are valid workspaces. Lookup failure conveys no checkout metadata.
    const listed = await window.electronAPI.gitListWorktrees(canonicalPath, id).catch(() => null);
    const linked = listed?.success ? listed.worktrees.find((entry: GitWorktree) => !entry.isMain && isSameWorkspaceIdentity(
      { environmentId: location.environmentId, path: entry.path }, registration.location!,
    )) : undefined;
    const mainPath = listed?.success ? listed.worktrees.find((entry: GitWorktree) => entry.isMain)?.path : undefined;
    const context = registration.checkoutContext ?? createMainCheckoutContext({ workspaceId: id, environmentId: location.environmentId, path: canonicalPath });
    if (context.id !== mainCheckoutContextId(id) || context.workspaceId !== id || context.environmentId !== location.environmentId || !isSameWorkspaceIdentity(context, registration.location)) {
      throw new Error('Workspace registration returned an invalid checkout context');
    }
    const environmentLabel = location.environmentId === 'local' ? 'Local'
      : await window.electronAPI.sshEnvironmentList().then((environments) => environments.find((environment) => environment.id === location.environmentId)?.label ?? location.environmentId)
        .catch(() => location.environmentId);
    const projectName = getWorkspaceNameFromPath(linked ? mainPath ?? canonicalPath : canonicalPath);
    return {
      ...createDefaultExplorerState(), ...createDefaultEditorState(), ...createDefaultNotesState(),
      id, lifecycle: 'parked', environmentId: location.environmentId, environmentLabel,
      name: projectName, projectName, workspacePath: canonicalPath, isLinkedWorktree: !!linked,
      checkoutContexts: [linked ? { ...context, kind: 'worktree', branch: linked.branch ?? null,
        ...(mainPath ? { mainCheckoutPath: normalizeWorkspacePath(mainPath) } : {}) } : context],
      harness: '', model: '', terminals: [], panes: [], activeTerminalId: null,
      browserVisible: false, browserOverlayCount: 0, browserUrl: 'https://github.com', browserPane: null,
      layoutRoot: null, gitCurrentBranch: linked?.branch ?? null, gitIsRepo: false, gitIsDetached: false,
      runtimeState: { ...DEFAULT_RUNTIME_STATE },
    };
  } catch (error) {
    if (registered) await window.electronAPI.unregisterOpenWorkspace(id).catch(() => undefined);
    throw error;
  }
}

/** Interactive open: duplicates select the live shell, including aliases canonicalized by main. */
export async function openWorkspace(location: WorkspaceLocation): Promise<WorkspaceTab> {
  let existing = findOpenWorkspace(location);
  if (existing) {
    useWorkspaceStore.getState().selectWorkspace(existing.id);
    return existing;
  }
  const shell = await prepareWorkspaceShell(location);
  existing = findOpenWorkspace(workspaceLocation(shell));
  if (existing) {
    await unregisterWorkspaceShell(shell);
    // Re-read after cleanup: another user action may have closed the duplicate.
    const live = findOpenWorkspace(workspaceLocation(shell));
    if (live) {
      useWorkspaceStore.getState().selectWorkspace(live.id);
      return live;
    }
    return openWorkspace(workspaceLocation(shell));
  }
  try {
    useWorkspaceStore.getState().addWorkspace(shell);
    return shell;
  } catch (error) {
    await unregisterWorkspaceShell(shell);
    throw error;
  }
}
