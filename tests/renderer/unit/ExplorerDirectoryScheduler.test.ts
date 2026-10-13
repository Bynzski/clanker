import { describe, expect, it, vi } from 'vitest';
import { ExplorerDirectoryScheduler } from '../../../src/renderer/lib/explorerDirectoryScheduler';
import type { FileListDirectoryResult } from '../../../src/shared/types/fileExplorer';
function deferred() {
  let resolve!: (value: FileListDirectoryResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<FileListDirectoryResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const empty: FileListDirectoryResult = { success: true, entries: [] };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function request(key: string, read: () => Promise<FileListDirectoryResult>, extra = {}) {
  return { key, remote: true, priority: 1 as const, force: false, valid: () => true, queued: vi.fn(), retired: vi.fn(), read, ...extra };
}
describe('Explorer-only physical SSH permits', () => {
  it('bounds many folders at three and prioritizes root/explicit expansion ahead of background', async () => {
    const scheduler = new ExplorerDirectoryScheduler();
    const reads = Array.from({ length: 10 }, deferred); const started: number[] = [];
    const promises = reads.map((read, index) => scheduler.request(request(String(index), () => { started.push(index); return read.promise; }, { priority: index >= 8 ? 0 : 1 })));
    await flush(); expect(started).toEqual([0, 1, 2]);
    reads[0].resolve(empty); await flush(); expect(started).toEqual([0, 1, 2, 8]);
    reads[1].resolve(empty); await flush(); expect(started[started.length - 1]).toBe(9);
    for (const read of reads) read.resolve(empty);
    await Promise.all(promises); await flush(); expect(started.length).toBe(10);
  });
  it('shares safe reads and keeps exactly one forced successor through repeated focus/manual/watch requests', async () => {
    const scheduler = new ExplorerDirectoryScheduler(); const first = deferred(); const next = deferred();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    const original = scheduler.request(request('root', read));
    expect(scheduler.request(request('root', read))).toBe(original);
    const forced = scheduler.request(request('root', read, { force: true }));
    for (let i = 0; i < 100; i++) expect(scheduler.request(request('root', read, { force: true }))).toBe(forced);
    await flush(); expect(read).toHaveBeenCalledTimes(1);
    first.resolve(empty); await flush(); expect(read).toHaveBeenCalledTimes(2);
    next.resolve(empty); await Promise.all([original, forced]);
  });
  it('retirement across remounts never frees capacity before actual IPC settlement', async () => {
    const scheduler = new ExplorerDirectoryScheduler(); const old = Array.from({ length: 3 }, deferred);
    let active = true;
    const pending = old.map((read, index) => scheduler.request(request(`old:${index}`, () => read.promise, { valid: () => active })));
    await flush(); active = false; scheduler.prune();
    const readNew = vi.fn(async () => empty); const fresh = scheduler.request(request('new-selection', readNew, { priority: 0 }));
    await flush(); expect(readNew).not.toHaveBeenCalled();
    old[0].reject(new Error('Disconnected')); await flush(); expect(readNew).toHaveBeenCalledOnce();
    old[1].resolve(empty); old[2].resolve(empty); await Promise.all([...pending, fresh]);
  });
  it('retires queued identities immediately and rejects obsolete results without starving new demand', async () => {
    const scheduler = new ExplorerDirectoryScheduler(1); const held = deferred(); let valid = true;
    const inFlight = scheduler.request(request('A:epoch1', () => held.promise));
    const queuedRead = vi.fn(async () => empty);
    const queued = scheduler.request(request('A:epoch1:child', queuedRead, { valid: () => valid }));
    valid = false; scheduler.prune(); expect((await queued).success).toBe(false);
    held.resolve(empty); await inFlight; await flush(); expect(queuedRead).not.toHaveBeenCalled();
    expect((await scheduler.request(request('A:epoch3', async () => empty))).success).toBe(true);
  });
  it('does not throttle unrelated local reads and frees permits on rejection or synchronous throw', async () => {
    const scheduler = new ExplorerDirectoryScheduler(1); const held = deferred();
    const remote = scheduler.request(request('remote', () => held.promise));
    const local = vi.fn(async () => empty);
    const locals = Array.from({ length: 8 }, (_, i) => scheduler.request(request(`local:${i}`, local, { remote: false })));
    await Promise.all(locals); expect(local).toHaveBeenCalledTimes(8);
    held.reject(new Error('Disconnected')); expect((await remote).success).toBe(false); await flush();
    expect((await scheduler.request(request('throw', () => { throw new Error('Unexpected'); }))).success).toBe(false);
    expect((await scheduler.request(request('recovery', async () => empty))).success).toBe(true);
  });
});
