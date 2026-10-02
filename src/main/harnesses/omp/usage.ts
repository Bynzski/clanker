import { HarnessCapabilityError, type HarnessUsageCapability, type HarnessUsageMeasurement, type HarnessUsageSnapshot } from '../types';
import { parseJsonOutput, requireSuccess } from '../commandExecution';

/**
 * OMP usage via its machine-readable `omp usage --json` (verified against
 * can1357/oh-my-pi `packages/coding-agent/src/cli/usage-cli.ts` and
 * `packages/ai/src/usage.ts`, OMP 18.4.x). Upstream assumptions this parser relies on:
 *
 * - Exit 0 with one JSON document `{ generatedAt, reports[], accountsWithoutUsage[],
 *   disabledCredentials[], capacity }` (epoch-millisecond timestamps). In JSON mode an
 *   empty result is still exit 0; only crashes exit non-zero. JSON mode therefore cannot
 *   distinguish "no credentials" from "only credentials without a usage endpoint", and
 *   this adapter never claims `unauthenticated`.
 * - One report per credential/account: `{ provider, fetchedAt, limits[], metadata? }`.
 *   Account identity lives in `metadata` (`accountId`, `email`, `planType`) and optionally
 *   `limit.scope.accountId`; it can be absent (e.g. Antigravity has only email/projectId).
 * - A limit is `{ id, label, scope{provider,accountId?,modelId?,tier?,windowId?,sharedGroup?},
 *   window?{id,label,durationMs?,resetsAt?}, amount{used?,limit?,remaining?,usedFraction?,
 *   remainingFraction?,unit}, status?, notes? }`. Units: percent|tokens|requests|credits|usd|
 *   minutes|bytes|unknown. Fractions are 0..1; `percent` amounts are points of 100.
 * - Window meaning comes from `window.*` metadata, never from ids like `primary`/`secondary`.
 * - Copies of one upstream quota share `scope.sharedGroup` within a report.
 * - `accountsWithoutUsage`, `disabledCredentials`, `capacity`, `resetCredits`, `status` and
 *   unknown keys are ignored. `omp usage invalidate` is never called.
 *
 * Tolerance policy: a corrupt root (not an object, no `reports` array) is a
 * `parse-failure`. A malformed report or limit is skipped so other providers' valid data
 * survives, UNLESS corruption would hide everything: if any entry was malformed and no
 * usable report/measurement remains, the whole result is a `parse-failure`. Limits that
 * are well-formed but carry no numeric quota (no amount values) are legitimately skipped.
 */
export const OMP_USAGE_COMMAND = { command: 'omp', args: ['usage', '--json'] } as const;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);

class Malformed extends Error {}
function optionalNumber(value: unknown, minimum = 0): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new Malformed();
  return value;
}
function optionalTimestamp(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Upstream precedence (resolveUsedFraction): usedFraction > used/limit > percent used > remainingFraction. */
function usedFraction(amount: Json, unit: string): number | undefined {
  const fraction = optionalNumber(amount.usedFraction, -Infinity);
  if (fraction !== undefined) return Math.max(0, fraction);
  const used = optionalNumber(amount.used);
  const limit = optionalNumber(amount.limit);
  if (used !== undefined && limit !== undefined && limit > 0) return used / limit;
  if (unit === 'percent' && used !== undefined) return used / 100;
  const remainingFraction = optionalNumber(amount.remainingFraction, -Infinity);
  if (remainingFraction !== undefined) return Math.max(0, 1 - remainingFraction);
  return undefined;
}

function toMeasurement(limit: Json, report: Json, metadata: Json): HarnessUsageMeasurement | undefined {
  if (!isObject(limit.amount)) throw new Malformed();
  const amount = limit.amount;
  const unit = str(amount.unit);
  if (!unit) throw new Malformed();
  const scope = isObject(limit.scope) ? limit.scope : {};
  if (limit.window !== undefined && !isObject(limit.window)) throw new Malformed();
  const window = limit.window;

  const used = optionalNumber(amount.used);
  const max = optionalNumber(amount.limit);
  const remaining = optionalNumber(amount.remaining);
  let values: Pick<HarnessUsageMeasurement, 'unit' | 'used' | 'limit' | 'remaining'>;
  if (unit !== 'percent' && (used !== undefined || max !== undefined || remaining !== undefined)) {
    values = {
      unit,
      used: used ?? (max !== undefined && remaining !== undefined ? Math.max(0, max - remaining) : undefined),
      limit: max,
      remaining: remaining ?? (max !== undefined && used !== undefined ? Math.max(0, max - used) : undefined),
    };
  } else {
    // Fraction/percent-only (or percent-unit) quota: normalized to percentage points of 100.
    const fraction = usedFraction(amount, unit);
    if (fraction === undefined) return undefined;
    const percent = round(fraction * 100);
    values = { unit: 'percent', used: percent, limit: 100, remaining: Math.max(0, round(100 - percent)) };
  }

  const resetsAt = optionalTimestamp(window?.resetsAt);
  const durationMs = optionalTimestamp(window?.durationMs);
  const windowLabel = str(window?.label);
  const notes = Array.isArray(limit.notes) ? limit.notes.filter((note): note is string => typeof note === 'string') : [];
  const accountId = str(scope.accountId) ?? str(metadata.accountId);
  // Only documented plan metadata. `scope.tier` also names model/quota meters (e.g. Codex
  // 'spark'), so it is deliberately not a plan fallback.
  const planLabel = str(metadata.planType) ?? str(metadata.plan);
  const accountLabel = str(metadata.email);
  const label = str(limit.label) ?? windowLabel;

  return {
    kind: values.unit === 'tokens' ? 'tokens' : values.unit === 'usd' ? 'spend' : window ? 'rate-limit' : 'allowance',
    ...values,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
    ...(window ? { period: {
      ...(resetsAt !== undefined && durationMs !== undefined ? { startsAt: resetsAt - durationMs } : {}),
      ...(resetsAt !== undefined ? { endsAt: resetsAt } : {}),
      ...(windowLabel ? { label: windowLabel } : {}),
    } } : {}),
    scope: {
      providerId: str(scope.provider) ?? str(report.provider),
      ...(accountId ? { accountId } : {}),
      ...(accountLabel ? { accountLabel } : {}),
      ...(planLabel ? { planLabel } : {}),
      ...(str(scope.modelId) ? { modelId: str(scope.modelId) } : {}),
    },
    ...(label ? { label } : {}),
    ...(notes.length > 0 ? { description: notes.slice(0, 3).join('; ') } : {}),
  };
}

export function parseOmpUsage(stdout: string): HarnessUsageSnapshot {
  const root = parseJsonOutput(stdout, 'omp usage --json');
  if (!isObject(root) || !Array.isArray(root.reports)) throw new HarnessCapabilityError('parse-failure', 'Unexpected omp usage document');

  const measurements: HarnessUsageMeasurement[] = [];
  const fetchedAt: number[] = [];
  let malformed = 0;
  for (const report of root.reports as unknown[]) {
    if (!isObject(report) || !str(report.provider) || !Array.isArray(report.limits)) { malformed++; continue; }
    const metadata = isObject(report.metadata) ? report.metadata : {};
    const fetched = optionalTimestamp(report.fetchedAt);
    if (fetched !== undefined) fetchedAt.push(fetched);
    const seenGroups = new Set<string>();
    for (const limit of report.limits as unknown[]) {
      try {
        if (!isObject(limit)) throw new Malformed();
        const group = isObject(limit.scope) ? str(limit.scope.sharedGroup) : undefined;
        if (group && seenGroups.has(group)) continue; // routing copies of one upstream quota
        const measurement = toMeasurement(limit, report, metadata);
        if (!measurement) continue;
        if (group) seenGroups.add(group);
        measurements.push(measurement);
      } catch (error) {
        if (!(error instanceof Malformed)) throw error;
        malformed++;
      }
    }
  }
  // Partial results are kept, but corruption must not masquerade as an empty account.
  if (malformed > 0 && measurements.length === 0) throw new HarnessCapabilityError('parse-failure', 'omp usage reports were malformed');
  // Honest data age: OMP serves per-account reports from its own cache.
  const observedAt = fetchedAt.length > 0 ? Math.min(...fetchedAt) : optionalTimestamp(root.generatedAt) ?? Date.now();
  return { observedAt, measurements };
}

export const ompUsage: HarnessUsageCapability = {
  async get({ executor }) {
    const result = await executor.run({ ...OMP_USAGE_COMMAND, args: [...OMP_USAGE_COMMAND.args], timeoutMs: 25_000, maxOutputBytes: 1024 * 1024 });
    return parseOmpUsage(requireSuccess(result, 'omp usage'));
  },
  // OMP caches provider reports for 5 minutes and applies its own failure cooldowns, so
  // probing every minute is cheap and does not defeat that cache. The 60 s hard minimum
  // limits process spawns (each loads OMP's auth store and extensions); 120 s after a
  // failure avoids respawning a crashing CLI.
  refresh: { cacheTtlMs: 60_000, minimumProbeIntervalMs: 60_000, failureBackoffMs: 120_000 },
};
