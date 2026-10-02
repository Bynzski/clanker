import { HarnessCapabilityError, type HarnessUsageMeasurement, type HarnessUsageSnapshot } from '../harnesses/types';
import type { HarnessUsageMeasurementView } from '../../shared/types/harnessUsage';

const MAX_MEASUREMENTS = 64;
const MAX_TEXT = 120;
const KINDS: readonly string[] = ['allowance', 'rate-limit', 'tokens', 'spend', 'other'];

function bad(what: string): never {
  throw new HarnessCapabilityError('parse-failure', `Malformed usage result: ${what}`);
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
function defined<T extends object>(value: T): T | undefined {
  return Object.values(value).some((entry) => entry !== undefined) ? value : undefined;
}

/**
 * Validates provider output and copies only known fields. Unknown fields (and
 * the opaque account key) cannot reach the renderer by accident.
 */
export function toUsageView(snapshot: HarnessUsageSnapshot): { observedAt: number; measurements: HarnessUsageMeasurementView[] } {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.measurements)) bad('missing measurements');
  const observedAt = num(snapshot.observedAt, 'observedAt');
  if (observedAt === undefined) bad('observedAt');
  if (snapshot.measurements.length > MAX_MEASUREMENTS) bad('too many measurements');
  const measurements = snapshot.measurements.map((raw: HarnessUsageMeasurement): HarnessUsageMeasurementView => {
    if (!raw || typeof raw !== 'object' || !KINDS.includes(raw.kind)) bad('measurement kind');
    const unit = text(raw.unit, 'unit');
    if (!unit) bad('unit');
    const period = raw.period === undefined ? undefined : defined({
      startsAt: num(raw.period?.startsAt, 'period.startsAt'),
      endsAt: num(raw.period?.endsAt, 'period.endsAt'),
      label: text(raw.period?.label, 'period.label'),
    });
    const scope = raw.scope === undefined ? undefined : defined({
      accountLabel: text(raw.scope?.accountLabel, 'accountLabel'),
      planLabel: text(raw.scope?.planLabel, 'planLabel'),
      providerId: text(raw.scope?.providerId, 'providerId'),
      modelId: text(raw.scope?.modelId, 'modelId'),
    });
    const view: HarnessUsageMeasurementView = {
      kind: raw.kind, unit,
      used: num(raw.used, 'used'), remaining: num(raw.remaining, 'remaining'), limit: num(raw.limit, 'limit'),
      resetsAt: num(raw.resetsAt, 'resetsAt'), period, scope,
      label: text(raw.label, 'label'), description: text(raw.description, 'description'),
    };
    return Object.fromEntries(Object.entries(view).filter(([, value]) => value !== undefined)) as unknown as HarnessUsageMeasurementView;
  });
  return { observedAt, measurements };
}
