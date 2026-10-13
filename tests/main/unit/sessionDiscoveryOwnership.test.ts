import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessSession } from '../../../src/shared/types/session';
import type { ManagedSessionDiscovery } from '../../../src/main/accounts/harnessAccountService';
import type { RegisteredWorkspace, WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { SESSION_DISCOVER } from '../../../src/shared/ipcChannels';
const { scan, other, handlers } = vi.hoisted(() => ({ scan: vi.fn(), other: vi.fn(), handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) } }));
vi.mock('../../../src/main/harnesses/registry', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/main/harnesses/registry')>();
  return { ...actual, getHarnessProviders: () => [
    { descriptor: { id: 'codex', name: 'Codex' }, sessions: { discover: scan } },
    { descriptor: { id: 'pi', name: 'Pi' }, sessions: { discover: other } },
  ] };
});
import { discoverSessions, discoverSessionsDetailed, clearSessionCache, clearSessionCacheForWorkspace, getSessionCacheSize } from '../../../src/main/sessionHistory';
import { registerSessionIpc } from '../../../src/main/ipc/sessionIpc';
const session = (id: string): HarnessSession => ({ id, harness: 'codex', cwd: '/workspace', title: '', timestamp: 1 });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const started = (n = 1) => vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(n));
beforeEach(() => { clearSessionCache(); scan.mockReset().mockResolvedValue([]); other.mockReset().mockResolvedValue([]); handlers.clear(); });

describe('real provider discovery single-flight and cache', () => {
  it.each([false, true])('shares equivalent detailed and ordinary results (force=%s)', async forceRefresh => {
    const gate = deferred<HarnessSession[]>(); scan.mockReturnValueOnce(gate.promise);
    const a = discoverSessions('/workspace', { forceRefresh });
    const b = discoverSessionsDetailed('/workspace', { forceRefresh });
    await started(); gate.resolve([session('shared')]);
    expect(await a).toEqual([session('shared')]); expect((await b).harnessStatus.codex?.status).toBe('success');
    expect(scan).toHaveBeenCalledOnce(); expect(other).toHaveBeenCalledOnce();
  });
  it('one forced successor waits for ordinary work and all later forced callers share its fresh result', async () => {
    const old = deferred<HarnessSession[]>(), fresh = deferred<HarnessSession[]>();
    scan.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const ordinary = discoverSessions('/workspace'); await started();
    const forced = Array.from({ length: 7 }, () => discoverSessions('/workspace', { forceRefresh: true }));
    expect(scan).toHaveBeenCalledOnce(); old.resolve([session('old')]); expect(await ordinary).toEqual([session('old')]);
    await started(2); fresh.resolve([session('fresh')]);
    expect(await Promise.all(forced)).toEqual(Array.from({ length: 7 }, () => [session('fresh')]));
    expect(await discoverSessions('/workspace')).toEqual([session('fresh')]); expect(scan).toHaveBeenCalledTimes(2);
  });
  it('force does not inherit an older cache even when another forced scan is running', async () => {
    scan.mockResolvedValueOnce([session('cached')]); await discoverSessions('/workspace');
    const gate = deferred<HarnessSession[]>(); scan.mockReturnValueOnce(gate.promise);
    const force = discoverSessions('/workspace', { forceRefresh: true }); await started(2);
    const ordinary = discoverSessions('/workspace'); gate.resolve([session('fresh')]);
    expect(await force).toEqual([session('fresh')]); expect(await ordinary).toEqual([session('fresh')]); expect(scan).toHaveBeenCalledTimes(2);
  });
  it.each(['all', 'workspace'])('cache clear (%s) starts new generation, and late old completion cannot overwrite force', async scope => {
    const old = deferred<HarnessSession[]>(), fresh = deferred<HarnessSession[]>(); scan.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const a = discoverSessions('/workspace'); await started();
    if (scope === 'all') clearSessionCache(); else clearSessionCacheForWorkspace('/workspace');
    const b = discoverSessions('/workspace', { forceRefresh: true }); await started(2);
    fresh.resolve([session('new')]); await b; old.resolve([session('old')]); await a;
    expect(await discoverSessions('/workspace')).toEqual([session('new')]); expect(scan).toHaveBeenCalledTimes(2);
  });
  it('clear retires a queued successor without claiming physical cancellation; retry starts new work', async () => {
    const old = deferred<HarnessSession[]>(); scan.mockReturnValueOnce(old.promise);
    const a = discoverSessions('/workspace'); await started();
    const force = discoverSessions('/workspace', { forceRefresh: true }); const rejection = expect(force).rejects.toThrow('invalidated');
    clearSessionCache(); old.resolve([]); await a; await rejection;
    expect(getSessionCacheSize()).toBe(0); await discoverSessions('/workspace'); expect(scan).toHaveBeenCalledTimes(2);
  });
  it('isolates account generations and target sets, including empty configured accounts', async () => {
    const managedScan = vi.fn().mockResolvedValue([session('managed')]);
    const managed = (key: string): ManagedSessionDiscovery => ({ cacheKey: key, targets: [{ harness: 'codex', accountId: 'acct_owned', discover: managedScan }] });
    const old = deferred<HarnessSession[]>(); scan.mockReturnValueOnce(old.promise);
    const a = discoverSessions('/workspace', { managed: managed('gen1') }); await started();
    const b = discoverSessions('/workspace', { managed: managed('gen2') }); await started(2); await b; old.resolve([]); await a;
    expect(managedScan).toHaveBeenCalledTimes(2); expect((await discoverSessions('/workspace', { managed: managed('gen2') }))[0].accountId).toBe('acct_owned');
    await discoverSessions('/workspace', { managed: { cacheKey: 'gen3', targets: [] } }); expect(scan).toHaveBeenCalledTimes(3);
  });
  it('different checkout scope sets cannot share path-equal provider work', async () => {
    const gate = deferred<HarnessSession[]>(); scan.mockReturnValue(gate.promise);
    const a = discoverSessions('/workspace', { scopeKey: 'main+worktree-a' });
    const b = discoverSessions('/workspace', { scopeKey: 'main+worktree-b' }); await started(2); gate.resolve([]); await Promise.all([a, b]);
  });
  it.each(['exception', 'timeout'])('partial provider %s remains diagnostic, uncached and retryable', async kind => {
    scan.mockImplementationOnce(() => { throw Object.assign(new Error('private provider failure'), { code: kind === 'timeout' ? 'ETIMEDOUT' : 'EIO' }); });
    other.mockResolvedValue([{ ...session('partial'), harness: 'pi' }]);
    const found = await discoverSessionsDetailed('/workspace');
    expect(found.sessions[0].id).toBe('partial'); expect(found.harnessStatus.codex?.status).toBe('error'); expect(found.harnessStatus.pi?.status).toBe('success'); expect(getSessionCacheSize()).toBe(0);
    await discoverSessions('/workspace'); expect(scan).toHaveBeenCalledTimes(2);
  });
  it('successful empty discovery is complete and cached', async () => {
    expect(await discoverSessions('/workspace')).toEqual([]); expect(await discoverSessions('/workspace')).toEqual([]);
    expect(getSessionCacheSize()).toBe(1); expect(scan).toHaveBeenCalledOnce();
  });
});

function setupIpc() {
  let managed: ManagedSessionDiscovery | undefined;
  const local = { workspaceId: 'a', location: { environmentId: 'local', path: '/workspace' }, environment: { kind: 'local' } } as RegisteredWorkspace;
  const workspaces = new Map<string, RegisteredWorkspace>([['a', local]]);
  const contexts = new Map<string, object[]>();
  const registry = { getWorkspace: (id: string) => workspaces.get(id), getCheckoutContextsForWorkspace: (id: string) => contexts.get(id) ?? [] } as unknown as WorkspaceRegistry;
  const listing = vi.fn().mockResolvedValue({ success: false, worktrees: [] });
  registerSessionIpc({ getTerminals: () => new Map(), getMainWindow: () => null, getSafeWorkspacePath: value => value,
    getIsShuttingDown: () => false, getStore: () => ({ get: vi.fn() }) as never,
    getHarnessOptions: () => ({ codex: { name: 'Codex', command: 'codex', args: [], icon: '' }, pi: { name: 'Pi', command: 'pi', args: [], icon: '' } }),
    getWorkspaceRegistry: () => registry, listWorktrees: listing,
    getHarnessAccountService: () => ({ discoverySource: () => managed }) as never,
  });
  const call = (id = 'a', forceRefresh = false, detailed = true) => handlers.get(SESSION_DISCOVER)!({}, id, { detailed, forceRefresh });
  return { call, local, workspaces, contexts, listing, setManaged: (value: ManagedSessionDiscovery) => { managed = value; } };
}
describe('SESSION_DISCOVER owns whole workspace discovery, not launch authority', () => {
  it('mixed detailed/ordinary callers share checkout-plan AND provider reads', async () => {
    const { call, listing } = setupIpc(); const gate = deferred<HarnessSession[]>(); scan.mockReturnValueOnce(gate.promise);
    const a = call(), b = call('a', false, false); await started(); gate.resolve([session('shared')]);
    expect(await a).toEqual({ sessions: [session('shared')], issues: [] }); expect(await b).toEqual([session('shared')]); expect(listing).toHaveBeenCalledOnce();
  });
  it('opening during warmup queues exactly one fresh whole-plan successor', async () => {
    const { call, listing } = setupIpc(); const old = deferred<HarnessSession[]>(); scan.mockReturnValueOnce(old.promise).mockResolvedValueOnce([session('fresh')]);
    const warmup = call(); await started(); const opened = [call('a', true), call('a', true), call('a', true)];
    expect(listing).toHaveBeenCalledOnce(); old.resolve([session('warm')]); await warmup;
    const results = await Promise.all(opened); expect(results).toEqual(Array(3).fill({ sessions: [session('fresh')], issues: [] })); expect(listing).toHaveBeenCalledTimes(2); expect(scan).toHaveBeenCalledTimes(2);
  });
  it.each(['closed', 'replaced'])('retires publication and queued follow-up when registration is %s', async kind => {
    const { call, workspaces, local } = setupIpc(); const gate = deferred<HarnessSession[]>(); scan.mockReturnValueOnce(gate.promise);
    const a = call(); const ar = expect(a).rejects.toThrow('closed'); await started();
    const force = call('a', true); const fr = expect(force).rejects.toThrow('invalidated');
    if (kind === 'closed') workspaces.delete('a'); else workspaces.set('a', { ...local });
    gate.resolve([]); await ar; await fr; expect(scan).toHaveBeenCalledOnce();
    if (kind === 'replaced') { await call(); expect(scan).toHaveBeenCalledTimes(2); }
  });
  it('same textual paths on separate SSH hosts and distinct workspace registrations stay isolated', async () => {
    const { call, workspaces } = setupIpc(); const gate = deferred<HarnessSession[]>();
    const hostA = vi.fn().mockReturnValue(gate.promise), hostB = vi.fn().mockReturnValue(gate.promise);
    const remote = (id: string, discoverSessions: typeof hostA) => ({ workspaceId: id, location: { environmentId: `ssh-${id}`, path: '/workspace' }, environment: { kind: 'ssh', capabilities: { sessionDiscovery: true }, discoverSessions } }) as unknown as RegisteredWorkspace;
    workspaces.set('a', remote('a', hostA)); workspaces.set('b', remote('b', hostB));
    const requests = [call(), call(), call('b'), call('b')];
    await vi.waitFor(() => { expect(hostA).toHaveBeenCalledOnce(); expect(hostB).toHaveBeenCalledOnce(); }); gate.resolve([]); await Promise.all(requests); expect(scan).not.toHaveBeenCalled();
  });
  it('new checkout scopes during flight get new plan/provider acquisition and reject old publication', async () => {
    const { call, contexts } = setupIpc(); const gate = deferred<HarnessSession[]>(); scan.mockReturnValueOnce(gate.promise);
    const a = call(); const rejected = expect(a).rejects.toThrow('configuration changed'); await started();
    contexts.set('a', [{ id: 'a::wt', workspaceId: 'a', environmentId: 'local', kind: 'worktree', path: '/wt', branch: 'feature' }]);
    await call('a', true); gate.resolve([]); await rejected; expect(scan.mock.calls.some(args => args[0] === '/wt')).toBe(true);
  });
  it('managed-account changes cannot reuse or publish incompatible in-flight history', async () => {
    const { call, setManaged } = setupIpc(); const gate = deferred<HarnessSession[]>(); scan.mockReturnValueOnce(gate.promise);
    const a = call(); const rejected = expect(a).rejects.toThrow('configuration changed'); await started();
    const managedScan = vi.fn().mockResolvedValue([]); setManaged({ cacheKey: 'new-generation', targets: [{ accountId: 'acct_new', harness: 'codex', discover: managedScan }] });
    await call('a', true); gate.resolve([]); await rejected; expect(managedScan).toHaveBeenCalledOnce(); expect(scan).toHaveBeenCalledTimes(2);
  });
  it('SSH failure settles shared callers and permits forced retry', async () => {
    const { call, workspaces } = setupIpc(); const host = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue([]);
    workspaces.set('a', { workspaceId: 'a', location: { environmentId: 'ssh-a', path: '/workspace' }, environment: { capabilities: { sessionDiscovery: true }, discoverSessions: host } } as unknown as RegisteredWorkspace);
    await expect(Promise.all([call(), call()])).rejects.toThrow('timeout'); await call('a', true); expect(host).toHaveBeenCalledTimes(2);
  });
});
