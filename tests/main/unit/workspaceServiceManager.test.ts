import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { IPty } from 'node-pty';
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
import { WorkspaceServiceManager } from '../../../src/main/services/workspaceServiceManager';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { releaseCheckoutContext } from '../../../src/main/checkoutContextRelease';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import type { AgentLocation } from '../../../src/shared/types/agentAttention';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { probeRecipePreview } from '../../../src/main/recipePreview';
import type { WorkspaceServicesUpdate } from '../../../src/shared/types/workspaceServices';
import { isLiveWorkspaceService, type DevServiceStartRequest } from '../../../src/shared/types/workspaceServices';

function environment(kind: 'local' | 'ssh' = 'local') {
  return {
    id: kind, kind,
    validateWorkspacePath: vi.fn(async (path: string) => ({ valid: true, resolvedPath: path })),
    readFile: vi.fn(async () => ({ success: true, content: JSON.stringify({ scripts: { dev: 'arbitrary project command' } }) })),
    listDirectory: vi.fn(async () => ({ success: true, entries: [] })),
  } as unknown as WorkspaceEnvironment;
}
function fakePty(pid: number, alive: Set<number>) {
  let data: (value: string) => void = () => undefined;
  let exit: (value: { exitCode: number; signal: number }) => void = () => undefined;
  const child = {
    pid, onData: vi.fn((fn) => { data = fn; return { dispose: vi.fn() }; }),
    onExit: vi.fn((fn) => { exit = fn; return { dispose: vi.fn() }; }),
    kill: vi.fn(() => exit({ exitCode: 0, signal: 15 })),
  };
  return {
    child: child as unknown as IPty, data: (value: string) => data(value),
    /** The whole service ends: the leader exits and no descendant remains in the group. */
    exit: (code: number, signal = 0) => { alive.delete(pid); exit({ exitCode: code, signal }); },
    /** Only the leader (npm) exits; descendants of the process group keep running. */
    exitLeader: (code: number, signal = 0) => exit({ exitCode: code, signal }),
  };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('workspace-owned dev services', () => {
  let registry: WorkspaceRegistry;
  let env: WorkspaceEnvironment;
  let manager: WorkspaceServiceManager;
  let location: AgentLocation | null;
  let shuttingDown: boolean;
  let a: CheckoutContext, b: CheckoutContext;
  let terminals: Map<string, { workspaceId: string; checkoutContextId: string }>;
  let children: ReturnType<typeof fakePty>[];
  /** Process groups that still have members; `signalGroup` below is the only way (besides exit) one empties. */
  let alive: Set<number>;
  let resistTerm: boolean;
  let spawn: Mock<typeof import('node-pty').spawn>;
  let probe: Mock<typeof probeRecipePreview>;
  let signalGroup: Mock<(pid: number, signal: NodeJS.Signals) => void>;
  let isGroupAlive: Mock<(pgid: number) => boolean>;
  let stubborn: boolean;
  let changed: Mock<(update: WorkspaceServicesUpdate) => void>;
  const request = (terminalId = 'a'): DevServiceStartRequest => ({ workspaceId: 'ws', terminalId, checkoutContextId: terminals.get(terminalId)!.checkoutContextId, cwd: registry.resolveCheckoutContext('ws', terminals.get(terminalId)!.checkoutContextId)!.path, command: 'npm run dev' });

  beforeEach(async () => {
    vi.useFakeTimers();
    env = environment();
    registry = new WorkspaceRegistry(() => env);
    await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: '/repo' });
    a = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: '/repo-worktrees/a', kind: 'worktree' })).checkoutContext!;
    b = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: '/repo-worktrees/b', kind: 'worktree' })).checkoutContext!;
    terminals = new Map([['a', { workspaceId: 'ws', checkoutContextId: a.id }], ['b', { workspaceId: 'ws', checkoutContextId: b.id }], ['main', { workspaceId: 'ws', checkoutContextId: 'ws::main' }]]);
    location = null; shuttingDown = false; children = []; alive = new Set(); stubborn = false; resistTerm = false;
    spawn = vi.fn(() => { const child = fakePty(1000 + children.length, alive); alive.add(1000 + children.length); children.push(child); return child.child; });
    probe = vi.fn(async () => ({ status: 'ready' as const, host: '127.0.0.1', port: 5173 }));
    // SIGKILL always empties a group unless `stubborn` (a process that cannot be killed); SIGTERM unless `resistTerm`.
    signalGroup = vi.fn((pid, signal) => { if (!stubborn && (signal === 'SIGKILL' || !resistTerm)) alive.delete(pid); });
    isGroupAlive = vi.fn((pgid) => alive.has(pgid));
    changed = vi.fn();
    manager = new WorkspaceServiceManager({ registry, getTerminal: (id) => terminals.get(id), getLocation: () => location,
      isShuttingDown: () => shuttingDown, spawn, probe, signalGroup, isGroupAlive, changed, canonicalRoot: (path) => path,
      timing: { graceMs: 200, killMs: 200, pollMs: 10 } });
  });
  afterEach(async () => { stubborn = false; const closing = manager.shutdown().catch(() => undefined); await vi.runAllTimersAsync(); await closing; vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('discovers without spawning, then starts immediately with registered worktree cwd and fixed argv, no renderer handshake', async () => {
    expect(await manager.discover({ workspaceId: 'ws', terminalId: 'a' })).toMatchObject({ success: true, command: { command: 'npm run dev', cwd: a.path } });
    expect(spawn).not.toHaveBeenCalled();
    const result = await manager.start(request());
    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'dev'], expect.objectContaining({ cwd: a.path, handleFlowControl: false }));
    // Running means the process exists; it never waits on a timer. Readiness is the separate previewUrl.
    expect(result.service?.status).toBe('running');
    expect(result.service?.previewUrl).toBeUndefined();
    expect(changed).toHaveBeenCalled();
  });
  it('runs main and two worktrees independently; stopping one leaves the others running', async () => {
    const first = await manager.start(request('a'));
    await manager.start(request('b')); await manager.start(request('main'));
    expect(children).toHaveLength(3);
    expect(spawn.mock.calls.map((call) => call[2].cwd)).toEqual([a.path, b.path, '/repo']);
    const stopping = manager.stop('ws', first.service!.id);
    expect(manager.usages()).toHaveLength(3); // Preserve usage until descendants have been escalated.
    await vi.advanceTimersByTimeAsync(1000); await stopping;
    expect(manager.usages()).toHaveLength(2);
    expect(children[1].child.kill).not.toHaveBeenCalled();
    expect(children[2].child.kill).not.toHaveBeenCalled();
    expect(signalGroup).toHaveBeenCalledWith(1000, 'SIGTERM');
    expect(signalGroup).not.toHaveBeenCalledWith(1000, 'SIGKILL'); // Graceful termination was enough.
    expect(signalGroup).not.toHaveBeenCalledWith(1001, expect.anything());
  });
  it('applies persisted checkout environment only to its own service and requires fresh confirmation', async () => {
    const discovery = await manager.discover({ workspaceId: 'ws', terminalId: 'a' });
    const saved = await manager.saveSettings({ ...request(), settingsRevision: discovery.command!.settingsRevision, environment: { PORT: '8788', VITE_DEV_PORT: '5174' } });
    expect(saved.success).toBe(true);
    expect((await manager.start(request())).error).toContain('settings changed');
    expect((await manager.start({ ...request(), settingsRevision: saved.command!.settingsRevision })).success).toBe(true);
    await manager.start(request('main'));
    expect(spawn.mock.calls[0][2].env).toMatchObject({ PORT: '8788', VITE_DEV_PORT: '5174' });
    expect(spawn.mock.calls[1][2].env?.VITE_DEV_PORT).toBe(process.env.VITE_DEV_PORT);
    expect(manager.snapshot().services[0]).not.toHaveProperty('environment');
  });
  it('refuses settings edits during pending/live services, including another workspace for the same physical root', async () => {
    const discovery = await manager.discover({ workspaceId: 'ws', terminalId: 'a' });
    const edit = { ...request(), settingsRevision: discovery.command!.settingsRevision, environment: { PORT: '8788' } };
    let finish!: (value: { success: boolean; content: string }) => void;
    vi.mocked(env.readFile).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const starting = manager.start(request());
    expect((await manager.saveSettings(edit)).error).toContain('Stop');
    finish({ success: true, content: '{"scripts":{"dev":"vite"}}' });
    await starting;
    expect((await manager.saveSettings(edit)).error).toContain('Stop');
    await registry.registerWorkspace({ workspaceId: 'other', workspacePath: a.path });
    terminals.set('other', { workspaceId: 'other', checkoutContextId: 'other::main' });
    expect((await manager.saveSettings({ ...edit, workspaceId: 'other', terminalId: 'other', checkoutContextId: 'other::main' })).error).toContain('Stop');
  });
  it('rechecks checkout identity and concurrent edits after asynchronous settings discovery', async () => {
    const discovery = await manager.discover({ workspaceId: 'ws', terminalId: 'a' });
    const edit = { ...request(), settingsRevision: discovery.command!.settingsRevision, environment: { PORT: '8788' } };
    const results = await Promise.all([manager.saveSettings(edit), manager.saveSettings({ ...edit, environment: { PORT: '8789' } })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    let finish!: (value: { success: boolean; content: string }) => void;
    vi.mocked(env.readFile).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const saving = manager.saveSettings({ ...edit, settingsRevision: results[0].command!.settingsRevision });
    registry.unregisterCheckoutContext(a.id);
    finish({ success: true, content: '{"scripts":{"dev":"vite"}}' });
    expect((await saving).success).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('coalesces two conversations sharing a checkout into one service', async () => {
    terminals.set('other', { workspaceId: 'ws', checkoutContextId: a.id });
    const [one, two] = await Promise.all([manager.start(request()), manager.start(request('other'))]);
    expect(one.service!.id).toBe(two.service!.id);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it('uses a native reported context only when main registered it; never falls back from an outside report', async () => {
    location = { path: b.path, checkoutContextId: b.id };
    const discovery = await manager.discover({ workspaceId: 'ws', terminalId: 'a' });
    expect(discovery.command?.cwd).toBe(b.path);
    expect((await manager.start(request())).success).toBe(false);
    expect((await manager.start({ ...request(), checkoutContextId: b.id, cwd: b.path })).success).toBe(true);
    location = { path: '/unregistered', checkoutContextId: null };
    expect((await manager.discover({ workspaceId: 'ws', terminalId: 'a' })).success).toBe(false);
  });
  it('blocks checkout release for starting/running services even after the originating terminal closes', async () => {
    await manager.start(request()); terminals.delete('a');
    expect(releaseCheckoutContext({ registry, terminals: manager.usages(), workspaceId: 'ws', checkoutContextId: a.id })).toMatchObject({ success: false, activeServices: 1, activeTerminals: 0, error: expect.stringContaining('stop the dev server') });
    expect(manager.snapshot().services[0].status).toBe('running');
    const stopped = manager.stop('ws', manager.snapshot().services[0].id);
    await vi.advanceTimersByTimeAsync(1000); await stopped;
    expect(releaseCheckoutContext({ registry, terminals: manager.usages(), workspaceId: 'ws', checkoutContextId: a.id }).success).toBe(true);
  });
  it.each(['workspace', 'context', 'terminal', 'shutdown', 'location'] as const)('rechecks %s after async inspection and never leaves an untracked process', async (change) => {
    let finish!: (value: { success: boolean; content: string }) => void;
    vi.mocked(env.readFile).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const starting = manager.start(request());
    expect(manager.usages()).toHaveLength(1);
    if (change === 'workspace') registry.unregisterWorkspace('ws');
    if (change === 'context') registry.unregisterCheckoutContext(a.id);
    if (change === 'terminal') terminals.delete('a');
    if (change === 'shutdown') shuttingDown = true;
    if (change === 'location') location = { path: b.path, checkoutContextId: b.id };
    finish({ success: true, content: '{"scripts":{"dev":"vite"}}' });
    expect((await starting).success).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(manager.usages()).toHaveLength(0);
  });
  it('rechecks again after asynchronous root validation', async () => {
    let finish!: (value: { valid: boolean; resolvedPath: string }) => void;
    vi.mocked(env.validateWorkspacePath).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const starting = manager.start(request()); await tick(); await tick();
    registry.unregisterCheckoutContext(a.id);
    finish({ valid: true, resolvedPath: a.path });
    expect((await starting).success).toBe(false); expect(spawn).not.toHaveBeenCalled();
  });
  it('cancels pending startup on workspace close without spawning later', async () => {
    let finish!: (value: { success: boolean; content: string }) => void;
    vi.mocked(env.readFile).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const starting = manager.start(request());
    await manager.closeWorkspace('ws');
    finish({ success: true, content: '{"scripts":{"dev":"vite"}}' });
    expect((await starting).success).toBe(false); expect(spawn).not.toHaveBeenCalled();
    expect(manager.snapshot().services).toEqual([]);
  });
  it('refuses changed commands, foreign terminals, SSH, and missing roots without spawning', async () => {
    expect((await manager.start({ ...request(), command: 'npm run evil' })).success).toBe(false);
    expect((await manager.discover({ workspaceId: 'other', terminalId: 'a' })).success).toBe(false);
    registry.describeCheckoutContext(a.id, { missing: true });
    expect((await manager.start(request())).success).toBe(false);
    Object.assign(env, { kind: 'ssh' });
    expect((await manager.start(request('b'))).error).toContain('only in local');
    expect(spawn).not.toHaveBeenCalled();
  });
  it('rejects a redirected root and spawn failure without retaining usage', async () => {
    vi.mocked(env.validateWorkspacePath).mockResolvedValueOnce({ valid: true, resolvedPath: '/elsewhere' });
    expect((await manager.start(request())).success).toBe(false); expect(spawn).not.toHaveBeenCalled();
    spawn.mockImplementationOnce(() => { throw new Error('npm unavailable'); });
    expect((await manager.start(request())).error).toBe('npm unavailable');
    expect(manager.usages()).toEqual([]);
  });
  it('reports an immediate nonzero exit as failed; a natural exit with code 0 is not an intentional stop', async () => {
    await manager.start(request()); await manager.start(request('b'));
    children[0].exit(1);
    expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', exitCode: 1 });
    children[1].exit(0);
    const natural = manager.snapshot().services[1];
    expect(natural).toMatchObject({ status: 'failed', exitCode: 0 });
    expect(natural.error).toContain('exited on its own');
    expect(manager.usages()).toEqual([]);
    expect(changed.mock.calls[changed.mock.calls.length - 1][0].services[1].status).toBe('failed');
  });
  it('parses split/ANSI rows, normalizes wildcard hosts, ignores remote/OSC URLs, and probes before offering preview', async () => {
    await manager.start(request());
    children[0].data('\x1b]8;;http://localhost:9000\x07hidden\x1b]8;;\x07\nhttp://example.com:5173\n\x1b[32mhttp://0.0.0.0:51');
    expect(probe).not.toHaveBeenCalled();
    children[0].data('73/app\x1b[0m\n'); await tick();
    expect(probe).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:5173/app', true);
    expect(manager.snapshot().services[0].previewUrl).toBe('http://127.0.0.1:5173/app');
    children[0].data('http://localhost:5173/app\n'); await tick();
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it('retries delayed readiness and queues additional bounded URL candidates without overlapping probes', async () => {
    probe.mockResolvedValueOnce({ status: 'unavailable', host: 'localhost', port: 5173 });
    await manager.start(request());
    children[0].data('http://localhost:5173\n'); await tick();
    expect(manager.snapshot().services[0].previewUrl).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(manager.snapshot().services[0].previewUrl).toBe('http://localhost:5173/');
  });
  it('discards late probe replies after stop and stops all services on shutdown with no restart reconstruction', async () => {
    let finish!: (value: { status: 'ready'; host: string; port: number }) => void;
    probe.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await manager.start(request()); await manager.start(request('b'));
    children[0].data('http://localhost:5173\n');
    const closing = manager.shutdown();
    finish({ status: 'ready', host: 'localhost', port: 5173 });
    await vi.advanceTimersByTimeAsync(1000); await closing;
    expect(manager.snapshot().services).toEqual([]);
    expect((await manager.start(request())).success).toBe(false);
  });
  it('strips inherited desktop/remote attention and bridge credentials from the dev process', async () => {
    vi.stubEnv('CLANKER_ATTENTION_TOKEN', 'secret'); vi.stubEnv('CLANKER_REMOTE_ATTENTION_TOKEN', 'remote-secret'); vi.stubEnv('clanker_mcp_token', 'bridge-secret');
    await manager.start(request());
    expect(Object.keys(spawn.mock.calls[0][2].env!).some((key) => /CLANKER_(?:REMOTE_)?ATTENTION_|CLANKER_MCP_/i.test(key))).toBe(false);
  });
  it('never reports success when termination cannot be confirmed; retains usage and permits a second Stop', async () => {
    const started = await manager.start(request());
    stubborn = true;
    const stopping = manager.stop('ws', started.service!.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await stopping).toMatchObject({ success: false });
    expect(manager.usages()).toHaveLength(1);
    expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', cleanupIncomplete: true, error: expect.stringContaining('try Stop again') });
    expect(isLiveWorkspaceService(manager.snapshot().services[0])).toBe(true);
    stubborn = false;
    const retry = manager.stop('ws', started.service!.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await retry).success).toBe(true); expect(manager.usages()).toEqual([]);
    expect(manager.snapshot().services[0]).toMatchObject({ status: 'stopped' });
  });
  it('retains a bounded ANSI-free diagnostic tail on failure instead of hiding the reason', async () => {
    await manager.start(request());
    children[0].data('old line that is not the cause\n'.repeat(5000) + '\x1b[31msh: next: command not found\x1b[0m\n' + 'x'.repeat(20000) + '\n');
    children[0].exit(127);
    const failed = manager.snapshot().services[0];
    expect(failed.error).not.toContain('\x1b');
    expect(failed.error!.length).toBeLessThanOrEqual(33 * 1024);
    expect(failed.error!.length).toBeGreaterThan(2048);
    expect(failed.error).toContain('sh: next: command not found'); // Recent errors survive; the over-long row is truncated, not dropped.
    expect(failed.error!.match(/x+…/)).toBeTruthy();
  });
  it('forgets completed orphan records but keeps live processes after a conversation closes', async () => {
    await manager.start(request()); await manager.start(request('b'));
    children[0].exit(1);
    terminals.delete('a'); terminals.delete('b');
    expect(manager.snapshot().services.map((entry) => entry.checkoutContextId)).toEqual([b.id]);
    expect(manager.usages()).toHaveLength(1);
  });
  it('forgets completed records after their checkout context is released', async () => {
    await manager.start(request()); children[0].exit(0);
    registry.unregisterCheckoutContext(a.id);
    expect(manager.snapshot().services).toEqual([]);
  });
  it('refuses stopping another workspace service', async () => {
    const started = await manager.start(request());
    expect((await manager.stop('other', started.service!.id)).success).toBe(false);
    expect(children[0].child.kill).not.toHaveBeenCalled();
  });

  describe('process ownership and termination', () => {
    it('does not call a service gone while a descendant outlives the package-manager parent', async () => {
      await manager.start(request());
      resistTerm = true; // The orphaned server ignores SIGTERM.
      children[0].exitLeader(0);
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'stopping', exitCode: 0 });
      expect(manager.usages()).toHaveLength(1); // Still owned: checkout cannot be released.
      expect(signalGroup).toHaveBeenCalledWith(1000, 'SIGTERM');
      await vi.advanceTimersByTimeAsync(1000);
      expect(signalGroup).toHaveBeenCalledWith(1000, 'SIGKILL');
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', exitCode: 0 });
      expect(manager.snapshot().services[0].cleanupIncomplete).toBeUndefined();
      expect(manager.usages()).toEqual([]);
      expect(alive.has(1000)).toBe(false);
    });
    it('keeps the service failed-but-owned when a descendant survives SIGKILL, and a later Stop or Start retries the cleanup', async () => {
      await manager.start(request());
      stubborn = true;
      children[0].exitLeader(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', cleanupIncomplete: true, error: expect.stringContaining('could not be confirmed terminated') });
      expect(manager.usages()).toHaveLength(1);
      // A restart must not launch while the old processes may still be alive.
      const blocked = manager.start(request());
      await vi.advanceTimersByTimeAsync(1000);
      expect((await blocked).success).toBe(false);
      expect(spawn).toHaveBeenCalledTimes(1);
      stubborn = false;
      const restarted = manager.start(request());
      await vi.advanceTimersByTimeAsync(1000);
      expect((await restarted).success).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(manager.snapshot().services).toHaveLength(1);
      expect(alive.has(1000)).toBe(false);
    });
    it('escalates an explicit Stop from SIGTERM to SIGKILL and terminates managed descendants of the group', async () => {
      const started = await manager.start(request());
      resistTerm = true;
      const stopping = manager.stop('ws', started.service!.id);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await stopping).success).toBe(true);
      expect(signalGroup.mock.calls.filter(([pid]) => pid === 1000).map(([, signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL']);
      expect(alive.has(1000)).toBe(false);
    });
    it('records the signal that ended the process and distinguishes an explicit Stop from an unexpected exit', async () => {
      await manager.start(request('a')); await manager.start(request('b'));
      children[0].exit(0, 9);
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', exitSignal: 'SIGKILL' });
      const stopping = manager.stop('ws', manager.snapshot().services[1].id);
      await vi.advanceTimersByTimeAsync(500); await stopping;
      expect(manager.snapshot().services[1]).toMatchObject({ status: 'stopped' });
      expect(manager.snapshot().services[1].error).toBeUndefined();
    });
    it('never signals a process group after it was observed empty (its pid may be recycled)', async () => {
      const started = await manager.start(request());
      children[0].exit(1);
      signalGroup.mockClear();
      await manager.stop('ws', started.service!.id);
      expect(signalGroup).not.toHaveBeenCalled();
      expect(children[0].child.kill).not.toHaveBeenCalled();
    });
  });

  describe('restart and concurrency', () => {
    it('restarts a failed service after cleanup with a fresh record, without duplicates', async () => {
      const first = await manager.start(request());
      children[0].data('boom\n'); children[0].exit(1);
      const second = await manager.start(request());
      expect(second.success).toBe(true);
      expect(second.service!.id).not.toBe(first.service!.id);
      expect(manager.snapshot().services).toHaveLength(1);
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'running' });
      expect(manager.snapshot().services[0].error).toBeUndefined();
      expect(spawn).toHaveBeenCalledTimes(2);
    });
    it('creates exactly one service for simultaneous Starts', async () => {
      terminals.set('other', { workspaceId: 'ws', checkoutContextId: a.id });
      const results = await Promise.all([manager.start(request()), manager.start(request()), manager.start(request('other'))]);
      expect(results.every((result) => result.success)).toBe(true);
      expect(new Set(results.map((result) => result.service!.id)).size).toBe(1);
      expect(spawn).toHaveBeenCalledTimes(1);
    });
    it('rejects a Start during Stop instead of pretending a new server launched', async () => {
      const started = await manager.start(request());
      resistTerm = true;
      const stopping = manager.stop('ws', started.service!.id);
      const early = await manager.start(request());
      expect(early).toMatchObject({ success: false, error: expect.stringContaining('still stopping') });
      await vi.advanceTimersByTimeAsync(1000); await stopping;
      expect(spawn).toHaveBeenCalledTimes(1);
      expect((await manager.start(request())).success).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(2);
    });
    it('rejects a Start while an unexpected exit is still cleaning up descendants', async () => {
      await manager.start(request());
      resistTerm = true;
      children[0].exitLeader(1);
      expect((await manager.start(request())).error).toContain('still stopping');
      await vi.advanceTimersByTimeAsync(1000);
      expect((await manager.start(request())).success).toBe(true);
    });
    it('makes repeated and simultaneous Stops safe and single-flight', async () => {
      const started = await manager.start(request());
      resistTerm = true;
      const stops = [manager.stop('ws', started.service!.id), manager.stop('ws', started.service!.id)];
      await vi.advanceTimersByTimeAsync(1000);
      expect((await Promise.all(stops)).every((result) => result.success)).toBe(true);
      expect(signalGroup.mock.calls.filter(([, signal]) => signal === 'SIGTERM')).toHaveLength(1);
      expect((await manager.stop('ws', started.service!.id)).success).toBe(true);
      expect(signalGroup.mock.calls.filter(([, signal]) => signal === 'SIGTERM')).toHaveLength(1);
    });
    it('Stop during launch cancels it without ever spawning', async () => {
      let finish!: (value: { success: boolean; content: string }) => void;
      vi.mocked(env.readFile).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      const starting = manager.start(request());
      await manager.stop('ws', manager.snapshot().services[0].id);
      finish({ success: true, content: '{"scripts":{"dev":"vite"}}' });
      expect((await starting).success).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
      expect(manager.usages()).toEqual([]);
    });
  });

  describe('port conflicts', () => {
    it.each([
      ['Error: Port 1420 is already in use', 1420],
      ['Error: listen EADDRINUSE: address already in use :::3000', 3000],
      ['Error: listen EADDRINUSE: address already in use 127.0.0.1:5173', 5173],
    ])('classifies %j as a conflict on port %i when the service then fails', async (row, port) => {
      await manager.start(request());
      children[0].data(`${row}\n`); children[0].exit(1);
      const service = manager.snapshot().services[0];
      expect(service.portConflict).toEqual({ port });
      expect(service.error).toMatch(new RegExp(`^Port ${port} is already in use by another process. Clanker did not stop it.`));
      expect(service.error).toContain(row); // The original output is preserved.
    });
    it('does not treat a recovered busy-port warning as the failure cause', async () => {
      await manager.start(request());
      children[0].data('Port 5173 is in use, trying another one...\nhttp://localhost:5174/\n'); await tick();
      expect(manager.snapshot().services[0].status).toBe('running');
      expect(manager.snapshot().services[0].portConflict).toBeUndefined();
      children[0].data('Error: listen EADDRINUSE: address already in use :::5173\n'); // later, after it was serving
      children[0].exit(1);
      expect(manager.snapshot().services[0].portConflict).toBeUndefined();
      expect(manager.snapshot().services[0].error).not.toContain('Clanker did not stop it');
    });
    it('never signals a process on the busy port', async () => {
      await manager.start(request());
      children[0].data('Error: Port 1420 is already in use\n'); children[0].exit(1);
      expect(signalGroup).not.toHaveBeenCalled();
    });
  });

  describe('cleanup and shutdown', () => {
    it('keeps evidence and rejects when workspace close cannot verify termination', async () => {
      await manager.start(request());
      stubborn = true;
      const closing = manager.closeWorkspace('ws').catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await closing).toMatchObject({ message: expect.stringContaining('could not be confirmed stopped') });
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', cleanupIncomplete: true });
      expect(manager.usages()).toHaveLength(1);
    });
    it('reports a failed shutdown instead of swallowing it, while still stopping the other services', async () => {
      await manager.start(request('a')); await manager.start(request('b'));
      signalGroup.mockImplementation((pid, signal) => { if (pid !== 1001 && (signal === 'SIGKILL' || !resistTerm)) alive.delete(pid); }); // 1001 cannot be killed
      const closing = manager.shutdown().catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await closing).toBeInstanceOf(Error);
      expect(alive.has(1000)).toBe(false); // The other service was not abandoned because one failed.
      expect(manager.usages()).toHaveLength(1);
      alive.delete(1001);
    });
    it('does not spawn a launch that is still pending when shutdown begins', async () => {
      let finish!: (value: { success: boolean; content: string }) => void;
      vi.mocked(env.readFile).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      const starting = manager.start(request());
      const closing = manager.shutdown();
      finish({ success: true, content: '{"scripts":{"dev":"vite"}}' });
      await vi.advanceTimersByTimeAsync(500); await closing;
      expect((await starting).success).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });
    it('blocks checkout release until the actual cleanup completes, including a survivor after the leader exits', async () => {
      await manager.start(request());
      resistTerm = true; children[0].exitLeader(1);
      const release = () => releaseCheckoutContext({ registry, terminals: manager.usages(), workspaceId: 'ws', checkoutContextId: a.id });
      expect(release()).toMatchObject({ success: false, activeServices: 1 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(release().success).toBe(true);
    });
    it('closing a conversation keeps its running service; closing the workspace stops every owned one', async () => {
      await manager.start(request('a')); await manager.start(request('b'));
      terminals.delete('a');
      expect(manager.usages()).toHaveLength(2);
      const closing = manager.closeWorkspace('ws'); await vi.advanceTimersByTimeAsync(500); await closing;
      expect(manager.snapshot().services).toEqual([]);
      expect(alive.size).toBe(0);
    });
  });

  describe('review hardening', () => {
    it('tolerates a group that lingers briefly after SIGKILL (a not-yet-reaped zombie) but not beyond the window', async () => {
      const started = await manager.start(request());
      signalGroup.mockImplementation((pid, signal) => { if (signal === 'SIGKILL') setTimeout(() => alive.delete(pid), 100); });
      const stopping = manager.stop('ws', started.service!.id);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await stopping).success).toBe(true); // Reaped 100 ms after the kill, inside the 200 ms verification window.
      const late = await manager.start(request());
      signalGroup.mockImplementation((pid, signal) => { if (signal === 'SIGKILL') setTimeout(() => alive.delete(pid), 5000); });
      const slow = manager.stop('ws', late.service!.id);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await slow).success).toBe(false); // Not confirmed in time: reported, never assumed.
      expect(manager.usages()).toHaveLength(1);
    });
    it('treats ESRCH as the group being gone, and stops signalling afterwards', async () => {
      const started = await manager.start(request());
      signalGroup.mockImplementation(() => { throw Object.assign(new Error('no such process'), { code: 'ESRCH' }); });
      isGroupAlive.mockReturnValue(true);
      const stopping = manager.stop('ws', started.service!.id);
      await vi.advanceTimersByTimeAsync(500);
      expect((await stopping).success).toBe(true);
      expect(signalGroup).toHaveBeenCalledTimes(1);
    });
    it('fails closed with an explanation when a group member cannot be signalled (EPERM)', async () => {
      const started = await manager.start(request());
      signalGroup.mockImplementation(() => { throw Object.assign(new Error('not permitted'), { code: 'EPERM' }); });
      const stopping = manager.stop('ws', started.service!.id);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await stopping).error).toContain('permission denied');
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', cleanupIncomplete: true, error: expect.stringContaining('permission denied') });
      expect(manager.usages()).toHaveLength(1);
    });
    it('the real probe and signal only ever address this service\'s negative process group, and EPERM is "still alive"', async () => {
      const kill = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
        if (pid === -1000 && signal === 0) return true;
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      });
      try {
        const plain = new WorkspaceServiceManager({ registry, getTerminal: (id) => terminals.get(id), getLocation: () => null, isShuttingDown: () => false,
          spawn, probe, changed, canonicalRoot: (path) => path, timing: { graceMs: 100, killMs: 100, pollMs: 10 } });
        const started = await plain.start(request());
        const stopping = plain.stop('ws', started.service!.id);
        await vi.advanceTimersByTimeAsync(1000);
        expect((await stopping).success).toBe(false);
        expect(kill.mock.calls.length).toBeGreaterThan(0);
        expect(kill.mock.calls.every(([pid]) => pid === -1000)).toBe(true);
        alive.delete(1000); kill.mockImplementation(() => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); });
        const retry = plain.stop('ws', started.service!.id);
        await vi.advanceTimersByTimeAsync(1000);
        expect((await retry).success).toBe(true); // The probe now reports the group gone.
      } finally { kill.mockRestore(); }
    });
    it('keeps an earlier failure diagnosis when a later Stop finally clears the leftover processes', async () => {
      const started = await manager.start(request());
      stubborn = true;
      children[0].data('Error: cannot find module "vite"\n'); children[0].exitLeader(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', cleanupIncomplete: true });
      stubborn = false;
      const stopping = manager.stop('ws', started.service!.id);
      await vi.advanceTimersByTimeAsync(500);
      expect((await stopping).success).toBe(true);
      const service = manager.snapshot().services[0];
      expect(service).toMatchObject({ status: 'failed', exitCode: 1 });
      expect(service.cleanupIncomplete).toBeUndefined();
      expect(service.error).toContain('cannot find module "vite"');
      expect(service.error).not.toContain('could not be confirmed');
      expect(manager.usages()).toEqual([]);
    });
    it('retries an unresolved cleanup after workspace close a bounded number of times, then releases the record', async () => {
      await manager.start(request());
      stubborn = true;
      const closing = manager.closeWorkspace('ws').catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await closing).toMatchObject({ message: expect.stringMatching(/pid 1000 in \/repo-worktrees\/a/) });
      expect(manager.usages()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(10_500); // First retry still cannot kill it.
      expect(manager.usages()).toHaveLength(1);
      stubborn = false;
      await vi.advanceTimersByTimeAsync(20_500); // Second retry succeeds.
      expect(manager.usages()).toEqual([]);
      expect(manager.snapshot().services).toEqual([]);
      expect(alive.size).toBe(0);
    });
    it('stops retrying after three attempts, so nothing polls forever', async () => {
      await manager.start(request());
      stubborn = true;
      const closing = manager.closeWorkspace('ws').catch(() => undefined);
      await vi.advanceTimersByTimeAsync(1000); await closing;
      await vi.advanceTimersByTimeAsync(10_000 * 6 + 5000);
      const calls = signalGroup.mock.calls.length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(signalGroup.mock.calls.length).toBe(calls);
      expect(manager.usages()).toHaveLength(1); // Still reported as owned; shutdown makes the final attempt.
    });
    it('does not let a leftover retry timer act after shutdown has begun', async () => {
      await manager.start(request());
      stubborn = true;
      const closing = manager.closeWorkspace('ws').catch(() => undefined);
      await vi.advanceTimersByTimeAsync(1000); await closing;
      const shutdown = manager.shutdown().catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await shutdown).toBeInstanceOf(Error); // Reported, not swallowed, and returned within the bounded window.
    });
  });

  describe('probe errors and exit/cleanup races', () => {
    const plainManager = () => new WorkspaceServiceManager({ registry, getTerminal: (id) => terminals.get(id), getLocation: () => null, isShuttingDown: () => false,
      spawn, probe, changed, canonicalRoot: (path) => path, timing: { graceMs: 100, killMs: 100, pollMs: 10 } });
    it.each([
      ['EPERM', 'EPERM'], ['an unexpected errno', 'EINVAL'], ['an error without a code', undefined],
    ])('treats %s from the real probe as "still alive", never as proof of exit', async (_label, code) => {
      const kill = vi.spyOn(process, 'kill').mockImplementation((_pid: number, signal?: string | number) => {
        if (signal === 0) throw Object.assign(new Error('probe failed'), code ? { code } : {});
        return true; // Signals themselves are accepted.
      });
      try {
        const plain = plainManager();
        const started = await plain.start(request());
        const stopping = plain.stop('ws', started.service!.id);
        await vi.advanceTimersByTimeAsync(1000);
        expect((await stopping).success).toBe(false);
        expect(plain.snapshot().services[0]).toMatchObject({ status: 'failed', cleanupIncomplete: true });
        expect(plain.usages()).toHaveLength(1);
        expect(kill.mock.calls.every(([pid]) => pid === -1000)).toBe(true);
      } finally { kill.mockRestore(); }
    });
    it('only ESRCH from the real probe proves the group is gone', async () => {
      const kill = vi.spyOn(process, 'kill').mockImplementation((_pid: number, signal?: string | number) => {
        if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        return true;
      });
      try {
        const plain = plainManager();
        const started = await plain.start(request());
        const stopping = plain.stop('ws', started.service!.id);
        await vi.advanceTimersByTimeAsync(500);
        expect((await stopping).success).toBe(true);
        expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([]); // Gone before anything was signalled.
      } finally { kill.mockRestore(); }
    });
    it('keeps the unexpected-exit diagnosis when an explicit Stop takes over before finishUnexpected() runs', async () => {
      const started = await manager.start(request());
      resistTerm = true; // Cleanup of the orphaned descendant is in flight when Stop arrives.
      children[0].data('Error: cannot find module "vite"\n'); children[0].exitLeader(1);
      expect(manager.snapshot().services[0].status).toBe('stopping');
      const stopping = manager.stop('ws', started.service!.id);
      children[0].data('later line from the orphan\n'); // Output that arrives while it is being torn down is kept too.
      await vi.advanceTimersByTimeAsync(1000);
      expect((await stopping).success).toBe(true);
      const service = manager.snapshot().services[0];
      expect(service).toMatchObject({ status: 'failed', exitCode: 1 });
      expect(service.cleanupIncomplete).toBeUndefined();
      expect(service.error).toContain('cannot find module "vite"');
      expect(service.error).toContain('later line from the orphan');
      expect(manager.usages()).toEqual([]);
    });
    it('keeps the diagnosis, plus the cleanup failure, when the takeover cannot verify termination', async () => {
      const started = await manager.start(request());
      stubborn = true;
      children[0].data('EADDRINUSE: address already in use :::4321\n'); children[0].exitLeader(1);
      const stopping = manager.stop('ws', started.service!.id);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await stopping).success).toBe(false);
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', cleanupIncomplete: true, portConflict: { port: 4321 } });
      expect(manager.snapshot().services[0].error).toContain('Port 4321 is already in use');
      expect(manager.snapshot().services[0].error).toContain('try Stop again');
    });
    it('keeps the diagnosis when workspace close takes over while descendants are being cleaned up', async () => {
      await manager.start(request());
      stubborn = true;
      children[0].data('Error: listen EADDRINUSE: address already in use 127.0.0.1:8123\n'); children[0].exitLeader(2);
      const closing = manager.closeWorkspace('ws').catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await closing).toBeInstanceOf(Error);
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', exitCode: 2, cleanupIncomplete: true });
      expect(manager.snapshot().services[0].error).toContain('Port 8123 is already in use');
      expect(manager.snapshot().services[0].error).toContain('EADDRINUSE');
    });
    it('does not blame an explicit Stop on an unexpected exit, and an exit after Stop was requested is not "unexpected"', async () => {
      const started = await manager.start(request());
      resistTerm = true;
      const stopping = manager.stop('ws', started.service!.id);
      children[0].data('terminating\n'); children[0].exitLeader(143);
      await vi.advanceTimersByTimeAsync(1000); await stopping;
      expect(manager.snapshot().services[0]).toMatchObject({ status: 'stopped' });
      expect(manager.snapshot().services[0].error).toBeUndefined();
    });
  });
});
