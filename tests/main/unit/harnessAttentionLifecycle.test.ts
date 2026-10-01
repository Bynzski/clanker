import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { localAttention } from '../../../src/main/harnesses/localAttention';
import { ensureAttentionAdapterFiles, removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import type { LocalAttentionContext } from '../../../src/main/harnesses/types';

const failure = vi.hoisted(() => ({ hooks: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
    if (failure.hooks && String(args[0]).endsWith('hooks.json')) throw new Error('disk full');
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
  it('retains Agy ownership across repeated preparations and out-of-order disposal', () => {
    const ctx = context();
    const capability = getHarnessProvider('agy').attention!.local!;
    const first = capability.prepare(ctx)!;
    const second = capability.prepare(ctx)!;
    const third = capability.prepare({ ...ctx, terminalId: 'other' })!;
    second.dispose(); second.dispose();
    first.dispose();
    expect(fs.existsSync(pluginPath(ctx))).toBe(true);
    third.dispose(); third.dispose();
    expect(fs.existsSync(pluginPath(ctx))).toBe(false);
  });
  it('rolls back a partially written Agy plugin and permits a later preparation', () => {
    const ctx = context();
    failure.hooks = true;
    const capability = getHarnessProvider('agy').attention!.local!;
    expect(() => capability.prepare(ctx)).toThrow('disk full');
    expect(fs.existsSync(path.dirname(pluginPath(ctx)))).toBe(false);
    failure.hooks = false;
    const prepared = capability.prepare(ctx)!;
    prepared.dispose();
    expect(fs.existsSync(pluginPath(ctx))).toBe(false);
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
