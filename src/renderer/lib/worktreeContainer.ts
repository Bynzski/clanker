import { dirnamePath, joinPaths, normalizePath, sameWorkspacePath } from './pathUtils';
import { getWorkspaceNameFromPath } from './workspaceLabels';
import type { GitWorktree } from '../../shared/types/git';

/** Return the repository that owns a generated container, when Git confirms one. */
export async function findGeneratedWorktreeContainerOwner(directoryPath: string): Promise<string | null> {
  const containerPath = normalizePath(directoryPath);
  const containerName = getWorkspaceNameFromPath(containerPath);
  if (!containerName.endsWith('-worktrees') || containerName.length <= '-worktrees'.length) return null;

  const repositoryName = containerName.slice(0, -'-worktrees'.length);
  const repositoryPath = joinPaths(dirnamePath(containerPath), repositoryName);
  try {
    const selectedWorktrees = await window.electronAPI.gitListWorktrees(containerPath);
    if (selectedWorktrees.success && selectedWorktrees.worktrees.some((entry: GitWorktree) => sameWorkspacePath(entry.path, containerPath))) return null;

    const [repositoryState, listed] = await Promise.all([
      window.electronAPI.gitGetBranchState(repositoryPath),
      window.electronAPI.gitListWorktrees(repositoryPath),
    ]);
    if (!repositoryState.success || !repositoryState.isRepo || !listed.success) return null;
    const main = listed.worktrees.find((entry: GitWorktree) => entry.isMain);
    if (!main || !sameWorkspacePath(main.path, repositoryPath)) return null;
    return listed.worktrees.some((entry: GitWorktree) => !entry.isMain && sameWorkspacePath(dirnamePath(entry.path), containerPath))
      ? repositoryPath
      : null;
  } catch {
    return null;
  }
}
