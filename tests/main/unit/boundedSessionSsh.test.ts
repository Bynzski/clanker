import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChildProcess } from 'child_process';

vi.mock('child_process', async (importOriginal) => ({ ...(await importOriginal<typeof import('child_process')>()), spawn: vi.fn(), execFile: vi.fn() }));
import { spawn } from 'child_process';

import { SshCommandExecutor } from '../../../src/main/remote/sshCommandExecutor';
import { SshEnvironment } from '../../../src/main/remote/sshEnvironment';
import { planLocalLaunch } from '../../../src/main/environment/localCommandExecutor';
import { normalizeHarnessCommand } from '../../../src/main/harnesses/commandExecution';
import { KNOWN_HARNESS_IDS } from '../../../src/shared/harnessIds';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  written = '';
  kill = vi.fn((signal?: string) => { setImmediate(() => this.finish(null, (signal ?? 'SIGTERM') as NodeJS.Signals)); return true; });
  constructor() { super(); this.stdin.on('data', (chunk) => { this.written += String(chunk); }); }
  finish(code: number | null, signal: NodeJS.Signals | null = null) { this.exitCode = code; this.signalCode = signal; this.emit('close', code, signal); }
  spawned() { setImmediate(() => this.emit('spawn')); return this; }
}
const nextChild = (): FakeChild => { const child = new FakeChild().spawned(); vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess); return child; };
const environment = () => new SshEnvironment({ kind: 'ssh', id: 'ssh-1', label: 'r', target: 'me@remote' }, new SshCommandExecutor());

beforeEach(() => { vi.mocked(spawn).mockReset(); });

describe('SSH bounded session', () => {
  it('spawns only the OpenSSH client for the registered target, with validated quoting, cwd and env', async () => {
    const child = nextChild();
    const session = await environment().openHarnessCommandSession({ command: 'tool', args: ['serve', "it's"], cwd: '/ws', env: { FOO: 'bar' } });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [binary, args, options] = vi.mocked(spawn).mock.calls[0] as unknown as [string, string[], { stdio: string[]; shell?: unknown }];
    expect(binary).toBe('ssh');
    expect(args.slice(0, 5)).toEqual(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'me@remote']);
    expect(args[5]).toMatch(/^cd '\/ws' && FOO='bar' 'sh' '-c' /);
    expect(args[5]).toContain('exec ');
    expect(args[5]).toMatch(/tool.*serve/s);
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(options.shell).toBeUndefined();
    await session.writeLine('ping');
    expect(child.written).toBe('ping\n');
    child.stdout.write('pong\r\n');
    expect(await session.readLine()).toBe('pong');
    await session.closeInput();
    child.finish(0);
    expect(await session.readLine()).toBeNull();
    expect(await session.wait()).toEqual({ stderr: '', exitCode: 0 });
  });

  it('never falls back to a local process: only ssh is ever spawned, and a failure stays a failure', async () => {
    const child = nextChild();
    const session = await environment().openHarnessCommandSession({ command: 'tool' });
    child.finish(255);
    await expect(session.readLine()).rejects.toMatchObject({ kind: 'transport-failure' });
    await expect(session.wait()).rejects.toMatchObject({ kind: 'transport-failure' });
    expect(vi.mocked(spawn).mock.calls.map((call) => call[0])).toEqual(['ssh']);
  });

  it('keeps a remote program exit as a result, but not OpenSSH failure or signal death', async () => {
    const ok = nextChild();
    const a = await environment().openHarnessCommandSession({ command: 'tool' });
    ok.stderr.write('remote complaint');
    ok.finish(2);
    expect(await a.wait()).toEqual({ stderr: 'remote complaint', exitCode: 2 });
    const killed = nextChild();
    const b = await environment().openHarnessCommandSession({ command: 'tool' });
    killed.finish(null, 'SIGHUP');
    await expect(b.wait()).rejects.toMatchObject({ kind: 'transport-failure' });
  });

  it('reports a spawn failure as a transport failure', async () => {
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
    setImmediate(() => child.emit('error', Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' })));
    await expect(environment().openHarnessCommandSession({ command: 'tool' })).rejects.toMatchObject({ kind: 'transport-failure' });
  });

  it('scrubs desktop attention credentials from the client environment and rejects forwarding them', async () => {
    process.env.CLANKER_ATTENTION_TOKEN = 'desktop-secret';
    try {
      nextChild();
      await environment().openHarnessCommandSession({ command: 'tool' });
      const options = vi.mocked(spawn).mock.calls[0][2] as unknown as { env: Record<string, string> };
      expect(options.env.CLANKER_ATTENTION_TOKEN).toBeUndefined();
      await expect(environment().openHarnessCommandSession({ command: 'tool', env: { CLANKER_ATTENTION_TOKEN: 'x' } })).rejects.toBeDefined();
      await expect(environment().openHarnessCommandSession({ command: 'tool', stdin: 'x' })).rejects.toMatchObject({ kind: 'command-failed' });
    } finally { delete process.env.CLANKER_ATTENTION_TOKEN; }
  });

  it('is cancelled before open and by abort afterwards, terminating the ssh client', async () => {
    const early = new AbortController(); early.abort();
    await expect(environment().openHarnessCommandSession({ command: 'tool' }, early.signal)).rejects.toMatchObject({ kind: 'aborted' });
    expect(spawn).not.toHaveBeenCalled();

    const child = nextChild();
    const controller = new AbortController();
    const session = await environment().openHarnessCommandSession({ command: 'tool' }, controller.signal);
    const pending = session.readLine();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    await session.dispose();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.signalCode).toBe('SIGTERM');
  });

  it('enforces timeout, cumulative output, and dispose idempotently (reaping the client)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const timed = nextChild();
      const a = await environment().openHarnessCommandSession({ command: 'tool', timeoutMs: 1000 });
      const pending = a.readLine().catch((error) => error);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toMatchObject({ kind: 'timeout' });
      await vi.advanceTimersByTimeAsync(10);
      expect(timed.kill).toHaveBeenCalled();
      await a.dispose(); await a.dispose();
    } finally { vi.useRealTimers(); }

    const flood = nextChild();
    const b = await environment().openHarnessCommandSession({ command: 'tool', maxOutputBytes: 100 });
    flood.stdout.write('x'.repeat(60)); flood.stdout.write('x'.repeat(60));
    await expect(b.readLine()).rejects.toMatchObject({ kind: 'output-limit' });
    await b.dispose();
    expect(flood.kill).toHaveBeenCalled();
  });
});

describe('Windows launch planning follows the bounded-spawn rules', () => {
  const files = new Set(['c:\\bin\\tool.exe', 'c:\\npm\\shim.cmd']);
  const overrides = { platform: 'win32' as const, baseEnv: { Path: 'C:\\bin;C:\\npm', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe', CLANKER_ATTENTION_TOKEN: 'secret' },
    fileExists: (file: string) => files.has(file.toLowerCase()) };

  it('launches .exe directly with intact argv, strips credentials and keeps one PATH key', () => {
    const { plan, env } = planLocalLaunch(normalizeHarnessCommand({ command: 'tool', args: ['a b', '&', '%X%'] }), overrides);
    expect(plan.file.toLowerCase()).toBe('c:\\bin\\tool.exe');
    expect(plan.args).toEqual(['a b', '&', '%X%']);
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toHaveLength(1);
    expect(env.CLANKER_ATTENTION_TOKEN).toBeUndefined();
  });
  it('routes .cmd through cmd.exe verbatim and rejects unsafe batch arguments, with typed errors', () => {
    const { plan } = planLocalLaunch(normalizeHarnessCommand({ command: 'shim', args: ['x&y'] }), overrides);
    expect(plan).toMatchObject({ file: 'C:\\Windows\\System32\\cmd.exe', windowsVerbatimArguments: true });
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(() => planLocalLaunch(normalizeHarnessCommand({ command: 'shim', args: ['%X%'] }), overrides)).toThrow(expect.objectContaining({ kind: 'command-failed' }));
    expect(() => planLocalLaunch(normalizeHarnessCommand({ command: 'missing' }), overrides)).toThrow(expect.objectContaining({ kind: 'binary-unavailable' }));
  });
  it('never uses a shell option', () => {
    for (const file of ['environment/localCommandExecutor.ts', 'environment/boundedSession.ts', 'environment/boundedSpawn.ts', 'remote/sshHarnessCommand.ts']) {
      expect(readFileSync(resolve(__dirname, '../../../src/main', file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(/shell\s*:/);
    }
  });
});

describe('shared execution code stays protocol- and harness-neutral', () => {
  it('contains no harness IDs and no JSON-RPC/Codex protocol strings', () => {
    const files = ['harnesses/commandExecution.ts', 'environment/boundedSession.ts', 'environment/boundedSpawn.ts', 'environment/localCommandExecutor.ts', 'remote/sshHarnessCommand.ts', 'remote/sshCommandExecutor.ts'];
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, '../../../src/main', file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(source, file).not.toMatch(/jsonrpc|rateLimits|account\/|["']initialized?["']|app-server/i);
      for (const id of KNOWN_HARNESS_IDS) expect(source, `${file}:${id}`).not.toMatch(new RegExp(`['"\`]${id}['"\`]`));
    }
    expect(readdirSync(resolve(__dirname, '../../../src/main/harnesses/codex'))).not.toContain('usage.ts');
  });
});
