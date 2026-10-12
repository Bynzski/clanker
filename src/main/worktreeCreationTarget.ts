import type { GitCreateWorktreeOptions, GitWorktreeListResult } from '../shared/types/git';
import type { RegisteredWorkspace, WorkspaceRegistry } from './workspaceRegistry';
import { adoptListedWorktree, findListedWorktree } from './worktreeContextAttachment';

/** Resolve a new branch's immutable commit from main's registered project or explicitly validated Git entry. */
export async function resolveNewWorktreeBase(params: {
  registry: WorkspaceRegistry;
  workspace: RegisteredWorkspace;
  options: NonNullable<GitCreateWorktreeOptions['newBranch']>;
  listWorktrees(): Promise<GitWorktreeListResult>;
  getProjectHead(): Promise<string>;
}): Promise<string> {
  const { registry, workspace, options, listWorktrees } = params;
  const source = options.baseWorktree;
  let commit: string;
  if (source !== undefined) {
    if (!source || typeof source.path !== 'string' || (source.branch !== null && typeof source.branch !== 'string')) throw new Error('Invalid base worktree');
    const adopted = await adoptListedWorktree({ registry, workspace, worktreePath: source.path, expectedBranch: source.branch, listWorktrees });
    if (!adopted.success || !adopted.checkoutContext) throw new Error(adopted.error || 'Base worktree is unavailable');
    const listing = await listWorktrees();
    const entry = listing.success ? findListedWorktree(listing, workspace.location.environmentId, adopted.checkoutContext.path) : null;
    if (!entry || entry.isLocked || entry.isPrunable || entry.branch !== source.branch || !entry.head) throw new Error('Base worktree changed or has no committed HEAD');
    commit = entry.head;
  } else {
    commit = await params.getProjectHead();
  }
  if (registry.getWorkspace(workspace.workspaceId) !== workspace) throw new Error('Workspace changed before worktree creation');
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) throw new Error('Base HEAD does not resolve to a commit');
  return commit;
}
