import type { WorkspaceRegistry, RegisteredWorkspace } from '../workspaceRegistry';
import type { RemotePreviewRequest, RemotePreviewState, RemotePreviewResult, RemotePreviewUpdate } from '../../shared/types/remotePreview';
import { isPreviewPort } from '../../shared/types/remotePreview';
import type { PortForwardHandle } from './sshPortForward';

interface Entry {
  workspace: RegisteredWorkspace;
  state: RemotePreviewState;
  controller: AbortController;
  handle?: PortForwardHandle;
  pending?: Promise<RemotePreviewResult>;
  stopping?: Promise<void>;
}

/** One explicit preview per registered workspace; reserves local ports through cleanup. */
export class RemotePreviewManager {
  private readonly entries = new Map<string, Entry>();
  private shuttingDown = false;
  constructor(private readonly registry: WorkspaceRegistry, private readonly notify: (update: RemotePreviewUpdate) => void) {}
  get(workspaceId: string): RemotePreviewState | null {
    const state = this.entries.get(workspaceId)?.state;
    return state ? { ...state } : null;
  }
  private emit(workspaceId: string): void { this.notify({ workspaceId, forward: this.get(workspaceId) }); }
  async start(request: RemotePreviewRequest): Promise<RemotePreviewResult> {
    const fail = (error: string): RemotePreviewResult => ({ success: false, forward: this.get(request?.workspaceId), error });
    if (!request || typeof request.workspaceId !== 'string' || !isPreviewPort(request.remotePort) || !isPreviewPort(request.localPort)) return fail('Preview ports must be whole numbers from 1024 to 65535');
    const workspace = this.registry.getWorkspace(request.workspaceId);
    if (this.shuttingDown || !workspace || workspace.environment.kind !== 'ssh' || !workspace.environment.startPortForward) return fail('An open SSH workspace is required');
    const existing = this.entries.get(request.workspaceId);
    if (existing && (existing.state.status !== 'error' || existing.handle || existing.stopping)) return fail('Stop the current preview before starting another');
    if ([...this.entries.values()].some((entry) => entry !== existing && entry.state.localPort === request.localPort && (entry.state.status !== 'error' || entry.handle))) return fail('This local port is already used by another workspace preview');
    if (this.entries.size >= 16 && !existing) return fail('Too many workspace previews; stop one before continuing');
    const entry: Entry = { workspace, controller: new AbortController(), state: { ...request,
      url: `http://127.0.0.1:${request.localPort}/`, status: 'starting' } };
    this.entries.set(request.workspaceId, entry);
    this.emit(request.workspaceId);
    const pending = (async (): Promise<RemotePreviewResult> => {
      try {
        entry.handle = await workspace.environment.startPortForward!(request.localPort, request.remotePort, entry.controller.signal, (error) => {
          if (this.entries.get(request.workspaceId) !== entry || entry.state.status === 'stopping') return;
          entry.handle = undefined;
          entry.state = { ...entry.state, status: 'error', error };
          this.emit(request.workspaceId);
        });
        if (this.shuttingDown || entry.controller.signal.aborted || this.entries.get(request.workspaceId) !== entry || this.registry.getWorkspace(request.workspaceId) !== workspace || entry.state.status !== 'starting') {
          await entry.handle.close();
          entry.handle = undefined;
          throw new Error('Remote workspace closed or preview cancelled');
        }
        entry.state = { ...entry.state, status: 'active' };
        this.emit(request.workspaceId);
        return { success: true, forward: this.get(request.workspaceId) };
      } catch (error) {
        if (this.entries.get(request.workspaceId) === entry && entry.state.status !== 'stopping') {
          entry.state = { ...entry.state, status: 'error', error: error instanceof Error ? error.message : String(error) };
          this.emit(request.workspaceId);
        }
        return { success: false, forward: this.get(request.workspaceId), error: error instanceof Error ? error.message : String(error) };
      }
    })();
    entry.pending = pending;
    return pending;
  }
  async stop(workspaceId: string): Promise<void> {
    const entry = this.entries.get(workspaceId);
    if (!entry) return;
    if (entry.stopping) return entry.stopping;
    entry.state = { ...entry.state, status: 'stopping' };
    this.emit(workspaceId);
    entry.controller.abort();
    entry.stopping = (async () => {
      await entry.pending;
      await entry.handle?.close();
      if (this.entries.get(workspaceId) === entry) { this.entries.delete(workspaceId); this.emit(workspaceId); }
    })();
    return entry.stopping;
  }
  close(): Promise<void> {
    this.shuttingDown = true;
    return this.closeWorkspaces();
  }
  async closeWorkspaces(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)));
  }
}
