import { describe, expect, it } from 'vitest';
import { toRendererMeasurements, validateUsageSnapshot } from '../../../src/main/usage/usageSnapshot';

const base = { kind: 'allowance', unit: 'percent', used: 1 };
const wrap = (m: unknown) => ({ observedAt: 1, measurements: [m] });

describe('validateUsageSnapshot structure', () => {
  it.each([
    ['period string', { ...base, period: 'weekly' }],
    ['period array', { ...base, period: [] }],
    ['period null', { ...base, period: null }],
    ['scope number', { ...base, scope: 42 }],
    ['scope array', { ...base, scope: ['a'] }],
    ['scope null', { ...base, scope: null }],
    ['measurement string', 'nope'],
    ['non-finite number', { ...base, used: Infinity }],
    ['string number', { ...base, limit: '100' }],
    ['bad kind', { ...base, kind: 'bogus' }],
    ['missing unit', { kind: 'other' }],
    ['non-string label', { ...base, label: 5 }],
    ['non-string accountId', { ...base, scope: { accountId: 7 } }],
  ])('rejects %s as a parse failure', (_name, measurement) => {
    expect(() => validateUsageSnapshot(wrap(measurement))).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  });
  it.each([null, undefined, 'x', [], { observedAt: 1 }, { measurements: [] }, { observedAt: 1, measurements: {} }])('rejects top-level %j', (value) => {
    expect(() => validateUsageSnapshot(value)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  });
  it('drops unknown fields, sanitizes text, keeps accountId internally and strips it for the renderer', () => {
    const snapshot = validateUsageSnapshot(wrap({ ...base, token: 'x', label: ' a\u0007b ', scope: { accountId: 'k', accountLabel: 'me', extra: 1 }, period: { label: 'w', junk: 1 } }));
    expect(snapshot.measurements[0]).toEqual({ ...base, label: 'a b', scope: { accountId: 'k', accountLabel: 'me' }, period: { label: 'w' } });
    expect(toRendererMeasurements(snapshot)[0].scope).toEqual({ accountLabel: 'me' });
    expect(snapshot.measurements[0].scope?.accountId).toBe('k');
  });
  it('omits an all-empty scope for the renderer', () => {
    const snapshot = validateUsageSnapshot(wrap({ ...base, scope: { accountId: 'k' } }));
    expect(toRendererMeasurements(snapshot)[0]).not.toHaveProperty('scope');
  });
});
