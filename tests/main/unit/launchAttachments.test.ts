import { describe, expect, it, vi } from 'vitest';
import { collectGarbage, weakHandle, type WeakHandle } from '../../_helpers/gc';
import { prepareLaunchAttachments, type LaunchAttachmentStep, type PreparedHarnessAttachment } from '../../../src/main/launchAttachments';

const quiet = () => undefined;

function step(name: string, make: (state: Parameters<LaunchAttachmentStep['prepare']>[0]) => PreparedHarnessAttachment | null | Promise<PreparedHarnessAttachment | null>, optional = false): LaunchAttachmentStep {
  return { name, optional, prepare: make };
}

describe('retention after preparation', () => {
  it('keeps only disposers: the attachment (and its args/env) is collectable once composed', async () => {
    let released = 0;
    const refs: WeakHandle[] = [];
    const recorder = (name: string): LaunchAttachmentStep => step(name, () => {
      const attachment = { env: { SECRET: `secret-${name}` }, args: ['--x'], dispose: () => { released += 1; } };
      refs.push(weakHandle(attachment));
      return attachment;
    });
    let prepared: Awaited<ReturnType<typeof prepareLaunchAttachments>> | null = await prepareLaunchAttachments({ args: [], env: {} }, [recorder('a'), recorder('b')], quiet);
    const dispose = prepared.dispose;
    prepared = null;
    await collectGarbage();

    expect(refs.map((ref) => ref.deref())).toEqual([undefined, undefined]);
    await dispose();
    await dispose();
    expect(released).toBe(2);
  });
});

describe('prepareLaunchAttachments', () => {
  it('composes args and env deterministically, in step order, each step seeing the earlier result', async () => {
    const seen: unknown[] = [];
    const prepared = await prepareLaunchAttachments({ args: ['base'], env: { USER_VAR: 'u' } }, [
      step('a', (state) => { seen.push({ args: [...state.args], env: state.env.A }); return { args: [...state.args, '--a'], env: { A: '1', SHARED: 'a' }, dispose() {} }; }),
      step('b', (state) => { seen.push({ args: [...state.args], env: state.env.A, user: state.env.USER_VAR }); return { args: ['--b', ...state.args], env: { B: '2', SHARED: 'b' }, dispose() {} }; }),
    ], quiet);

    expect(prepared.args).toEqual(['--b', 'base', '--a']);
    expect(prepared.env).toEqual({ A: '1', B: '2', SHARED: 'b' });
    expect(prepared.attached).toEqual(['a', 'b']);
    expect(seen).toEqual([{ args: ['base'], env: undefined }, { args: ['base', '--a'], env: '1', user: 'u' }]);
  });

  it('does not report the base environment as an addition', async () => {
    const prepared = await prepareLaunchAttachments({ args: [], env: { SECRET: 's' } }, [], quiet);
    expect(prepared.env).toEqual({});
    expect(prepared.args).toEqual([]);
  });

  it('skips a step that yields nothing without disturbing the others', async () => {
    const dispose = vi.fn();
    const prepared = await prepareLaunchAttachments({ args: [], env: {} }, [
      step('none', () => null), step('some', () => ({ env: { X: '1' }, dispose })),
    ], quiet);
    expect(prepared.attached).toEqual(['some']);
  });

  it('rolls back already-acquired attachments, latest first, when a later required step fails', async () => {
    const order: string[] = [];
    const failure = new Error('boom');
    await expect(prepareLaunchAttachments({ args: [], env: {} }, [
      step('first', () => ({ dispose: () => { order.push('first'); } })),
      step('second', () => ({ dispose: () => { order.push('second'); } })),
      step('third', () => { throw failure; }),
    ], quiet)).rejects.toBe(failure);
    expect(order).toEqual(['second', 'first']);
  });

  it('an optional step that fails is skipped and reported, and earlier attachments stay', async () => {
    const report = vi.fn();
    const keep = vi.fn();
    const prepared = await prepareLaunchAttachments({ args: ['x'], env: {} }, [
      step('keep', () => ({ args: ['x', '--k'], dispose: keep })),
      step('flaky', () => { throw new Error('nope'); }, true),
      step('after', () => ({ env: { AFTER: '1' }, dispose() {} })),
    ], report);

    expect(prepared.args).toEqual(['x', '--k']);
    expect(prepared.env).toEqual({ AFTER: '1' });
    expect(prepared.attached).toEqual(['keep', 'after']);
    expect(report).toHaveBeenCalledWith('flaky', 'prepare', expect.any(Error));
    expect(keep).not.toHaveBeenCalled();
  });

  it('disposes everything once, in reverse order, and is idempotent', async () => {
    const order: string[] = [];
    const prepared = await prepareLaunchAttachments({ args: [], env: {} }, [
      step('a', () => ({ dispose: () => { order.push('a'); } })),
      step('b', () => ({ dispose: async () => { order.push('b'); } })),
    ], quiet);

    await Promise.all([prepared.dispose(), prepared.dispose()]);
    await prepared.dispose();
    expect(order).toEqual(['b', 'a']);
  });

  it('a failing disposal neither throws nor stops the remaining disposals', async () => {
    const report = vi.fn();
    const survivor = vi.fn();
    const prepared = await prepareLaunchAttachments({ args: [], env: {} }, [
      step('survivor', () => ({ dispose: survivor })),
      step('broken', () => ({ dispose: () => { throw new Error('cleanup failed'); } })),
    ], report);

    await expect(prepared.dispose()).resolves.toBeUndefined();
    expect(survivor).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('broken', 'dispose', expect.any(Error));
  });

  it('a cleanup error during rollback does not mask the original launch failure', async () => {
    const original = new Error('launch failed');
    await expect(prepareLaunchAttachments({ args: [], env: {} }, [
      step('leaky', () => ({ dispose: () => { throw new Error('cleanup failed'); } })),
      step('bad', () => { throw original; }),
    ], quiet)).rejects.toBe(original);
  });

  it('the default reporter names the step and phase only, never the exception text or object', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await prepareLaunchAttachments({ args: [], env: {} }, [
        step('x', () => { throw new Error('clanker_mcp_v1_secret'); }, true),
        step('y', () => ({ dispose: () => { throw Object.assign(new Error('another-secret'), { token: 'clanker_mcp_v1_secret2' }); } })),
      ]).then((prepared) => prepared.dispose());
      expect(warn).toHaveBeenCalledTimes(2);
      const printed = JSON.stringify(warn.mock.calls) + warn.mock.calls.flat().map(String).join(' ');
      expect(printed).toContain('"x" prepare failed');
      expect(printed).toContain('"y" dispose failed');
      expect(printed).not.toMatch(/secret/);
      expect(warn.mock.calls.flat().every((part) => typeof part === 'string')).toBe(true);
    } finally { warn.mockRestore(); }
  });

  it('no steps is a no-op launch', async () => {
    const prepared = await prepareLaunchAttachments({ args: ['a', 'b'], env: {} }, [], quiet);
    expect(prepared.args).toEqual(['a', 'b']);
    await expect(prepared.dispose()).resolves.toBeUndefined();
  });
});

describe('facts provided to later steps', () => {
  it('a step sees only what earlier steps that really attached provided', async () => {
    const seen: string[][] = [];
    const observe = (name: string): LaunchAttachmentStep => step(name, (state) => { seen.push([...state.provided].sort()); return { dispose: quiet }; });
    await prepareLaunchAttachments({ args: [], env: {} }, [
      step('first', () => ({ provides: ['alpha'], dispose: quiet })),
      step('declines', () => null, true),
      step('fails', () => { throw new Error('boom'); }, true),
      observe('reader'),
    ], quiet);
    expect(seen).toEqual([['alpha']]);
  });

  it('a step that declined or failed provides nothing, and facts are a copy: a reader cannot alter what later steps see', async () => {
    const seen: string[][] = [];
    await prepareLaunchAttachments({ args: [], env: {} }, [
      step('declines', () => null, true),
      step('mutating reader', (state) => { (state.provided as Set<string>).add('forged'); return { dispose: quiet }; }),
      step('reader', (state) => { seen.push([...state.provided]); return { dispose: quiet }; }),
    ], quiet);
    expect(seen).toEqual([[]]);
  });
});
