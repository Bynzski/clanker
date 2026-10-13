import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttentionLogWriter, AttentionTelemetry } from '../../../src/main/attentionTelemetry';
import type { AttentionReceipt } from '../../../src/shared/types/attentionReceipt';

const receipt: AttentionReceipt = { terminalId: 'term-a', receivedRevision: 3, storedRevision: 3,
  snapshotPresent: true, foreground: false, source: 'push', eligible: true, suppression: 'none', indicator: 'running', merge: 'applied' };

function fixture(ready = true) {
  let now = 0;
  const records: Array<Record<string, unknown>> = [];
  const writer = new AttentionLogWriter('/unused-observational-test');
  vi.spyOn(writer, 'append').mockImplementation(record => { records.push(record as Record<string, unknown>); });
  const telemetry = new AttentionTelemetry(writer, () => [], () => now);
  if (ready) telemetry.rendererReady();
  const anomalies = () => records.filter(record => record.kind === 'anomaly');
  const at = (time: number) => { now = time; };
  return { telemetry, records, at, anomalies };
}
afterEach(() => vi.restoreAllMocks());

describe('attention receipt expectations are observational and renderer-scoped', () => {
  it('records unavailable publications without a missing-receipt deadline, then starts a deadline on actual hydration', () => {
    const { telemetry, records, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', false);
    at(10000); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'publication', rendererAvailable: false, deliveryExpected: false }));
    telemetry.rendererReady();
    telemetry.hydrate('term-a', 3, 'running');
    at(14999); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
    at(15000); telemetry.checkReceipts();
    expect(anomalies()).toHaveLength(1);
    expect(anomalies()[0]).toMatchObject({ reason: 'renderer-receipt-missing', revision: 3 });
  });

  it('does not expect pushes until the newly created renderer has subscribed/hydrated', () => {
    const { telemetry, records, at, anomalies } = fixture(false);
    telemetry.publish('term-a', 3, 'running', true);
    at(10000); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'publication', rendererAvailable: true, deliveryExpected: false }));
  });

  it.each(['navigation', 'gone', 'closed', 'shutdown'] as const)('cancels outstanding deadlines on %s and preserves boundary evidence', reason => {
    const { telemetry, records, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    at(4999); telemetry.rendererUnavailable(reason);
    at(15000); telemetry.checkReceipts();
    telemetry.receipt(receipt); // no old renderer delivery attribution
    expect(anomalies()).toEqual([]);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'renderer-state', rendererAvailable: false, reason }));
    expect(records.some(record => record.kind === 'renderer-receipt')).toBe(false);
  });

  it('records read-only hydration without starting or extending delivery expectations', () => {
    const { telemetry, at, anomalies, records } = fixture();
    telemetry.hydrate('term-a', 3, 'running', false);
    at(10000); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'hydration', deliveryExpected: false }));
    telemetry.publish('term-a', 3, 'running', true);
    at(14999); telemetry.hydrate('term-a', 3, 'running', false);
    at(15000); telemetry.checkReceipts();
    expect(anomalies()).toHaveLength(1);
  });

  it('keeps the original deadline across repeated hydration and duplicate publications', () => {
    const { telemetry, records, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    for (const time of [1000, 3000, 4999]) { at(time); telemetry.hydrate('term-a', 3, 'running'); }
    telemetry.publish('term-a', 3, 'running', true);
    at(5000); telemetry.checkReceipts();
    expect(anomalies()).toHaveLength(1);
    expect(records.filter(record => record.kind === 'hydration')).toHaveLength(3);
    at(10000); telemetry.hydrate('term-a', 3, 'running'); telemetry.checkReceipts();
    expect(anomalies()).toHaveLength(1);
    telemetry.receipt({ ...receipt, source: 'hydration' });
    at(20000); telemetry.hydrate('term-a', 3, 'running'); telemetry.checkReceipts();
    expect(anomalies()).toHaveLength(1);
  });

  it('lets a newer authoritative hydration supersede the older deadline without accepting an old receipt', () => {
    const { telemetry, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    at(4000); telemetry.hydrate('term-a', 4, 'running');
    telemetry.receipt(receipt);
    at(5000); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
    at(9000); telemetry.checkReceipts();
    expect(anomalies()).toHaveLength(1);
    expect(anomalies()[0]).toMatchObject({ reason: 'renderer-receipt-missing', revision: 4 });
  });

  it('preserves a received acknowledgement across repeated hydration, including a delayed receipt before the original deadline', () => {
    const { telemetry, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    at(4500); telemetry.hydrate('term-a', 3, 'running');
    at(4900); telemetry.receipt({ ...receipt, source: 'hydration', merge: 'equal' });
    for (const time of [5000, 10000, 15000]) { at(time); telemetry.hydrate('term-a', 3, 'running'); telemetry.checkReceipts(); }
    expect(anomalies()).toEqual([]);
  });

  it('supersedes an older deadline with a newer authoritative tombstone; stale receipts cannot satisfy it', () => {
    const { telemetry, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    at(4000); telemetry.publish('term-a', 4, 'retired', true);
    at(5000); telemetry.receipt(receipt); telemetry.hydrate('term-a', 3, 'running'); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
    at(8999); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
    telemetry.receipt({ ...receipt, receivedRevision: 4, storedRevision: 4, snapshotPresent: false, indicator: 'none', suppression: 'no-snapshot' });
    at(10000); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
  });

  it.each(['tombstone', 'empty-store'] as const)('classifies a received live revision with %s as merge disagreement, not missing receipt', failure => {
    const { telemetry, records, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    telemetry.receipt({ ...receipt, storedRevision: failure === 'empty-store' ? null : 3,
      snapshotPresent: false, merge: failure === 'tombstone' ? 'tombstone' : 'applied', indicator: 'none', suppression: 'no-snapshot' });
    at(10000); telemetry.hydrate('term-a', 3, 'running'); telemetry.checkReceipts();
    expect(anomalies().map(record => record.reason)).toEqual(['renderer-merge-disagreement']);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'renderer-receipt', outcome: 'merge-disagreement' }));
  });

  it('diagnoses newer/failed renderer merges as received, while an older incoming revision remains stale', () => {
    const { telemetry, records, at, anomalies } = fixture();
    telemetry.publish('term-a', 4, 'running', true);
    telemetry.receipt(receipt);
    at(5000); telemetry.checkReceipts();
    expect(anomalies().map(record => record.reason)).toEqual(['renderer-receipt-missing']);
    at(11000); telemetry.receipt({ ...receipt, receivedRevision: 4, storedRevision: 5, merge: 'older' });
    at(20000); telemetry.checkReceipts();
    expect(anomalies().map(record => record.reason)).toEqual(['renderer-receipt-missing', 'renderer-merge-disagreement']);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'renderer-receipt', outcome: 'stale-receipt' }));
  });

  it('starts a fresh check after renderer recreation without carrying old receipts or unavailable time', () => {
    const { telemetry, at, anomalies, records } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    telemetry.receipt(receipt);
    at(1000); telemetry.rendererUnavailable('navigation');
    at(10000); telemetry.rendererReady(); telemetry.hydrate('term-a', 3, 'running');
    at(14999); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
    at(15000); telemetry.checkReceipts();
    expect(anomalies()).toHaveLength(1);
    expect(anomalies()[0]).toMatchObject({ reason: 'renderer-receipt-missing', rendererEpoch: 1 });
    telemetry.receipt({ ...receipt, source: 'hydration', merge: 'equal' });
    at(20000); telemetry.hydrate('term-a', 3, 'running'); telemetry.checkReceipts();
    expect(anomalies()).toHaveLength(1);
    expect(records.filter(record => record.kind === 'renderer-receipt').map(record => record.rendererEpoch)).toEqual([0, 1]);
  });

  it('does not allow a cached presentation report to masquerade as a push/hydration receipt', () => {
    const { telemetry, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    telemetry.receipt({ ...receipt, source: 'presentation' });
    at(5000); telemetry.checkReceipts();
    expect(anomalies().map(record => record.reason)).toEqual(['renderer-receipt-missing']);
  });

  it('cannot rearm deadlines after bounded shutdown', async () => {
    const { telemetry, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    await telemetry.stop();
    telemetry.rendererReady(); telemetry.hydrate('term-a', 3, 'running');
    at(20000); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
  });
});

describe('received indicator suppression is distinct from missing delivery', () => {
  it('logs legitimate ineligibility for an active Running snapshot without a missing or presentation anomaly', () => {
    const { telemetry, records, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    telemetry.receipt({ ...receipt, eligible: false, indicator: 'none', suppression: 'ineligible' });
    at(10000); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'renderer-receipt', publishedStatus: 'running', outcome: 'stored-indicator-none', suppression: 'ineligible' }));
  });

  it.each(['selector-none', 'acknowledged'] as const)('flags eligible Running with indicator none (%s), even in foreground, without calling it a missing receipt', suppression => {
    const { telemetry, records, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'running', true);
    telemetry.receipt({ ...receipt, foreground: true, indicator: 'none', suppression });
    at(10000); telemetry.hydrate('term-a', 3, 'running'); telemetry.checkReceipts();
    expect(anomalies().map(record => record.reason)).toEqual(['renderer-running-indicator-none']);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'renderer-receipt', outcome: 'stored-indicator-none', eligible: true }));
  });

  it('records foreground acknowledgement of an idle finish without flagging it as unexpected suppression', () => {
    const { telemetry, records, at, anomalies } = fixture();
    telemetry.publish('term-a', 3, 'idle', true);
    telemetry.receipt({ ...receipt, foreground: true, indicator: 'none', suppression: 'acknowledged' });
    at(10000); telemetry.checkReceipts();
    expect(anomalies()).toEqual([]);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'renderer-receipt', publishedStatus: 'idle', suppression: 'acknowledged' }));
  });
});
