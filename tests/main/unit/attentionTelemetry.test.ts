import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AttentionLogWriter, AttentionTelemetry } from '../../../src/main/attentionTelemetry';
import { parseAttentionReceipt, type AttentionReceipt } from '../../../src/shared/types/attentionReceipt';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function fixture(maxBytes?: number) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'attention-log-test-'));
  directories.push(directory);
  return { directory, writer: new AttentionLogWriter(path.join(directory, 'logs'), maxBytes) };
}
const receipt: AttentionReceipt = { terminalId: 'term-a', receivedRevision: 3, storedRevision: 3, snapshotPresent: true, foreground: false, source: 'push', eligible: true, suppression: 'none', indicator: 'running', merge: 'applied' };

describe('attention diagnostic logging', () => {
  it('serializes concurrent writes, rotates bounded files, and uses private POSIX permissions', async () => {
    const { directory, writer } = await fixture(200);
    for (let i = 0; i < 40; i++) writer.append({ kind: 'test', index: i });
    await writer.flush();
    const dir = path.join(directory, 'logs');
    expect((await fs.readdir(dir)).sort()).toEqual(['attention.1.jsonl', 'attention.2.jsonl', 'attention.jsonl']);
    for (const file of await fs.readdir(dir)) {
      const text = await fs.readFile(path.join(dir, file), 'utf8');
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(200);
      for (const line of text.trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow();
      if (process.platform !== 'win32') expect((await fs.stat(path.join(dir, file))).mode & 0o777).toBe(0o600);
    }
    expect((await fs.readFile(path.join(dir, 'attention.jsonl'), 'utf8'))).toContain('"index":39');
  });

  it('bounds the queue and reports discarded diagnostics', async () => {
    const { directory, writer } = await fixture();
    for (let i = 0; i < 1000; i++) writer.append({ index: i });
    await writer.flush();
    const rows = (await fs.readFile(path.join(directory, 'logs', 'attention.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(rows.length).toBeLessThanOrEqual(257);
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'diagnostic-overflow', dropped: 744 });
  });

  it('fails closed on symlink files without touching the target or throwing', async () => {
    if (process.platform === 'win32') return;
    const { directory, writer } = await fixture();
    await fs.mkdir(path.join(directory, 'logs'));
    await fs.writeFile(path.join(directory, 'target'), 'original');
    await fs.symlink(path.join(directory, 'target'), path.join(directory, 'logs', 'attention.jsonl'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    writer.append({ kind: 'test' });
    await writer.flush();
    expect(await fs.readFile(path.join(directory, 'target'), 'utf8')).toBe('original');
  });

  it('captures one bounded anomaly for missing receipts, and receipts never change lifecycle', async () => {
    const { directory, writer } = await fixture();
    let now = 100;
    const trace = vi.fn(() => [{ at: 1, semantic: 'turn_started', revision: 3, status: 'running' as const }]);
    const telemetry = new AttentionTelemetry(writer, trace, () => now);
    telemetry.rendererReady();
    telemetry.publish('term-a', 3, 'running', true);
    now += 5001;
    telemetry.checkReceipts(); telemetry.checkReceipts();
    expect(trace).toHaveBeenCalledTimes(1);
    telemetry.receipt(receipt);
    now += 10000;
    telemetry.checkReceipts();
    await telemetry.stop();
    const text = await fs.readFile(path.join(directory, 'logs', 'attention.jsonl'), 'utf8');
    expect(text).toContain('renderer-receipt-missing');
    expect(text).toContain('renderer-receipt');
    expect(trace).toHaveBeenCalledTimes(1);
  });

  it('does not treat an older receipt as delivery of a newer publication, and captures tombstone disagreement', async () => {
    const { writer } = await fixture();
    let now = 0;
    const trace = vi.fn(() => []);
    const telemetry = new AttentionTelemetry(writer, trace, () => now);
    telemetry.rendererReady();
    telemetry.publish('term-a', 4, 'running', true);
    telemetry.receipt(receipt);
    now = 5001;
    telemetry.checkReceipts();
    expect(trace).toHaveBeenCalledTimes(1);
    now = 11000;
    telemetry.receipt({ ...receipt, receivedRevision: 4, storedRevision: 4, snapshotPresent: false, merge: 'tombstone' });
    expect(trace).toHaveBeenCalledTimes(2);
    await telemetry.stop();
  });

  it('rejects arbitrary content and invalid receipt fields', () => {
    expect(parseAttentionReceipt(receipt)).toEqual(receipt);
    for (const invalid of [null, [], { ...receipt, prompt: 'secret' }, { ...receipt, terminalId: '/private/path' }, { ...receipt, storedRevision: NaN }, { ...receipt, receivedRevision: -1 }, { ...receipt, indicator: 'secret' }, { ...receipt, merge: {} }, { ...receipt, source: 'unknown' }, { ...receipt, eligible: null }, { ...receipt, suppression: 'secret' }]) expect(parseAttentionReceipt(invalid)).toBeNull();
  });
});
