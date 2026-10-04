import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { localAttention } from '../../../src/main/harnesses/localAttention';
import { ensureAttentionAdapterFiles, ensureProviderAttentionResources, prepareLocalAttention, removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import type { LocalAttentionContext } from '../../../src/main/harnesses/types';

const failure = vi.hoisted(() => ({ hooks: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
    if (failure.hooks && /hooks\.json(\.\d+\.tmp)?$/.test(String(args[0]))) throw new Error('disk full');
    return actual.writeFileSync(...args);
  } };
});

const roots: string[] = [];
afterEach(() => {
  failure.hooks = false;
  removeAttentionAdapterFiles();
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});
function context(terminalId = 'terminal'): LocalAttentionContext {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-provider-attention-'));
  roots.push(homeDir);
  return { terminalId, args: [], env: {}, files: ensureAttentionAdapterFiles(), homeDir, platform: 'linux' };
}
const pluginPath = (ctx: LocalAttentionContext) => path.join(ctx.homeDir!, '.gemini/config/plugins/clanker-grid-attention/hooks.json');

describe('provider attention leases', () => {
  it('represents Hermes SSH-only attention without a local no-op', () => {
    expect(getHarnessProvider('hermes').attention?.local).toBeUndefined();
    expect(getHarnessProvider('hermes').attention?.remote).toBeDefined();
  });
  it('keeps the persistent Agy plugin installed across repeated preparations and disposal', () => {
    const ctx = context();
    const capability = getHarnessProvider('agy').attention!.local!;
    const first = capability.prepare(ctx)!;
    const second = capability.prepare(ctx)!;
    const third = capability.prepare({ ...ctx, terminalId: 'other' })!;
    second.dispose(); second.dispose();
    first.dispose();
    third.dispose(); third.dispose();
    // Other Clanker processes and live Antigravity sessions share it; the guard keeps it inert.
    expect(fs.existsSync(pluginPath(ctx))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(pluginPath(ctx)), 'guard.mjs'))).toBe(true);
  });
  it('never leaves a hook referencing a partially written Agy plugin and permits a later preparation', () => {
    const ctx = context();
    failure.hooks = true;
    const capability = getHarnessProvider('agy').attention!.local!;
    expect(() => capability.prepare(ctx)).toThrow('disk full');
    expect(fs.existsSync(pluginPath(ctx))).toBe(false);
    expect(fs.readdirSync(path.dirname(pluginPath(ctx))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    failure.hooks = false;
    capability.prepare(ctx)!.dispose();
    expect(fs.existsSync(pluginPath(ctx))).toBe(true);
  });
  it('does not acquire resources when user configuration prevents injection', () => {
    const ctx = context();
    expect(getHarnessProvider('claude').attention!.local!.prepare({ ...ctx, args: ['--bare'] })).toBeNull();
    expect(getHarnessProvider('claude').attention!.local!.plan({ ...ctx, args: ['--bare'] })).toMatchObject({ status: 'blocked', failure: { kind: 'not-configured' } });
    const acquire = vi.fn();
    expect(localAttention(() => null, acquire).prepare(ctx)).toBeNull();
    expect(acquire).not.toHaveBeenCalled();
  });
  it('preserves cleanup failure and allows disposal to be retried', () => {
    const release = vi.fn().mockImplementationOnce(() => { throw new Error('cleanup failed'); });
    const prepared = localAttention(() => ({ args: [], env: {} }), () => release).prepare(context())!;
    expect(() => prepared.dispose()).toThrow('cleanup failed');
    prepared.dispose(); prepared.dispose();
    expect(release).toHaveBeenCalledTimes(2);
  });
});

it('shared attention resources contain only the generic command bridge', () => {
  expect(Object.keys(context().files)).toEqual(['command']);
  for (const id of ['claude', 'pi', 'omp', 'opencode'] as const) {
    expect(getHarnessProvider(id).attention.prepareResources).toBeTypeOf('function');
  }
});

it('isolates provider failure, keeps shared infrastructure intact, and retries lazily', () => {
  const ctx = context();
  const capability = getHarnessProvider('pi').attention;
  const prepare = vi.spyOn(capability, 'prepareResources').mockImplementation((scoped) => { fs.writeFileSync(path.join(scoped.resourceRoot!, 'partial.ts'), 'partial', { mode: 0o600 }); throw new Error('Pi resource failure'); });
  const other = vi.spyOn(getHarnessProvider('opencode').attention, 'prepareResources');
  try {
    expect(ensureAttentionAdapterFiles()).toBe(ctx.files);
    expect(prepareLocalAttention('codex', { ...ctx, env: { CODEX_HOME: '/nonexistent' } })).not.toBeNull();
    expect(prepare).not.toHaveBeenCalled(); expect(other).not.toHaveBeenCalled();
    const validOther = ensureProviderAttentionResources('opencode', ctx.files);
    const before = fs.readdirSync(path.dirname(ctx.files.command)).sort();
    expect(() => prepareLocalAttention('pi', ctx)).toThrow('Pi resource failure');
    expect(fs.readdirSync(path.dirname(ctx.files.command)).sort()).toEqual(before);
    expect(ensureProviderAttentionResources('opencode', ctx.files)).toBe(validOther);
    expect(fs.existsSync(path.join(validOther.resourceRoot!, 'opencode/plugins/clanker-attention.js'))).toBe(true);
    expect(other).toHaveBeenCalledTimes(1);
    expect(prepareLocalAttention('codex', { ...ctx, env: { CODEX_HOME: '/nonexistent' } })).not.toBeNull();
    prepare.mockRestore();
    expect(prepareLocalAttention('pi', ctx)).not.toBeNull();
    const scoped = ensureProviderAttentionResources('pi', ctx.files);
    expect(fs.existsSync(path.join(scoped.resourceRoot!, 'pi.ts'))).toBe(true);
    // Windows inherits NTFS ACLs; POSIX mode bits do not describe that protection.
    if (process.platform !== 'win32') expect(fs.statSync(scoped.resourceRoot!).mode & 0o777).toBe(0o700);
  } finally { prepare.mockRestore(); other.mockRestore(); }
});

it.each(['claude', 'opencode', 'pi', 'omp'] as const)('prepares %s resources once per root and shares only infrastructure', async (id) => {
  const ctx = context();
  const prepare = vi.spyOn(getHarnessProvider(id).attention, 'prepareResources');
  try {
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => ensureProviderAttentionResources(id, ctx.files)),
      Promise.resolve().then(() => ensureProviderAttentionResources(id, ctx.files)),
    ]);
    expect(first).toBe(second); expect(first.command).toBe(ctx.files.command);
    expect(first.resourceRoot).not.toBe(path.dirname(ctx.files.command));
    expect(prepare).toHaveBeenCalledTimes(1);
    removeAttentionAdapterFiles();
    const fresh = ensureProviderAttentionResources(id);
    expect(fresh.resourceRoot).not.toBe(first.resourceRoot);
    expect(prepare).toHaveBeenCalledTimes(2);
  } finally { prepare.mockRestore(); }
});
