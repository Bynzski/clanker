import { expect, it, vi } from 'vitest';
import type { Session } from 'electron';
import { BrowserSessionScopes } from '../../../src/main/browserSessionScope';
it('shares SSH tabs only within a workspace and retains persistent global local browsing', () => {
  const scopes = new BrowserSessionScopes();
  const a = scopes.partition('ssh-a', 'ssh'), b = scopes.partition('ssh-b', 'ssh');
  expect(a).not.toBe(b); expect(a.startsWith('persist:')).toBe(false);
  expect(scopes.partition('ssh-a', 'ssh')).toBe(a);
  expect(scopes.partition('local-a', 'local')).toBe('persist:browser-global');
  expect(scopes.partition('local-b', 'local')).toBe('persist:browser-global');
});
it('clears private storage/cache/connections on disposal and uses a new scope on reopen', async () => {
  const scopes = new BrowserSessionScopes(), old = scopes.partition('a', 'ssh');
  const session = { clearStorageData: vi.fn().mockResolvedValue(undefined), clearCache: vi.fn().mockResolvedValue(undefined), closeAllConnections: vi.fn().mockResolvedValue(undefined) };
  scopes.attach('a', session as unknown as Session); scopes.dispose('a'); scopes.dispose('a');
  expect(session.clearStorageData).toHaveBeenCalledTimes(1); expect(session.closeAllConnections).toHaveBeenCalledTimes(1);
  expect(scopes.partition('a', 'ssh')).not.toBe(old); await Promise.resolve();
});
