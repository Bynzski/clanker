import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessSession } from '../../../src/shared/types/session';
const { discover } = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock('../../../src/main/harnesses/registry', () => ({
  getHarnessProviders: () => [{ descriptor: { id: 'codex' }, sessions: { discover } }],
}));
import { clearSessionCache, clearSessionCacheForWorkspace, discoverSessions, getSessionCacheSize } from '../../../src/main/sessionHistory';
const session = (id: string): HarnessSession => ({ id, harness: 'codex', cwd: '/workspace', title: id, timestamp: 1 });
const deferred = () => {
  let finish!: (value: HarnessSession[]) => void;
  const promise = new Promise<HarnessSession[]>((resolve) => { finish = resolve; });
  return { promise, finish };
};
beforeEach(() => { discover.mockReset(); clearSessionCache(); });
describe('session cache completion ownership', () => {
  it('an older scan finishing last cannot overwrite a newer refresh', async () => {
    const old = deferred(), fresh = deferred();
    discover.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const older = discoverSessions('/workspace');
    const newer = discoverSessions('/workspace', { forceRefresh: true });
    fresh.finish([session('new')]); await newer;
    old.finish([session('old')]); await older;
    expect(await discoverSessions('/workspace')).toEqual([session('new')]);
    expect(discover).toHaveBeenCalledTimes(2);
  });
  it.each(['all', 'workspace'])('in-flight scans cannot repopulate an invalidated %s cache', async (scope) => {
    const old = deferred(); discover.mockReturnValueOnce(old.promise).mockResolvedValueOnce([session('new')]);
    const pending = discoverSessions('/workspace');
    if (scope === 'all') clearSessionCache(); else clearSessionCacheForWorkspace('/workspace');
    old.finish([session('old')]); await pending;
    expect(getSessionCacheSize()).toBe(0);
    expect(await discoverSessions('/workspace')).toEqual([session('new')]);
  });
  it('a failed refresh retires the earlier success cache, so the next scan retries', async () => {
    discover.mockResolvedValueOnce([session('old')]).mockRejectedValueOnce(new Error('unreadable')).mockResolvedValueOnce([session('new')]);
    await discoverSessions('/workspace');
    expect(await discoverSessions('/workspace', { forceRefresh: true })).toEqual([]);
    expect(getSessionCacheSize()).toBe(0);
    expect(await discoverSessions('/workspace')).toEqual([session('new')]);
    expect(discover).toHaveBeenCalledTimes(3);
  });
  it('isolates even a synchronous provider failure, and retries instead of caching it', async () => {
    discover.mockImplementationOnce(() => { throw new Error('storage failed'); }).mockResolvedValueOnce([session('recovered')]);
    expect(await discoverSessions('/workspace')).toEqual([]);
    expect(getSessionCacheSize()).toBe(0);
    expect(await discoverSessions('/workspace')).toEqual([session('recovered')]);
  });
});
