import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemotePreviewManager } from '../../../src/main/remote/remotePreviewManager';
import { PreviewTransportError, type PortForwardHandle } from '../../../src/main/remote/sshPortForward';
import type { WorkspaceRegistry, RegisteredWorkspace } from '../../../src/main/workspaceRegistry';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((res) => { resolve = res; }); return { promise, resolve }; }
function fixture() {
  const close = vi.fn().mockResolvedValue(undefined), startPortForward = vi.fn().mockResolvedValue({ close });
  const workspace = { workspaceId: 'ssh-a', location: { environmentId: 'host', path: '/same' }, environment: { kind: 'ssh', startPortForward } } as unknown as RegisteredWorkspace;
  const workspaces = new Map([['ssh-a', workspace], ['ssh-b', { ...workspace, workspaceId: 'ssh-b' }], ['local', { ...workspace, workspaceId: 'local', environment: { kind: 'local' } } as RegisteredWorkspace]]);
  const notify = vi.fn(), allocate = vi.fn().mockImplementation(async (preferred: number, reserved: Set<number>) => reserved.has(preferred) || !preferred ? 4000 + reserved.size : preferred), probe = vi.fn().mockResolvedValue(false);
  const manager = new RemotePreviewManager({ getWorkspace: (id: string) => workspaces.get(id) ?? null } as WorkspaceRegistry, notify, { allocate, probe });
  return { manager, startPortForward, close, workspace, workspaces, notify, allocate, probe };
}
const request = { workspaceId: 'ssh-a', remotePort: 3000 };
afterEach(() => vi.useRealTimers());
describe('RemotePreviewManager', () => {
  it('allocates the local port in main and supports distinct services and workspaces', async () => {
    const f = fixture();
    for (const bad of [{ ...request, workspaceId: 'local' }, { ...request, workspaceId: 'unknown' }, { ...request, remotePort: 80 }, { ...request, remoteHost: '0.0.0.0' as never }, { ...request, protocol: 'ftp' as never }]) expect((await f.manager.start(bad)).success).toBe(false);
    const result = await f.manager.start(request);
    expect(result.forward).toMatchObject({ localPort: 3000, remotePort: 3000, status: 'waiting', url: 'http://127.0.0.1:3000/' });
    await f.manager.start({ ...request, remotePort: 6006, remoteHost: '::1', protocol: 'https' });
    await f.manager.start({ ...request, workspaceId: 'ssh-b' });
    expect(f.manager.getAll('ssh-a')).toHaveLength(2);
    expect(f.manager.get('ssh-b')?.localPort).not.toBe(3000);
    expect(f.startPortForward).toHaveBeenCalledWith(expect.any(Number), 6006, expect.any(AbortSignal), expect.any(Function), '::1');
    await f.manager.close(); expect(f.close).toHaveBeenCalledTimes(3);
  });
  it('retries a port-allocation race after OpenSSH bind conflict', async () => {
    const f = fixture();
    f.startPortForward.mockRejectedValueOnce(new PreviewTransportError('bind-conflict', 'Local port conflict'));
    expect((await f.manager.start(request)).success).toBe(true);
    expect(f.allocate.mock.calls.map(([preferred]) => preferred)).toEqual([3000, 0]);
    expect(f.startPortForward.mock.calls[0][0]).not.toBe(f.startPortForward.mock.calls[1][0]);
    await f.manager.close();
  });
  it('survives delayed service startup and restarts without replacing the SSH child', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.probe.mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true);
    await f.manager.start(request); await vi.advanceTimersByTimeAsync(0);
    expect(f.manager.get('ssh-a')?.status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(2000); expect(f.manager.get('ssh-a')?.status).toBe('active');
    await vi.advanceTimersByTimeAsync(5000); expect(f.manager.get('ssh-a')?.status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(2000); expect(f.manager.get('ssh-a')?.status).toBe('active');
    expect(f.startPortForward).toHaveBeenCalledTimes(1); expect(f.close).not.toHaveBeenCalled(); await f.manager.close();
  });
  it('coalesces duplicate starts and closes handles returned after workspace shutdown', async () => {
    const f = fixture(), pending = deferred<PortForwardHandle>(); f.startPortForward.mockReturnValueOnce(pending.promise);
    const first = f.manager.start(request), second = f.manager.start(request);
    await Promise.resolve(); await Promise.resolve();
    const signal = f.startPortForward.mock.calls[0][2] as AbortSignal;
    const stop = f.manager.closeWorkspace('ssh-a'); f.workspaces.delete('ssh-a');
    expect(signal.aborted).toBe(true); pending.resolve({ close: f.close });
    expect((await first).success).toBe(false); expect((await second).success).toBe(false); await stop;
    expect(f.close).toHaveBeenCalled(); expect(f.manager.get('ssh-a')).toBeNull();
  });
  it('waits for child termination and ignores late exit/health callbacks', async () => {
    const f = fixture(), closing = deferred<void>(), health = deferred<boolean>(); f.close.mockReturnValue(closing.promise); f.probe.mockReturnValue(health.promise);
    await f.manager.start(request); const exit = f.startPortForward.mock.calls[0][3] as (error: string) => void;
    let drained = false; const stop = f.manager.close().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    closing.resolve(); await stop; health.resolve(true); await Promise.resolve(); exit('late');
    expect(f.manager.get('ssh-a')).toBeNull(); expect((await f.manager.start(request)).success).toBe(false);
  });
  it('rejects replaced registrations and reports transport errors without killing other services', async () => {
    const f = fixture(), pending = deferred<PortForwardHandle>(); f.startPortForward.mockReturnValueOnce(pending.promise);
    const first = f.manager.start(request); await Promise.resolve(); await Promise.resolve();
    f.workspaces.set('ssh-a', { ...f.workspace }); pending.resolve({ close: f.close });
    expect((await first).success).toBe(false); expect(f.close).toHaveBeenCalled();
    await f.manager.start(request); await f.manager.start({ ...request, remotePort: 6006 });
    const exit = f.startPortForward.mock.calls[1][3] as (error: string) => void; exit('SSH server rejected TCP forwarding');
    expect(f.manager.getAll('ssh-a')[0]).toMatchObject({ status: 'error', error: 'SSH server rejected TCP forwarding' });
    expect(f.manager.getAll('ssh-a')[1].status).toBe('waiting'); await f.manager.close();
  });
});
it('keeps ownership on cleanup failure and permits a later cleanup retry', async () => {
  const f = fixture(); await f.manager.start(request);
  f.close.mockRejectedValueOnce(new Error('temporary cleanup failure'));
  await expect(f.manager.stop('ssh-a')).rejects.toThrow('temporary cleanup failure');
  expect(f.manager.get('ssh-a')?.status).toBe('stopping');
  await f.manager.stop('ssh-a'); expect(f.manager.get('ssh-a')).toBeNull();
  expect(f.close).toHaveBeenCalledTimes(2); await f.manager.close();
});
it('enforces a per-workspace cap without restricting a second workspace to one service', async () => {
  const f = fixture();
  for (const port of [3000, 3001, 3002, 3003]) expect((await f.manager.start({ ...request, remotePort: port })).success).toBe(true);
  expect((await f.manager.start({ ...request, remotePort: 3004 })).success).toBe(false);
  expect((await f.manager.start({ ...request, workspaceId: 'ssh-b', remotePort: 3004 })).success).toBe(true);
  await f.manager.close();
});
it('reports managed Browser certificate errors without turning TLS trust into SSH failure', async () => {
  const f = fixture(); await f.manager.start({ ...request, protocol: 'https' });
  const forward = f.manager.get('ssh-a')!;
  f.manager.reportBrowserNavigation('ssh-b', forward.url, -202); expect(f.manager.get('ssh-a')?.error).toBeUndefined();
  f.manager.reportBrowserNavigation('ssh-a', 'https://example.com', -202); expect(f.manager.get('ssh-a')?.error).toBeUndefined();
  f.manager.reportBrowserNavigation('ssh-a', forward.url, -202);
  expect(f.manager.get('ssh-a')).toMatchObject({ status: 'waiting', error: expect.stringContaining('certificate rejected') });
  expect(f.close).not.toHaveBeenCalled(); f.manager.reportBrowserNavigation('ssh-a', forward.url);
  expect(f.manager.get('ssh-a')?.error).toBeUndefined();
  f.manager.reportBrowserNavigation('ssh-a', forward.url, -324);
  expect(f.manager.get('ssh-a')).toMatchObject({ status: 'waiting', error: undefined });
  expect(f.close).not.toHaveBeenCalled(); await f.manager.close();
});
it('exposes an empty discovery bootstrap after the last Browser lease disappears', async () => {
  const f = fixture(); const services = [{ remoteHost: '127.0.0.1', remotePort: 5173, protocol: 'http', source: 'listener', cwd: '/same' }];
  const discover = vi.fn().mockResolvedValue(services);
  Object.assign(f.workspace.environment, { discoverWebServices: discover });
  f.manager.discovery.setConsumer('ssh-a', 'browser', true); await Promise.resolve(); await Promise.resolve();
  expect(f.manager.snapshot('ssh-a').services).toEqual([expect.objectContaining({ confidence: 'workspace' })]);
  f.manager.discovery.setConsumer('ssh-a', 'browser', false);
  expect(f.manager.snapshot('ssh-a').services).toEqual([]);
  const fresh = deferred<[]>(); discover.mockReturnValue(fresh.promise);
  f.manager.discovery.setConsumer('ssh-a', 'browser', true);
  expect(f.manager.snapshot('ssh-a').services).toEqual([]);
  f.manager.discovery.setConsumer('ssh-a', 'browser', false); fresh.resolve([]);
  await Promise.resolve(); await Promise.resolve(); expect(f.manager.snapshot('ssh-a').services).toEqual([]);
  await f.manager.close();
});
