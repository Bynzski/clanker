import {
  HarnessCapabilityError,
  type HarnessUsageCapability,
  type HarnessUsageContext,
  type HarnessUsageMeasurement,
  type HarnessUsageSnapshot,
} from '../types';
import type { HarnessCommandSession } from '../commandExecution';

/**
 * Codex usage through the stdio app-server (verified against openai/codex main, codex-cli 0.160.0
 * and a live handshake). Assumptions:
 *
 * - `codex app-server` speaks newline-delimited JSON-RPC on stdio (stdio is the default listener;
 *   plain `app-server` is used rather than `--listen stdio://` because the upstream test client and
 *   every version use it, whereas `--listen` is newer). Messages carry no `jsonrpc` field.
 * - Handshake: `initialize` request (clientInfo, capabilities), wait for its response, then an
 *   `initialized` notification. Unrelated notifications (e.g. `account/updated`) and server
 *   requests (they carry a `method`) can arrive at any time and are ignored.
 * - `account/read` -> `{ account: null | {type:"chatgpt",email,planType} | {type:"apiKey"} |
 *   {type:"amazonBedrock",...}, requiresOpenaiAuth }`.
 * - `account/rateLimits/read` -> `{ ordinaryUsageAllowed, rateLimits, rateLimitsByLimitId,
 *   rateLimitResetCredits, accountId, rateLimitUpsell }`. `usedPercent` is 0..100 (overage kept),
 *   `windowDurationMins` is minutes, `resetsAt` is Unix SECONDS (not milliseconds).
 * - Signed-out and non-ChatGPT auth are JSON-RPC `-32600` errors whose messages start with
 *   "codex account authentication required" / "chatgpt authentication required". Old servers answer
 *   the newer params with `-32600`/`-32602`, and the Codex TUI then retries once with null params.
 *
 * Deliberately omitted (the shared model has no safe place for them): `ordinaryUsageAllowed`,
 * `spendControlReached`, `rateLimitReachedType`, `rateLimitUpsell`, reset credits, and `credits`
 * (the same object repeats in every snapshot and its unit is unspecified; `unlimited` has no
 * numeric form). `individualLimit` keeps only its percentage: `limit`/`used` are decimal strings
 * with no stated currency, so no monetary measurement is made. `supportsLunaReserve` is NOT sent: it
 * lets the backend record experiment exposure, which a passive usage read must not trigger.
 */
export const CODEX_APP_SERVER_COMMAND = { command: 'codex', args: ['app-server'] } as const;
const PROVIDER_ID = 'openai-codex';
const MAX_IGNORED_MESSAGES = 2000;
const WEEK_MINUTES = 10_080;
/** Unix seconds beyond this are almost certainly milliseconds; refuse rather than guess. */
const MAX_PLAUSIBLE_RESET_SECONDS = 1e11;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** A matching JSON-RPC error response. */
class RpcError extends Error {
  constructor(readonly code: unknown, message: string) { super(message); }
}
class Malformed extends Error {}

function protocolFailure(message: string, cause?: unknown): HarnessCapabilityError {
  return new HarnessCapabilityError('parse-failure', message, cause);
}

/** Reads until the response for `expectedId`; ignores notifications, server requests and other ids. */
async function readResponse(session: HarnessCommandSession, expectedId: number): Promise<unknown> {
  for (let ignored = 0; ignored <= MAX_IGNORED_MESSAGES; ignored++) {
    const line = await session.readLine();
    if (line === null) throw new HarnessCapabilityError('command-failed', 'codex app-server closed before responding');
    if (!line.trim()) { ignored--; continue; }
    let message: unknown;
    try { message = JSON.parse(line); } catch (error) { throw protocolFailure('codex app-server sent invalid JSON', error); }
    if (!isObject(message)) throw protocolFailure('codex app-server sent a non-object message');
    if (typeof message.method === 'string' || message.id !== expectedId) continue;
    if (isObject(message.error)) throw new RpcError(message.error.code, typeof message.error.message === 'string' ? message.error.message : '');
    if ('result' in message) return message.result;
    throw protocolFailure('codex app-server response had neither result nor error');
  }
  throw new HarnessCapabilityError('command-failed', 'codex app-server sent too many unrelated messages');
}

class Rpc {
  private nextId = 1;
  constructor(private readonly session: HarnessCommandSession) {}
  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    await this.session.writeLine(JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) }));
    return readResponse(this.session, id);
  }
  notify(method: string): Promise<void> {
    return this.session.writeLine(JSON.stringify({ method }));
  }
}

/** Structured error codes/messages only; the raw server message never leaves this function. */
function failureFor(error: unknown): HarnessCapabilityError {
  if (error instanceof HarnessCapabilityError) return error;
  if (error instanceof RpcError) {
    if (error.code === -32600 && /^codex account authentication required/i.test(error.message)) {
      return new HarnessCapabilityError('unauthenticated', 'codex account is not signed in');
    }
    if (error.code === -32600 && /^chatgpt authentication required/i.test(error.message)) {
      return new HarnessCapabilityError('unsupported', 'codex is not using ChatGPT authentication');
    }
    return new HarnessCapabilityError('command-failed', 'codex app-server returned an error');
  }
  return new HarnessCapabilityError('command-failed', String(error), error);
}

function isOldServerRejection(error: unknown): boolean {
  return error instanceof RpcError && (error.code === -32600 || error.code === -32602)
    && !/^(?:codex account|chatgpt) authentication required/i.test(error.message);
}

export interface CodexAccountInfo { kind: 'chatgpt' | 'unknown'; email?: string; planType?: string }

function readAccount(result: unknown): CodexAccountInfo {
  if (!isObject(result)) throw protocolFailure('Unexpected account/read response');
  const { account } = result;
  if (account === null || account === undefined) {
    throw new HarnessCapabilityError(result.requiresOpenaiAuth === true ? 'unauthenticated' : 'unsupported',
      result.requiresOpenaiAuth === true ? 'codex account is not signed in' : 'codex has no account that exposes usage');
  }
  if (!isObject(account) || typeof account.type !== 'string') throw protocolFailure('Unexpected account in account/read response');
  if (account.type === 'chatgpt') return { kind: 'chatgpt', email: str(account.email), planType: str(account.planType) };
  if (account.type === 'apiKey' || account.type === 'amazonBedrock') {
    throw new HarnessCapabilityError('unsupported', 'codex is not using ChatGPT authentication');
  }
  return { kind: 'unknown' }; // future account type: let the rate-limit call prove support
}

const seconds = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= MAX_PLAUSIBLE_RESET_SECONDS) throw new Malformed();
  return Math.round(value * 1000);
};

function durationLabel(minutes: number): string {
  if (minutes === WEEK_MINUTES) return 'weekly';
  if (minutes % WEEK_MINUTES === 0) return `${minutes / WEEK_MINUTES} week`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day`;
  if (minutes % 60 === 0) return `${minutes / 60} hour`;
  return `${minutes} min`;
}

function snapshotMeasurements(key: string | undefined, snapshot: unknown, response: Json, account: CodexAccountInfo): HarnessUsageMeasurement[] {
  if (!isObject(snapshot)) throw new Malformed();
  const modelId = str(snapshot.normalModelSlug);
  let base = str(snapshot.limitName) ?? str(snapshot.limitId) ?? key ?? modelId ?? 'Codex';
  if (base.toLowerCase() === 'codex') base = 'Codex';
  const scope = {
    providerId: PROVIDER_ID,
    ...(str(response.accountId) ? { accountId: str(response.accountId) } : {}),
    ...(account.email ? { accountLabel: account.email } : {}),
    ...((str(snapshot.planType) ?? account.planType) ? { planLabel: str(snapshot.planType) ?? account.planType } : {}),
    ...(modelId ? { modelId } : {}),
  };
  const measurements: HarnessUsageMeasurement[] = [];
  for (const slot of ['primary', 'secondary'] as const) {
    const window = snapshot[slot];
    if (window === null || window === undefined) continue;
    if (!isObject(window)) throw new Malformed();
    const used = window.usedPercent;
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) throw new Malformed();
    const minutes = window.windowDurationMins;
    if (minutes !== null && minutes !== undefined && (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0)) throw new Malformed();
    const resetsAt = seconds(window.resetsAt);
    const label = typeof minutes === 'number' ? durationLabel(minutes) : undefined;
    measurements.push({
      kind: 'rate-limit', unit: 'percent', used, remaining: Math.max(0, 100 - used), limit: 100,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
      ...(label || resetsAt !== undefined ? { period: {
        ...(label ? { label } : {}),
        ...(resetsAt !== undefined ? { endsAt: resetsAt } : {}),
        ...(resetsAt !== undefined && typeof minutes === 'number' ? { startsAt: resetsAt - Math.round(minutes * 60_000) } : {}),
      } } : {}),
      scope, label: `${base} · ${label ?? `${slot} window`}`,
    });
  }
  const individual = snapshot.individualLimit;
  if (individual !== null && individual !== undefined) {
    if (!isObject(individual)) throw new Malformed();
    const remaining = individual.remainingPercent;
    if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) throw new Malformed();
    const resetsAt = seconds(individual.resetsAt);
    measurements.push({
      kind: 'allowance', unit: 'percent', used: 100 - remaining, remaining, limit: 100,
      ...(resetsAt !== undefined ? { resetsAt, period: { endsAt: resetsAt } } : {}),
      scope, label: `${base} · spend limit`,
    });
  }
  return measurements;
}

/**
 * `rateLimitsByLimitId` (every returned meter family) wins; the single legacy `rateLimits`
 * snapshot is used only when that map is absent/empty, so one meter is never counted twice.
 * Malformed snapshots are skipped while valid ones survive; if any were malformed and nothing
 * valid remains, the result is a parse-failure.
 */
export function parseCodexRateLimits(result: unknown, account: CodexAccountInfo): HarnessUsageMeasurement[] {
  if (!isObject(result)) throw protocolFailure('Unexpected account/rateLimits/read response');
  const byId = result.rateLimitsByLimitId;
  if (byId !== null && byId !== undefined && !isObject(byId)) throw protocolFailure('Unexpected rateLimitsByLimitId');
  const mapEntries = isObject(byId) ? Object.entries(byId).filter(([, value]) => value !== null && value !== undefined) : [];
  const entries: Array<[string | undefined, unknown]> = mapEntries.length > 0 ? mapEntries
    : (result.rateLimits !== null && result.rateLimits !== undefined ? [[undefined, result.rateLimits]] : []);
  if (entries.length === 0) throw protocolFailure('account/rateLimits/read returned no rate limits');
  const measurements: HarnessUsageMeasurement[] = [];
  let malformed = 0;
  for (const [key, snapshot] of entries) {
    try { measurements.push(...snapshotMeasurements(key, snapshot, result, account)); }
    catch (error) { if (!(error instanceof Malformed)) throw error; malformed++; }
  }
  if (malformed > 0 && measurements.length === 0) throw protocolFailure('codex rate limits were malformed');
  return measurements;
}

async function readUsage(session: HarnessCommandSession, clientInfo: HarnessUsageContext['clientInfo']): Promise<HarnessUsageSnapshot> {
  const rpc = new Rpc(session);
  try {
    // The initialize response must arrive before `initialized` is sent.
    await rpc.request('initialize', {
      clientInfo: { name: clientInfo?.name ?? 'clanker-grid', title: clientInfo?.title ?? 'Clanker Grid', version: clientInfo?.version ?? 'unknown' },
      capabilities: null,
    });
    await rpc.notify('initialized');
    const account = readAccount(await rpc.request('account/read', { refreshToken: false }));

    let result: unknown;
    try {
      try {
        result = await rpc.request('account/rateLimits/read', { excludeResetCreditDetails: true });
      } catch (error) {
        if (!isOldServerRejection(error)) throw error;
        result = await rpc.request('account/rateLimits/read', null); // legacy servers accept only null params
      }
    } catch (error) {
      // A future account type that cannot read limits has no usage, not a broken probe.
      if (account.kind === 'unknown' && error instanceof RpcError) throw new HarnessCapabilityError('unsupported', 'codex account type exposes no rate limits');
      throw error;
    }
    const measurements = parseCodexRateLimits(result, account);

    // Accept data only after the app-server shuts down cleanly.
    await session.closeInput();
    const exit = await session.wait();
    if (exit.exitCode !== 0) throw new HarnessCapabilityError('command-failed', `codex app-server exited with code ${exit.exitCode}`);
    return { observedAt: Date.now(), measurements };
  } catch (error) {
    throw failureFor(error);
  }
}

export const codexUsage: HarnessUsageCapability = {
  async get({ sessionExecutor, clientInfo }) {
    if (!sessionExecutor) throw new HarnessCapabilityError('unsupported', 'This environment cannot run interactive usage sessions');
    const session = await sessionExecutor.open({ ...CODEX_APP_SERVER_COMMAND, args: [...CODEX_APP_SERVER_COMMAND.args], timeoutMs: 30_000, maxOutputBytes: 512 * 1024 });
    try {
      return await readUsage(session, clientInfo);
    } finally {
      await session.dispose();
    }
  },
  // A live backend read per probe: one-minute freshness, a one-minute hard minimum, and a two
  // minute failure backoff (each failure also spawns app-server, locally or over SSH).
  refresh: { cacheTtlMs: 60_000, minimumProbeIntervalMs: 60_000, failureBackoffMs: 120_000 },
};
