import type { WorkspaceLocation, WorkspaceEnvironmentId } from '../shared/types/environments';
import { LOCAL_ENVIRONMENT_ID } from '../shared/types/environments';
import type { WorkspaceEnvironment } from './environment/workspaceEnvironment';
import { isSameWorkspaceIdentity, normalizeWorkspacePath } from '../shared/workspaceIdentity';
import { isPathContained } from './remote/remotePaths';

export interface RegisteredWorkspace {
  workspaceId: string;
  location: WorkspaceLocation;
  environment: WorkspaceEnvironment;
}

export interface WorkspaceRegistrationInput {
  workspaceId: string;
  workspacePath: string;
  environmentId?: WorkspaceEnvironmentId;
}

export interface WorkspaceRegistrationResult {
  success: boolean;
  location?: WorkspaceLocation;
  error?: string;
}

export type EnvironmentResolver = (
  environmentId: WorkspaceEnvironmentId
) => Promise<WorkspaceEnvironment | null> | WorkspaceEnvironment | null;

export class WorkspaceRegistry {
  private readonly workspaces = new Map<string, RegisteredWorkspace>();
  private readonly isWorktreeBeingRemoved?: (path: string) => boolean;
  private readonly remoteReservations = new Map<symbol, { environmentId: string; paths: string[] }>();
  private readonly worktreeResourceIds = new Map<string, string>();

  public getWorktreeResourceId(environmentId: string): string {
    return this.worktreeResourceIds.get(environmentId) ?? environmentId;
  }

  public isRemotePathReserved(environmentId: string, workspacePath: string): boolean {
    return [...this.remoteReservations.values()].some((entry) => this.getWorktreeResourceId(entry.environmentId) === this.getWorktreeResourceId(environmentId) && entry.paths.some((reserved) =>
      isPathContained(reserved, workspacePath) || isPathContained(workspacePath, reserved)));
  }

  public reserveRemotePaths(environmentId: string, paths: string[]): (() => void) | null {
    if (environmentId === LOCAL_ENVIRONMENT_ID || paths.some((entry) => this.isRemotePathReserved(environmentId, entry))) return null;
    const token = Symbol('remote-worktree-removal');
    this.remoteReservations.set(token, { environmentId, paths });
    return () => { this.remoteReservations.delete(token); };
  }

  constructor(
    private readonly resolveEnvironment: EnvironmentResolver,
    options?: {
      isWorktreeBeingRemoved?: (path: string) => boolean;
    }
  ) {
    this.isWorktreeBeingRemoved = options?.isWorktreeBeingRemoved;
  }

  public async registerWorkspace(
    input: WorkspaceRegistrationInput
  ): Promise<WorkspaceRegistrationResult> {
    const { workspaceId, workspacePath } = input;
    if (!workspaceId || typeof workspaceId !== 'string' || !workspaceId.trim()) {
      return { success: false, error: 'Workspace ID is required' };
    }

    if (this.workspaces.has(workspaceId)) {
      return { success: false, error: 'Workspace identity is already registered' };
    }

    if (!workspacePath || typeof workspacePath !== 'string' || !workspacePath.trim()) {
      return { success: false, error: 'Workspace path is required' };
    }

    const environmentId = (input.environmentId && input.environmentId.trim())
      ? input.environmentId.trim()
      : LOCAL_ENVIRONMENT_ID;

    const environment = await this.resolveEnvironment(environmentId);
    if (!environment) {
      return { success: false, error: `Environment '${environmentId}' not found` };
    }
    if (environmentId !== LOCAL_ENVIRONMENT_ID) this.worktreeResourceIds.set(environmentId, environment.worktreeResourceId ?? environmentId);

    // Worktree safety check for local environment
    if (environmentId === LOCAL_ENVIRONMENT_ID && this.isWorktreeBeingRemoved?.(workspacePath)) {
      return { success: false, error: 'This worktree is being removed' };
    }
    if (environmentId !== LOCAL_ENVIRONMENT_ID && this.isRemotePathReserved(environmentId, workspacePath)) {
      return { success: false, error: 'This remote worktree is being removed or awaiting completion verification' };
    }

    const validation = await environment.validateWorkspacePath(workspacePath);
    if (!validation.valid || !validation.resolvedPath) {
      return { success: false, error: validation.error || 'Workspace directory is invalid or not accessible' };
    }

    const canonicalPath = normalizeWorkspacePath(validation.resolvedPath);
    // Validation crosses SSH; a removal may start while it is in flight.
    if (environmentId !== LOCAL_ENVIRONMENT_ID && this.isRemotePathReserved(environmentId, canonicalPath)) {
      return { success: false, error: 'This remote worktree is being removed or awaiting completion verification' };
    }
    const location: WorkspaceLocation = {
      environmentId,
      path: canonicalPath,
    };

    const registered: RegisteredWorkspace = {
      workspaceId,
      location,
      environment,
    };

    this.workspaces.set(workspaceId, registered);
    return { success: true, location };
  }

  public unregisterWorkspace(workspaceId: string): void {
    if (!workspaceId) return;
    this.workspaces.delete(workspaceId);
  }

  public getWorkspace(workspaceId: string): RegisteredWorkspace | null {
    if (!workspaceId) return null;
    return this.workspaces.get(workspaceId) ?? null;
  }

  public getWorkspaceByLocation(
    environmentId: WorkspaceEnvironmentId,
    workspacePath: string
  ): RegisteredWorkspace | null {
    const target = {
      environmentId: environmentId || LOCAL_ENVIRONMENT_ID,
      path: workspacePath,
    };

    for (const workspace of this.workspaces.values()) {
      if (isSameWorkspaceIdentity(workspace.location, target)) {
        return workspace;
      }
    }
    return null;
  }

  public isEnvironmentInUse(environmentId: WorkspaceEnvironmentId): boolean {
    if ([...this.remoteReservations.values()].some((entry) => this.getWorktreeResourceId(entry.environmentId) === this.getWorktreeResourceId(environmentId))) return true;
    for (const workspace of this.workspaces.values()) {
      if (workspace.location.environmentId === environmentId) return true;
    }
    return false;
  }

  public getAllWorkspaces(): RegisteredWorkspace[] {
    return [...this.workspaces.values()];
  }

  public getLocalOpenWorkspacePaths(): string[] {
    return [...this.workspaces.values()]
      .filter((w) => w.location.environmentId === LOCAL_ENVIRONMENT_ID)
      .map((w) => w.location.path);
  }

  public clear(): void {
    this.workspaces.clear();
  }
}
