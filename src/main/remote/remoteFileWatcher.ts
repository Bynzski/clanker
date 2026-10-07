import type { WorkspaceRegistry } from '../workspaceRegistry';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { RegisteredWorkspace } from '../workspaceRegistry';
import type { RemoteFileWatchRequest, RemoteFileSnapshot, RemoteFilesChangedEvent } from '../../shared/types/remoteFileWatch';
import { validateSnapshotTargets } from './sshFileSnapshot';

interface WatchSession {
  request: RemoteFileWatchRequest;
  workspace: RegisteredWorkspace;
  root: string;
  context?: CheckoutContext;
}

interface WatchBaseline {
  files: Map<string, string | null>;
  directories: Map<string, string | null>;
}

interface RemoteFileWatcherDeps {
  getWorkspaceRegistry: () => WorkspaceRegistry;
  onChanged: (event: RemoteFilesChangedEvent) => void;
  intervalMs?: number;
}

/** One active workspace, one outstanding batched SSH snapshot, bounded retries. */
export class RemoteFileWatcher {
  private active: WatchSession | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: AbortController | null = null;
  private failures = 0;
  private readonly baselines = new Map<string, WatchBaseline>();
  private readonly intervalMs: number;

  constructor(private readonly deps: RemoteFileWatcherDeps) {
    this.intervalMs = deps.intervalMs ?? 3000;
  }

  public sync(request: RemoteFileWatchRequest | null): boolean {
    if (request === null) {
      this.stop();
      return true;
    }
    if (!request || typeof request.workspaceId !== 'string') return false;
    const registry = this.deps.getWorkspaceRegistry();
    const workspace = registry.getWorkspace(request.workspaceId);
    const context = request.checkoutContextId !== undefined ? registry.resolveCheckoutContext(request.workspaceId, request.checkoutContextId) : undefined;
    if (request.checkoutContextId !== undefined && (typeof request.checkoutContextId !== 'string' || !request.checkoutContextId || !context || context.missing)) { this.stop(); return false; }
    const root = context?.path ?? workspace?.location.path;
    if (!workspace || !root || workspace.environment.kind !== 'ssh' || !workspace.environment.capabilities.watchFiles ||
        !workspace.environment.snapshotFiles || !validateSnapshotTargets(root, request)) { this.stop(); return false; }
    const normalized: RemoteFileWatchRequest = {
      workspaceId: request.workspaceId,
      ...(context ? { checkoutContextId: context.id } : {}),
      filePaths: [...new Set(request.filePaths)].sort(),
      directoryPaths: [...new Set(request.directoryPaths)].sort(),
    };
    if (!normalized.filePaths.length && !normalized.directoryPaths.length) {
      this.stop();
      return true;
    }
    if (JSON.stringify(this.active?.request) === JSON.stringify(normalized)) return true;
    if (this.active?.request.workspaceId !== request.workspaceId) this.inFlight?.abort();
    this.clearTimer();
    this.active = { request: normalized, workspace, root, ...(context ? { context } : {}) };
    this.failures = 0;
    if (!this.inFlight) this.schedule(0);
    return true;
  }

  public closeWorkspace(workspaceId: string): void {
    this.baselines.delete(workspaceId);
    if (this.active?.request.workspaceId === workspaceId) this.stop();
  }

  public close(): void {
    this.stop();
    this.baselines.clear();
  }

  private stop(): void {
    this.active = null;
    this.clearTimer();
    this.inFlight?.abort();
    this.failures = 0;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => { this.timer = null; void this.poll(); }, delay);
    this.timer.unref?.();
  }

  private applySnapshot(session: WatchSession, snapshot: RemoteFileSnapshot): void {
    const { workspaceId } = session.request;
    const baseline = this.baselines.get(workspaceId) ?? { files: new Map(), directories: new Map() };
    const event: RemoteFilesChangedEvent = { workspaceId, ...(session.context ? { checkoutContextId: session.context.id } : {}), files: [], directoryPaths: [] };
    const unchangedFilePaths: string[] = [];
    const unchangedDirectoryPaths: string[] = [];
    for (const file of snapshot.files) {
      const initial = !baseline.files.has(file.path);
      if (initial || baseline.files.get(file.path) !== file.fingerprint) {
        event.files.push({ filePath: file.path, deleted: file.fingerprint === null, initial });
      } else if (file.fingerprint !== null) unchangedFilePaths.push(file.path);
      baseline.files.set(file.path, file.fingerprint);
    }
    for (const directory of snapshot.directories) {
      if (!baseline.directories.has(directory.path) || baseline.directories.get(directory.path) !== directory.fingerprint) event.directoryPaths.push(directory.path);
      else if (directory.fingerprint !== null) unchangedDirectoryPaths.push(directory.path);
      baseline.directories.set(directory.path, directory.fingerprint);
    }
    // Bound retained state to current targets, including while the workspace is parked.
    for (const key of baseline.files.keys()) if (!session.request.filePaths.includes(key)) baseline.files.delete(key);
    for (const key of baseline.directories.keys()) if (!session.request.directoryPaths.includes(key)) baseline.directories.delete(key);
    this.baselines.set(workspaceId, baseline);
    if (unchangedFilePaths.length) event.unchangedFilePaths = unchangedFilePaths;
    if (unchangedDirectoryPaths.length) event.unchangedDirectoryPaths = unchangedDirectoryPaths;
    if (event.files.length || event.directoryPaths.length || unchangedFilePaths.length || unchangedDirectoryPaths.length) this.deps.onChanged(event);
  }

  private async poll(): Promise<void> {
    const session = this.active;
    if (!session || this.inFlight) return;
    const validSession = () => this.deps.getWorkspaceRegistry().getWorkspace(session.request.workspaceId) === session.workspace
      && (!session.context || (this.deps.getWorkspaceRegistry().getCheckoutContext(session.context.id) === session.context && !session.context.missing));
    if (!validSession()) {
      this.closeWorkspace(session.request.workspaceId);
      return;
    }
    const controller = new AbortController();
    this.inFlight = controller;
    try {
      const snapshot = await session.workspace.environment.snapshotFiles!(session.root, session.request, controller.signal);
      if (this.active === session && !controller.signal.aborted &&
          validSession()) {
        this.applySnapshot(session, snapshot);
        this.failures = 0;
      }
    } catch {
      // SSH/permission failures leave the baseline intact; they are not deletions.
      if (this.active === session && !controller.signal.aborted) {
        this.failures = Math.min(this.failures + 1, 4);
        if (session.context) this.deps.onChanged({ workspaceId: session.request.workspaceId, checkoutContextId: session.context.id, reconcileCheckout: true, files: [], directoryPaths: [] });
      }
    } finally {
      this.inFlight = null;
      if (this.active) this.schedule(this.active !== session ? 0 : Math.min(this.intervalMs * 2 ** this.failures, 30000));
    }
  }
}
