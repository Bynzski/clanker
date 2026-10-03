import { randomUUID } from 'node:crypto';
import type { GitWorktreeInspectionResult, GitWorktreeRemoveResult } from '../../shared/types/git';
import type { RegisteredWorkspace, WorkspaceRegistry } from '../workspaceRegistry';
import { validRemoteWorktreePath } from './sshWorktreeInspection';
import { remoteRemovalPaths } from './sshWorktreeRemoval';
import { isPathContained } from './remotePaths';
import type { RemoteWorktreeRemovalRecord } from '../../shared/types/store';

export interface RemoteWorktreeRemovalPersistence {
  read(): RemoteWorktreeRemovalRecord[];
  write(records: RemoteWorktreeRemovalRecord[]): void;
}

interface PendingRemoval {
  record: RemoteWorktreeRemovalRecord;
  workspace?: RegisteredWorkspace;
  release: () => void;
  active: boolean;
  persisted: boolean;
}

export class RemoteWorktreeCoordinator {
  private readonly pending = new Map<string, PendingRemoval>();
  private recoveryError?: string;

  public getRecoveryError(): string | undefined { return this.recoveryError; }

  private requireManualRecovery(): void {
    this.recoveryError = 'Manual recovery required: saved remote worktree removal state is invalid or conflicting. ' +
      'Preserve and inspect remoteWorktreeRemovals in the application store and the host completion journals before repairing it; ' +
      'do not reopen affected checkouts until host completion is verified. Remote worktree operations are blocked.';
  }

  constructor(private readonly registry: () => WorkspaceRegistry | undefined,
    private readonly terminalPaths?: (environmentId: string) => string[] | null,
    private readonly persistence?: RemoteWorktreeRemovalPersistence) {
    let records: RemoteWorktreeRemovalRecord[];
    try {
      records = persistence ? persistence.read() : [];
      if (!Array.isArray(records)) { this.requireManualRecovery(); return; }
    } catch { this.requireManualRecovery(); return; }
    for (const record of records) {
      if (!record || typeof record.operationId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(record.operationId) || typeof record.environmentId !== 'string' ||
          !record.environmentId || record.environmentId === 'local' || typeof record.resourceId !== 'string' ||
          !record.resourceId.startsWith('ssh:') || !validRemoteWorktreePath(record.workspacePath) || !validRemoteWorktreePath(record.worktreePath)) {
        this.requireManualRecovery();
        continue;
      }
      const { stagingPath, recoveryDirectory } = remoteRemovalPaths(record.worktreePath, record.operationId);
      const restored = registry()?.restoreRemotePaths(record.environmentId, [record.worktreePath, stagingPath, recoveryDirectory], record.resourceId);
      if (!restored) { this.requireManualRecovery(); continue; }
      if (restored.conflict || this.pending.has(record.operationId)) this.requireManualRecovery();
      // Never replace the original evidence for a duplicate ID. All restored
      // reservations remain held while recovery is required, including overlaps.
      if (!this.pending.has(record.operationId)) this.pending.set(record.operationId, { record, release: restored.release, active: false, persisted: true });
    }
  }

  private save(): void {
    this.persistence?.write([...this.pending.values()].filter((entry) => entry.persisted).map((entry) => entry.record));
  }

  private complete(operationId: string, entry: PendingRemoval): void {
    // A failed desktop write must retain both the durable and runtime protection.
    entry.persisted = false;
    try { this.save(); } catch (error) { entry.persisted = true; throw error; }
    entry.release();
    this.pending.delete(operationId);
  }

  private activity(workspace: RegisteredWorkspace): string[] | null {
    const terminals = this.terminalPaths ? this.terminalPaths(workspace.location.environmentId) : [];
    if (terminals === null) return null;
    // Checkout-context roots (each workspace's main root included) are the registered activity.
    return [...new Set([...terminals, ...(this.registry()?.getAllCheckoutContexts() ?? [])
      .filter((entry) => entry.environmentId !== 'local' && this.registry()?.getWorktreeResourceId(entry.environmentId) ===
        this.registry()?.getWorktreeResourceId(workspace.location.environmentId)).map((entry) => entry.path)])].sort();
  }

  public async inspect(workspace: RegisteredWorkspace, worktreePath: string): Promise<GitWorktreeInspectionResult> {
    if (this.recoveryError) return { success: false, error: this.recoveryError };
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
    if (this.recoveryError) return { success: false, error: this.recoveryError };
    if (!workspace.environment.removeWorktree || !workspace.environment.waitForWorktreeOperations) return { success: false, error: 'Remote worktree removal is unavailable for this environment' };
    if (!validRemoteWorktreePath(worktreePath) || (typeof expectedBranch !== 'string' && expectedBranch !== null)) return { success: false, error: 'Invalid remote worktree removal request' };
    const operationId = randomUUID();
    const { stagingPath, recoveryDirectory } = remoteRemovalPaths(worktreePath, operationId);
    const release = this.registry()?.reserveRemotePaths(workspace.location.environmentId, [worktreePath, stagingPath, recoveryDirectory]);
    if (!release) return { success: false, error: 'This worktree is being removed or awaiting completion verification; refresh worktrees' };
    const pending: PendingRemoval = { workspace, release, active: true, persisted: false,
      record: { operationId, environmentId: workspace.location.environmentId,
        resourceId: this.registry()!.getWorktreeResourceId(workspace.location.environmentId),
        workspacePath: workspace.location.path, worktreePath } };
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
      pending.persisted = true;
      try { this.save(); } catch (error) { pending.persisted = false; throw error; }
      uncertain = true;
      const result = await workspace.environment.removeWorktree(workspace.location.path, worktreePath, expectedBranch, activity, operationId);
      uncertain = result.uncertain === true;
      return { success: result.success, error: result.error, warning: result.warning, recoveryPath: result.recoveryPath };
    } catch (error) {
      return { success: false, error: `${error instanceof Error ? error.message : 'Remote removal failed'}${uncertain ? '\nRefresh worktrees to verify completion before reopening.' : ''}` };
    } finally {
      pending.active = false;
      if (!uncertain) this.complete(operationId, pending);
    }
  }

  /** Release uncertain reservations only after the host journals completion. */
  public async reconcile(environmentId: string): Promise<void> {
    if (this.recoveryError) throw new Error(this.recoveryError);
    for (const [operationId, entry] of this.pending) {
      if (entry.active || entry.record.resourceId !== this.registry()?.getWorktreeResourceId(environmentId)) continue;
      const workspace = entry.workspace ?? this.registry()?.getAllWorkspaces().find((workspace) =>
        workspace.environment.kind === 'ssh' && workspace.environment.worktreeResourceId === entry.record.resourceId);
      if (!workspace?.environment.waitForWorktreeOperations) throw new Error('Open the owning SSH repository to verify pending worktree removal');
      await workspace.environment.waitForWorktreeOperations(entry.record.workspacePath, operationId);
      this.complete(operationId, entry);
    }
  }
}
