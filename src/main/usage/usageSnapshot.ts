import { HarnessCapabilityError, type HarnessUsageMeasurement, type HarnessUsageSnapshot } from '../harnesses/types';
import type { HarnessUsageMeasurementView } from '../../shared/types/harnessUsage';

const MAX_MEASUREMENTS = 64;
const MAX_TEXT = 120;
const KINDS: readonly string[] = ['allowance', 'rate-limit', 'tokens', 'spend', 'other'];

function bad(what: string): never {
  throw new HarnessCapabilityError('parse-failure', `Malformed usage result: ${what}`);
}
function plain(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) bad(what);
  return value as Record<string, unknown>;
}
function num(value: unknown, what: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) bad(what);
  return value;
}
function text(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') bad(what);
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return cleaned ? cleaned.slice(0, MAX_TEXT) : undefined;
}
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
function nested<T extends object>(value: unknown, what: string, build: (raw: Record<string, unknown>) => T): T | undefined {
  if (value === undefined) return undefined;
  const result = compact(build(plain(value, what)));
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Structural validation for provider output. Returns the main-process
 * representation: known fields only, sanitized text, finite numbers, and the
 * opaque `scope.accountId` retained for later correlation. Nested structures
 * must be plain objects; wrong shapes are parse failures, never "absent".
 */
export function validateUsageSnapshot(snapshot: unknown): HarnessUsageSnapshot {
  const raw = plain(snapshot, 'snapshot');
  if (!Array.isArray(raw.measurements)) bad('measurements');
  const observedAt = num(raw.observedAt, 'observedAt');
  if (observedAt === undefined) bad('observedAt');
  if (raw.measurements.length > MAX_MEASUREMENTS) bad('too many measurements');
  const measurements = raw.measurements.map((entry: unknown): HarnessUsageMeasurement => {
    const m = plain(entry, 'measurement');
    if (typeof m.kind !== 'string' || !KINDS.includes(m.kind)) bad('measurement kind');
    const unit = text(m.unit, 'unit');
    if (!unit) bad('unit');
    return compact({
      kind: m.kind as HarnessUsageMeasurement['kind'], unit,
      used: num(m.used, 'used'), remaining: num(m.remaining, 'remaining'), limit: num(m.limit, 'limit'),
      resetsAt: num(m.resetsAt, 'resetsAt'),
      period: nested(m.period, 'period', (p) => ({
        startsAt: num(p.startsAt, 'period.startsAt'), endsAt: num(p.endsAt, 'period.endsAt'), label: text(p.label, 'period.label'),
      })),
      scope: nested(m.scope, 'scope', (s) => ({
        accountId: text(s.accountId, 'accountId'), accountLabel: text(s.accountLabel, 'accountLabel'),
        planLabel: text(s.planLabel, 'planLabel'), providerId: text(s.providerId, 'providerId'), modelId: text(s.modelId, 'modelId'),
      })),
      label: text(m.label, 'label'), description: text(m.description, 'description'),
    });
  });
  return { observedAt, measurements };
}

/** Renderer boundary: drops the opaque account identity. */
export function toRendererMeasurements(snapshot: HarnessUsageSnapshot): HarnessUsageMeasurementView[] {
  return snapshot.measurements.map((measurement) => {
    if (!measurement.scope) return measurement;
    const scope = compact({ ...measurement.scope, accountId: undefined });
    delete scope.accountId;
    return compact({ ...measurement, scope: Object.keys(scope).length > 0 ? scope : undefined });
  });
}
