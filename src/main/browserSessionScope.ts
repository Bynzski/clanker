import { randomUUID } from 'node:crypto';
import type { Session } from 'electron';

/** All tabs in an SSH workspace share a private, nonpersistent Chromium session.
 * Local browsing keeps its existing global persistent login/storage behavior. */
export class BrowserSessionScopes {
  private scopes = new Map<string, { partition: string; session?: Session }>();
  partition(workspaceId: string, kind: 'local' | 'ssh'): string {
    if (kind === 'local') return 'persist:browser-global';
    let scope = this.scopes.get(workspaceId);
    if (!scope) { scope = { partition: `browser-ssh-${randomUUID()}` }; this.scopes.set(workspaceId, scope); }
    return scope.partition;
  }
  attach(workspaceId: string, session: Session): void {
    const scope = this.scopes.get(workspaceId);
    if (scope) scope.session = session;
  }
  dispose(workspaceId: string): void {
    const scope = this.scopes.get(workspaceId);
    this.scopes.delete(workspaceId); // A reopened workspace gets a fresh scope immediately.
    if (scope?.session) {
      void Promise.all([scope.session.clearStorageData(), scope.session.clearCache(), scope.session.closeAllConnections()])
        .catch((error: unknown) => console.warn('[clanker-grid] private browser session cleanup failed:', error));
    }
  }
  disposeAll(): void { for (const id of this.scopes.keys()) this.dispose(id); }
}
