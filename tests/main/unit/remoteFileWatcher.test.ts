import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { RemoteFileWatcher } from '../../../src/main/remote/remoteFileWatcher';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { SshEnvironment } from '../../../src/main/remote/sshEnvironment';
import type { RemoteFileSnapshot } from '../../../src/shared/types/remoteFileWatch';

describe('remote file watcher', () => {
  const request = { workspaceId: 'remote', filePaths: ['/ws/a', '/ws/b'], directoryPaths: ['/ws'] };
  let registry: WorkspaceRegistry;
  let watcher: RemoteFileWatcher;
  let snapshot: MockInstance<SshEnvironment['snapshotFiles']>;
  const changed = vi.fn();
  const baseline: RemoteFileSnapshot = {
    files: [{ path: '/ws/a', fingerprint: 'a' }, { path: '/ws/b', fingerprint: 'b' }],
    directories: [{ path: '/ws', fingerprint: 'root' }],
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    changed.mockClear();
    const environment = new SshEnvironment({ id: 'ssh-host', kind: 'ssh', label: 'Host', target: 'host' });
    vi.spyOn(environment, 'validateWorkspacePath').mockResolvedValue({ valid: true, resolvedPath: '/ws' });
    snapshot = vi.spyOn(environment, 'snapshotFiles').mockResolvedValue(baseline);
    registry = new WorkspaceRegistry(() => environment);
    await registry.registerWorkspace({ workspaceId: 'remote', workspacePath: '/ws', environmentId: 'ssh-host' });
    watcher = new RemoteFileWatcher({ getWorkspaceRegistry: () => registry, onChanged: changed, intervalMs: 1000 });
  });

  afterEach(() => { watcher.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('batches all targets and emits scoped changes, deletions and directory updates', async () => {
    expect(watcher.sync(request)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith('/ws', request, expect.any(AbortSignal));
    expect(changed.mock.calls[0][0].files.every((file: { initial: boolean }) => file.initial)).toBe(true);
    changed.mockClear();
    snapshot.mockResolvedValueOnce({ files: [{ path: '/ws/a', fingerprint: 'updated' }, { path: '/ws/b', fingerprint: null }], directories: [{ path: '/ws', fingerprint: 'new-directory' }] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).toHaveBeenCalledWith({ workspaceId: 'remote', files: [{ filePath: '/ws/a', deleted: false, initial: false }, { filePath: '/ws/b', deleted: true, initial: false }], directoryPaths: ['/ws'] });
  });

  it('never overlaps snapshots and discards results for superseded targets', async () => {
    let resolve!: (value: RemoteFileSnapshot) => void;
    snapshot.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    watcher.sync(request);
    await vi.advanceTimersByTimeAsync(0);
    watcher.sync({ ...request, filePaths: ['/ws/a'] });
    await vi.advanceTimersByTimeAsync(10000);
    expect(snapshot).toHaveBeenCalledTimes(1);
    resolve(baseline);
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalledTimes(2);
    // The superseded response was discarded; only the new snapshot emits.
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('backs off after failures without reporting missing files and detects changes on recovery', async () => {
    watcher.sync(request);
    await vi.advanceTimersByTimeAsync(0);
    changed.mockClear();
    snapshot.mockRejectedValueOnce(new Error('SSH disconnected'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(snapshot).toHaveBeenCalledTimes(2);
    snapshot.mockResolvedValueOnce({ ...baseline, files: [{ path: '/ws/a', fingerprint: 'reconnected' }] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ files: [{ filePath: '/ws/a', deleted: false, initial: false }] }));
  });

  it('allows retrying existing unchanged files without emitting false change notifications', async () => {
    watcher.sync(request);
    await vi.advanceTimersByTimeAsync(0);
    changed.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).toHaveBeenCalledWith({ workspaceId: 'remote', files: [], directoryPaths: [], unchangedFilePaths: ['/ws/a', '/ws/b'], unchangedDirectoryPaths: ['/ws'] });
  });

  it('reports unchanged directories after recovery even when no files are watched', async () => {
    snapshot.mockResolvedValue({ files: [], directories: baseline.directories });
    watcher.sync({ ...request, filePaths: [] });
    await vi.advanceTimersByTimeAsync(0);
    snapshot.mockResolvedValueOnce({ files: [], directories: [{ path: '/ws', fingerprint: 'updated' }] });
    await vi.advanceTimersByTimeAsync(1000);
    changed.mockClear();
    snapshot.mockRejectedValueOnce(new Error('SSH disconnected'));
    snapshot.mockResolvedValue({ files: [], directories: [{ path: '/ws', fingerprint: 'updated' }] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(changed).toHaveBeenCalledWith({ workspaceId: 'remote', files: [], directoryPaths: [], unchangedDirectoryPaths: ['/ws'] });
  });

  it('discards responses from another SSH workspace with the same root', async () => {
    await registry.registerWorkspace({ workspaceId: 'other', workspacePath: '/ws', environmentId: 'different-ssh-host' });
    let resolve!: (value: RemoteFileSnapshot) => void;
    snapshot.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    watcher.sync(request);
    await vi.advanceTimersByTimeAsync(0);
    watcher.sync({ ...request, workspaceId: 'other' });
    expect(snapshot.mock.calls[0][2]!.aborted).toBe(true);
    resolve(baseline);
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'other' }));
  });

  it('aborts a closed workspace and ignores its late response', async () => {
    let resolve!: (value: RemoteFileSnapshot) => void;
    snapshot.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    watcher.sync(request);
    await vi.advanceTimersByTimeAsync(0);
    const signal = snapshot.mock.calls[0][2]!;
    watcher.closeWorkspace('remote');
    registry.unregisterWorkspace('remote');
    expect(signal.aborted).toBe(true);
    resolve(baseline);
    await vi.advanceTimersByTimeAsync(10000);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it('rejects root escapes, unregistered workspaces and excessive targets', () => {
    expect(watcher.sync({ ...request, filePaths: ['/outside'] })).toBe(false);
    expect(watcher.sync({ ...request, workspaceId: 'missing' })).toBe(false);
    expect(watcher.sync({ ...request, filePaths: Array(129).fill('/ws/a') })).toBe(false);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('retains a parked workspace baseline and stops timers when switching to local', async () => {
    watcher.sync(request);
    await vi.advanceTimersByTimeAsync(0);
    watcher.sync(null);
    changed.mockClear();
    await vi.advanceTimersByTimeAsync(10000);
    expect(snapshot).toHaveBeenCalledTimes(1);
    snapshot.mockResolvedValueOnce({ ...baseline, files: [{ path: '/ws/a', fingerprint: 'changed-while-parked' }] });
    watcher.sync(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ files: [{ filePath: '/ws/a', deleted: false, initial: false }] }));
  });

  it('clears failure-backoff timers on close and does not schedule more SSH work', async () => {
    snapshot.mockRejectedValue(new Error('SSH disconnected'));
    watcher.sync(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    watcher.closeWorkspace('remote');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(snapshot).toHaveBeenCalledTimes(1);
  });
});
