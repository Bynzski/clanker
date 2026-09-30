import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSshPortForward } from '../../../src/main/remote/sshPortForward';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));
import { spawn, execFile } from 'node:child_process';
vi.mock('node:net', () => ({ createConnection: vi.fn() }));
import { createConnection, type Socket } from 'node:net';
function mockChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }), stdout: new EventEmitter(), stderr: new EventEmitter(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true; }),
  });
  return child;
}
function ready(child: ReturnType<typeof mockChild>) {
  const calls = vi.mocked(spawn).mock.calls;
  const args = calls[calls.length - 1][1] as string[];
  const marker = args[args.length - 1].match(/clanker-preview-[a-f0-9]+/)![0];
  child.stdout.emit('data', Buffer.from(marker.slice(0, 8)));
  child.stdout.emit('data', Buffer.from(marker.slice(8) + '\n'));
}
function confirmForward(child: ReturnType<typeof mockChild>) {
  child.stderr.emit('data', Buffer.from('debug1: channel 0: new session [client-session]\ndebug2: channel 0: open confirm rwindow 0 rmax 32768\n'));
  child.stderr.emit('data', Buffer.from('debug1: channel 2: new direct-tcpip [direct-tcpip]\ndebug2: channel 2: open con'));
  child.stderr.emit('data', Buffer.from('firm rwindow 2097152 rmax 32768\n'));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createConnection).mockImplementation(() => Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
  }) as unknown as Socket);
  vi.mocked(execFile).mockImplementation(((_cmd: string, _args: string[], _opts: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
    callback(null, 'forkafterauthentication no\nstdinnull no\nsessiontype default\n', '');
    return {};
  }) as typeof execFile);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('SSH port forward', () => {
  it('binds only loopback, avoids sharing/forking, and confirms readiness before reporting success', async () => {
    const child = mockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
    vi.stubEnv('CLANKER_ATTENTION_TOKEN', 'desktop-secret');
    const onExit = vi.fn();
    const started = startSshPortForward('host', 4000, 3000, new AbortController().signal, onExit);
    await Promise.resolve();
    expect(spawn).toHaveBeenCalledWith('ssh', expect.arrayContaining(['127.0.0.1:4000:127.0.0.1:3000', 'ExitOnForwardFailure=yes', 'ControlPath=none', 'forkafterauthentication=no']), expect.any(Object));
    expect(vi.mocked(spawn).mock.calls[0][2]?.env).not.toHaveProperty('CLANKER_ATTENTION_TOKEN');
    ready(child);
    let succeeded = false;
    void started.then(() => { succeeded = true; });
    child.stderr.emit('data', Buffer.from('debug2: channel 0: open confirm rwindow 0 rmax 32768\n'));
    await Promise.resolve();
    expect(succeeded).toBe(false);
    expect(createConnection).toHaveBeenCalledWith({ host: '127.0.0.1', port: 4000 });
    confirmForward(child);
    const handle = await started;
    await handle.close();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(onExit).not.toHaveBeenCalled();
    expect(vi.mocked(createConnection).mock.results[0].value.destroy).toHaveBeenCalled();
  });
  it.each(['administratively prohibited: open failed', 'connect failed: Connection refused'])('rejects a forwarding channel failure despite a successful remote probe: %s', async (reason) => {
    const child = mockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
    const onExit = vi.fn();
    const started = startSshPortForward('host', 4000, 3000, new AbortController().signal, onExit);
    await Promise.resolve();
    ready(child);
    child.stderr.emit('data', Buffer.from('debug1: channel 2: new direct-tcpip [direct-tcpip]\nchannel 2: open fai'));
    child.stderr.emit('data', Buffer.from(`led: ${reason}\n`));
    await expect(started).rejects.toThrow(`SSH preview forwarding failed: ${reason}`);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(vi.mocked(createConnection).mock.results[0].value.destroy).toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });
  it('surfaces a forwarding rejection after startup and releases the owned listener', async () => {
    const child = mockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
    const onExit = vi.fn();
    const started = startSshPortForward('host', 4000, 3000, new AbortController().signal, onExit);
    await Promise.resolve();
    ready(child);
    confirmForward(child);
    await started;
    child.stderr.emit('data', Buffer.from('channel 3: open failed: administratively prohibited: open failed\n'));
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(onExit).toHaveBeenCalledExactlyOnceWith('SSH preview forwarding failed: administratively prohibited: open failed');
  });
  it('cleans up the forwarding probe on cancellation, connection failure, or missing confirmation', async () => {
    vi.useFakeTimers();
    for (const outcome of ['abort', 'error', 'timeout'] as const) {
      const child = mockChild();
      vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
      const controller = new AbortController();
      const started = startSshPortForward('host', 4000, 3000, controller.signal, vi.fn());
      const rejected = expect(started).rejects.toThrow(outcome === 'abort' ? 'cancelled' : outcome === 'error' ? 'ECONNREFUSED' : 'timed out');
      await Promise.resolve();
      ready(child);
      const calls = vi.mocked(createConnection).mock.results;
      const probe = calls[calls.length - 1].value as Socket;
      if (outcome === 'abort') controller.abort();
      else if (outcome === 'error') probe.emit('error', new Error('ECONNREFUSED'));
      else await vi.advanceTimersByTimeAsync(15000);
      await rejected;
      expect(probe.destroy).toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    }
  });
  it('reports bind/auth/service failure and stops the owned process', async () => {
    const child = mockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
    const started = startSshPortForward('host', 4000, 3000, new AbortController().signal, vi.fn());
    await Promise.resolve();
    child.stderr.emit('data', Buffer.from('bind: Address already in use'));
    child.emit('close', 255);
    await expect(started).rejects.toThrow('Address already in use');
  });
  it('reports unexpected exits after readiness and supports explicit cancellation', async () => {
    const child = mockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
    const onExit = vi.fn();
    const started = startSshPortForward('host', 4000, 3000, new AbortController().signal, onExit);
    await Promise.resolve();
    ready(child);
    confirmForward(child);
    await started;
    child.stderr.emit('data', Buffer.from('Connection lost'));
    child.emit('close', 255);
    expect(onExit).toHaveBeenCalledWith('Connection lost');
    const controller = new AbortController();
    const secondChild = mockChild();
    vi.mocked(spawn).mockReturnValue(secondChild as unknown as ChildProcess);
    const second = startSshPortForward('host', 4001, 3000, controller.signal, vi.fn());
    await Promise.resolve();
    controller.abort();
    await expect(second).rejects.toThrow('cancelled');
    expect(secondChild.kill).toHaveBeenCalled();
  });
  it('times out unacknowledged startup and kills the client', async () => {
    vi.useFakeTimers();
    const child = mockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
    const started = startSshPortForward('host', 4000, 3000, new AbortController().signal, vi.fn());
    const rejected = expect(started).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('rejects configured forwards and invalid ports/targets before spawning', async () => {
    vi.mocked(execFile).mockImplementation(((_cmd: string, _args: string[], _opts: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
      callback(null, 'localforward 8080 localhost:8080\n', ''); return {};
    }) as typeof execFile);
    await expect(startSshPortForward('host', 4000, 3000, new AbortController().signal, vi.fn())).rejects.toThrow('already configures');
    await expect(startSshPortForward('-bad', 4000, 3000, new AbortController().signal, vi.fn())).rejects.toThrow('Invalid');
    await expect(startSshPortForward('host', 80, 3000, new AbortController().signal, vi.fn())).rejects.toThrow('Invalid');
    expect(spawn).not.toHaveBeenCalled();
  });
});
