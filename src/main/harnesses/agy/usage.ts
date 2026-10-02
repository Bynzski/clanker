import { HarnessCapabilityError, type HarnessUsageCapability, type HarnessUsageMeasurement, type HarnessUsageSnapshot } from '../types';
import { parseOffsetTimestamp } from '../usageParsing';

/**
 * Antigravity (`agy`) usage via print-mode `/usage` (verified against agy 1.2.14 live output
 * and the shipped binary's error strings). Assumptions:
 *
 * - SAFETY: before agy 1.1.11, `-p /usage` is not a recognised command and is sent to the
 *   model as an ordinary prompt (a real conversation that consumes quota). So `agy --version`
 *   runs FIRST and `/usage` is issued only when the version is positively >= 1.1.11. Ambiguous,
 *   prerelease or unparseable versions fail closed.
 * - `agy --output-format json -p=/usage` prints one envelope:
 *   `{ conversation_id, status: "SUCCESS", response (human text, never parsed), duration_seconds,
 *   num_turns, usage{input_tokens,output_tokens,thinking_tokens,cache_read_tokens,total_tokens},
 *   command{ name: "usage", data{ description, groups[{ name, description, buckets[{ id, name,
 *   description, window ("5h"|"weekly"|...), remaining_fraction (0..1), reset_time (RFC3339),
 *   disabled? }] }] } } }`. `disabled` is omitted when false.
 * - A genuine read-only usage reply has an empty conversation_id, zero turns and zero tokens.
 *   Anything else is evidence a model turn ran and is rejected as command-failed (second guard after the version
 *   gate) with a long hard backoff so Clanker does not repeat it.
 * - Error envelopes are not specified; auth is classified only from a narrow phrase list in the
 *   envelope's own structured error/message fields (never the human `response`) (phrases taken from agy's strings: "authentication
 *   required", "not authenticated", token expired/revoked...). Generic failures stay generic.
 *   stderr is never inspected. This is best-effort and unverified against a live error envelope.
 */
export const AGY_MINIMUM_SAFE_VERSION = [1, 1, 11] as const;
export const AGY_VERSION_COMMAND = { command: 'agy', args: ['--version'] } as const;
export const AGY_USAGE_COMMAND = { command: 'agy', args: ['--output-format', 'json', '-p=/usage'] } as const;
const PROVIDER_ID = 'google-antigravity';
/** After evidence of a model turn nothing must retry soon. */
const TURN_DETECTED_BACKOFF_MS = 60 * 60_000;
const WINDOW_DURATION_MS: Record<string, number> = { '5h': 5 * 3_600_000, weekly: 7 * 24 * 3_600_000 };
const WINDOW_LABEL: Record<string, string> = { '5h': '5 hour', weekly: 'weekly' };
const AUTH_REJECTION = /authentication required|not authenticated|login required|credentials? (?:have been )?revoked|token (?:has been )?(?:revoked|expired)/i;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Whole output must be one `X.Y.Z` / `vX.Y.Z` line; nothing else is trusted. */
export function parseAgyVersion(output: string): [number, number, number] | undefined {
  const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(output.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}
export function isSafeAgyVersion(version: readonly number[] | undefined): boolean {
  if (!version) return false;
  for (let i = 0; i < 3; i++) {
    if (version[i] !== AGY_MINIMUM_SAFE_VERSION[i]) return version[i] > AGY_MINIMUM_SAFE_VERSION[i];
  }
  return true;
}

class Malformed extends Error {}

/** Strict JSON first; otherwise only whole-line `{...}` candidates that look like envelopes. */
function findEnvelope(stdout: string): Json {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(stdout)); } catch {
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
      try { candidates.push(JSON.parse(trimmed)); } catch { /* log noise */ }
    }
  }
  const envelopes = candidates.filter((value): value is Json => isObject(value) && typeof value.status === 'string');
  const distinct = new Set(envelopes.map((value) => JSON.stringify(value)));
  if (envelopes.length === 0) throw new HarnessCapabilityError('parse-failure', 'agy produced no usage envelope');
  if (distinct.size > 1) throw new HarnessCapabilityError('parse-failure', 'agy produced conflicting envelopes');
  return envelopes[0];
}

function isZeroOrAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === 0;
}

/** Throws unless the envelope shows no model turn ran. */
function assertNoModelTurn(envelope: Json): void {
  const usage = envelope.usage === undefined ? {} : envelope.usage;
  const clean = (envelope.conversation_id === undefined || envelope.conversation_id === null || envelope.conversation_id === '')
    && isZeroOrAbsent(envelope.num_turns)
    && isObject(usage)
    && Object.values(usage).every(isZeroOrAbsent);
  if (!clean) {
    throw new HarnessCapabilityError('command-failed', 'agy /usage appears to have run a model turn; refusing it as usage data', undefined, TURN_DETECTED_BACKOFF_MS);
  }
}

function classifyErrorEnvelope(envelope: Json): HarnessCapabilityError {
  const error = envelope.error;
  const messages = [envelope.message, envelope.error_message, isObject(error) ? error.message : error]
    .filter((value): value is string => typeof value === 'string');
  if (messages.some((message) => AUTH_REJECTION.test(message))) return new HarnessCapabilityError('unauthenticated', 'agy reports the account is not signed in');
  return new HarnessCapabilityError('command-failed', 'agy usage reported a failure');
}

function toMeasurement(groupName: string | undefined, bucket: unknown): HarnessUsageMeasurement | undefined {
  if (!isObject(bucket)) throw new Malformed();
  if (bucket.disabled === true) return undefined; // tier does not meter this bucket: not "100% left"
  const fraction = bucket.remaining_fraction;
  if (fraction === undefined || fraction === null) return undefined;
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) throw new Malformed();
  if (bucket.window !== undefined && bucket.window !== null && typeof bucket.window !== 'string') throw new Malformed();

  const remaining = Math.round(Math.min(1, Math.max(0, fraction)) * 100 * 1e4) / 1e4;
  const window = str(bucket.window);
  const windowLabel = window ? WINDOW_LABEL[window.toLowerCase()] ?? window : undefined;
  const duration = window ? WINDOW_DURATION_MS[window.toLowerCase()] : undefined;
  const resetsAt = parseOffsetTimestamp(bucket.reset_time);
  const bucketName = str(bucket.name) ?? windowLabel;
  const label = [groupName, bucketName].filter(Boolean).join(' · ') || undefined;
  return {
    kind: 'rate-limit', unit: 'percent', used: Math.round((100 - remaining) * 1e4) / 1e4, remaining, limit: 100,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
    ...(windowLabel ? { period: {
      label: windowLabel,
      ...(resetsAt !== undefined ? { endsAt: resetsAt } : {}),
      ...(resetsAt !== undefined && duration ? { startsAt: resetsAt - duration } : {}),
    } } : {}),
    scope: { providerId: PROVIDER_ID },
    ...(label ? { label } : {}),
  };
}

/**
 * Tolerance: bad envelope/missing groups -> parse-failure; malformed group or bucket is skipped
 * while valid ones survive; disabled or fraction-less buckets are legitimate skips; if something
 * was malformed and nothing usable remains -> parse-failure. A tier with only disabled buckets
 * yields an ok snapshot with zero measurements.
 */
export function parseAgyUsage(stdout: string, now: () => number = Date.now): HarnessUsageSnapshot {
  const envelope = findEnvelope(stdout);
  if (String(envelope.status).toUpperCase() !== 'SUCCESS') throw classifyErrorEnvelope(envelope);
  assertNoModelTurn(envelope);
  const command = envelope.command;
  const data = isObject(command) && command.name === 'usage' && isObject(command.data) ? command.data : undefined;
  if (!data || !Array.isArray(data.groups)) throw new HarnessCapabilityError('parse-failure', 'agy reply is not a usage command response');

  const measurements: HarnessUsageMeasurement[] = [];
  let malformed = 0;
  for (const group of data.groups as unknown[]) {
    if (!isObject(group) || !Array.isArray(group.buckets)) { malformed++; continue; }
    const groupName = str(group.name);
    for (const bucket of group.buckets as unknown[]) {
      try {
        const measurement = toMeasurement(groupName, bucket);
        if (measurement) measurements.push(measurement);
      } catch (error) {
        if (!(error instanceof Malformed)) throw error;
        malformed++;
      }
    }
  }
  if (malformed > 0 && measurements.length === 0) throw new HarnessCapabilityError('parse-failure', 'agy usage buckets were malformed');
  // The envelope carries no fetch time; observation time is when this probe completed.
  return { observedAt: now(), measurements };
}

export const agyUsage: HarnessUsageCapability = {
  async get({ executor }) {
    const versionResult = await executor.run({ ...AGY_VERSION_COMMAND, args: [...AGY_VERSION_COMMAND.args], timeoutMs: 10_000, maxOutputBytes: 4096 });
    if (versionResult.exitCode !== 0) throw new HarnessCapabilityError('command-failed', `agy --version exited with code ${versionResult.exitCode}`);
    if (!isSafeAgyVersion(parseAgyVersion(versionResult.stdout))) {
      throw new HarnessCapabilityError('unsupported', 'agy version is below 1.1.11 or could not be verified; /usage is not run');
    }
    const result = await executor.run({ ...AGY_USAGE_COMMAND, args: [...AGY_USAGE_COMMAND.args], timeoutMs: 30_000, maxOutputBytes: 256 * 1024 });
    if (result.exitCode !== 0) {
      let envelope: Json | undefined;
      try { envelope = findEnvelope(result.stdout); } catch { /* no envelope */ }
      throw envelope ? classifyErrorEnvelope(envelope) : new HarnessCapabilityError('command-failed', `agy usage exited with code ${result.exitCode}`);
    }
    return parseAgyUsage(result.stdout);
  },
  // Each probe is a live vendor quota request with no local cache, preceded by a cheap version
  // check. A 2 minute hard minimum (manual refresh cannot bypass it) and 5 minute failure backoff.
  refresh: { cacheTtlMs: 60_000, minimumProbeIntervalMs: 120_000, failureBackoffMs: 300_000 },
};
