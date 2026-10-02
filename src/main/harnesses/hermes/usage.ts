import { HarnessCapabilityError, type HarnessUsageCapability, type HarnessUsageMeasurement, type HarnessUsageSnapshot } from '../types';
import { parseJsonOutput } from '../commandExecution';

/**
 * Hermes usage via `hermes usage --json` (verified against NousResearch/hermes-agent
 * `hermes_cli/subcommands/usage.py` and `agent/account_usage.py`, v0.21.x). Assumptions:
 *
 * - One invocation queries the *configured* provider (same credential resolution as a
 *   session, without starting an agent). No provider fan-out is attempted.
 * - Exit 0 prints one document with documented-stable, additive keys: `provider`, `source`,
 *   `title`, `plan`, `fetched_at` (ISO-8601 with offset), `windows[]` of `{ label,
 *   used_percent (0-100 or null), resets_at (ISO or null), detail }`, `details[]`,
 *   `unavailable_reason`.
 * - Exit 1 (empty stdout, prose on stderr) covers "no credential configured", "provider has
 *   no usage endpoint" and "fetch failed" indistinguishably. It is reported as a generic
 *   `command-failed`, never `unauthenticated`, and stderr is not interpreted.
 * - `unavailable_reason` is free text; only its presence is used. When it is set and no
 *   window yields a measurement, the configured provider exposes no account limits
 *   (`unsupported`). Windows with a null `used_percent` carry no quota number and are skipped.
 * - Hermes documents no account identity, so none is produced. Unknown keys are ignored.
 *
 * Strictness: a non-object root, non-array `windows`, a window that is not an object or has
 * no string `label`, or a non-null `used_percent` that is not a finite number in 0..100 is a
 * `parse-failure`. An unparsable optional `resets_at` or `fetched_at` is merely omitted.
 */
export const HERMES_USAGE_COMMAND = { command: 'hermes', args: ['usage', '--json'] } as const;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** ISO-8601 with an explicit offset -> epoch ms; anything else is undefined (never local time). */
export function parseHermesTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value.trim())) return undefined;
  // JS Date reliably handles at most millisecond precision; Python emits microseconds.
  const normalized = value.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : undefined;
}

export function parseHermesUsage(stdout: string): HarnessUsageSnapshot {
  const root = parseJsonOutput(stdout, 'hermes usage --json');
  if (!isObject(root) || !Array.isArray(root.windows)) throw new HarnessCapabilityError('parse-failure', 'Unexpected hermes usage document');
  const providerId = str(root.provider);
  const planLabel = str(root.plan);

  const measurements: HarnessUsageMeasurement[] = [];
  for (const window of root.windows as unknown[]) {
    if (!isObject(window) || !str(window.label)) throw new HarnessCapabilityError('parse-failure', 'Malformed hermes usage window');
    if (window.used_percent === null || window.used_percent === undefined) continue;
    const used = window.used_percent;
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) {
      throw new HarnessCapabilityError('parse-failure', 'Invalid hermes used_percent');
    }
    const resetsAt = parseHermesTimestamp(window.resets_at);
    const label = str(window.label)!;
    const detail = str(window.detail);
    measurements.push({
      kind: resetsAt !== undefined ? 'rate-limit' : 'allowance',
      unit: 'percent', used, remaining: 100 - used, limit: 100,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
      label, period: { label },
      scope: { ...(providerId ? { providerId } : {}), ...(planLabel ? { planLabel } : {}) },
      ...(detail ? { description: detail } : {}),
    });
  }
  if (measurements.length === 0 && str(root.unavailable_reason)) {
    throw new HarnessCapabilityError('unsupported', 'Configured Hermes provider reports no account limits');
  }
  return { observedAt: parseHermesTimestamp(root.fetched_at) ?? Date.now(), measurements };
}

export const hermesUsage: HarnessUsageCapability = {
  async get({ executor }) {
    const result = await executor.run({ ...HERMES_USAGE_COMMAND, args: [...HERMES_USAGE_COMMAND.args], timeoutMs: 20_000, maxOutputBytes: 128 * 1024 });
    if (result.exitCode !== 0) {
      throw new HarnessCapabilityError('command-failed',
        `hermes usage exited with code ${result.exitCode} (no credential, no usage endpoint or fetch failure; not distinguishable)`,
        { exitCode: result.exitCode });
    }
    return parseHermesUsage(result.stdout);
  },
  // Hermes makes a live provider request (Codex/Anthropic/OpenRouter) on every call and has
  // no cache of its own, so the hard minimum matches the ~minute freshness the popover wants
  // and nothing faster. Exit 1 is commonly a permanent "not configured" state; a 5 minute
  // failure backoff avoids respawning Python every minute for users without that provider.
  refresh: { cacheTtlMs: 60_000, minimumProbeIntervalMs: 60_000, failureBackoffMs: 300_000 },
};
