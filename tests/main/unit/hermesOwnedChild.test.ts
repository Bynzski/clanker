import { describe, expect, it, vi } from 'vitest';
import { HermesOwnedChild, HERMES_CLEANUP_ERROR } from '../../../src/main/assistants/hermesOwnedChild';
import { fakeChild } from '../../_helpers/fakeHermes';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('exact owned Hermes child termination', () => {
  it('waits for SIGKILL exit acknowledgement, including signal exits with null exitCode', async () => {
    const child = fakeChild();
    child.kill.mockImplementation(() => true);
    const exited = vi.fn();
    const owned = new HermesOwnedChild(child, exited);
    let done = false;
    const stop = owned.stop(1, 1000).then(() => { done = true; });
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGKILL'), { interval: 5 });
    expect(done).toBe(false);
    expect(owned.hasExited).toBe(false);
    child.emit('exit', null, 'SIGKILL'); // Node leaves exitCode null on a signal exit.
    await stop;
    expect(owned.hasExited).toBe(true);
    expect(owned.cleanupIncomplete).toBe(false);
    expect(exited).toHaveBeenCalledOnce();
    await owned.stop(1, 1);
    expect(child.kill).toHaveBeenCalledTimes(2);
  });

  it.each(['false', 'throw', 'accepted-without-exit'] as const)('does not confuse %s signal delivery with termination', async (behavior) => {
    const child = fakeChild();
    child.kill.mockImplementation(() => {
      if (behavior === 'throw') throw new Error('private token and process details');
      return behavior !== 'false';
    });
    const owned = new HermesOwnedChild(child, vi.fn());
    const first = owned.stop(1, 1);
    expect(owned.stop(1, 1)).toBe(first);
    await expect(first).rejects.toThrow(HERMES_CLEANUP_ERROR);
    expect(owned.hasExited).toBe(false);
    expect(owned.cleanupIncomplete).toBe(true);
    expect(child.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL']);
    // A later attempt uses the same exact handle; no unrelated process is signalled.
    child.kill.mockImplementation(() => { child.emit('exit', null, 'SIGTERM'); return true; });
    await owned.stop(1, 1);
    expect(owned.cleanupIncomplete).toBe(false);
  });

  it('a runtime/kill error is not an exit, while an error from a never-spawned child is', async () => {
    const child = fakeChild();
    child.kill.mockImplementation(() => { child.emit('error', new Error('signal failed')); return false; });
    const owned = new HermesOwnedChild(child, vi.fn());
    await expect(owned.stop(1, 1)).rejects.toThrow(HERMES_CLEANUP_ERROR);
    expect(owned.hasExited).toBe(false);
    child.emit('exit', 1);
    await owned.stop(1, 1);
    expect(owned.hasExited).toBe(true);

    const unspawned = fakeChild();
    Object.defineProperty(unspawned, 'pid', { value: undefined });
    const failed = new HermesOwnedChild(unspawned, vi.fn());
    unspawned.emit('error', new Error('ENOENT'));
    await failed.stop(1, 1);
    expect(unspawned.kill).not.toHaveBeenCalled();
  });

  it('accepts an already recorded signal exit without sending another signal', async () => {
    const child = fakeChild();
    Object.defineProperty(child, 'signalCode', { value: 'SIGTERM' });
    const owned = new HermesOwnedChild(child, vi.fn());
    await owned.stop(1, 1);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('does not release one child when a different child exits', async () => {
    const child = fakeChild(); const other = fakeChild();
    child.kill.mockImplementation(() => true);
    const owned = new HermesOwnedChild(child, vi.fn());
    const stop = owned.stop(1, 1);
    other.crash();
    await tick();
    await expect(stop).rejects.toThrow(HERMES_CLEANUP_ERROR);
    expect(owned.hasExited).toBe(false);
  });
});
