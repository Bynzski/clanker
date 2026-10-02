import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSshPortForward } from '../../../src/main/remote/sshPortForward';
vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));
import { spawn, execFile } from 'node:child_process';
vi.mock('node:net', () => ({ createConnection: vi.fn() }));
import { createConnection, type Socket } from 'node:net';
function child() {
  const result = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn(() => { queueMicrotask(() => result.emit('close', null)); return true; }) });
  return result;
}
function ready(process: ReturnType<typeof child>, port = 4000) {
  process.stderr.emit('data', Buffer.from(`debug1: Local forwarding listening on 127.0.0.1 port ${port}.\n`));
  const results = vi.mocked(createConnection).mock.results;
  results[results.length - 1].value.emit('connect');
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createConnection).mockImplementation(() => Object.assign(new EventEmitter(), { destroy: vi.fn() }) as unknown as Socket);
  vi.mocked(execFile).mockImplementation(((_cmd: string, _args: string[], _opts: unknown, callback: (error: null, stdout: string, stderr: string) => void) => { callback(null, 'forkafterauthentication no\nstdinnull no\nsessiontype default\n', ''); return {}; }) as typeof execFile);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('SSH preview transport', () => {
  it.each(['127.0.0.1', '::1'] as const)('binds only desktop loopback and forwards to %s without a remote helper', async (host) => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as unknown as ChildProcess);
    vi.stubEnv('CLANKER_ATTENTION_TOKEN', 'desktop-secret');
    const exit = vi.fn(); const pending = startSshPortForward('host', 4000, 3000, new AbortController().signal, exit, host);
    await Promise.resolve();
    expect(spawn).toHaveBeenCalledWith('ssh', expect.arrayContaining(['-N', `127.0.0.1:4000:${host === '::1' ? '[::1]' : host}:3000`, 'ControlPath=none', 'GatewayPorts=no']), expect.any(Object));
    expect(vi.mocked(spawn).mock.calls[0][1]).not.toContain('python3');
    expect(vi.mocked(spawn).mock.calls[0][2]?.env).not.toHaveProperty('CLANKER_ATTENTION_TOKEN');
    ready(process); const handle = await pending;
    // The service may be absent/restarting; SSH must survive refused channels.
    process.stderr.emit('data', Buffer.from('channel 2: open failed: connect failed: Connection refused\n'));
    expect(process.kill).not.toHaveBeenCalled(); expect(exit).not.toHaveBeenCalled();
    await handle.close(); expect(process.kill).toHaveBeenCalledWith('SIGTERM'); expect(exit).not.toHaveBeenCalled();
  });
  it.each([false, true])('fails closed for SSH forwarding policy rejection, ready=%s', async (afterReady) => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as unknown as ChildProcess);
    const exit = vi.fn(); const pending = startSshPortForward('host', 4000, 3000, new AbortController().signal, exit);
    await Promise.resolve();
    if (afterReady) { ready(process); await pending; }
    const rejected = afterReady ? Promise.resolve() : expect(pending).rejects.toThrow('SSH server rejected TCP forwarding');
    process.stderr.emit('data', Buffer.from('channel 2: open failed: administratively prohibited: open failed\n'));
    await rejected; await Promise.resolve();
    expect(process.kill).toHaveBeenCalled();
    if (afterReady) expect(exit).toHaveBeenCalledWith('SSH server rejected TCP forwarding');
  });
  it('classifies bind conflicts for automatic retry and does not expose diagnostics', async () => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as unknown as ChildProcess);
    const pending = startSshPortForward('host', 4000, 3000, new AbortController().signal, vi.fn());
    await Promise.resolve(); const rejected = expect(pending).rejects.toMatchObject({ kind: 'bind-conflict' });
    process.stderr.emit('data', Buffer.from('bind: Address already in use\n')); await rejected;
  });
  it('reports unexpected disconnects and ignores intentional/late shutdown callbacks', async () => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as unknown as ChildProcess);
    const exit = vi.fn(); const pending = startSshPortForward('host', 4000, 3000, new AbortController().signal, exit);
    await Promise.resolve(); ready(process); await pending;
    process.stderr.emit('data', Buffer.from('debug2: secret log\nConnection reset\n')); process.emit('close', 255);
    expect(exit).toHaveBeenCalledWith('SSH connection lost');
  });
  it('cancels pending startup and enforces its deadline', async () => {
    vi.useFakeTimers();
    for (const abort of [true, false]) {
      const process = child(); vi.mocked(spawn).mockReturnValue(process as unknown as ChildProcess);
      const controller = new AbortController(); const pending = startSshPortForward('host', 4000, 3000, controller.signal, vi.fn());
      const rejected = expect(pending).rejects.toThrow(); await Promise.resolve();
      if (abort) controller.abort(); else await vi.advanceTimersByTimeAsync(15000);
      await rejected; expect(process.kill).toHaveBeenCalled();
    }
  });
  it('rejects configured forwards, non-loopback targets and unsafe ports before spawning', async () => {
    vi.mocked(execFile).mockImplementation(((_cmd: string, _args: string[], _opts: unknown, callback: (error: null, stdout: string, stderr: string) => void) => { callback(null, 'localforward 8080 localhost:8080\n', ''); return {}; }) as typeof execFile);
    await expect(startSshPortForward('host', 4000, 3000, new AbortController().signal, vi.fn())).rejects.toThrow('already configures');
    await expect(startSshPortForward('-bad', 4000, 3000, new AbortController().signal, vi.fn())).rejects.toThrow('Invalid');
    await expect(startSshPortForward('host', 80, 3000, new AbortController().signal, vi.fn())).rejects.toThrow('Invalid');
    await expect(startSshPortForward('host', 4000, 3000, new AbortController().signal, vi.fn(), '0.0.0.0' as never)).rejects.toThrow('Invalid');
    expect(spawn).not.toHaveBeenCalled();
  });
});
