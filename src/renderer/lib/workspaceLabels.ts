import type { WorkspaceTab } from '../store/workspaceTypes';
import { LOCAL_ENVIRONMENT_ID } from '../../shared/types/environments';

export function getWorkspaceNameFromPath(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[/\\]+$/, '');
  if (!trimmed) return 'Workspace';
  const baseName = trimmed.split(/[/\\]/).pop();
  return baseName && baseName.length > 0 ? baseName : 'Workspace';
}

type WorkspaceIdentity = Pick<
  WorkspaceTab,
  'name' | 'workspacePath' | 'isLinkedWorktree' | 'projectName' | 'gitCurrentBranch' | 'environmentId' | 'environmentLabel'
>;

export function getRemoteEnvironmentLabel(workspace: Pick<WorkspaceTab, 'environmentId' | 'environmentLabel'>): string | null {
  if (!workspace.environmentId || workspace.environmentId === LOCAL_ENVIRONMENT_ID) return null;
  const label = workspace.environmentLabel?.trim() || workspace.environmentId;
  return `SSH · ${label}`;
}

export function getWorkspaceProjectName(workspace: WorkspaceIdentity): string {
  if (workspace.projectName?.trim()) return workspace.projectName.trim();
  if (workspace.isLinkedWorktree) {
    const segments = workspace.workspacePath.replace(/[/\\]+$/, '').split(/[/\\]/);
    const parent = segments[segments.length - 2] ?? '';
    if (parent.endsWith('-worktrees') && parent.length > '-worktrees'.length) {
      return parent.slice(0, -'-worktrees'.length);
    }
  }
  return getWorkspaceNameFromPath(workspace.workspacePath);
}

export function getWorkspaceTabLabel(workspace: WorkspaceIdentity): string {
  const projectName = getWorkspaceProjectName(workspace);
  const name = workspace.name?.trim();
  if (!workspace.isLinkedWorktree) return name || projectName;
  const generatedName = getWorkspaceNameFromPath(workspace.workspacePath);
  if (!workspace.gitCurrentBranch && (!name || name === projectName || name === generatedName)) {
    const generated = /^(.*)-([0-9a-f]{20})$/i.exec(generatedName);
    const checkoutName = generated ? `${generated[2].slice(0, 8)} ${generated[1]}` : generatedName;
    return `${projectName} / ${checkoutName}`;
  }
  return name && name !== generatedName && name !== projectName
    ? `${projectName} / ${name}`
    : projectName;
}

/** Initial value for the inline rename editor of a workspace. */
export function getWorkspaceRenameValue(workspace: WorkspaceIdentity): string {
  const projectName = getWorkspaceProjectName(workspace);
  return workspace.isLinkedWorktree && workspace.name === getWorkspaceNameFromPath(workspace.workspacePath)
    ? projectName
    : workspace.name || projectName;
}
