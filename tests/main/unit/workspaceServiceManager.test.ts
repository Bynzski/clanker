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
import type { DevServiceStartRequest } from '../../../src/shared/types/workspaceServices';

function environment(kind: 'local' | 'ssh' = 'local') {
  return {
    id: kind, kind,
    validateWorkspacePath: vi.fn(async (path: string) => ({ valid: true, resolvedPath: path })),
    readFile: vi.fn(async () => ({ success: true, content: JSON.stringify({ scripts: { dev: 'arbitrary project command' } }) })),
    listDirectory: vi.fn(async () => ({ success: true, entries: [] })),
  } as unknown as WorkspaceEnvironment;
}
function fakePty(pid: number) {
  let data: (value: string) => void = () => undefined;
  let exit: (value: { exitCode: number; signal: number }) => void = () => undefined;
  const child = {
    pid, onData: vi.fn((fn) => { data = fn; return { dispose: vi.fn() }; }),
    onExit: vi.fn((fn) => { exit = fn; return { dispose: vi.fn() }; }),
    kill: vi.fn(() => exit({ exitCode: 0, signal: 15 })),
  };
  return { child: child as unknown as IPty, data: (value: string) => data(value), exit: (code: number) => exit({ exitCode: code, signal: 0 }) };
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
  let spawn: Mock<typeof import('node-pty').spawn>;
  let probe: Mock<typeof probeRecipePreview>;
  let signalGroup: Mock<(pid: number, signal: NodeJS.Signals) => void>;
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
    location = null; shuttingDown = false; children = [];
    spawn = vi.fn(() => { const child = fakePty(1000 + children.length); children.push(child); return child.child; });
    probe = vi.fn(async () => ({ status: 'ready' as const, host: '127.0.0.1', port: 5173 }));
    signalGroup = vi.fn(); changed = vi.fn();
    manager = new WorkspaceServiceManager({ registry, getTerminal: (id) => terminals.get(id), getLocation: () => location,
      isShuttingDown: () => shuttingDown, spawn, probe, signalGroup, changed, canonicalRoot: (path) => path });
  });
  afterEach(async () => { const closing = manager.shutdown(); await vi.runAllTimersAsync(); await closing; vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('discovers without spawning, then starts immediately with registered worktree cwd and fixed argv, no renderer handshake', async () => {
    expect(await manager.discover({ workspaceId: 'ws', terminalId: 'a' })).toMatchObject({ success: true, command: { command: 'npm run dev', cwd: a.path } });
    expect(spawn).not.toHaveBeenCalled();
    const result = await manager.start(request());
    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'dev'], expect.objectContaining({ cwd: a.path, handleFlowControl: false }));
    expect(result.service?.status).toBe('starting');
    await vi.advanceTimersByTimeAsync(750);
    expect(manager.snapshot().services[0].status).toBe('running');
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
    expect(signalGroup).toHaveBeenCalledWith(1000, 'SIGKILL');
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
    expect(manager.snapshot().services[0].status).toBe('starting');
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
  it('reports immediate nonzero exit as failed; natural exit in a background workspace also publishes and cleans descendants', async () => {
    await manager.start(request()); await manager.start(request('b'));
    children[0].exit(1);
    expect(manager.snapshot().services[0]).toMatchObject({ status: 'failed', exitCode: 1 });
    await vi.advanceTimersByTimeAsync(750);
    children[1].exit(0);
    expect(manager.snapshot().services[1].status).toBe('stopped');
    expect(manager.usages()).toEqual([]);
    expect(signalGroup).toHaveBeenCalledWith(1000, 'SIGKILL');
    expect(changed.mock.calls[changed.mock.calls.length - 1][0].services[1].status).toBe('stopped');
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
  it('retains usage and permits a second Stop if the PTY does not confirm termination', async () => {
    const started = await manager.start(request());
    vi.mocked(children[0].child.kill).mockImplementation(() => undefined);
    const stopping = manager.stop('ws', started.service!.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await stopping).toMatchObject({ success: false });
    expect(manager.usages()).toHaveLength(1);
    expect(manager.snapshot().services[0].error).toContain('try Stop again');
    vi.mocked(children[0].child.kill).mockImplementation(() => children[0].exit(0));
    const retry = manager.stop('ws', started.service!.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await retry).success).toBe(true); expect(manager.usages()).toEqual([]);
  });
  it('refuses stopping another workspace service', async () => {
    const started = await manager.start(request());
    expect((await manager.stop('other', started.service!.id)).success).toBe(false);
    expect(children[0].child.kill).not.toHaveBeenCalled();
  });
});
