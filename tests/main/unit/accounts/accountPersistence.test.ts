import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HarnessCapabilityError } from '../../../../src/main/harnesses/types';
import { HarnessAccountError } from '../../../../src/main/accounts/harnessAccountService';
import { UnsafeAccountPathError } from '../../../../src/main/accounts/accountHomes';
import { FlakyStorage, addAccount, createHarness, settleFlow, type Harness } from './accountFixtures';

const SAVE_FAILED = 'Account settings could not be saved. Try again.';
let storage: FlakyStorage;
let h: Harness;
beforeEach(() => { storage = new FlakyStorage(); h = createHarness({ storage }); });
afterEach(() => { fs.rmSync(h.root, { recursive: true, force: true }); });
const accountsRoot = () => path.join(h.root, 'harness-accounts');
const homeDir = (id: string) => path.join(accountsRoot(), 'codex', id);
const durable = () => JSON.stringify(storage.state);
const noLeak = (text: string) => expect(text).not.toMatch(/EACCES|\/home\/me|\.config|permission denied|harness-accounts\.json/);

describe('registry mutations are transactional', () => {
  it('selection: a failed save leaves the previous selection in memory and durable state unchanged', async () => {
    const a = await addAccount(h, 'codex', 'A');
    const b = await addAccount(h, 'codex', 'B');
    h.service.select('local', 'codex', a.id);
    const before = durable();
    storage.failing = true;
    const error = (() => { try { h.service.select('local', 'codex', b.id); } catch (e) { return e as Error; } })();
    expect(error).toBeInstanceOf(HarnessAccountError);
    expect(error!.message).toBe(SAVE_FAILED);
    noLeak(error!.message);
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe(a.id);
    expect(durable()).toBe(before);
    expect(() => h.service.select('local', 'codex', 'default')).toThrow(SAVE_FAILED);
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe(a.id);
    storage.failing = false;
    h.service.select('local', 'codex', b.id);
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe(b.id);
  });

  it('rename: a failed save keeps the old label, in memory and on the projection', async () => {
    const a = await addAccount(h, 'codex', 'Old');
    const before = durable();
    storage.failing = true;
    expect(() => h.service.rename('local', 'codex', a.id, 'New')).toThrow(SAVE_FAILED);
    expect(h.service.list('local', 'codex').accounts.find((x) => x.id === a.id)?.label).toBe('Old');
    expect(durable()).toBe(before);
  });

  it('status: background marking never throws or leaks, and the committed status stays', async () => {
    const a = await addAccount(h, 'codex', 'A');
    storage.failing = true;
    expect(() => h.service.reportStatus(a.id, 'needs-auth')).not.toThrow();
    expect(h.service.list('local', 'codex').accounts.find((x) => x.id === a.id)?.status).toBe('connected');
    // A home that vanished is also marked in the background; a failing save must not surface there either.
    fs.rmSync(homeDir(a.id), { recursive: true });
    let message = '';
    try { h.service.resolveBinding({ environmentId: 'local', harness: 'codex', accountId: a.id, forLaunch: true }); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('needs to be reconnected');
    noLeak(message);
    expect(h.service.list('local', 'codex').accounts.find((x) => x.id === a.id)?.status).toBe('connected');
  });

  it('never mutates records already published (a failed save cannot half-apply)', async () => {
    const a = await addAccount(h, 'codex', 'Old');
    const published = h.service.managedAccounts('local')[0];
    const snapshot = { ...published };
    storage.failing = true;
    expect(() => h.service.rename('local', 'codex', a.id, 'New')).toThrow();
    h.service.reportStatus(a.id, 'needs-auth');
    expect(published).toEqual(snapshot);
  });

  it('persistence failures through IPC-facing calls carry only the fixed message', async () => {
    const a = await addAccount(h, 'codex', 'A');
    storage.failing = true;
    for (const action of [() => h.service.select('local', 'codex', a.id), () => h.service.rename('local', 'codex', a.id, 'x')]) {
      try { action(); } catch (e) { expect((e as Error).message).toBe(SAVE_FAILED); }
    }
    await expect(h.service.remove('local', 'codex', a.id)).rejects.toThrow(SAVE_FAILED);
  });
});

describe('add: authentication succeeds but the registry cannot be saved', () => {
  /** The fake provider "stores credentials" in the home and then the disk starts failing. */
  function authThenDiskFails() {
    h.capabilities.codex.authenticate.mockImplementationOnce(async (context) => {
      context.waitingForBrowser();
      const [home] = fs.readdirSync(path.join(accountsRoot(), 'codex'));
      fs.writeFileSync(path.join(accountsRoot(), 'codex', home, 'credentials'), 'secret');
      storage.failing = true;
      return { email: 'e@example.test', plan: 'Pro' };
    });
  }

  it('no ghost account, cleanup is attempted, and the home is deleted only after proven sign-out', async () => {
    authThenDiskFails();
    const listener = vi.fn();
    h.service.onAccountsChanged(listener);
    const started = h.service.startAdd('local', 'codex', 'New');
    const state = await settleFlow(h, started.flowId) as { status: string; message?: string };
    expect(state).toEqual({ status: 'failed', message: SAVE_FAILED });
    expect(h.capabilities.codex.logout).toHaveBeenCalledTimes(1);
    expect(h.service.managedAccounts('local')).toEqual([]);
    expect(h.service.list('local', 'codex').accounts).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(accountsRoot(), 'codex'))).toEqual([]); // proven, so deleted
    expect(JSON.stringify(h.authEvents)).not.toMatch(/EACCES|\/home\/me/);
    storage.failing = false;
    expect(h.service.managedAccounts('local')).toEqual([]);
  });

  it('keeps the home recoverable when sign-out cannot be proven, instead of abandoning credentials', async () => {
    authThenDiskFails();
    h.capabilities.codex.logout.mockRejectedValueOnce(new HarnessCapabilityError('timeout', 'slow'));
    const started = h.service.startAdd('local', 'codex', 'New');
    expect((await settleFlow(h, started.flowId)).status).toBe('failed');
    const [kept] = fs.readdirSync(path.join(accountsRoot(), 'codex'));
    expect(kept).toMatch(/^acct_/);
    expect(fs.readFileSync(path.join(accountsRoot(), 'codex', kept, 'credentials'), 'utf8')).toBe('secret');
    expect(h.service.managedAccounts('local')).toEqual([]); // memory still equals the last durable state

    // After a restart with a working disk the home surfaces as a reconnectable, unauthenticated-until-proven account.
    storage.failing = false;
    const restarted = h.restart();
    expect(restarted.managedAccounts('local')).toEqual([expect.objectContaining({ id: kept, harness: 'codex', environmentId: 'local', status: 'needs-auth' })]);
    expect(restarted.getSelectedAccountId('local', 'codex')).toBe('default');
    expect(() => restarted.resolveBinding({ environmentId: 'local', harness: 'codex', accountId: kept, forLaunch: true })).toThrow('needs to be reconnected');
    await restarted.remove('local', 'codex', kept); // the user can remove it once provider cleanup works
    expect(fs.existsSync(path.join(accountsRoot(), 'codex', kept))).toBe(false);
  });

  it('surfaces the retained home immediately when the registry is writable again', async () => {
    h.capabilities.codex.authenticate.mockImplementationOnce(async () => {
      const [home] = fs.readdirSync(path.join(accountsRoot(), 'codex'));
      fs.writeFileSync(path.join(accountsRoot(), 'codex', home, 'credentials'), 'secret');
      throw new HarnessCapabilityError('command-failed', 'login finished but verification broke');
    });
    h.capabilities.codex.logout.mockRejectedValueOnce(new HarnessCapabilityError('command-failed', 'cannot'));
    const state = await settleFlow(h, h.service.startAdd('local', 'codex').flowId);
    expect(state.status).toBe('failed');
    await vi.waitFor(() => expect(h.service.managedAccounts('local')).toHaveLength(1));
    expect(h.service.managedAccounts('local')[0].status).toBe('needs-auth');
  });

  it('a failed add whose provider CLI never ran needs no sign-out and deletes its empty home', async () => {
    h.capabilities.codex.authenticate.mockRejectedValueOnce(new HarnessCapabilityError('binary-unavailable', 'nope'));
    const state = await settleFlow(h, h.service.startAdd('local', 'codex').flowId);
    expect(state).toEqual({ status: 'failed', message: 'Codex is not installed on this machine.' });
    expect(h.capabilities.codex.logout).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(accountsRoot(), 'codex'))).toEqual([]);
  });

  it('cleanup of an abandoned add uses the same standard: unproven sign-out keeps the home', async () => {
    h.capabilities.codex.authenticate.mockImplementationOnce(async (context) => {
      const [home] = fs.readdirSync(path.join(accountsRoot(), 'codex'));
      fs.writeFileSync(path.join(accountsRoot(), 'codex', home, 'credentials'), 'secret');
      await new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(new HarnessCapabilityError('aborted', 'x'))));
      return {};
    });
    h.capabilities.codex.logout.mockRejectedValueOnce(new HarnessCapabilityError('command-failed', 'cannot'));
    const started = h.service.startAdd('local', 'codex');
    await vi.waitFor(() => expect(h.capabilities.codex.authenticate).toHaveBeenCalled());
    h.service.cancelAuth(started.flowId);
    expect(await settleFlow(h, started.flowId)).toEqual({ status: 'cancelled' });
    expect(fs.readdirSync(path.join(accountsRoot(), 'codex'))).toHaveLength(1);
  });
});

describe('cancel versus completed sign-in', () => {
  it('cancel before authenticate resolves wins (cancelled, home cleaned after proven sign-out)', async () => {
    h.capabilities.codex.authenticate.mockImplementationOnce((context) => new Promise((_, reject) => {
      context.signal.addEventListener('abort', () => reject(new HarnessCapabilityError('aborted', 'x')));
    }));
    const started = h.service.startAdd('local', 'codex');
    await vi.waitFor(() => expect(h.capabilities.codex.authenticate).toHaveBeenCalled());
    h.service.cancelAuth(started.flowId);
    expect(await settleFlow(h, started.flowId)).toEqual({ status: 'cancelled' });
    expect(h.service.managedAccounts('local')).toEqual([]);
    expect(h.capabilities.codex.logout).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(accountsRoot(), 'codex'))).toEqual([]);
  });

  it('once authenticate has returned successfully the account commits even if cancel or shutdown raced it', async () => {
    let release!: () => void;
    h.capabilities.codex.authenticate.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ email: 'e@example.test' }); }));
    const started = h.service.startAdd('local', 'codex', 'Kept');
    await vi.waitFor(() => expect(h.capabilities.codex.authenticate).toHaveBeenCalled());
    h.service.cancelAuth(started.flowId); // soft cancel; the provider finishes anyway
    release();
    const state = await settleFlow(h, started.flowId) as { status: string };
    expect(state.status).toBe('connected');
    expect(h.service.managedAccounts('local').map((r) => r.label)).toEqual(['Kept']);
    expect(h.capabilities.codex.logout).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(accountsRoot(), 'codex', h.service.managedAccounts('local')[0].id))).toBe(true);
  });
});

describe('reconnect persistence', () => {
  it('does not partially apply refreshed identity or status when the save fails', async () => {
    const a = await addAccount(h, 'codex', 'A');
    h.service.reportStatus(a.id, 'needs-auth');
    const before = JSON.stringify(h.service.managedAccounts('local'));
    h.capabilities.codex.authenticate.mockImplementationOnce(async () => { storage.failing = true; return { email: 'changed@example.test', plan: 'Max' }; });
    const state = await settleFlow(h, h.service.reconnect('local', 'codex', a.id).flowId);
    expect(state).toEqual({ status: 'failed', message: SAVE_FAILED });
    expect(JSON.stringify(h.service.managedAccounts('local'))).toBe(before);
    expect(fs.existsSync(homeDir(a.id))).toBe(true);
    expect(h.capabilities.codex.logout).not.toHaveBeenCalled(); // an existing account's home is never rolled back
  });
});

describe('removal ordering', () => {
  it('home deletion failure after a successful logout keeps identity, selection and listeners quiet; retry completes', async () => {
    const a = await addAccount(h, 'codex', 'A');
    h.service.select('local', 'codex', a.id);
    const listener = vi.fn();
    h.service.onAccountsChanged(listener);
    const before = durable();
    vi.spyOn(h.homes, 'remove').mockImplementationOnce(() => { throw new Error('EBUSY /home/me/.config/clanker'); });
    const error = await h.service.remove('local', 'codex', a.id).catch((e: Error) => e);
    expect(error).toBeInstanceOf(HarnessAccountError);
    expect((error as Error).message).toBe('A was signed out, but its storage could not be deleted. Try again.');
    noLeak((error as Error).message);
    expect(h.capabilities.codex.logout).toHaveBeenCalledTimes(1);
    expect(h.service.managedAccounts('local').map((r) => r.id)).toEqual([a.id]);
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe(a.id);
    expect(durable()).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    await h.service.remove('local', 'codex', a.id);
    expect(h.capabilities.codex.logout).toHaveBeenCalledTimes(2); // provider proves sign-out again
    expect(h.service.managedAccounts('local')).toEqual([]);
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe('default');
    expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'removed', accountId: a.id, harness: 'codex' });
    expect(fs.existsSync(homeDir(a.id))).toBe(false);
  });

  it('an unsafe home at deletion time (TOCTOU) fails the removal and keeps the record', async () => {
    const a = await addAccount(h, 'codex', 'A');
    vi.spyOn(h.homes, 'remove').mockImplementationOnce(() => { throw new UnsafeAccountPathError(); });
    await expect(h.service.remove('local', 'codex', a.id)).rejects.toThrow('storage could not be deleted');
    expect(h.service.managedAccounts('local')).toHaveLength(1);
  });

  it('registry save failure after the home was deleted keeps the old state, emits nothing and can be retried', async () => {
    const a = await addAccount(h, 'codex', 'A');
    h.service.select('local', 'codex', a.id);
    const listener = vi.fn();
    h.service.onAccountsChanged(listener);
    const before = durable();
    storage.failing = true;
    const error = await h.service.remove('local', 'codex', a.id).catch((e: Error) => e);
    expect((error as Error).message).toBe(SAVE_FAILED);
    noLeak((error as Error).message);
    expect(fs.existsSync(homeDir(a.id))).toBe(false);
    expect(h.service.managedAccounts('local').map((r) => r.id)).toEqual([a.id]);
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe(a.id);
    expect(durable()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    // Meanwhile the account honestly reports that it needs attention rather than pointing at a missing home.
    expect(() => h.service.resolveBinding({ environmentId: 'local', harness: 'codex', forLaunch: true })).toThrow('needs to be reconnected');

    storage.failing = false;
    await h.service.remove('local', 'codex', a.id); // recreates the trusted home so the provider can prove sign-out
    expect(h.service.managedAccounts('local')).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(homeDir(a.id))).toBe(false);
  });
});

describe('orphaned-home recovery', () => {
  it('recovers only validated, non-empty, unregistered owned homes, as needs-auth records', async () => {
    const kept = await addAccount(h, 'codex', 'Kept');
    const orphan = `acct_${'a'.repeat(32)}`;
    const empty = `acct_${'b'.repeat(32)}`;
    h.homes.ensure('codex', orphan);
    fs.writeFileSync(path.join(h.homes.resolve('codex', orphan), 'state'), 'x');
    h.homes.ensure('claude', empty); // empty: a crash before sign-in, nothing worth recovering
    fs.mkdirSync(path.join(accountsRoot(), 'codex', 'not-an-account-id'));
    fs.writeFileSync(path.join(accountsRoot(), 'codex', 'not-an-account-id', 'x'), 'x');
    fs.mkdirSync(path.join(accountsRoot(), 'Weird Harness'));
    const outside = path.join(h.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'x'), 'x');
    try { fs.symlinkSync(outside, path.join(accountsRoot(), 'codex', `acct_${'c'.repeat(32)}`), 'junction'); } catch { /* links unavailable */ }

    const restarted = h.restart();
    const ids = restarted.managedAccounts('local').map((r) => r.id).sort();
    expect(ids).toEqual([kept.id, orphan].sort());
    const recovered = restarted.managedAccounts('local').find((r) => r.id === orphan)!;
    expect(recovered).toMatchObject({ status: 'needs-auth', harness: 'codex', environmentId: 'local' });
    expect(recovered).not.toHaveProperty('email');
    expect(restarted.getSelectedAccountId('local', 'codex')).toBe('default');
    expect(JSON.stringify(storage.state)).not.toContain(h.root);
  });

  it('does not claim the home of an add that is still in flight', async () => {
    let release!: () => void;
    h.capabilities.codex.authenticate.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({}); }));
    const started = h.service.startAdd('local', 'codex');
    await vi.waitFor(() => expect(h.capabilities.codex.authenticate).toHaveBeenCalled());
    const [home] = fs.readdirSync(path.join(accountsRoot(), 'codex'));
    fs.writeFileSync(path.join(accountsRoot(), 'codex', home, 'partial'), 'x');
    h.service.recoverOrphanedHomes();
    expect(h.service.managedAccounts('local')).toEqual([]);
    release();
    expect((await settleFlow(h, started.flowId)).status).toBe('connected');
    expect(h.service.managedAccounts('local')).toHaveLength(1);
  });

  it('a failing registry during recovery is silent and changes nothing', async () => {
    const orphan = `acct_${'d'.repeat(32)}`;
    h.homes.ensure('codex', orphan);
    fs.writeFileSync(path.join(h.homes.resolve('codex', orphan), 'state'), 'x');
    storage.failing = true;
    expect(() => h.restart()).not.toThrow();
    expect(h.restart().managedAccounts('local')).toEqual([]);
  });

  it('default-only users: no recovery, no records, no directories created', () => {
    const fresh = createHarness();
    expect(fresh.service.managedAccounts('local')).toEqual([]);
    expect(fs.existsSync(path.join(fresh.root, 'harness-accounts'))).toBe(false);
    fs.rmSync(fresh.root, { recursive: true, force: true });
  });
});
