import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HarnessCapabilityError } from '../../../../src/main/harnesses/types';
import { HarnessAccountError, prepareHarnessAccountContext } from '../../../../src/main/accounts/harnessAccountService';
import { MemoryAccountStorage } from '../../../../src/main/accounts/accountStorage';
import { addAccount, createHarness, fakeCapability, settleFlow, type Harness } from './accountFixtures';

let h: Harness;
beforeEach(() => { h = createHarness(); });
afterEach(() => { fs.rmSync(h.root, { recursive: true, force: true }); });
const accountsRoot = () => path.join(h.root, 'harness-accounts');

describe('default account', () => {
  it('is synthetic: no stored record, no directories, no auth flow, nothing changes for a user who never adds one', async () => {
    const list = h.service.list('local', 'codex');
    expect(list).toMatchObject({ environmentId: 'local', harness: 'codex', managedSupported: true });
    expect(list.accounts).toEqual([{ id: 'default', harness: 'codex', kind: 'default', status: 'unknown', selected: true }]);
    expect(fs.existsSync(accountsRoot())).toBe(false);
    expect(h.storage.state).toBeUndefined();
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it.each(['codex', 'claude'] as const)('%s default binding adds no environment and leaves the base untouched', (harness) => {
    const binding = h.service.resolveBinding({ environmentId: 'local', harness, forLaunch: true });
    expect(binding).toMatchObject({ id: 'default', kind: 'default', environment: {} });
    const base = { PATH: '/bin', EXTRA: '1' };
    expect(binding.mergeEnvironment(base)).toBe(base);
    expect(base).toEqual({ PATH: '/bin', EXTRA: '1' });
    expect(fs.existsSync(accountsRoot())).toBe(false);
  });

  it('prepareHarnessAccountContext without a service, or for a harness with no account capability, is the default binding', () => {
    for (const harness of ['codex', 'claude', 'opencode', 'pi', 'not-a-harness']) {
      const binding = prepareHarnessAccountContext(undefined, { environmentId: 'local', harness });
      expect(binding.kind).toBe('default');
      expect(Object.keys(binding.environment)).toEqual([]);
    }
    expect(prepareHarnessAccountContext(h.service, { environmentId: 'local', harness: 'opencode' }).kind).toBe('default');
  });

  it('cannot be removed or have its identity forged', async () => {
    await expect(h.service.remove('local', 'codex', 'default')).rejects.toThrow('default account cannot be removed');
    expect(() => h.service.select('local', 'codex', 'acct_deadbeef')).toThrow(HarnessAccountError);
  });
});

describe('managed accounts: add, bind, persist', () => {
  it('adds an account only after verified sign-in and persists display-safe metadata only', async () => {
    const started = h.service.startAdd('local', 'codex', '  Work\u0007 ');
    expect(['starting', 'waiting-for-browser']).toContain(started.state.status);
    const state = await settleFlow(h, started.flowId);
    expect(state.status).toBe('connected');
    const account = (state as unknown as { account: Record<string, unknown> }).account;
    expect(account).toMatchObject({ kind: 'managed', harness: 'codex', label: 'Work', email: 'person@example.test', plan: 'Pro', status: 'connected', selected: false });
    expect(h.openExternal).toHaveBeenCalledExactlyOnceWith('https://auth.example.test/login');
    expect(h.authEvents.map((e) => (e as { state: { status: string } }).state.status)).toEqual(['waiting-for-browser', 'connected']);

    const stored = JSON.stringify(h.storage.state);
    expect(stored).not.toMatch(/token|secret|https?:|auth_url|authUrl|password/i);
    expect(stored).not.toContain(h.root); // no filesystem paths in metadata
    expect(Object.keys((h.storage.state as { accounts: object[] }).accounts[0]).sort())
      .toEqual(['createdAt', 'email', 'environmentId', 'harness', 'id', 'kind', 'label', 'plan', 'status']);
  });

  it('does not select the new account implicitly', async () => {
    await addAccount(h, 'codex', 'Work');
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe('default');
  });

  it('managed Codex receives only its trusted owned home; managed Claude only its config directory', async () => {
    const codex = await addAccount(h, 'codex', 'C');
    const claude = await addAccount(h, 'claude', 'L');
    const codexBinding = h.service.resolveBinding({ environmentId: 'local', harness: 'codex', accountId: codex.id, forLaunch: true });
    const claudeBinding = h.service.resolveBinding({ environmentId: 'local', harness: 'claude', accountId: claude.id, forLaunch: true });
    expect(Object.keys(codexBinding.environment)).toEqual(['CODEX_HOME']);
    expect(Object.keys(claudeBinding.environment)).toEqual(['CLAUDE_CONFIG_DIR']);
    const real = fs.realpathSync(accountsRoot());
    expect(codexBinding.environment.CODEX_HOME).toBe(path.join(real, 'codex', codex.id));
    expect(claudeBinding.environment.CLAUDE_CONFIG_DIR).toBe(path.join(real, 'claude', claude.id));
    expect(Object.isFrozen(codexBinding.environment)).toBe(true);
    expect(codexBinding.mergeEnvironment({ CODEX_HOME: '/user/set', KEEP: '1' })).toEqual({ CODEX_HOME: codexBinding.environment.CODEX_HOME, KEEP: '1' });
    // Nothing a renderer could read carries the path.
    expect(JSON.stringify(codexBinding.safe)).not.toContain(real);
    expect(JSON.stringify(h.service.list('local', 'codex'))).not.toContain(real);
  });

  it('allocates distinct owned directories for concurrent adds', async () => {
    const [a, b] = [h.service.startAdd('local', 'codex', 'A'), h.service.startAdd('local', 'codex', 'B')];
    const states = await Promise.all([settleFlow(h, a.flowId), settleFlow(h, b.flowId)]);
    const ids = states.map((s) => (s as unknown as { account: { id: string } }).account.id);
    expect(new Set(ids).size).toBe(2);
    expect(fs.readdirSync(path.join(accountsRoot(), 'codex')).sort()).toEqual([...ids].sort());
  });

  it('survives a restart through storage and drops tampered or foreign records on load', async () => {
    const account = await addAccount(h, 'codex', 'Work');
    h.service.select('local', 'codex', account.id);
    const reloaded = createHarness({ storage: new MemoryAccountStorage(JSON.parse(JSON.stringify(h.storage.state))) });
    expect(reloaded.service.getSelectedAccountId('local', 'codex')).toBe(account.id);

    const tampered = createHarness({ storage: new MemoryAccountStorage({
      accounts: [
        { id: '../../.codex', harness: 'codex', environmentId: 'local', kind: 'managed', createdAt: 1 },
        { id: `acct_${'c'.repeat(32)}`, harness: 'pi', environmentId: 'local', kind: 'managed', createdAt: 1 },
        { id: `acct_${'d'.repeat(32)}`, harness: 'codex', environmentId: 'local', kind: 'default', createdAt: 1 },
        { id: `acct_${'e'.repeat(32)}`, harness: 'codex', environmentId: 'local', kind: 'managed', createdAt: 1, path: '/etc', label: 'ok\u0000' },
        'junk', null,
      ],
      selections: { 'local\u0000codex': '../../.codex', 'ssh\u0000claude': `acct_${'e'.repeat(32)}` },
    }) });
    expect(tampered.service.managedAccounts('local').map((r) => r.id)).toEqual([`acct_${'e'.repeat(32)}`]);
    expect(tampered.service.managedAccounts('local')[0]).not.toHaveProperty('path');
    expect(tampered.service.getSelectedAccountId('local', 'codex')).toBe('default');
    expect(tampered.service.getSelectedAccountId('ssh', 'claude')).toBe('default');
    fs.rmSync(tampered.root, { recursive: true, force: true });
    fs.rmSync(reloaded.root, { recursive: true, force: true });
  });
});

describe('selection', () => {
  it('is scoped to environment + harness and never crosses either', async () => {
    const codex = await addAccount(h, 'codex', 'C');
    const claude = await addAccount(h, 'claude', 'L');
    h.service.select('local', 'codex', codex.id);
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe(codex.id);
    expect(h.service.getSelectedAccountId('local', 'claude')).toBe('default'); // Codex and Claude do not interfere
    h.service.select('local', 'claude', claude.id);
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe(codex.id);

    expect(() => h.service.select('local', 'claude', codex.id)).toThrow('not available'); // other harness
    expect(() => h.service.select('other-env', 'codex', codex.id)).toThrow('not available'); // other environment
    expect(() => h.service.select('local', 'codex', 'acct_' + '0'.repeat(32))).toThrow('not available'); // invented
    expect(h.service.getSelectedAccountId('other-env', 'codex')).toBe('default');
    expect(() => h.service.select('local', 'opencode', 'default')).toThrow('not available for this harness');
    expect(() => h.service.list({} as never, 'codex')).toThrow('Invalid account request');
  });

  it('changing selection does not alter a binding that was already resolved (a running terminal keeps its environment)', async () => {
    const first = await addAccount(h, 'codex', 'One');
    const second = await addAccount(h, 'codex', 'Two');
    h.service.select('local', 'codex', first.id);
    const spawnedWith = h.service.resolveBinding({ environmentId: 'local', harness: 'codex', forLaunch: true });
    const env = spawnedWith.mergeEnvironment({ A: '1' });
    const snapshot = JSON.stringify(env);
    h.service.select('local', 'codex', second.id);
    expect(JSON.stringify(env)).toBe(snapshot);
    expect(spawnedWith.id).toBe(first.id);
    expect(h.service.resolveBinding({ environmentId: 'local', harness: 'codex', forLaunch: true }).id).toBe(second.id);
  });

  it('falls back to default when the selected account is removed, and does not delete the native home', async () => {
    const account = await addAccount(h, 'codex', 'Work');
    h.service.select('local', 'codex', account.id);
    const list = await h.service.remove('local', 'codex', account.id);
    expect(list.accounts.map((a) => a.id)).toEqual(['default']);
    expect(list.accounts[0].selected).toBe(true);
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe('default');
  });

  it('renames with a sanitized, bounded, non-unique label', async () => {
    const a = await addAccount(h, 'codex', 'Same');
    const b = await addAccount(h, 'codex', 'Same');
    const list = h.service.rename('local', 'codex', b.id, `  ${'x'.repeat(100)}\n`);
    expect(list.accounts.find((x) => x.id === b.id)?.label).toHaveLength(40);
    expect(h.service.list('local', 'codex').accounts.find((x) => x.id === a.id)?.label).toBe('Same');
    expect(() => h.service.rename('local', 'codex', a.id, 5 as never)).toThrow('Invalid account request');
  });
});

describe('auth flow lifecycle', () => {
  it('counts starting/browser sign-in work, but not completed or failed flows', async () => {
    let finish!: () => void;
    h.capabilities.codex.authenticate.mockImplementationOnce(async (context) => {
      context.waitingForBrowser();
      await new Promise<void>((resolve) => { finish = resolve; });
      return {};
    });
    expect(h.service.hasActiveSignIn()).toBe(false);
    const started = h.service.startAdd('local', 'codex');
    expect(h.service.hasActiveSignIn()).toBe(true);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(h.service.hasActiveSignIn()).toBe(true);
    finish(); await settleFlow(h, started.flowId);
    expect(h.service.hasActiveSignIn()).toBe(false);
    h.capabilities.codex.authenticate.mockRejectedValueOnce(new Error('failed'));
    await settleFlow(h, h.service.startAdd('local', 'codex').flowId);
    expect(h.service.hasActiveSignIn()).toBe(false);
  });

  it('cleans the owned directory and persists nothing when sign-in fails, mapping errors to safe text', async () => {
    h.capabilities.codex.authenticate.mockRejectedValueOnce(new Error('token=sk-SECRET url=https://x/?code=ABC path=/home/me/.codex'));
    const started = h.service.startAdd('local', 'codex');
    const state = await settleFlow(h, started.flowId) as { status: string; message?: string };
    expect(state).toEqual({ status: 'failed', message: 'Sign-in failed. Try again.' });
    expect(JSON.stringify(h.authEvents)).not.toMatch(/SECRET|code=ABC|\.codex/);
    expect(h.service.list('local', 'codex').accounts).toHaveLength(1);
    expect(fs.readdirSync(path.join(accountsRoot(), 'codex'))).toEqual([]);
    expect(h.storage.state).toBeUndefined();
  });

  it.each([
    ['binary-unavailable', 'Codex is not installed on this machine.'],
    ['unauthenticated', 'Sign-in was not completed.'],
    ['timeout', 'Sign-in timed out. Try again.'],
  ] as const)('maps %s to a fixed product message', async (kind, message) => {
    h.capabilities.codex.authenticate.mockRejectedValueOnce(new HarnessCapabilityError(kind, 'raw https://leak'));
    const state = await settleFlow(h, h.service.startAdd('local', 'codex').flowId);
    expect(state).toEqual({ status: 'failed', message });
  });

  it('cancel aborts the provider, ends cancelled and discards the directory', async () => {
    let signal: AbortSignal | undefined;
    h.capabilities.codex.authenticate.mockImplementationOnce((context) => new Promise((_, reject) => {
      signal = context.signal;
      context.waitingForBrowser();
      context.signal.addEventListener('abort', () => reject(new HarnessCapabilityError('aborted', 'cancelled')));
    }));
    const started = h.service.startAdd('local', 'codex');
    await vi.waitFor(() => expect(signal).toBeDefined());
    h.service.cancelAuth(started.flowId);
    expect(await settleFlow(h, started.flowId)).toEqual({ status: 'cancelled' });
    expect(signal?.aborted).toBe(true);
    expect(fs.readdirSync(path.join(accountsRoot(), 'codex'))).toEqual([]);
    expect(h.service.managedAccounts('local')).toEqual([]);
  });

  it('allows one auth flow per account and bounds concurrency', async () => {
    const account = await addAccount(h, 'codex', 'W');
    h.capabilities.codex.authenticate.mockImplementation((context) => new Promise((_, reject) => {
      context.signal.addEventListener('abort', () => reject(new HarnessCapabilityError('aborted', 'x')));
    }));
    const first = h.service.reconnect('local', 'codex', account.id);
    expect(() => h.service.reconnect('local', 'codex', account.id)).toThrow('already in progress');
    const more = [1, 2, 3].map(() => h.service.startAdd('local', 'codex'));
    expect(() => h.service.startAdd('local', 'codex')).toThrow('Too many sign-ins');
    await h.service.cancelAllAuth();
    expect(await settleFlow(h, first.flowId)).toEqual({ status: 'cancelled' });
    for (const flow of more) expect(await settleFlow(h, flow.flowId)).toEqual({ status: 'cancelled' });
    expect(fs.readdirSync(path.join(accountsRoot(), 'codex')).length).toBe(1); // only the pre-existing account remains
  });

  it('reconnect reuses the same trusted home and refreshes status', async () => {
    const account = await addAccount(h, 'codex', 'W');
    h.service.reportStatus(account.id, 'needs-auth');
    expect(() => h.service.resolveBinding({ environmentId: 'local', harness: 'codex', accountId: account.id, forLaunch: true })).toThrow('needs to be reconnected');
    const before = h.service.resolveBinding({ environmentId: 'local', harness: 'codex', accountId: account.id }).environment;
    const state = await settleFlow(h, h.service.reconnect('local', 'codex', account.id).flowId);
    expect(state.status).toBe('connected');
    const after = h.service.resolveBinding({ environmentId: 'local', harness: 'codex', accountId: account.id, forLaunch: true }).environment;
    expect(after).toEqual(before);
  });

  it('refuses to open anything that is not an http(s) address', async () => {
    h.capabilities.codex.authenticate.mockImplementationOnce(async (context) => { context.openUrl('javascript:alert(1)'); return {}; });
    const state = await settleFlow(h, h.service.startAdd('local', 'codex').flowId);
    expect(state.status).toBe('failed');
    expect(h.openExternal).not.toHaveBeenCalled();
    h.capabilities.codex.authenticate.mockImplementationOnce(async (context) => { context.openUrl('file:///etc/passwd'); return {}; });
    expect((await settleFlow(h, h.service.startAdd('local', 'codex').flowId)).status).toBe('failed');
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it('dispose cancels pending sign-ins and waits for them', async () => {
    h.capabilities.claude.authenticate.mockImplementationOnce((context) => new Promise((_, reject) => {
      context.signal.addEventListener('abort', () => reject(new HarnessCapabilityError('aborted', 'x')));
    }));
    const started = h.service.startAdd('local', 'claude');
    await h.service.dispose();
    expect(await settleFlow(h, started.flowId)).toEqual({ status: 'cancelled' });
    expect(() => h.service.startAdd('local', 'claude')).toThrow('shutting down');
  });
});

describe('removal', () => {
  it('signs out through the provider, deletes only the owned directory, clears selection and notifies listeners', async () => {
    const keep = await addAccount(h, 'codex', 'Keep');
    const gone = await addAccount(h, 'codex', 'Gone');
    const nativeHome = path.join(h.root, '.codex');
    fs.mkdirSync(nativeHome);
    fs.writeFileSync(path.join(nativeHome, 'auth.json'), 'native');
    h.service.select('local', 'codex', gone.id);
    const listener = vi.fn();
    h.service.onAccountsChanged(listener);
    const generation = h.service.generation;

    const list = await h.service.remove('local', 'codex', gone.id);
    expect(h.capabilities.codex.logout).toHaveBeenCalledTimes(1);
    expect(list.accounts.map((a) => a.id)).toEqual(['default', keep.id]);
    expect(fs.existsSync(path.join(accountsRoot(), 'codex', gone.id))).toBe(false);
    expect(fs.existsSync(path.join(accountsRoot(), 'codex', keep.id))).toBe(true);
    expect(fs.readFileSync(path.join(nativeHome, 'auth.json'), 'utf8')).toBe('native');
    expect(listener).toHaveBeenCalledWith({ type: 'removed', accountId: gone.id, harness: 'codex' });
    expect(h.service.generation).toBeGreaterThan(generation);
    expect(JSON.stringify(h.storage.state)).not.toContain(gone.id);
  });

  it('rejects other-harness, other-environment and unknown accounts without touching anything', async () => {
    const account = await addAccount(h, 'codex', 'W');
    await expect(h.service.remove('local', 'claude', account.id)).rejects.toThrow('not available');
    await expect(h.service.remove('elsewhere', 'codex', account.id)).rejects.toThrow('not available');
    await expect(h.service.remove('local', 'codex', '../../.codex')).rejects.toThrow('not available');
    expect(fs.existsSync(path.join(accountsRoot(), 'codex', account.id))).toBe(true);
    expect(h.capabilities.codex.logout).not.toHaveBeenCalled();
  });

  it('removes after a successful logout, and after a definitive "already signed out"', async () => {
    const a = await addAccount(h, 'codex', 'A');
    await expect(h.service.remove('local', 'codex', a.id)).resolves.toBeDefined();
    expect(h.capabilities.codex.logout).toHaveBeenCalledTimes(1);
    expect(h.service.managedAccounts('local')).toEqual([]);
    const b = await addAccount(h, 'codex', 'B');
    h.capabilities.codex.logout.mockRejectedValueOnce(new HarnessCapabilityError('unauthenticated', 'x'));
    await expect(h.service.remove('local', 'codex', b.id)).resolves.toBeDefined();
    expect(h.service.managedAccounts('local')).toEqual([]);
    expect(fs.readdirSync(path.join(accountsRoot(), 'codex'))).toEqual([]);
  });

  it.each(['binary-unavailable', 'unsupported', 'timeout', 'command-failed', 'transport-failure', 'aborted'] as const)(
    'fails closed on %s: metadata, ID, selection, home and listeners are all untouched, with a fixed message', async (kind) => {
      const account = await addAccount(h, 'codex', 'Work');
      h.service.select('local', 'codex', account.id);
      const nativeHome = path.join(h.root, '.codex');
      fs.mkdirSync(nativeHome);
      fs.writeFileSync(path.join(nativeHome, 'auth.json'), 'native');
      const home = h.homes.resolve('codex', account.id);
      fs.writeFileSync(path.join(home, 'marker'), 'x');
      const listener = vi.fn();
      h.service.onAccountsChanged(listener);
      const generation = h.service.generation;
      const before = JSON.stringify(h.storage.state);
      h.capabilities.codex.logout.mockRejectedValueOnce(new HarnessCapabilityError(kind, 'raw https://leak token=SECRET /home/me'));

      const error = await h.service.remove('local', 'codex', account.id).catch((e: Error) => e);
      expect(error).toBeInstanceOf(HarnessAccountError);
      expect((error as Error).message).toBe('Work could not be signed out, so it was not removed. Try again.');
      expect((error as Error).message).not.toMatch(/SECRET|leak|\/home/);
      expect(h.service.managedAccounts('local').map((r) => r.id)).toEqual([account.id]);
      expect(h.service.getSelectedAccountId('local', 'codex')).toBe(account.id);
      expect(fs.readFileSync(path.join(home, 'marker'), 'utf8')).toBe('x');
      expect(JSON.stringify(h.storage.state)).toBe(before);
      expect(listener).not.toHaveBeenCalled();
      expect(h.service.generation).toBe(generation);
      expect(fs.readFileSync(path.join(nativeHome, 'auth.json'), 'utf8')).toBe('native');
      // The account is still fully usable and can be removed once cleanup works.
      expect(h.service.resolveBinding({ environmentId: 'local', harness: 'codex', forLaunch: true }).id).toBe(account.id);
      await expect(h.service.remove('local', 'codex', account.id)).resolves.toBeDefined();
    });

  it('recreates a missing home so the provider can still prove sign-out', async () => {
    const account = await addAccount(h, 'codex', 'A');
    fs.rmSync(path.join(accountsRoot(), 'codex', account.id), { recursive: true });
    await h.service.remove('local', 'codex', account.id);
    expect(h.capabilities.codex.logout).toHaveBeenCalledTimes(1);
    expect(h.service.managedAccounts('local')).toEqual([]);
  });

  it('refuses to remove an account whose storage cannot be verified (symlinked home) and deletes nothing', async () => {
    const account = await addAccount(h, 'codex', 'A');
    const home = path.join(accountsRoot(), 'codex', account.id);
    const victim = path.join(h.root, 'victim');
    fs.mkdirSync(victim);
    fs.writeFileSync(path.join(victim, 'keep'), 'x');
    fs.rmSync(home, { recursive: true });
    try { fs.symlinkSync(victim, home, 'junction'); } catch { return; }
    await expect(h.service.remove('local', 'codex', account.id)).rejects.toThrow('storage could not be verified');
    expect(h.capabilities.codex.logout).not.toHaveBeenCalled();
    expect(h.service.managedAccounts('local')).toHaveLength(1);
    expect(fs.readFileSync(path.join(victim, 'keep'), 'utf8')).toBe('x');
  });

  it('cancels a pending reconnect for the account first and leaves other accounts alone', async () => {
    const account = await addAccount(h, 'codex', 'A');
    h.capabilities.codex.authenticate.mockImplementationOnce((context) => new Promise((_, reject) => {
      context.signal.addEventListener('abort', () => reject(new HarnessCapabilityError('aborted', 'x')));
    }));
    const flow = h.service.reconnect('local', 'codex', account.id);
    await h.service.remove('local', 'codex', account.id);
    expect(await settleFlow(h, flow.flowId)).toEqual({ status: 'cancelled' });
    expect(h.service.managedAccounts('local')).toEqual([]);
  });
});

describe('never falls back to another account', () => {
  it('a missing managed account fails the launch explicitly, not silently as default', async () => {
    const account = await addAccount(h, 'codex', 'W');
    await h.service.remove('local', 'codex', account.id);
    expect(() => h.service.resolveBinding({ environmentId: 'local', harness: 'codex', accountId: account.id, forLaunch: true })).toThrow('removed or is no longer available');
  });

  it('a managed home deleted behind our back marks the account as needing sign-in and refuses to launch', async () => {
    const account = await addAccount(h, 'codex', 'W');
    fs.rmSync(path.join(accountsRoot(), 'codex', account.id), { recursive: true });
    expect(() => h.service.resolveBinding({ environmentId: 'local', harness: 'codex', accountId: account.id, forLaunch: true })).toThrow('needs to be reconnected');
    expect(h.service.list('local', 'codex').accounts.find((a) => a.id === account.id)?.status).toBe('needs-auth');
  });
});

describe('SSH environments (v1)', () => {
  it('report an explicit capability state and never create local state', async () => {
    const list = h.service.list('ssh-1', 'codex');
    expect(list).toMatchObject({ managedSupported: false, unsupportedReason: 'Managed accounts are not available for SSH environments yet.' });
    expect(list.accounts.map((a) => a.id)).toEqual(['default']);
    expect(() => h.service.startAdd('ssh-1', 'codex')).toThrow('not available for SSH environments');
    expect(() => h.service.reconnect('ssh-1', 'claude', 'acct_' + '1'.repeat(32))).toThrow('not available for SSH environments');
    expect(fs.existsSync(accountsRoot())).toBe(false);
    expect(h.capabilities.codex.authenticate).not.toHaveBeenCalled();
    // An environment ID never maps a local managed account onto SSH.
    expect(h.service.resolveBinding({ environmentId: 'ssh-1', harness: 'codex', forLaunch: true }).environment).toEqual({});
  });

  it('a local account cannot be used or selected for an SSH environment', async () => {
    const account = await addAccount(h, 'codex', 'W');
    expect(() => h.service.select('ssh-1', 'codex', account.id)).toThrow('not available');
    expect(() => h.service.resolveBinding({ environmentId: 'ssh-1', harness: 'codex', accountId: account.id, forLaunch: true })).toThrow('not available for SSH environments');
  });

  it('a persisted managed record scoped to an SSH environment is dropped on load and never resolves a local path', async () => {
    const id = `acct_${'f'.repeat(32)}`;
    const forged = createHarness({ storage: new MemoryAccountStorage({
      accounts: [{ id, harness: 'codex', environmentId: 'ssh-1', kind: 'managed', createdAt: 1, label: 'Remote' }],
      selections: { 'ssh-1\u0000codex': id },
    }) });
    expect(forged.service.managedAccounts('ssh-1')).toEqual([]);
    expect(forged.service.list('ssh-1', 'codex').accounts.map((a) => a.id)).toEqual(['default']);
    expect(forged.service.getSelectedAccountId('ssh-1', 'codex')).toBe('default');
    expect(() => forged.service.resolveBinding({ environmentId: 'ssh-1', harness: 'codex', accountId: id, forLaunch: true })).toThrow('not available for SSH environments');
    expect(forged.service.discoverySource('ssh-1')).toBeUndefined();
    expect(forged.service.resolveBinding({ environmentId: 'ssh-1', harness: 'codex', forLaunch: true })).toMatchObject({ kind: 'default', environment: {} });
    expect(fs.existsSync(path.join(forged.root, 'harness-accounts'))).toBe(false);
    fs.rmSync(forged.root, { recursive: true, force: true });
  });
});

describe('capability coverage', () => {
  it('rejects harnesses without the account capability', () => {
    for (const harness of ['opencode', 'pi', 'omp', 'hermes', 'agy', 'bogus']) {
      expect(() => h.service.list('local', harness)).toThrow(HarnessAccountError);
    }
  });

  it('provider capability controls the variable name; shared code names no harness', async () => {
    const custom = createHarness({ capabilities: { codex: fakeCapability('SOME_OTHER_HOME') } });
    const account = await addAccount(custom, 'codex');
    expect(Object.keys(custom.service.resolveBinding({ environmentId: 'local', harness: 'codex', accountId: account.id }).environment)).toEqual(['SOME_OTHER_HOME']);
    fs.rmSync(custom.root, { recursive: true, force: true });
    const source = fs.readFileSync(path.resolve(__dirname, '../../../../src/main/accounts/harnessAccountService.ts'), 'utf8');
    expect(source).not.toMatch(/CODEX_HOME|CLAUDE_CONFIG_DIR|case 'codex'|case 'claude'|=== 'codex'|=== 'claude'/);
  });
});
