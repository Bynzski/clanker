import type { WorkspaceLocation, WorkspaceEnvironmentId } from '../shared/types/environments';
import { LOCAL_ENVIRONMENT_ID } from '../shared/types/environments';
import type { WorkspaceEnvironment } from './environment/workspaceEnvironment';
import { isSameWorkspaceIdentity, normalizeWorkspacePath } from '../shared/workspaceIdentity';
import { isPathContained } from './remote/remotePaths';
import type { CheckoutContext, CheckoutContextKind } from '../shared/types/checkoutContext';
import { createMainCheckoutContext, mainCheckoutContextId } from '../shared/checkoutContext';

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
  /** The workspace's main checkout context, created with the registration. */
  checkoutContext?: CheckoutContext;
  error?: string;
}

export interface CheckoutContextRegistrationInput {
  workspaceId: string;
  path: string;
  kind: CheckoutContextKind;
  branch?: string | null;
  mainCheckoutPath?: string;
}

export interface CheckoutContextRegistrationResult {
  success: boolean;
  checkoutContext?: CheckoutContext;
  error?: string;
}

const REMOVAL_IN_PROGRESS_LOCAL = 'This worktree is being removed';
const REMOVAL_IN_PROGRESS_REMOTE = 'This remote worktree is being removed or awaiting completion verification';

export type EnvironmentResolver = (
  environmentId: WorkspaceEnvironmentId
) => Promise<WorkspaceEnvironment | null> | WorkspaceEnvironment | null;

export class WorkspaceRegistry {
  private readonly workspaces = new Map<string, RegisteredWorkspace>();
  /**
   * Validated execution roots, keyed by context id. Every registered workspace owns its main
   * context; a context never outlives its workspace. A context's root is canonicalized and
   * checked on its own, so a worktree context never widens another context's boundary.
   */
  private readonly checkoutContexts = new Map<string, CheckoutContext>();
  private readonly pendingRegistrations = new Map<string, { environmentId: string }>();
  private readonly isWorktreeBeingRemoved?: (path: string) => boolean;
  private readonly remoteReservations = new Map<symbol, { environmentId: string; resourceId: string; paths: string[] }>();
  private readonly worktreeResourceIds = new Map<string, string>();

  public getWorktreeResourceId(environmentId: string): string {
    return this.worktreeResourceIds.get(environmentId) ?? environmentId;
  }

  public isRemotePathReserved(environmentId: string, workspacePath: string): boolean {
    return [...this.remoteReservations.values()].some((entry) => (entry.environmentId === environmentId || entry.resourceId === this.getWorktreeResourceId(environmentId)) && entry.paths.some((reserved) =>
      isPathContained(reserved, workspacePath) || isPathContained(workspacePath, reserved)));
  }

  public reserveRemotePaths(environmentId: string, paths: string[], resourceId?: string): (() => void) | null {
    // Restored removal records must protect duplicate saved targets before any
    // workspace has resolved that environment in this desktop process.
    if (resourceId) this.worktreeResourceIds.set(environmentId, resourceId);
    if (environmentId === LOCAL_ENVIRONMENT_ID || paths.some((entry) => this.isRemotePathReserved(environmentId, entry))) return null;
    const token = Symbol('remote-worktree-removal');
    this.remoteReservations.set(token, { environmentId, resourceId: this.getWorktreeResourceId(environmentId), paths });
    return () => { this.remoteReservations.delete(token); };
  }

  /** Persisted operations may overlap. Preserve each operation's protection;
   * the coordinator must require manual recovery if restoration conflicts. */
  public restoreRemotePaths(environmentId: string, paths: string[], resourceId: string): { release: () => void; conflict: boolean } {
    this.worktreeResourceIds.set(environmentId, resourceId);
    const conflict = paths.some((entry) => this.isRemotePathReserved(environmentId, entry));
    const token = Symbol('restored-remote-worktree-removal');
    this.remoteReservations.set(token, { environmentId, resourceId, paths });
    return { conflict, release: () => { this.remoteReservations.delete(token); } };
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

    if (this.workspaces.has(workspaceId) || this.pendingRegistrations.has(workspaceId)) {
      return { success: false, error: 'Workspace identity is already registered' };
    }

    if (!workspacePath || typeof workspacePath !== 'string' || !workspacePath.trim()) {
      return { success: false, error: 'Workspace path is required' };
    }

    const environmentId = (input.environmentId && input.environmentId.trim())
      ? input.environmentId.trim()
      : LOCAL_ENVIRONMENT_ID;

    const pending = { environmentId };
    this.pendingRegistrations.set(workspaceId, pending);
    try {
      const environment = await this.resolveEnvironment(environmentId);
      if (this.pendingRegistrations.get(workspaceId) !== pending) {
        return { success: false, error: 'Workspace registration was cancelled' };
      }
      if (!environment) {
        return { success: false, error: `Environment '${environmentId}' not found` };
      }
      if (environmentId !== LOCAL_ENVIRONMENT_ID) this.worktreeResourceIds.set(environmentId, environment.worktreeResourceId ?? environmentId);

      const root = await this.validateRoot(environment, environmentId, workspacePath,
        () => this.pendingRegistrations.get(workspaceId) !== pending, 'Workspace');
      if ('error' in root) return { success: false, error: root.error };

      const location: WorkspaceLocation = {
        environmentId,
        path: root.canonicalPath,
      };

      const registered: RegisteredWorkspace = {
        workspaceId,
        location,
        environment,
      };

      this.workspaces.set(workspaceId, registered);
      const checkoutContext = createMainCheckoutContext({ workspaceId, environmentId, path: location.path });
      this.checkoutContexts.set(checkoutContext.id, checkoutContext);
      return { success: true, location, checkoutContext: { ...checkoutContext } };
    } finally {
      if (this.pendingRegistrations.get(workspaceId) === pending) this.pendingRegistrations.delete(workspaceId);
    }
  }

  /**
   * Shared by workspace and checkout-context registration: removal safeguards and canonical
   * validation by the owning environment. `isCancelled` is rechecked after each await.
   */
  private async validateRoot(
    environment: WorkspaceEnvironment,
    environmentId: WorkspaceEnvironmentId,
    rootPath: string,
    isCancelled: () => boolean,
    subject: string,
  ): Promise<{ canonicalPath: string } | { error: string }> {
    // Worktree safety check for local environment
    if (environmentId === LOCAL_ENVIRONMENT_ID && this.isWorktreeBeingRemoved?.(rootPath)) {
      return { error: REMOVAL_IN_PROGRESS_LOCAL };
    }
    if (environmentId !== LOCAL_ENVIRONMENT_ID && this.isRemotePathReserved(environmentId, rootPath)) {
      return { error: REMOVAL_IN_PROGRESS_REMOTE };
    }

    const validation = await environment.validateWorkspacePath(rootPath);
    if (isCancelled()) {
      return { error: `${subject} registration was cancelled` };
    }
    if (!validation.valid || !validation.resolvedPath) {
      return { error: validation.error || `${subject} directory is invalid or not accessible` };
    }

    const canonicalPath = normalizeWorkspacePath(validation.resolvedPath);
    // Validation crosses SSH; a removal may start while it is in flight.
    if (environmentId !== LOCAL_ENVIRONMENT_ID && this.isRemotePathReserved(environmentId, canonicalPath)) {
      return { error: REMOVAL_IN_PROGRESS_REMOTE };
    }
    return { canonicalPath };
  }

  /**
   * Registers an additional execution root (e.g. a linked worktree) under an already registered
   * workspace. The root is validated by the workspace's environment independently of the
   * workspace root; sibling directories are never made reachable by widening the workspace.
   *
   * Main-process only for now: nothing in the renderer IPC surface can call this yet.
   */
  public async registerCheckoutContext(
    input: CheckoutContextRegistrationInput,
  ): Promise<CheckoutContextRegistrationResult> {
    const workspace = this.workspaces.get(input.workspaceId);
    if (!workspace) return { success: false, error: 'Workspace is not registered' };
    if (typeof input.path !== 'string' || !input.path.trim()) {
      return { success: false, error: 'Checkout path is required' };
    }
    if (input.kind !== 'main' && input.kind !== 'worktree') {
      return { success: false, error: 'Invalid checkout context kind' };
    }
    if (input.kind === 'main') {
      return { success: false, error: 'The main checkout context is created with its workspace' };
    }

    const { environmentId } = workspace.location;
    const root = await this.validateRoot(workspace.environment, environmentId, input.path,
      () => this.workspaces.get(input.workspaceId) !== workspace, 'Checkout');
    if ('error' in root) return { success: false, error: root.error };
    if (this.workspaces.get(input.workspaceId) !== workspace) {
      return { success: false, error: 'Workspace was closed during checkout registration' };
    }

    const target = { environmentId, path: root.canonicalPath };
    for (const existing of this.checkoutContexts.values()) {
      if (existing.workspaceId === input.workspaceId && isSameWorkspaceIdentity(existing, target)) {
        return { success: true, checkoutContext: { ...existing } };
      }
    }

    const checkoutContext: CheckoutContext = {
      id: `${input.workspaceId}::ckt-${globalThis.crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      environmentId,
      path: root.canonicalPath,
      kind: input.kind,
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
      ...(input.mainCheckoutPath ? { mainCheckoutPath: normalizeWorkspacePath(input.mainCheckoutPath) } : {}),
    };
    this.checkoutContexts.set(checkoutContext.id, checkoutContext);
    return { success: true, checkoutContext: { ...checkoutContext } };
  }

  /** Drops one non-main context. The main context lives and dies with its workspace. */
  public unregisterCheckoutContext(contextId: string): boolean {
    const context = this.checkoutContexts.get(contextId);
    if (!context || context.kind === 'main') return false;
    return this.checkoutContexts.delete(contextId);
  }

  public getCheckoutContext(contextId: string): CheckoutContext | null {
    if (!contextId) return null;
    return this.checkoutContexts.get(contextId) ?? null;
  }

  /**
   * Resolves the execution root for a workspace. No id means the workspace's main checkout.
   * A context registered under a different workspace is never returned.
   */
  public resolveCheckoutContext(workspaceId: string, contextId?: string): CheckoutContext | null {
    if (!workspaceId || !this.workspaces.has(workspaceId)) return null;
    const context = this.checkoutContexts.get(contextId || mainCheckoutContextId(workspaceId));
    return context && context.workspaceId === workspaceId ? context : null;
  }

  public getCheckoutContextsForWorkspace(workspaceId: string): CheckoutContext[] {
    return [...this.checkoutContexts.values()].filter((context) => context.workspaceId === workspaceId);
  }

  public getAllCheckoutContexts(): CheckoutContext[] {
    return [...this.checkoutContexts.values()];
  }

  public unregisterWorkspace(workspaceId: string): void {
    if (!workspaceId) return;
    this.workspaces.delete(workspaceId);
    this.pendingRegistrations.delete(workspaceId);
    for (const [contextId, context] of this.checkoutContexts) {
      if (context.workspaceId === workspaceId) this.checkoutContexts.delete(contextId);
    }
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
    if ([...this.pendingRegistrations.values()].some((entry) => entry.environmentId === environmentId)) return true;
    if ([...this.remoteReservations.values()].some((entry) => entry.environmentId === environmentId || entry.resourceId === this.getWorktreeResourceId(environmentId))) return true;
    for (const workspace of this.workspaces.values()) {
      if (workspace.location.environmentId === environmentId) return true;
    }
    return false;
  }

  public getAllWorkspaces(): RegisteredWorkspace[] {
    return [...this.workspaces.values()];
  }

  /** Every local root in use: workspace roots plus checkout-context roots, for removal safeguards. */
  public getLocalOpenWorkspacePaths(): string[] {
    const paths = [...this.workspaces.values()]
      .filter((w) => w.location.environmentId === LOCAL_ENVIRONMENT_ID)
      .map((w) => w.location.path);
    for (const context of this.checkoutContexts.values()) {
      if (context.environmentId === LOCAL_ENVIRONMENT_ID) paths.push(context.path);
    }
    return [...new Set(paths)];
  }

  public clear(): void {
    this.workspaces.clear();
    this.pendingRegistrations.clear();
    this.checkoutContexts.clear();
  }
}
