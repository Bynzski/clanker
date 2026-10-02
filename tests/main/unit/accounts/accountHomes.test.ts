import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AccountHomeStore, UnsafeAccountPathError, isStrictlyContained } from '../../../../src/main/accounts/accountHomes';
import { tempRoot } from './accountFixtures';

const ID = `acct_${'a'.repeat(32)}`;
const OTHER = `acct_${'b'.repeat(32)}`;
const roots: string[] = [];
const fresh = () => { const r = tempRoot(); roots.push(r); return r; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('AccountHomeStore', () => {
  it('allocates a private home strictly under the owned root', () => {
    const base = fresh();
    const root = path.join(base, 'accounts');
    const store = new AccountHomeStore(root);
    const home = store.ensure('codex', ID);
    expect(isStrictlyContained(fs.realpathSync(root), home)).toBe(true);
    expect(path.basename(home)).toBe(ID);
    expect(path.basename(path.dirname(home))).toBe('codex');
    if (process.platform !== 'win32') expect(fs.statSync(home).mode & 0o777).toBe(0o700);
  });

  it.each(['../escape', 'acct_../../x', `${ID}/..`, 'default', '', 'acct_XYZ', `${ID}\0`, '/etc/passwd', 'C:\\Windows'])('rejects hostile identity %j', (id) => {
    const store = new AccountHomeStore(path.join(fresh(), 'accounts'));
    expect(() => store.homePath('codex', id)).toThrow(UnsafeAccountPathError);
    expect(() => store.ensure('codex', id)).toThrow(UnsafeAccountPathError);
    expect(() => store.remove('codex', id)).toThrow(UnsafeAccountPathError);
  });

  it.each(['../codex', 'codex/../x', 'Codex', '', '.'])('rejects hostile harness name %j', (harness) => {
    const store = new AccountHomeStore(path.join(fresh(), 'accounts'));
    expect(() => store.homePath(harness, ID)).toThrow(UnsafeAccountPathError);
  });

  it('refuses a symlinked account home and never deletes through it', () => {
    const base = fresh();
    const root = path.join(base, 'accounts');
    const store = new AccountHomeStore(root);
    store.ensure('codex', ID);
    const victim = path.join(base, 'victim');
    fs.mkdirSync(victim);
    fs.writeFileSync(path.join(victim, 'keep.txt'), 'x');
    fs.rmSync(path.join(root, 'codex', ID), { recursive: true });
    try { fs.symlinkSync(victim, path.join(root, 'codex', ID), 'junction'); } catch { return; /* symlinks unavailable */ }
    expect(() => store.resolve('codex', ID)).toThrow(UnsafeAccountPathError);
    expect(() => store.ensure('codex', ID)).toThrow(UnsafeAccountPathError);
    expect(() => store.remove('codex', ID)).toThrow(UnsafeAccountPathError);
    expect(fs.existsSync(path.join(victim, 'keep.txt'))).toBe(true);
  });

  it('refuses a symlinked harness directory or root', () => {
    const base = fresh();
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    const root = path.join(base, 'accounts');
    fs.mkdirSync(root);
    try { fs.symlinkSync(outside, path.join(root, 'codex'), 'junction'); } catch { return; }
    const store = new AccountHomeStore(root);
    expect(() => store.ensure('codex', ID)).toThrow(UnsafeAccountPathError);
    expect(fs.readdirSync(outside)).toEqual([]);

    const linkedRoot = path.join(base, 'linked-root');
    fs.symlinkSync(outside, linkedRoot, 'junction');
    expect(() => new AccountHomeStore(linkedRoot).ensure('claude', OTHER)).toThrow(UnsafeAccountPathError);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('removes exactly one verified home and leaves its siblings alone', () => {
    const store = new AccountHomeStore(path.join(fresh(), 'accounts'));
    const first = store.ensure('codex', ID);
    const second = store.ensure('codex', OTHER);
    fs.writeFileSync(path.join(first, 'f'), 'x');
    store.remove('codex', ID);
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.existsSync(second)).toBe(true);
    expect(() => store.remove('codex', ID)).not.toThrow(); // already gone
  });

  it('never touches provider-native homes, even if the owned root pointed at them', () => {
    const base = fresh();
    const nativeCodex = path.join(base, '.codex');
    fs.mkdirSync(nativeCodex);
    fs.writeFileSync(path.join(nativeCodex, 'auth.json'), 'native');
    // A misconfigured root that places a "managed" home exactly on the protected directory.
    const store = new AccountHomeStore(path.join(base, 'accounts'), { protectedPaths: [path.join(base, 'accounts', 'codex')] });
    expect(() => store.ensure('codex', ID)).toThrow(UnsafeAccountPathError);

    const guarded = new AccountHomeStore(path.join(base, 'accounts2'), { protectedPaths: [nativeCodex] });
    guarded.ensure('codex', ID);
    guarded.remove('codex', ID);
    expect(fs.readFileSync(path.join(nativeCodex, 'auth.json'), 'utf8')).toBe('native');
  });

  it('requires an absolute root', () => {
    expect(() => new AccountHomeStore('relative/root')).toThrow(UnsafeAccountPathError);
  });
});

describe('containment on Windows-style paths', () => {
  const win = path.win32;
  it('treats only strict descendants as contained, case-insensitively and across separators', () => {
    const root = 'C:\\Users\\Me\\AppData\\Roaming\\Clanker\\harness-accounts';
    expect(isStrictlyContained(root, `${root}\\codex\\${ID}`, win)).toBe(true);
    expect(isStrictlyContained(root, root, win)).toBe(false);
    expect(isStrictlyContained(root, `${root}\\..\\..\\Other`, win)).toBe(false);
    expect(isStrictlyContained(root, 'C:\\Users\\Me\\.codex', win)).toBe(false);
    expect(isStrictlyContained(root, 'D:\\harness-accounts\\codex', win)).toBe(false);
    expect(isStrictlyContained(root.toLowerCase(), `${root.toUpperCase()}\\codex`, win)).toBe(true);
    expect(isStrictlyContained(`${root}-evil`, `${root}\\codex`, win)).toBe(false);
  });

  it('uses the same rule for POSIX paths', () => {
    expect(isStrictlyContained('/data/accounts', '/data/accounts/codex/x', path.posix)).toBe(true);
    expect(isStrictlyContained('/data/accounts', '/data/accounts-evil/x', path.posix)).toBe(false);
    expect(isStrictlyContained('/data/accounts', '/data/accounts/../etc', path.posix)).toBe(false);
  });

  it('derives native paths on the host platform', () => {
    const store = new AccountHomeStore(path.join(os.tmpdir(), 'clanker-win-check'));
    expect(store.homePath('claude', ID)).toBe(path.join(os.tmpdir(), 'clanker-win-check', 'claude', ID));
  });
});
