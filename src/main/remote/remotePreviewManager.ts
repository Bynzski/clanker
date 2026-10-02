import type { WorkspaceRegistry, RegisteredWorkspace } from '../workspaceRegistry';
import type { RemotePreviewRequest, RemotePreviewState, RemotePreviewResult, RemotePreviewUpdate, RemoteWebService } from '../../shared/types/remotePreview';
import { isPreviewPort } from '../../shared/types/remotePreview';
import { type PortForwardHandle, PreviewTransportError } from './sshPortForward';
import { allocatePreviewPort, probePreviewUrl } from './previewHealth';
import { RemoteServiceDiscovery } from './remoteServiceDiscovery';

interface Entry {
  workspace: RegisteredWorkspace;
  state: RemotePreviewState;
  controller: AbortController;
  handle?: PortForwardHandle;
  pending?: Promise<RemotePreviewResult>;
  stopping?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
}
interface Dependencies {
  allocate: typeof allocatePreviewPort;
  probe: typeof probePreviewUrl;
}
export function previewServiceId(request: RemotePreviewRequest): string {
  return `${request.workspaceId}:${request.remoteHost ?? '127.0.0.1'}:${request.remotePort}:${request.protocol ?? 'http'}`;
}
/** Independent service forwards, bounded to four per workspace/sixteen globally.
 * Numeric reservations survive startup and child cleanup. Service health uses
 * existing tunnels, never new SSH connections, and does not kill healthy SSH. */
export class RemotePreviewManager {
  private readonly entries = new Map<string, Entry>();
  private readonly reserved = new Set<number>();
  private readonly services = new Map<string, { services: RemoteWebService[]; error?: string }>();
  private shuttingDown = false;
  readonly discovery: RemoteServiceDiscovery;
  constructor(private readonly registry: WorkspaceRegistry, private readonly notify: (update: RemotePreviewUpdate) => void,
    private readonly dependencies: Dependencies = { allocate: allocatePreviewPort, probe: probePreviewUrl }) {
    this.discovery = new RemoteServiceDiscovery(registry, (id, services, error) => { this.services.set(id, { services, error }); this.emit(id); });
  }
  getAll(workspaceId: string): RemotePreviewState[] { return [...this.entries.values()].filter((entry) => entry.workspace.workspaceId === workspaceId).map((entry) => ({ ...entry.state })); }
  get(workspaceId: string): RemotePreviewState | null { const states = this.getAll(workspaceId); return states[states.length - 1] ?? null; }
  snapshot(workspaceId: string): RemotePreviewUpdate {
    return { workspaceId, forward: this.get(workspaceId), forwards: this.getAll(workspaceId), services: this.services.get(workspaceId)?.services ?? [], error: this.services.get(workspaceId)?.error };
  }
  private emit(workspaceId: string): void { this.notify(this.snapshot(workspaceId)); }
  async start(request: RemotePreviewRequest): Promise<RemotePreviewResult> {
    const fail = (error: string): RemotePreviewResult => ({ success: false, forward: this.get(request?.workspaceId), error });
    if (!request || typeof request.workspaceId !== 'string' || !isPreviewPort(request.remotePort)
      || (request.remoteHost !== undefined && !['127.0.0.1', '::1'].includes(request.remoteHost))
      || (request.protocol !== undefined && !['http', 'https'].includes(request.protocol))) return fail('A loopback web service and port from 1024 to 65535 are required');
    const workspace = this.registry.getWorkspace(request.workspaceId);
    if (this.shuttingDown || !workspace || workspace.environment.kind !== 'ssh' || !workspace.environment.startPortForward) return fail('An open SSH workspace is required');
    const id = previewServiceId(request), existing = this.entries.get(id);
    if (existing) {
      if (existing.stopping) return fail('Preview is stopping');
      if (existing.pending && existing.state.status === 'starting') return existing.pending;
      if (existing.state.status !== 'error') return { success: true, forward: { ...existing.state } };
      existing.controller.abort(); if (existing.timer) clearTimeout(existing.timer);
      this.reserved.delete(existing.state.localPort); this.entries.delete(id);
    }
    if (this.entries.size >= 16 || this.getAll(request.workspaceId).length >= 4) return fail('Too many previews; stop a service before continuing');
    const entry: Entry = { workspace, controller: new AbortController(), state: { workspaceId: request.workspaceId, remotePort: request.remotePort,
      remoteHost: request.remoteHost ?? '127.0.0.1', protocol: request.protocol ?? 'http', serviceId: id, localPort: 0, url: '', status: 'starting' } };
    this.entries.set(id, entry); this.emit(request.workspaceId);
    const current = () => !this.shuttingDown && !entry.controller.signal.aborted && this.entries.get(id) === entry && this.registry.getWorkspace(request.workspaceId) === workspace;
    const pending = (async (): Promise<RemotePreviewResult> => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          let port = await this.dependencies.allocate(attempt === 0 ? request.remotePort : 0, this.reserved);
          if (!current()) throw new Error('Remote workspace closed or preview cancelled');
          if (this.reserved.has(port)) port = await this.dependencies.allocate(0, this.reserved);
          if (!current() || this.reserved.has(port)) throw new Error('Preview allocation cancelled');
          this.reserved.add(port); entry.state.localPort = port; entry.state.url = `${entry.state.protocol}://127.0.0.1:${port}/`;
          try {
            const handle = await workspace.environment.startPortForward!(port, request.remotePort, entry.controller.signal, (error) => {
              if (!current() || entry.state.status === 'stopping') return;
              entry.handle = undefined; if (entry.timer) clearTimeout(entry.timer);
              this.reserved.delete(port); entry.state = { ...entry.state, status: 'error', error }; this.emit(request.workspaceId);
            }, entry.state.remoteHost);
            entry.handle = handle;
            if (!current() || entry.state.status === 'error') { await handle.close(); entry.handle = undefined; throw new Error('Remote workspace closed or preview cancelled'); }
            break;
          } catch (error) {
            this.reserved.delete(port);
            if (!(error instanceof PreviewTransportError) || error.kind !== 'bind-conflict' || attempt === 2 || !current()) throw error;
          }
        }
        entry.state = { ...entry.state, status: 'waiting' }; this.emit(request.workspaceId);
        void this.checkHealth(id, entry);
        return { success: true, forward: { ...entry.state } };
      } catch (error) {
        const message = entry.state.error ?? (error instanceof PreviewTransportError ? error.message : 'Could not start SSH preview');
        if (entry.state.status !== 'stopping' && this.entries.get(id) === entry) {
          if (current()) entry.state = { ...entry.state, status: 'error', error: message };
          else this.entries.delete(id);
          this.emit(request.workspaceId);
        }
        return { success: false, forward: this.get(request.workspaceId), error: message };
      }
    })();
    entry.pending = pending; return pending;
  }
  private async checkHealth(id: string, entry: Entry): Promise<void> {
    const healthy = await this.dependencies.probe(entry.state.url, entry.controller.signal).catch(() => false);
    if (this.shuttingDown || entry.controller.signal.aborted || this.entries.get(id) !== entry || !entry.handle || entry.state.status === 'error') return;
    if (this.registry.getWorkspace(entry.workspace.workspaceId) !== entry.workspace) { void this.stop(entry.workspace.workspaceId, id); return; }
    const status = healthy ? 'active' : 'waiting';
    if (entry.state.status !== status) { entry.state = { ...entry.state, status }; this.emit(entry.workspace.workspaceId); }
    entry.timer = setTimeout(() => void this.checkHealth(id, entry), healthy ? 5000 : 2000); entry.timer.unref();
  }
  async stop(workspaceId: string, serviceId?: string): Promise<void> {
    if (!serviceId) { await Promise.all([...this.entries].filter(([, entry]) => entry.workspace.workspaceId === workspaceId).map(([id]) => this.stop(workspaceId, id))); return; }
    const entry = this.entries.get(serviceId);
    if (!entry || entry.workspace.workspaceId !== workspaceId) return;
    if (entry.stopping) return entry.stopping;
    entry.state = { ...entry.state, status: 'stopping' }; this.emit(workspaceId);
    entry.controller.abort(); if (entry.timer) clearTimeout(entry.timer);
    entry.stopping = (async () => {
      await entry.pending; await entry.handle?.close();
      this.reserved.delete(entry.state.localPort);
      if (this.entries.get(serviceId) === entry) { this.entries.delete(serviceId); this.emit(workspaceId); }
    })().catch((error: unknown) => { entry.stopping = undefined; throw error; }); return entry.stopping;
  }
  async closeWorkspace(workspaceId: string): Promise<void> {
    this.discovery.closeWorkspace(workspaceId); this.services.delete(workspaceId); await this.stop(workspaceId);
  }
  close(): Promise<void> { this.shuttingDown = true; this.discovery.close(); return this.closeWorkspaces(); }
  async closeWorkspaces(): Promise<void> {
    this.discovery.closeWorkspaces(); this.services.clear();
    await Promise.all([...new Set([...this.entries.values()].map((entry) => entry.workspace.workspaceId))].map((id) => this.stop(id)));
  }
}
