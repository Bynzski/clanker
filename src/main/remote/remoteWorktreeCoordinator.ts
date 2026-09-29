import { randomUUID } from 'node:crypto';
import type { GitWorktreeInspectionResult, GitWorktreeRemoveResult } from '../../shared/types/git';
import type { RegisteredWorkspace, WorkspaceRegistry } from '../workspaceRegistry';
import { validRemoteWorktreePath } from './sshWorktreeInspection';
import { remoteRemovalPaths } from './sshWorktreeRemoval';
import { isPathContained } from './remotePaths';

export class RemoteWorktreeCoordinator {
  private readonly pending = new Map<string, { workspace: RegisteredWorkspace; release: () => void; active: boolean }>();
  constructor(private readonly registry: () => WorkspaceRegistry | undefined,
    private readonly terminalPaths?: (environmentId: string) => string[] | null) {}

  private activity(workspace: RegisteredWorkspace): string[] | null {
    const terminals = this.terminalPaths ? this.terminalPaths(workspace.location.environmentId) : [];
    if (terminals === null) return null;
    return [...new Set([...terminals, ...(this.registry()?.getAllWorkspaces() ?? [])
      .filter((entry) => entry.location.environmentId !== 'local' && this.registry()?.getWorktreeResourceId(entry.location.environmentId) ===
        this.registry()?.getWorktreeResourceId(workspace.location.environmentId)).map((entry) => entry.location.path)])].sort();
  }

  public async inspect(workspace: RegisteredWorkspace, worktreePath: string): Promise<GitWorktreeInspectionResult> {
    if (!workspace.environment.inspectWorktree) return { success: false, error: 'Worktree inspection is unavailable for this environment' };
    if (!validRemoteWorktreePath(worktreePath)) return { success: false, error: 'Invalid remote worktree inspection path' };
    const before = this.activity(workspace);
    if (!before) return { success: false, error: 'An active SSH terminal directory could not be verified; stop it before inspection' };
    if (before.some((active) => isPathContained(worktreePath, active) || isPathContained(active, worktreePath))) {
      return { success: false, error: 'Close workspace tabs and stop active terminals using this checkout before removal' };
    }
    const result = await workspace.environment.inspectWorktree(workspace.location.path, worktreePath, before);
    if (this.registry()?.getWorkspace(workspace.workspaceId) !== workspace || JSON.stringify(before) !== JSON.stringify(this.activity(workspace))) {
      return { success: false, error: 'Workspace or terminal activity changed during inspection; inspect it again' };
    }
    return result;
  }

  public async remove(workspace: RegisteredWorkspace, worktreePath: string, expectedBranch: string | null): Promise<GitWorktreeRemoveResult> {
    if (!workspace.environment.removeWorktree || !workspace.environment.waitForWorktreeOperations) return { success: false, error: 'Remote worktree removal is unavailable for this environment' };
    if (!validRemoteWorktreePath(worktreePath) || (typeof expectedBranch !== 'string' && expectedBranch !== null)) return { success: false, error: 'Invalid remote worktree removal request' };
    const operationId = randomUUID();
    const { stagingPath, recoveryDirectory } = remoteRemovalPaths(worktreePath, operationId);
    const release = this.registry()?.reserveRemotePaths(workspace.location.environmentId, [worktreePath, stagingPath, recoveryDirectory]);
    if (!release) return { success: false, error: 'This worktree is being removed or awaiting completion verification; refresh worktrees' };
    const pending = { workspace, release, active: true };
    this.pending.set(operationId, pending);
    let uncertain = false;
    try {
      const inspection = await this.inspect(workspace, worktreePath);
      if (!inspection.success || !inspection.worktree) return { success: false, error: inspection.error || 'Could not inspect worktree' };
      if (inspection.hasChanges !== false) return { success: false, error: 'Worktree has uncommitted, untracked, or ignored files' };
      if (inspection.worktree.branch !== expectedBranch) return { success: false, error: 'Worktree branch changed; inspect it again' };
      const activity = this.activity(workspace);
      if (!activity) return { success: false, error: 'Active terminal directories could not be verified' };
      // No await between the final activity snapshot and dispatch. Registrations
      // and terminal spawns reject the reserved paths throughout the operation.
      uncertain = true;
      const result = await workspace.environment.removeWorktree(workspace.location.path, worktreePath, expectedBranch, activity, operationId);
      uncertain = result.uncertain === true;
      return { success: result.success, error: result.error, warning: result.warning, recoveryPath: result.recoveryPath };
    } catch (error) {
      return { success: false, error: `${error instanceof Error ? error.message : 'Remote removal failed'}${uncertain ? '\nRefresh worktrees to verify completion before reopening.' : ''}` };
    } finally {
      pending.active = false;
      if (!uncertain) { release(); this.pending.delete(operationId); }
    }
  }

  /** Release uncertain reservations only after the host journals completion. */
  public async reconcile(environmentId: string): Promise<void> {
    for (const [operationId, entry] of this.pending) {
      if (entry.active || this.registry()?.getWorktreeResourceId(entry.workspace.location.environmentId) !== this.registry()?.getWorktreeResourceId(environmentId)) continue;
      await entry.workspace.environment.waitForWorktreeOperations?.(entry.workspace.location.path, operationId);
      entry.release(); this.pending.delete(operationId);
    }
  }
}
