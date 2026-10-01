import { afterEach, expect, it, vi } from 'vitest';
import { RemoteServiceDiscovery } from '../../../src/main/remote/remoteServiceDiscovery';
import type { RegisteredWorkspace, WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
const service = { remoteHost: '127.0.0.1' as const, remotePort: 5173, protocol: 'http' as const, source: 'listener' as const, cwd: '/repo/app' };
afterEach(() => vi.useRealTimers());
function fixture() {
  const discover = vi.fn().mockResolvedValue([service]);
  const workspace = { workspaceId: 'a', location: { path: '/repo', environmentId: 'ssh' }, environment: { kind: 'ssh', worktreeResourceId: 'same-host', discoverWebServices: discover } } as unknown as RegisteredWorkspace;
  const workspaces = new Map([['a', workspace], ['b', { ...workspace, workspaceId: 'b', location: { path: '/other', environmentId: 'alias' } }]]);
  const notify = vi.fn();
  const discovery = new RemoteServiceDiscovery({ getWorkspace: (id: string) => workspaces.get(id) } as unknown as WorkspaceRegistry, notify);
  return { discover, notify, discovery, workspaces };
}
it('coalesces host inventory, associates per workspace, backs off and stops without consumers', async () => {
  vi.useFakeTimers(); const f = fixture();
  f.discovery.setConsumer('a', 'browser', true); f.discovery.setConsumer('b', 'browser', true);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.discover).toHaveBeenCalledTimes(1);
  expect(f.notify).toHaveBeenCalledWith('a', [expect.objectContaining({ confidence: 'workspace' })], undefined);
  expect(f.notify).toHaveBeenCalledWith('b', [], undefined);
  await vi.advanceTimersByTimeAsync(120000);
  const scans = f.discover.mock.calls.length;
  expect(scans).toBeLessThan(10);
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.discover).toHaveBeenCalledTimes(scans + 1);
  f.discovery.setConsumer('a', 'browser', false); f.discovery.setConsumer('b', 'browser', false);
  await vi.advanceTimersByTimeAsync(120000);
  expect(f.discover).toHaveBeenCalledTimes(scans + 1);
});
it('aborts the last consumer, ignores stale results and never resurrects a closed workspace', async () => {
  const f = fixture(); let resolve!: (value: typeof service[]) => void;
  f.discover.mockReturnValue(new Promise((res) => { resolve = res; }));
  f.discovery.setConsumer('a', 'browser', true);
  const signal = f.discover.mock.calls[0][0] as AbortSignal;
  f.discovery.closeWorkspace('a'); f.workspaces.delete('a');
  const count = f.notify.mock.calls.length;
  expect(signal.aborted).toBe(true);
  resolve([service]); await Promise.resolve(); await Promise.resolve();
  expect(f.notify).toHaveBeenCalledTimes(count);
  f.discovery.close();
});
it('terminal hints accelerate retained discovery without creating a scanner for idle hosts', async () => {
  vi.useFakeTimers(); const f = fixture();
  f.discovery.hint('a', service); expect(f.discover).not.toHaveBeenCalled();
  f.discovery.setConsumer('a', 'browser', true); await vi.advanceTimersByTimeAsync(0);
  expect(f.discover).toHaveBeenCalledWith(expect.any(AbortSignal), [expect.objectContaining({ remotePort: 5173 })]);
  f.discovery.hint('a', { ...service, remotePort: 5174 }); await vi.advanceTimersByTimeAsync(0);
  expect(f.discover).toHaveBeenCalledTimes(2);
  f.discovery.close();
});
