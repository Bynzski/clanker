import { describe, expect, it } from 'vitest';
import { describeMeasurement, formatChecked, formatReset, groupMeasurements, measurementLabel, providerDisplayName } from '../../../src/renderer/lib/usageFormat';
import type { HarnessUsageMeasurementView } from '../../../src/shared/types/harnessUsage';

const m = (overrides: Partial<HarnessUsageMeasurementView>): HarnessUsageMeasurementView => ({ kind: 'rate-limit', unit: 'percent', ...overrides });
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

describe('measurement formatting', () => {
  it('shows percent remaining first, and fills the bar with REMAINING capacity', () => {
    const view = describeMeasurement(m({ used: 28, remaining: 72, limit: 100, label: '5 hour' }), 'Codex');
    expect(view.value).toBe('72% remaining');
    expect(view.ratio).toBeCloseTo(0.72);
    expect(view.percentNow).toBe(72);
  });
  it('falls back to percent used', () => {
    expect(describeMeasurement(m({ used: 28 }), 'X').value).toBe('28% used');
    expect(describeMeasurement(m({ remaining: 40 }), 'X')).toMatchObject({ value: '40% remaining', ratio: 0.4 });
  });
  it('keeps overage visible in the text while the bar clamps', () => {
    const view = describeMeasurement(m({ used: 130, remaining: 0, limit: 100 }), 'X');
    expect(view.value).toBe('130% used');
    expect(view.ratio).toBe(0);
    expect(view.percentNow).toBe(0);
  });
  it('pins the remaining-capacity ratio for every depletion level', () => {
    const ratio = (used: number, remaining?: number) => describeMeasurement(m({ used, ...(remaining !== undefined ? { remaining } : {}) }), 'X').ratio;
    expect(ratio(0, 100)).toBe(1);
    expect(ratio(28, 72)).toBeCloseTo(0.72);
    expect(ratio(99, 1)).toBeCloseTo(0.01);
    expect(ratio(100, 0)).toBe(0);
    expect(ratio(130, 0)).toBe(0);
    expect(ratio(28)).toBeCloseTo(0.72); // remaining derived from used
    expect(describeMeasurement(m({ unit: 'usd', used: 4.2, limit: 20 }), 'X').ratio).toBeCloseTo(0.79);
    expect(describeMeasurement(m({ unit: 'credits', used: 3, limit: 10 }), 'X').ratio).toBeCloseTo(0.7);
  });
  it('formats money only for the usd unit and never infers a currency', () => {
    expect(describeMeasurement(m({ unit: 'usd', used: 4.2, limit: 20 }), 'X').value).toBe('$4.20 / $20.00 used');
    const credits = describeMeasurement(m({ unit: 'credits', used: 4.2, limit: 20 }), 'X').value;
    expect(credits).toBe('4.2 / 20 credits used');
    expect(credits).not.toContain('$');
  });
  it('renders generic units with and without a denominator', () => {
    expect(describeMeasurement(m({ unit: 'requests', used: 320, limit: 1000 }), 'X')).toMatchObject({ value: '320 / 1,000 requests used', ratio: 0.68 });
    expect(describeMeasurement(m({ unit: 'tokens', remaining: 680 }), 'X')).toMatchObject({ value: '680 tokens remaining' });
    expect(describeMeasurement(m({ unit: 'tokens', remaining: 680 }), 'X').ratio).toBeUndefined();
    expect(describeMeasurement(m({ unit: 'requests', limit: 50, remaining: 20 }), 'X')).toMatchObject({ value: '30 / 50 requests used', ratio: 0.4 });
    expect(describeMeasurement(m({ unit: 'minutes', limit: 50 }), 'X').value).toBe('50 minutes limit');
    expect(describeMeasurement(m({ unit: 'weird' }), 'X').value).toBe('No data');
  });
  it('strips only the exact leading harness prefix and has sensible fallbacks', () => {
    expect(measurementLabel(m({ label: 'Codex · 5 hour' }), 'Codex')).toBe('5 hour');
    expect(measurementLabel(m({ label: 'Claude · weekly' }), 'Claude')).toBe('weekly');
    expect(measurementLabel(m({ label: 'Gemini Models · Weekly Limit' }), 'Antigravity')).toBe('Gemini Models · Weekly Limit');
    expect(measurementLabel(m({ label: 'Codex' }), 'Codex')).toBe('Codex');
    expect(measurementLabel(m({ period: { label: 'weekly' } }), 'X')).toBe('weekly');
    expect(measurementLabel(m({ scope: { modelId: 'opus' } }), 'X')).toBe('opus');
    expect(measurementLabel(m({}), 'X')).toBe('rate-limit');
  });
});

describe('reset and checked formatting', () => {
  it.each([
    [42 * 60_000, 'resets in 42m'], [60 * 60_000 + 42 * 60_000, 'resets in 1h 42m'], [2 * 3_600_000, 'resets in 2h'],
    [3 * 86_400_000 + 6 * 3_600_000, 'resets in 3d 6h'], [86_400_000 * 2, 'resets in 2d'], [30_000, 'resets in 1m'],
    [-1, 'reset due'], [0, 'reset due'],
  ])('countdown for %s ms', (delta, text) => { expect(formatReset(NOW + delta, NOW)).toBe(text); });
  it('uses a short calendar date for distant resets, and never shows seconds', () => {
    expect(formatReset(NOW + 20 * 86_400_000, NOW)).toMatch(/^resets [A-Z][a-z]{2,} \d{1,2}$|^resets \d{1,2}\s?[A-Za-z]+/);
    expect(formatReset(NOW + 90_000, NOW)).not.toMatch(/\ds\b/);
  });
  it.each([[0, 'checked just now'], [90_000, 'checked just now'], [5 * 60_000, 'checked 5m ago'], [3 * 3_600_000, 'checked 3h ago']])('checked %s ms ago', (age, text) => {
    expect(formatChecked(NOW - age, NOW)).toBe(text);
  });
});

describe('provider names and grouping', () => {
  it('maps known provider ids and humanizes unknown ones without any behavior', () => {
    expect(providerDisplayName('anthropic')).toBe('Anthropic');
    expect(providerDisplayName('openai-codex')).toBe('OpenAI Codex');
    expect(providerDisplayName('google-antigravity')).toBe('Google Antigravity');
    expect(providerDisplayName('openrouter')).toBe('OpenRouter');
    expect(providerDisplayName('some-new_vendor')).toBe('Some New Vendor');
  });
  it('groups by provider, account and plan but not model, keeping first-seen order', () => {
    const groups = groupMeasurements([
      m({ scope: { providerId: 'anthropic', planLabel: 'Pro', accountLabel: 'a@x', modelId: 'opus' } }),
      m({ scope: { providerId: 'openai-codex', planLabel: 'Plus' } }),
      m({ scope: { providerId: 'anthropic', planLabel: 'Pro', accountLabel: 'a@x', modelId: 'sonnet' } }),
      m({}),
    ]);
    expect(groups.map((g) => [g.providerId, g.measurements.length])).toEqual([['anthropic', 2], ['openai-codex', 1], [undefined, 1]]);
  });
});
