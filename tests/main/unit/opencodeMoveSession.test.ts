import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// The user's home is faked so "user CLI bin directories" can be proven without touching the real one.
const fakeHome = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => fakeHome.dir || actual.homedir() }, homedir: () => fakeHome.dir || actual.homedir() };
});

import { EventEmitter } from 'node:events';
import { moveOpenCodeConversation, planOpenCodeServe, stopTransientServer } from '../../../src/main/harnesses/opencode/rehome';
import { UnverifiedProcessExitError } from '../../../src/main/harnesses/types';

// A stand-in `opencode serve` (a node script named `opencode` on PATH) that records what it was asked, so the
// transient-server protocol is checked without the real CLI: loopback, Basic auth with a fresh password, the
// documented body, and that it is stopped afterwards.
let dir: string;
afterEach(() => { fakeHome.dir = ''; fs.rmSync(dir, { recursive: true, force: true }); });

function fakeOpenCode(moveStatus: number, where = 'bin'): { bin: string; request: string; killed: string; env: string } {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oc-move-')));
  // The user's home is always a sandbox, so a real OpenCode installed on this machine can never shadow the fake.
  fakeHome.dir = path.join(dir, 'home');
  const bin = path.join(dir, where);
  fs.mkdirSync(bin, { recursive: true });
  const record = { request: path.join(dir, 'request.json'), killed: path.join(dir, 'killed'), env: path.join(dir, 'env.json') };
  fs.writeFileSync(path.join(bin, 'opencode'), `#!${process.execPath}
const http = require('node:http'); const fs = require('node:fs');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const host = args[args.indexOf('--hostname') + 1];
const expected = 'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
fs.writeFileSync(${JSON.stringify(record.env)}, JSON.stringify({ attention: Object.keys(process.env).filter((key) => key.startsWith('CLANKER_ATTENTION_')) }));
http.createServer((req, res) => {
  if (req.headers.authorization !== expected) { res.statusCode = 401; return res.end(); }
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method === 'POST') fs.writeFileSync(${JSON.stringify(record.request)}, JSON.stringify({ url: req.url, body: JSON.parse(body), host, cwd: process.cwd() }));
    res.statusCode = req.method === 'POST' ? ${moveStatus} : 200; res.end('{}');
  });
}).listen(port, host);
fs.writeFileSync(${JSON.stringify(path.join(dir, 'pid'))}, String(process.pid));
setTimeout(() => process.exit(0), 20000); // a stand-in never outlives its test
process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(record.killed)}, '1'); process.exit(0); });
`, { mode: 0o755 });
  return { bin, ...record };
}
const onPath = (bin: string) => ({ launch: { baseEnv: { PATH: [bin, path.dirname(process.execPath)].join(path.delimiter) } } });
const posixOnly = process.platform === 'win32' ? it.skip : it;

describe('moveOpenCodeConversation (native contract)', () => {
  posixOnly('asks the native move-session of a loopback, password-protected transient server, then stops it before returning', async () => {
    const fake = fakeOpenCode(204);
    await moveOpenCodeConversation({ sessionId: 'ses_abc', directory: dir, env: process.env }, onPath(fake.bin));
    const request = JSON.parse(fs.readFileSync(fake.request, 'utf8'));
    expect(request).toEqual({ url: '/experimental/control-plane/move-session', body: { sessionID: 'ses_abc', destination: { directory: dir } }, host: '127.0.0.1', cwd: dir });
    expect(request.body).not.toHaveProperty('moveChanges'); // no file is transferred
    expect(fs.existsSync(fake.killed)).toBe(true); // already stopped when the call returned
  });

  posixOnly('rejects when OpenCode refuses, and still stops the server', async () => {
    const fake = fakeOpenCode(400);
    await expect(moveOpenCodeConversation({ sessionId: 'ses_abc', directory: dir, env: process.env }, onPath(fake.bin))).rejects.toThrow(/HTTP 400/);
    expect(fs.existsSync(fake.killed)).toBe(true);
  });

  it('rejects when the CLI cannot be found or started', async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oc-move-')));
    await expect(moveOpenCodeConversation({ sessionId: 'ses_abc', directory: dir, env: process.env }, { launch: { baseEnv: { PATH: path.join(dir, 'empty') } }, command: 'opencode-not-installed' })).rejects.toThrow();
  });

  posixOnly('never forwards Clanker attention credentials to the server', async () => {
    const fake = fakeOpenCode(204);
    await moveOpenCodeConversation({ sessionId: 'ses_abc', directory: dir, env: { ...process.env, CLANKER_ATTENTION_TOKEN: 'secret', CLANKER_ATTENTION_PORT: '1' } }, onPath(fake.bin));
    expect(JSON.parse(fs.readFileSync(fake.env, 'utf8')).attention).toEqual([]);
  });
});

describe('command resolution is the canonical one', () => {
  posixOnly('a desktop/AppImage PATH without user bin directories still finds OpenCode in the user\'s own bin (~/.local/bin)', async () => {
    const fake = fakeOpenCode(204, path.join('home', '.local', 'bin'));
    // PATH knows nothing of the user's directories, exactly as for a GUI launch.
    await moveOpenCodeConversation({ sessionId: 'ses_abc', directory: dir, env: { PATH: '/usr/bin:/bin' } });
    expect(fs.existsSync(fake.request)).toBe(true);
  });

  posixOnly('~/.npm-global/bin is searched too', async () => {
    const fake = fakeOpenCode(204, path.join('home', '.npm-global', 'bin'));
    await moveOpenCodeConversation({ sessionId: 'ses_abc', directory: dir, env: { PATH: '/usr/bin:/bin' } });
    expect(fs.existsSync(fake.request)).toBe(true);
  });

  it('on Windows an npm `.cmd` shim runs through the escaped cmd.exe form, resolved via PATH/PATHEXT (never a bare spawn of "opencode")', () => {
    const shim = 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd';
    const plan = planOpenCodeServe({ port: 4100, password: 'pw', directory: 'C:\\repo', env: { PATH: 'C:\\Users\\me\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' } }, 'opencode',
      { platform: 'win32', baseEnv: { PATH: 'C:\\Users\\me\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, fileExists: (file) => file.toLowerCase() === shim.toLowerCase() });
    expect(plan.plan.file).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(plan.plan.windowsVerbatimArguments).toBe(true);
    expect(plan.plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(plan.plan.args[3].toLowerCase()).toContain(shim.toLowerCase());
    expect(plan.plan.args[3]).toContain('serve');
    expect(plan.env.OPENCODE_SERVER_PASSWORD).toBe('pw');
  });

  it('on Windows a real opencode.exe launches directly, and a missing command fails closed with a typed error', () => {
    const exe = 'C:\\tools\\opencode.exe';
    const base = { PATH: 'C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    const direct = planOpenCodeServe({ port: 1, password: 'pw', directory: 'C:\\repo', env: base }, 'opencode', { platform: 'win32', baseEnv: base, fileExists: (file) => file.toLowerCase() === exe.toLowerCase() });
    expect(direct.plan.file.toLowerCase()).toBe(exe.toLowerCase());
    expect(() => planOpenCodeServe({ port: 1, password: 'pw', directory: 'C:\\repo', env: base }, 'opencode', { platform: 'win32', baseEnv: base, fileExists: () => false })).toThrow(/not installed/);
  });

  it('the plan carries user CLI bin directories on PATH (host platform) and never an attention credential', () => {
    // Resolution is not what is under test here (on Windows nothing named opencode is installed on the runner).
    const plan = planOpenCodeServe({ port: 1, password: 'pw', directory: '/repo', env: { PATH: '/usr/bin', CLANKER_ATTENTION_TOKEN: 'x' } }, 'opencode', { fileExists: () => true });
    const entries = (plan.env.PATH ?? '').split(path.delimiter);
    expect(entries.length).toBeGreaterThan(1);
    expect(entries).toContain(process.platform === 'win32' ? entries.find((entry) => /npm/i.test(entry)) : path.join(os.homedir(), '.local', 'bin'));
    expect(plan.env).not.toHaveProperty('CLANKER_ATTENTION_TOKEN');
  });
});

/** A child whose exit the TEST decides: kill() only records the request, exactly like a signal sent to a process. */
function fakeChild(pid: number | undefined = 4242) {
  const events = new EventEmitter();
  const calls: string[] = [];
  const child = {
    pid, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
    kill: vi.fn((signal?: NodeJS.Signals | number) => { calls.push(`kill ${String(signal)}`); return true; }),
  };
  const exited = new Promise<void>((resolve) => { events.once('exit', () => resolve()); });
  const exit = () => { child.exitCode = 0; events.emit('exit', 0, null); };
  return { child, exited, exit, calls };
}
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const state = (promise: Promise<unknown>) => { const box = { done: false, error: undefined as unknown }; promise.then(() => { box.done = true; }, (error) => { box.done = true; box.error = error; }); return box; };

describe('stopTransientServer: the exit is proven by the child\'s own exit event', () => {
  const timing = { gracefulMs: 60, forcedMs: 60 };

  it('graceful termination: resolves once the real exit happened (POSIX: SIGTERM only)', async () => {
    const { child, exited, exit, calls } = fakeChild();
    const stopping = state(stopTransientServer(child, exited, { ...timing, platform: 'linux' }));
    await tick(10);
    expect(calls).toEqual(['kill SIGTERM']);
    expect(stopping.done).toBe(false); // the signal was sent; nothing is proven yet
    exit();
    await tick(5);
    expect(stopping.done).toBe(true);
    expect(stopping.error).toBeUndefined();
    expect(calls).toEqual(['kill SIGTERM']); // never escalated
  });

  it('CRITICAL: SIGTERM ignored -> SIGKILL requested -> still pending until the REAL exit event', async () => {
    const { child, exited, exit, calls } = fakeChild();
    const stopping = state(stopTransientServer(child, exited, { gracefulMs: 40, forcedMs: 400, platform: 'linux' }));
    await tick(120); // past the graceful bound
    expect(calls).toEqual(['kill SIGTERM', 'kill SIGKILL']); // the forced kill was requested...
    expect(stopping.done).toBe(false); // ...and that alone proves nothing: the helper is still pending
    exit(); // the process really ends
    await tick(5);
    expect(stopping.done).toBe(true);
    expect(stopping.error).toBeUndefined();
  });

  it('forced termination also fails: rejects (bounded, safe text), never succeeds on a timer', async () => {
    const { child, exited, calls } = fakeChild();
    const started = Date.now();
    const outcome = state(stopTransientServer(child, exited, { ...timing, platform: 'linux' }));
    await tick(300);
    expect(outcome.done).toBe(true);
    expect(outcome.error).toBeInstanceOf(UnverifiedProcessExitError);
    expect(String((outcome.error as Error).message)).toBe('The OpenCode relocation server could not be confirmed stopped');
    expect(calls).toEqual(['kill SIGTERM', 'kill SIGKILL']);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('an exit that races the end of the graceful wait still counts, and an already-exited child needs nothing', async () => {
    const done = fakeChild(); done.exit();
    await expect(stopTransientServer(done.child, done.exited, { ...timing, platform: 'linux' })).resolves.toBeUndefined();
    expect(done.calls).toEqual([]);
  });

  describe('Windows: the whole tree, awaited, with the child\'s exit still the final proof', () => {
    it('phase 1 `taskkill /PID n /T`, phase 2 `taskkill /PID n /T /F`, each awaited; resolves only after the child\'s exit event', async () => {
      const { child, exited, exit, calls } = fakeChild(777);
      const commands: string[] = [];
      let finishForced!: () => void;
      const run = vi.fn((command: string, args: string[]) => {
        commands.push([command, ...args].join(' '));
        if (args.includes('/F')) return new Promise<void>((resolve) => { finishForced = resolve; });
        return Promise.resolve();
      });
      const stopping = state(stopTransientServer(child, exited, { gracefulMs: 30, forcedMs: 500, platform: 'win32', run }));
      await tick(80);
      expect(commands).toEqual(['taskkill /PID 777 /T', 'taskkill /PID 777 /T /F']);
      expect(calls).toEqual([]); // no plain kill(): cmd.exe alone would leave the server behind
      expect(stopping.done).toBe(false); // taskkill still running
      finishForced(); // taskkill has completed...
      await tick(30);
      expect(stopping.done).toBe(false); // ...but the OpenCode child has not exited: still not proven
      exit();
      await tick(5);
      expect(stopping.done).toBe(true);
      expect(stopping.error).toBeUndefined();
    });

    it('taskkill succeeding but the child never exiting rejects; a failing/hung taskkill cannot hang or crash the teardown', async () => {
      const { child, exited } = fakeChild(5);
      const failing = vi.fn(async () => { throw new Error('taskkill: access denied'); });
      const outcome = state(stopTransientServer(child, exited, { gracefulMs: 30, forcedMs: 30, platform: 'win32', run: failing }));
      await tick(200);
      expect(outcome.error).toBeInstanceOf(UnverifiedProcessExitError);
      expect(failing).toHaveBeenCalledTimes(2);
    });

    it('a graceful tree kill that works needs no force', async () => {
      const { child, exited, exit } = fakeChild(9);
      const commands: string[] = [];
      const run = vi.fn(async (command: string, args: string[]) => { commands.push([command, ...args].join(' ')); exit(); });
      await stopTransientServer(child, exited, { gracefulMs: 200, platform: 'win32', run });
      expect(commands).toEqual(['taskkill /PID 9 /T']);
    });
  });
});

describe('moveOpenCodeConversation: teardown is part of success', () => {
  posixOnly('a server that ignores SIGTERM is force-killed and the call resolves only after its real exit', async () => {
    const fake = fakeOpenCode(204);
    fs.appendFileSync(path.join(fake.bin, 'opencode'), "process.removeAllListeners('SIGTERM'); process.on('SIGTERM', () => {});\n");
    const started = Date.now();
    await moveOpenCodeConversation({ sessionId: 'ses_abc', directory: dir, env: process.env }, { ...onPath(fake.bin), teardown: { gracefulMs: 150, forcedMs: 3_000 } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(150); // it really waited out the ignored SIGTERM
    expect(fs.existsSync(fake.request)).toBe(true);
  });

  posixOnly('an unprovable teardown REJECTS even though the move itself was accepted (so nothing is resumed afterwards)', async () => {
    const fake = fakeOpenCode(204);
    await expect(moveOpenCodeConversation({ sessionId: 'ses_abc', directory: dir, env: process.env },
      { ...onPath(fake.bin), teardown: { gracefulMs: 1, forcedMs: 1, platform: 'win32', run: async () => undefined } }))
      .rejects.toBeInstanceOf(UnverifiedProcessExitError);
    expect(fs.existsSync(fake.request)).toBe(true); // the move had been accepted: success is still refused
    // This test disabled the real teardown on purpose; end the stand-in it left running.
    try { process.kill(Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8')), 'SIGKILL'); } catch { /* already gone */ }
  });
});
