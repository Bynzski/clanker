import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
type Owner = { key: string; value: string };
type Options = { app?: unknown; repo: string; owner: Owner; workspaceRoots: string[]; children?: unknown[]; timeoutMs?: number };
const { createSmokeOwner, cleanupSmokeFixture } = require('../../../scripts/lib/smoke-fixture-cleanup.cjs') as {
  createSmokeOwner(): Owner;
  cleanupSmokeFixture(options: Options): Promise<{ retiredFixturePtys: number; verifiedPtyExit: boolean; cleanElectronExit: boolean }>;
};
const roots: string[] = [];
const processes: ChildProcess[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const child of processes.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill('SIGKILL'); await exited;
    }
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-cleanup-unit-')); roots.push(repo);
  const entry = path.join(repo, 'dist/main/main/main.js'); fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, 'exports.terminals = new Map();');
  const native = require(entry) as { terminals: Map<string, { cwd: string; environmentId?: string; exited: Promise<void> }> };
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null as string | null,
    kill: vi.fn((signal: string) => { child.signalCode = signal; child.emit('exit', null, signal); }) });
  const order: string[] = [];
  const kill = vi.fn(async (id: string) => { order.push(`retire:${id}`); native.terminals.delete(id); return { success: true }; });
  vi.stubGlobal('window', { electronAPI: { killTerminal: kill } });
  const handle = {
    evaluate: vi.fn(async (callback: (entries: { id: string; exited: Promise<void> }[]) => unknown) => callback(captured)),
    dispose: vi.fn(async () => { order.push('dispose'); }),
  };
  let captured: { id: string; exited: Promise<void> }[] = [];
  const page = { isClosed: () => false, evaluate: (callback: (ids: string[]) => unknown, ids: string[]) => callback(ids) };
  const app = {
    process: () => child, windows: () => [page],
    evaluateHandle: vi.fn(async (callback: (electron: unknown, args: unknown) => unknown, args: unknown) => {
      captured = callback(undefined, args) as typeof captured; return handle;
    }),
    evaluate: vi.fn(async (callback: (electron: unknown, entry: string) => unknown, entry: string) => callback(undefined, entry)),
    close: vi.fn(async () => {
      order.push('close'); expect(native.terminals.size).toBe(0);
      child.exitCode = 0; child.emit('exit', 0, null);
    }),
  };
  const options = { app, repo, owner: createSmokeOwner(), workspaceRoots: [repo], timeoutMs: 50 };
  return { options, app, child, handle, native, kill, order };
}

describe('smoke-owned teardown without close-guard bypass', () => {
  it('retires via IPC, awaits real exit evidence and closes only after the live table is empty', async () => {
    const f = fixture();
    f.options.timeoutMs = 500;
    let exit!: () => void;
    f.native.terminals.set('fixture', { cwd: f.options.repo, environmentId: 'local', exited: new Promise(resolve => { exit = resolve; }) });
    const cleanup = cleanupSmokeFixture(f.options);
    await vi.waitFor(() => expect(f.kill).toHaveBeenCalledWith('fixture'));
    expect(f.app.close).not.toHaveBeenCalled();
    exit();
    expect(await cleanup).toMatchObject({ retiredFixturePtys: 1, verifiedPtyExit: true, cleanElectronExit: true });
    expect(f.order).toEqual(['retire:fixture', 'dispose', 'close']);
  });

  it.each([{ cwd: '/unrelated' }, { environmentId: 'ssh:unrelated' }])('refuses retirement outside local fixture launch roots: %j', async unexpected => {
    const f = fixture();
    f.native.terminals.set('unrelated', { cwd: f.options.repo, exited: Promise.resolve(), ...unexpected });
    await expect(cleanupSmokeFixture(f.options)).rejects.toThrow('Unexpected terminal outside fixture launch roots');
    expect(f.kill).not.toHaveBeenCalled(); expect(f.app.close).not.toHaveBeenCalled();
    expect(f.native.terminals.has('unrelated')).toBe(true);
  });

  it('fails boundedly when PTY exit cannot be verified, but still stops exact owned helper children', async () => {
    const f = fixture();
    f.native.terminals.set('fixture', { cwd: f.options.repo, exited: new Promise(() => {}) });
    const dependency = { exitCode: null, signalCode: null as string | null, kill: vi.fn((signal: string) => { dependency.signalCode = signal; }) };
    await expect(cleanupSmokeFixture({ ...f.options, children: [dependency] })).rejects.toThrow('Verify fixture PTY exit timed out');
    expect(dependency.kill).toHaveBeenCalledWith('SIGTERM'); expect(f.app.close).not.toHaveBeenCalled();
  });

  it('drains tagged helpers after natural Electron exit before waiting for delayed Playwright stdio close', async () => {
    const f = fixture();
    let drained!: () => void;
    f.app.close.mockImplementation(async () => {
      f.child.exitCode = 0; f.child.emit('exit', 0, null);
      await new Promise<void>(resolve => { drained = resolve; });
    });
    const dependency = { exitCode: null, signalCode: null as string | null, kill: vi.fn((signal: string) => { dependency.signalCode = signal; drained(); }) };
    await expect(cleanupSmokeFixture({ ...f.options, children: [dependency] })).resolves.toMatchObject({ cleanElectronExit: true });
    expect(dependency.kill).toHaveBeenCalledTimes(1);
  });

  it.skipIf(process.platform !== 'linux')('reaps only uniquely tagged live descendants even after IPC failure, escalating an ignored SIGTERM', async () => {
    const f = fixture();
    f.app.evaluateHandle.mockRejectedValue(new Error('renderer/transport gone'));
    const launch = async (owner?: Owner) => {
      const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)'], {
        env: { ...process.env, ...(owner ? { [owner.key]: owner.value } : {}) }, stdio: ['ignore', 'pipe', 'ignore'],
      });
      processes.push(child);
      await new Promise<void>((resolve, reject) => { child.stdout!.once('data', () => resolve()); child.once('error', reject); });
      return child;
    };
    const owned = await launch(f.options.owner); const unrelated = await launch();
    await expect(cleanupSmokeFixture(f.options)).rejects.toThrow('renderer/transport gone');
    await vi.waitFor(() => expect(owned.signalCode).toBe('SIGKILL'));
    expect(unrelated.exitCode).toBeNull(); expect(unrelated.signalCode).toBeNull();
    expect(f.app.close).not.toHaveBeenCalled();
  });
});
