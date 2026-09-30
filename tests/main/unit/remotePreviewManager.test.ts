import { describe, expect, it, vi } from 'vitest';
import { RemotePreviewManager } from '../../../src/main/remote/remotePreviewManager';
import type { WorkspaceRegistry, RegisteredWorkspace } from '../../../src/main/workspaceRegistry';
import type { PortForwardHandle } from '../../../src/main/remote/sshPortForward';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((res) => { resolve = res; }); return { promise, resolve }; }
function fixture() {
  const close = vi.fn().mockResolvedValue(undefined);
  const startPortForward = vi.fn().mockResolvedValue({ close });
  const workspace = { workspaceId: 'ssh-a', location: { environmentId: 'host', path: '/same' }, environment: { kind: 'ssh', startPortForward } } as unknown as RegisteredWorkspace;
  const workspaces = new Map([['ssh-a', workspace], ['ssh-b', { ...workspace, workspaceId: 'ssh-b' }],
    ['local', { ...workspace, workspaceId: 'local', environment: { kind: 'local' } } as RegisteredWorkspace]]);
  const notify = vi.fn();
  const manager = new RemotePreviewManager({ getWorkspace: (id: string) => workspaces.get(id) ?? null } as WorkspaceRegistry, notify);
  return { manager, startPortForward, close, workspace, workspaces, notify };
}
const request = { workspaceId: 'ssh-a', localPort: 4000, remotePort: 3000 };

describe('RemotePreviewManager', () => {
  it('routes through the registered SSH environment and rejects local, unknown and invalid requests', async () => {
    const { manager, startPortForward } = fixture();
    for (const invalid of [{ ...request, workspaceId: 'local' }, { ...request, workspaceId: 'unknown' },
      { ...request, localPort: 0 }, { ...request, remotePort: 65536 }, { ...request, remotePort: 3000.1 }]) {
      expect((await manager.start(invalid)).success).toBe(false);
    }
    expect(startPortForward).not.toHaveBeenCalled();
    expect(await manager.start(request)).toEqual({ success: true, forward: { ...request, status: 'active', url: 'http://127.0.0.1:4000/' } });
    expect(startPortForward).toHaveBeenCalledWith(4000, 3000, expect.any(AbortSignal), expect.any(Function));
    await manager.stop('ssh-a');
  });
  it('reserves a local port across startup and stop, then releases it after cleanup', async () => {
    const { manager, startPortForward, close } = fixture();
    const pending = deferred<PortForwardHandle>();
    const closing = deferred<void>();
    startPortForward.mockReturnValueOnce(pending.promise);
    close.mockReturnValueOnce(closing.promise);
    const started = manager.start(request);
    expect((await manager.start({ ...request, workspaceId: 'ssh-b' })).error).toContain('already used');
    pending.resolve({ close });
    await started;
    const stopped = manager.stop('ssh-a');
    await Promise.resolve();
    expect(manager.get('ssh-a')?.status).toBe('stopping');
    expect((await manager.start({ ...request, workspaceId: 'ssh-b' })).success).toBe(false);
    closing.resolve();
    await stopped;
    expect(manager.get('ssh-a')).toBeNull();
    expect((await manager.start({ ...request, workspaceId: 'ssh-b' })).success).toBe(true);
    await manager.stop('ssh-b');
  });
  it('cancels pending starts on workspace close and closes handles returned late', async () => {
    const { manager, startPortForward, close, workspaces } = fixture();
    const pending = deferred<PortForwardHandle>();
    startPortForward.mockReturnValueOnce(pending.promise);
    const started = manager.start(request);
    const signal = startPortForward.mock.calls[0][2] as AbortSignal;
    const stopped = manager.stop('ssh-a');
    workspaces.delete('ssh-a');
    expect(signal.aborted).toBe(true);
    pending.resolve({ close });
    expect((await started).success).toBe(false);
    await stopped;
    expect(close).toHaveBeenCalled();
    expect(manager.get('ssh-a')).toBeNull();
  });
  it('rejects a replaced registration and exposes SSH errors with explicit retry', async () => {
    const { manager, startPortForward, close, workspaces, workspace } = fixture();
    const pending = deferred<PortForwardHandle>();
    startPortForward.mockReturnValueOnce(pending.promise);
    const started = manager.start(request);
    workspaces.set('ssh-a', { ...workspace });
    pending.resolve({ close });
    expect((await started).success).toBe(false);
    expect(close).toHaveBeenCalled();
    expect((await manager.start(request)).success).toBe(true);
    const onExit = startPortForward.mock.calls[1][3] as (error: string) => void;
    onExit('SSH disconnected');
    expect(manager.get('ssh-a')).toMatchObject({ status: 'error', error: 'SSH disconnected' });
    expect((await manager.start(request)).success).toBe(true);
    await manager.stop('ssh-a');
  });
  it('cleans all forwards on shutdown and refuses subsequent starts', async () => {
    const { manager, close } = fixture();
    await manager.start(request);
    manager.close();
    await manager.stop('ssh-a');
    expect(close).toHaveBeenCalled();
    expect((await manager.start(request)).success).toBe(false);
  });
});
