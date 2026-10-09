import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _setTestStore, _resetTestStore, _setTestSafeStorage, _resetTestSafeStorage, approveGitLabInstance, revokeGitLabInstance,
  saveGitLabInstancePat, getProviderPat, savePat, deletePat, getCredentialRevision, configureSshForHost, restoreApprovedGitLabInstances } from '../../../../src/main/credential/credentialService';
import { replaceApprovedGitLabOrigins } from '../../../../src/main/vcs/instancePolicy';
let values: Map<string, unknown>; let root: string;
let originalHome: string | undefined;
beforeEach(() => {
  values = new Map(); _setTestStore({ get: (key) => values.get(key), set: (key, value) => { values.set(key, value); }, delete: (key) => { values.delete(key); } });
  _setTestSafeStorage({ isEncryptionAvailable: () => true, encryptString: (token) => Buffer.from(`cipher:${token}`), decryptString: (buffer) => buffer.toString().slice(7) });
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-vcs-safety-')); originalHome = process.env.HOME; process.env.HOME = root;
  replaceApprovedGitLabOrigins([]);
});
afterEach(() => { _resetTestStore(); _resetTestSafeStorage(); replaceApprovedGitLabOrigins([]);
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  fs.rmSync(root, { recursive: true, force: true }); });
describe('main-owned host credentials and SSH configuration safety', () => {
  it('stores host tokens separately under encrypted origin-digest keys, with no SaaS fallback', async () => {
    expect(await savePat({ provider: 'gitlab', token: 'saas-secret' })).toMatchObject({ success: true });
    expect(approveGitLabInstance('https://code.example')).toMatchObject({ success: true });
    expect(getProviderPat('gitlab', 'https://code.example').success).toBe(false);
    expect(await saveGitLabInstancePat('https://code.example', 'host-secret')).toMatchObject({ success: true });
    expect(getProviderPat('gitlab', 'https://code.example').token).toBe('host-secret');
    expect(getProviderPat('gitlab', 'https://gitlab.com').token).toBe('saas-secret');
    expect(getProviderPat('gitlab', 'https://other.example').success).toBe(false);
    expect([...values.keys()].some((key) => /^encryptedPats\.gitlab-instance-[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(JSON.stringify([...values])).not.toContain('host-secret');
  });
  it('revocation blocks access and removes its token, without touching SaaS credentials', async () => {
    await savePat({ provider: 'gitlab', token: 'saas' }); approveGitLabInstance('https://code.example'); await saveGitLabInstancePat('https://code.example', 'host');
    expect(revokeGitLabInstance('https://code.example').success).toBe(true);
    expect(getProviderPat('gitlab', 'https://code.example').success).toBe(false);
    expect(getProviderPat('gitlab', 'https://gitlab.com').token).toBe('saas');
  });
  it.each(['http://code.example', 'https://user:pass@code.example', 'https://code.example/path', 'https://code.example?q=1', 'https://code.example#fragment', 'https://code.example/a/..', 'https://code%2Eexample'])('rejects invalid approval %s', async (origin) => {
    expect(approveGitLabInstance(origin).success).toBe(false);
    expect((await saveGitLabInstancePat(origin, 'secret')).success).toBe(false);
    expect(values.size).toBe(0);
  });
  it('fails closed when approval persistence or restore is unavailable', () => {
    approveGitLabInstance('https://code.example');
    _setTestStore({ get: () => { throw new Error('secret'); }, set: () => { throw new Error('secret'); }, delete: () => {} });
    expect(revokeGitLabInstance('https://code.example').success).toBe(false);
    expect(getProviderPat('gitlab', 'https://code.example').success).toBe(false);
    expect(() => restoreApprovedGitLabInstances()).not.toThrow();
    expect(getProviderPat('gitlab', 'https://code.example').success).toBe(false);
  });
  it('restores main-owned approvals and preserves port isolation', async () => {
    approveGitLabInstance('https://code.example:8443'); await saveGitLabInstancePat('https://code.example:8443', 'host');
    replaceApprovedGitLabOrigins([]); restoreApprovedGitLabInstances();
    expect(getProviderPat('gitlab', 'https://code.example:8443').token).toBe('host');
    expect(getProviderPat('gitlab', 'https://code.example').success).toBe(false);
  });
  it('bounds main-owned approvals', () => {
    for (let i = 0; i < 16; i++) expect(approveGitLabInstance(`https://code${i}.example`).success).toBe(true);
    expect(approveGitLabInstance('https://extra.example').success).toBe(false);
  });
  it.runIf(process.platform !== 'win32')('quotes a POSIX identity path without rewriting literal backslashes', async () => {
    process.env.HOME = path.join(root, 'user with"quotes\\literal');
    fs.mkdirSync(process.env.HOME);
    expect((await configureSshForHost('code.example')).success).toBe(true);
    const config = fs.readFileSync(path.join(process.env.HOME, '.ssh', 'config'), 'utf8');
    expect(config).toContain('IdentityFile "'); expect(config).toContain('with\\"quotes\\\\literal');
  });
  it('blocks token retrieval on a forged hosted origin', async () => {
    await savePat({ provider: 'github', token: 'secret' }); expect(getProviderPat('github', 'https://attacker.test').success).toBe(false);
  });
  it('invalidates credential revisions and sanitizes deletion storage errors', async () => {
    const before = getCredentialRevision(); await savePat({ provider: 'github', token: 'secret' }); expect(getCredentialRevision()).toBeGreaterThan(before);
    _setTestStore({ get: () => { throw new Error('private-path secret'); }, set: () => {}, delete: () => { throw new Error('private-path secret'); } });
    const result = deletePat('github'); expect(result.success).toBe(false); expect(result.error).not.toContain('secret'); expect(result.error).not.toContain('private-path');
  });
  it.each(['', '*', '-option', 'host name', 'host\nHost *\nProxyCommand evil', 'host\rIdentityFile /secret', 'host\tUser evil', 'host\0evil', 'host+alias'])('rejects SSH config injection before any write: %s', async (host) => {
    expect((await configureSshForHost(host)).success).toBe(false); expect(fs.existsSync(path.join(root, '.ssh'))).toBe(false);
  });
});
