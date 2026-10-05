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

import { killProcessTree, moveOpenCodeConversation, planOpenCodeServe } from '../../../src/main/harnesses/opencode/rehome';

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
  fs.writeFileSync(path.join(bin, 'opencode'), `#!/usr/bin/env node
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
    const plan = planOpenCodeServe({ port: 1, password: 'pw', directory: '/repo', env: { PATH: '/usr/bin', CLANKER_ATTENTION_TOKEN: 'x' } });
    const entries = (plan.env.PATH ?? '').split(path.delimiter);
    expect(entries.length).toBeGreaterThan(1);
    expect(entries).toContain(process.platform === 'win32' ? entries.find((entry) => /npm/i.test(entry)) : path.join(os.homedir(), '.local', 'bin'));
    expect(plan.env).not.toHaveProperty('CLANKER_ATTENTION_TOKEN');
  });
});

describe('killProcessTree', () => {
  it('kills the whole tree with taskkill on Windows (the shim runs the server as a grandchild of cmd.exe)', () => {
    const run = vi.fn();
    const kill = vi.fn();
    killProcessTree({ pid: 4242, kill }, 'win32', run);
    expect(run).toHaveBeenCalledWith('taskkill', ['/pid', '4242', '/T', '/F']);
    expect(kill).not.toHaveBeenCalled();
  });
  it('uses an ordinary kill elsewhere, and never throws', () => {
    const kill = vi.fn(() => { throw new Error('gone'); });
    expect(() => killProcessTree({ pid: 1, kill }, 'linux', vi.fn())).not.toThrow();
    expect(kill).toHaveBeenCalled();
  });
});
