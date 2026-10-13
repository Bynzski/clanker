import type { FileListDirectoryResult } from '../../shared/types/fileExplorer';
import { explorerDirectoryEvent } from './workspaceSwitchDebug';

interface DirectoryRequest {
  key: string;
  remote: boolean;
  priority: 0 | 1;
  force: boolean;
  valid: () => boolean;
  queued: () => void;
  retired: () => void;
  read: (current: () => boolean) => Promise<FileListDirectoryResult>;
}
interface Job {
  request: DirectoryRequest;
  promise: Promise<FileListDirectoryResult>;
  resolve: (result: FileListDirectoryResult) => void;
  retired: boolean;
}
interface Slot { running?: Job; queued?: Job; latest?: Job }
const cancelled = (): FileListDirectoryResult => ({ success: false, entries: [], errorCode: 'unknown', error: 'Directory request retired' });

/** Explorer listings only. Physical IPC occupancy survives component and selection retirement. */
export class ExplorerDirectoryScheduler {
  private readonly slots = new Map<string, Slot>();
  private readonly queue: Job[] = [];
  private activeRemote = 0;
  constructor(private readonly limit = 3) {}

  request(request: DirectoryRequest): Promise<FileListDirectoryResult> {
    this.prune();
    if (!request.valid()) return Promise.resolve(cancelled());
    const slot = this.slots.get(request.key) ?? {};
    this.slots.set(request.key, slot);
    const shared = slot.queued ?? (!request.force ? slot.running : undefined);
    if (shared && !shared.retired) {
      shared.request.priority = Math.min(shared.request.priority, request.priority) as 0 | 1;
      this.trace('coalesced');
      return shared.promise;
    }
    let resolve!: Job['resolve'];
    const job: Job = { request, promise: new Promise(done => { resolve = done; }), resolve: result => resolve(result), retired: false };
    // One forced successor per directory. Supersede presentation, not the physical permit.
    if (slot.running) this.retire(slot.running);
    slot.queued = slot.latest = job;
    request.queued();
    this.queue.push(job);
    this.trace(slot.running ? 'followup' : 'scheduled');
    this.pump();
    return job.promise;
  }

  prune(): void {
    for (const [key, slot] of this.slots) {
      if (slot.running && !slot.running.request.valid()) this.retire(slot.running);
      if (slot.queued && !slot.queued.request.valid()) {
        const queued = slot.queued;
        slot.queued = undefined;
        if (slot.latest === queued) slot.latest = undefined;
        const index = this.queue.indexOf(queued);
        if (index >= 0) this.queue.splice(index, 1);
        this.retire(queued);
        queued.resolve(cancelled());
      }
      if (!slot.running && !slot.queued) this.slots.delete(key);
    }
  }

  private retire(job: Job): void {
    if (job.retired) return;
    job.retired = true;
    job.request.retired();
    this.trace('retired');
  }

  private pump(): void {
    this.prune();
    for (;;) {
      const candidates = this.queue.filter(job => {
        const slot = this.slots.get(job.request.key);
        return !slot?.running && (!job.request.remote || this.activeRemote < this.limit);
      });
      const job = candidates.sort((a, b) => a.request.priority - b.request.priority)[0];
      if (!job) return;
      this.queue.splice(this.queue.indexOf(job), 1);
      const slot = this.slots.get(job.request.key)!;
      slot.queued = undefined;
      slot.running = job;
      if (job.request.remote) this.activeRemote++;
      this.trace('dispatched');
      void Promise.resolve().then(() => job.request.read(() => !job.retired && job.request.valid() && slot.latest === job))
        .catch((error: unknown) => ({ success: false, entries: [], errorCode: 'unknown', error: error instanceof Error ? error.message : 'Directory acquisition failed' } as FileListDirectoryResult))
        .then(job.resolve)
        .finally(() => {
          // The promise has actually settled; only now can another SSH IPC start.
          if (job.request.remote) this.activeRemote--;
          job.request.retired();
          slot.running = undefined;
          if (!slot.queued) this.slots.delete(job.request.key);
          this.trace('settled');
          this.pump();
        });
    }
  }

  private trace(event: Parameters<typeof explorerDirectoryEvent>[0]): void {
    explorerDirectoryEvent(event, this.activeRemote, this.queue.length);
  }
}

