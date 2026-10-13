import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';
import type { AttentionReceipt } from '../shared/types/attentionReceipt';
import type { AttentionVerdict } from '../shared/attentionProtocol';
import type { AttentionTraceEntry } from './agentAttentionBroker';
import { eventLoopDelay } from './eventLoopDelay';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_QUEUE = 256;
const MAX_TERMINALS = 64;
const RECEIPT_GRACE_MS = 5000;

/** Serialized, bounded, best-effort writer. Diagnostic failures never break agent launches.
 * No console interception: only explicitly content-free attention records enter this file. */
export class AttentionLogWriter {
  private queue: string[] = [];
  private draining: Promise<void> | null = null;
  private disabled = false;
  private dropped = 0;

  constructor(private readonly directory: string, private readonly maxBytes = MAX_FILE_BYTES) {}

  append(record: object): void {
    if (this.disabled) return;
    const line = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(line) > this.maxBytes || this.queue.length >= MAX_QUEUE) { this.dropped++; return; }
    this.queue.push(line);
    if (!this.draining) this.draining = this.drain().finally(() => { this.draining = null; });
  }

  async flush(): Promise<void> { await this.draining; }

  private async regularFile(file: string): Promise<boolean> {
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe diagnostic file');
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async drain(): Promise<void> {
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const dir = await fs.lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Unsafe diagnostic directory');
      if (process.platform !== 'win32') await fs.chmod(this.directory, 0o700);
      const file = path.join(this.directory, 'attention.jsonl');
      for (const name of ['attention.jsonl', 'attention.1.jsonl', 'attention.2.jsonl']) await this.regularFile(path.join(this.directory, name));
      let size = await this.regularFile(file) ? (await fs.stat(file)).size : 0;
      while (this.queue.length) {
        const line = this.queue.shift()!;
        const bytes = Buffer.byteLength(line);
        if (size + bytes > this.maxBytes) {
          await fs.rm(path.join(this.directory, 'attention.2.jsonl'), { force: true });
          if (await this.regularFile(path.join(this.directory, 'attention.1.jsonl'))) await fs.rename(path.join(this.directory, 'attention.1.jsonl'), path.join(this.directory, 'attention.2.jsonl'));
          if (await this.regularFile(file)) await fs.rename(file, path.join(this.directory, 'attention.1.jsonl'));
          size = 0;
        }
        const handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0), 0o600);
        try {
          if (process.platform !== 'win32') await handle.chmod(0o600);
          await handle.writeFile(line);
        } finally { await handle.close(); }
        size += bytes;
      }
      if (this.dropped) {
        this.queue.push(JSON.stringify({ kind: 'diagnostic-overflow', dropped: this.dropped }) + '\n');
        this.dropped = 0;
        await this.drain();
      }
    } catch {
      this.disabled = true;
      this.queue = [];
      console.warn('[clanker-grid] Attention diagnostic file unavailable; console diagnostics remain available');
    }
  }
}

type PendingPublication = { revision: number; at: number; reported: boolean; acknowledged: boolean; snapshotPresent: boolean; lastReceipt?: string };

/** Observation only. Receipts and diagnostic timers cannot mutate the broker or acknowledge UI. */
export class AttentionTelemetry {
  private pending = new Map<string, PendingPublication>();
  private recent = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly writer: AttentionLogWriter,
    private readonly trace: (terminalId: string) => AttentionTraceEntry[],
    private readonly now: () => number = Date.now) {}

  start(version: string): void {
    this.writer.append({ kind: 'startup', at: this.now(), version, platform: process.platform });
    let lastTick = this.now();
    let lastSample = lastTick;
    this.timer = setInterval(() => {
      const now = this.now();
      if (now - lastTick > 1500 || now - lastSample >= 30_000) {
        this.writer.append({ kind: 'main-loop-sample', at: now, tickDelayMs: Math.max(0, now - lastTick - 1000), eventLoopDelay: eventLoopDelay() });
        lastSample = now;
      }
      lastTick = now;
      this.checkReceipts();
    }, 1000);
    this.timer.unref();
  }

  transportRejection(verdict: AttentionVerdict): void {
    this.writer.append({ kind: 'transport-rejection', at: this.now(), verdict, eventLoopDelay: eventLoopDelay() });
  }

  record(terminalId: string, entry: AttentionTraceEntry): void {
    this.writer.append({ kind: 'broker', terminalId, ...entry });
    if (entry.verdict?.startsWith('rejected-') || entry.semantic === 'release-without-settlement') this.anomaly(terminalId, entry.semantic);
  }

  publish(terminalId: string, revision: number, status: string, rendererAvailable: boolean): void {
    this.writer.append({ kind: 'publication', at: this.now(), terminalId, revision, status, rendererAvailable });
    this.pending.delete(terminalId);
    this.pending.set(terminalId, { revision, at: this.now(), reported: false, acknowledged: false, snapshotPresent: status !== 'retired' });
    this.bound(this.pending);
  }

  receipt(receipt: AttentionReceipt): void {
    // Only main-published terminal IDs/revisions are attributable. Renderer data remains untrusted.
    const pending = this.pending.get(receipt.terminalId);
    if (!pending || receipt.receivedRevision > pending.revision) return;
    const signature = JSON.stringify(receipt);
    if (pending.lastReceipt === signature) return;
    pending.lastReceipt = signature;
    this.writer.append({ kind: 'renderer-receipt', at: this.now(), ...receipt });
    if (receipt.receivedRevision === pending.revision) {
      if (receipt.storedRevision === pending.revision && receipt.snapshotPresent === pending.snapshotPresent && !['older', 'tombstone'].includes(receipt.merge)) pending.acknowledged = true;
      else this.anomaly(receipt.terminalId, 'renderer-merge-disagreement');
    }
  }

  checkReceipts(): void {
    for (const [id, pending] of this.pending) {
      if (!pending.acknowledged && !pending.reported && this.now() - pending.at >= RECEIPT_GRACE_MS) {
        pending.reported = true;
        this.anomaly(id, 'renderer-receipt-missing');
      }
    }
  }

  private anomaly(terminalId: string, reason: string): void {
    const last = this.recent.get(terminalId);
    if (last !== undefined && this.now() - last < RECEIPT_GRACE_MS) return;
    this.recent.delete(terminalId);
    this.recent.set(terminalId, this.now());
    this.bound(this.recent);
    this.writer.append({ kind: 'anomaly', at: this.now(), terminalId, reason, eventLoopDelay: eventLoopDelay(), trace: this.trace(terminalId).slice(-24) });
  }

  private bound<T>(map: Map<string, T>): void {
    if (map.size > MAX_TERMINALS) map.delete(map.keys().next().value!);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.writer.flush(), new Promise<void>(resolve => { timeout = setTimeout(resolve, 2000); })]);
    } finally { if (timeout) clearTimeout(timeout); }
  }
}

let active: AttentionTelemetry | null = null;
export function setAttentionTelemetry(telemetry: AttentionTelemetry | null): void { active = telemetry; }
export function attentionTelemetry(): AttentionTelemetry | null { return active; }
