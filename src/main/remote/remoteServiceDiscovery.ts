import type { WorkspaceRegistry, RegisteredWorkspace } from '../workspaceRegistry';
import type { RemoteWebService } from '../../shared/types/remotePreview';
import { associateWebServices, type RemoteWebEndpoint } from './sshPortDiscovery';

interface Host {
  consumers: Map<string, { workspace: RegisteredWorkspace; tokens: Set<string> }>;
  services: RemoteWebService[];
  controller: AbortController;
  pending?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  burstUntil: number;
  scans: number;
  rescan: boolean;
  scanning: boolean;
}
/** Demand-driven host inventory. A Browser lease shares one scan with all leases
 * on the same resolved SSH transport. Fast startup bursts end after one minute;
 * stable/idle discovery backs off to one minute, never a perpetual 3s SSH loop. */
export class RemoteServiceDiscovery {
  private hosts = new Map<string, Host>();
  private hints = new Map<string, Array<RemoteWebEndpoint & { expires: number }>>();
  private closed = false;
  constructor(private registry: WorkspaceRegistry, private notify: (workspaceId: string, services: RemoteWebService[], error?: string) => void) {}
  private key(workspace: RegisteredWorkspace) { return workspace.environment.worktreeResourceId ?? workspace.location.environmentId; }
  setConsumer(workspaceId: string, token: string, enabled: boolean): boolean {
    const workspace = this.registry.getWorkspace(workspaceId);
    if (this.closed || !workspace || workspace.environment.kind !== 'ssh' || !workspace.environment.discoverWebServices || !/^[\w-]{1,80}$/.test(token)) return false;
    const key = this.key(workspace);
    let host = this.hosts.get(key);
    if (!enabled) {
      const consumer = host?.consumers.get(workspaceId);
      consumer?.tokens.delete(token);
      if (consumer?.tokens.size === 0) { host?.consumers.delete(workspaceId); this.notify(workspaceId, []); }
      if (host?.consumers.size === 0) this.removeHost(key, host);
      return true;
    }
    if (!host) {
      host = { consumers: new Map(), services: [], controller: new AbortController(), burstUntil: Date.now() + 60000, scans: 0, rescan: false, scanning: false };
      this.hosts.set(key, host);
    }
    let consumer = host.consumers.get(workspaceId);
    if (consumer && consumer.workspace !== workspace) host.consumers.delete(workspaceId);
    consumer = host.consumers.get(workspaceId);
    if (!consumer) {
      consumer = { workspace, tokens: new Set() }; host.consumers.set(workspaceId, consumer);
      this.notify(workspaceId, []); // A new lease never bootstraps from cached host ownership.
      if (host.scanning) host.rescan = true;
      if (host.timer) clearTimeout(host.timer);
      host.timer = undefined;
    }
    if (consumer.tokens.size >= 8 && !consumer.tokens.has(token)) return false;
    consumer.tokens.add(token);
    if (!host.timer) void this.scan(key, host);
    return true;
  }
  private services(host: Host, workspace: RegisteredWorkspace) {
    const hints = this.validHints(workspace.workspaceId);
    return associateWebServices(host.services, workspace.location.path).map((service) => ({ ...service,
      confidence: hints.some((hint) => hint.remotePort === service.remotePort && hint.remoteHost === service.remoteHost) ? 'workspace' as const : service.confidence }));
  }
  private publish(host: Host, error?: string, recipients = host.consumers) {
    for (const [id, consumer] of recipients) {
      if (host.consumers.get(id) !== consumer) continue;
      if (this.registry.getWorkspace(id) === consumer.workspace) this.notify(id, this.services(host, consumer.workspace), error);
      else host.consumers.delete(id);
    }
  }
  private validHints(id: string) { return (this.hints.get(id) ?? []).filter((hint) => hint.expires > Date.now()); }
  hint(workspaceId: string, endpoint: RemoteWebEndpoint): void {
    const workspace = this.registry.getWorkspace(workspaceId);
    if (!workspace || workspace.environment.kind !== 'ssh' || this.closed) return;
    const hints = this.validHints(workspaceId).filter((hint) => hint.remoteHost !== endpoint.remoteHost || hint.remotePort !== endpoint.remotePort);
    this.hints.set(workspaceId, [...hints.slice(-7), { ...endpoint, expires: Date.now() + 120000 }]);
    const key = this.key(workspace), host = this.hosts.get(key);
    if (!host) return;
    host.burstUntil = Date.now() + 60000; host.scans = 0;
    if (host.timer) clearTimeout(host.timer);
    host.timer = undefined;
    if (host.pending) host.rescan = true;
    else void this.scan(key, host);
  }
  refresh(workspaceId: string): void {
    const workspace = this.registry.getWorkspace(workspaceId);
    if (!workspace) return;
    const key = this.key(workspace), host = this.hosts.get(key);
    if (!host) return;
    if (host.timer) clearTimeout(host.timer);
    host.timer = undefined;
    // User refreshes are coalesced, including while an SSH command is pending.
    void this.scan(key, host);
  }
  private scan(key: string, host: Host): Promise<void> {
    if (host.pending) return host.pending;
    if (this.hosts.get(key) !== host || host.controller.signal.aborted) return Promise.resolve();
    const first = [...host.consumers.values()][0]?.workspace;
    if (!first) { this.removeHost(key, host); return Promise.resolve(); }
    host.pending = Promise.resolve().then(async () => {
      host.scanning = true;
      const recipients = new Map(host.consumers);
      try {
        if (host.controller.signal.aborted || this.hosts.get(key) !== host) return;
        const hints = [...host.consumers.keys()].flatMap((id) => this.validHints(id)).slice(0, 8);
        const services = await first.environment.discoverWebServices!(host.controller.signal, hints);
        if (this.hosts.get(key) !== host || host.controller.signal.aborted) return;
        host.services = services;
        this.publish(host, undefined, recipients);
          } catch {
        if (this.hosts.get(key) === host && !host.controller.signal.aborted) this.publish(host, 'Could not discover remote web services', recipients);
      } finally {
        host.pending = undefined; host.scanning = false;
        if (this.hosts.get(key) === host && !host.controller.signal.aborted) {
          if (!host.consumers.size) { this.removeHost(key, host); } else {
          const delay = host.rescan ? 750 : Date.now() >= host.burstUntil ? 60000 : Math.min(15000, 1500 * 2 ** host.scans++);
          host.rescan = false;
          host.timer = setTimeout(() => { host.timer = undefined; void this.scan(key, host); }, delay);
          host.timer.unref();
          }
        }
      }
    });
    return host.pending;
  }
  private removeHost(key: string, host: Host) {
    this.hosts.delete(key); if (host.timer) clearTimeout(host.timer); host.controller.abort();
  }
  closeWorkspace(workspaceId: string): void {
    this.hints.delete(workspaceId);
    for (const [key, host] of this.hosts) { host.consumers.delete(workspaceId); if (!host.consumers.size) this.removeHost(key, host); }
  }
  closeWorkspaces(): void {
    for (const [key, host] of this.hosts) this.removeHost(key, host);
    this.hints.clear();
  }
  close(): void { this.closed = true; this.closeWorkspaces(); }
}
