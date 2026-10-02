import { randomUUID } from 'node:crypto';
import {
  HarnessCapabilityError,
  type HarnessUsageCapability,
  type HarnessUsageMeasurement,
  type HarnessUsageSnapshot,
} from '../types';
import type { HarnessCommandRequest, HarnessCommandSession } from '../commandExecution';
import { parseOffsetTimestamp } from '../usageParsing';

/**
 * Claude usage via Claude Code's stream-json CONTROL protocol (verified against claude 2.1.287,
 * @anthropic-ai/claude-agent-sdk 0.3.287 types/transport, T3 Code's probe, and live runs). The
 * Agent SDK is deliberately not imported: it would spawn a local Claude Code and bypass SSH
 * environments. Clanker speaks the same wire protocol through `context.sessionExecutor`.
 *
 * - argv mirrors the SDK transport (`--output-format stream-json --verbose --input-format
 *   stream-json`, no `--print`; verified to work) plus the SDK flags for an isolated probe:
 *   `--no-session-persistence`, `--settings {"disableAllHooks":true}` (no user/project/local/
 *   Clanker hooks), `--mcp-config {"mcpServers":{}}` + `--strict-mcp-config` (no configured MCP
 *   servers), and env `ENABLE_CLAUDEAI_MCP_SERVERS=false`, `CLAUDE_CODE_AUTO_CONNECT_IDE=0`,
 *   `CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL=1`. `--bare` is NOT used: it skips OAuth/keychain. Account
 *   selection variables (CLAUDE_CONFIG_DIR, API keys, Bedrock/Vertex) are never touched.
 * - NO-TURN: only `control_request` frames (`initialize`, then `get_usage`) are ever written; never a
 *   `user` message or prompt. Inbound `assistant`/`user`/`result`/`stream_event` frames (structural
 *   evidence a turn ran) or any inbound `control_request` (permission/hook/MCP asks, which are
 *   never granted) fail the probe.
 * - `initialize` -> `control_response{ response:{ subtype:"success", request_id, response:{ account:
 *   {email?,organization?,subscriptionType?,tokenSource?,apiKeySource?,apiProvider?} } } }`.
 *   Live-verified signed-out: `{tokenSource:"none"}`; API key: `apiKeySource:"ANTHROPIC_API_KEY"`.
 * - `get_usage` (`skip_behaviors:true` is documented in the SDK types, so the transcript scan is
 *   skipped) -> `{ session, subscription_type, rate_limits_available, rate_limits:{ five_hour,
 *   seven_day, seven_day_oauth_apps, seven_day_opus, seven_day_sonnet: {utilization (0-100 percent),
 *   resets_at (ISO)}, model_scoped:[{display_name,utilization,resets_at}], extra_usage, ... } }`.
 *   EXPERIMENTAL upstream; additive fields (including undocumented codename windows and `limits[]`)
 *   are ignored.
 */
export const CLAUDE_USAGE_ARGS = [
  '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json',
  '--no-session-persistence',
  '--settings', '{"disableAllHooks":true}',
  '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config',
] as const;
export const CLAUDE_USAGE_ENV = {
  ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
  CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
  CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1',
} as const;
const PROVIDER_ID = 'anthropic-claude';
const MAX_IGNORED_MESSAGES = 2000;
const SESSION_MINUTES = 300;
const WEEK_MINUTES = 10_080;
/** Frames that only exist when a model turn is running. */
const TURN_FRAME_TYPES = new Set(['assistant', 'user', 'result', 'stream_event']);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

class ControlError extends Error {}
class Malformed extends Error {}

const protocolFailure = (message: string, cause?: unknown) => new HarnessCapabilityError('parse-failure', message, cause);

async function readControlResponse(session: HarnessCommandSession, requestId: string): Promise<Json> {
  for (let ignored = 0; ignored <= MAX_IGNORED_MESSAGES; ignored++) {
    const line = await session.readLine();
    if (line === null) throw new HarnessCapabilityError('command-failed', 'claude closed before responding');
    if (!line.trim()) { ignored--; continue; }
    let message: unknown;
    try { message = JSON.parse(line); } catch (error) { throw protocolFailure('claude sent invalid JSON', error); }
    if (!isObject(message)) throw protocolFailure('claude sent a non-object message');
    const type = message.type;
    if (type === 'control_request') throw new HarnessCapabilityError('command-failed', 'claude asked the host for something during a usage probe');
    if (typeof type === 'string' && TURN_FRAME_TYPES.has(type)) throw new HarnessCapabilityError('command-failed', 'claude appears to have started a model turn');
    if (type !== 'control_response' || !isObject(message.response) || message.response.request_id !== requestId) continue;
    const { response } = message;
    if (response.subtype === 'error') throw new ControlError('control error');
    if (response.subtype !== 'success' || !isObject(response.response)) throw protocolFailure('claude control response had an unexpected shape');
    return response.response as Json;
  }
  throw new HarnessCapabilityError('command-failed', 'claude sent too many unrelated messages');
}

function controlRequest(subtype: string, extra: Json = {}): { id: string; line: string } {
  const id = `clanker-${subtype}-${randomUUID()}`;
  return { id, line: JSON.stringify({ type: 'control_request', request_id: id, request: { subtype, ...extra } }) };
}

interface ClaudeAccount { email?: string; subscriptionType?: string }

/** Conservative, structured classification only (live-verified account shapes). */
export function classifyClaudeAccount(initResponse: unknown): ClaudeAccount {
  if (!isObject(initResponse)) throw protocolFailure('Unexpected initialize response');
  const account = initResponse.account;
  if (account === undefined || account === null) return {}; // ambiguous: let get_usage decide
  if (!isObject(account)) throw protocolFailure('Unexpected account in initialize response');
  const provider = str(account.apiProvider);
  if (provider && provider !== 'firstParty') throw new HarnessCapabilityError('unsupported', 'claude is using a third-party provider');
  const apiKeySource = str(account.apiKeySource);
  if (apiKeySource && apiKeySource.toLowerCase() !== 'none') throw new HarnessCapabilityError('unsupported', 'claude is using an API key');
  const email = str(account.email);
  const subscriptionType = str(account.subscriptionType);
  if (str(account.tokenSource)?.toLowerCase() === 'none' && !email && !subscriptionType) {
    throw new HarnessCapabilityError('unauthenticated', 'claude is not signed in');
  }
  return { email, subscriptionType };
}

const KNOWN_PLANS: Record<string, string> = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', free: 'Free' };
/** 'pro' -> 'Pro'; the init display form 'Claude Pro' -> 'Pro'; unknown values keep their words. */
export function claudePlanLabel(value: string | undefined): string | undefined {
  const text = str(value);
  if (!text) return undefined;
  const bare = text.replace(/^claude\s+/i, '');
  return KNOWN_PLANS[bare.toLowerCase()] ?? `${bare.charAt(0).toUpperCase()}${bare.slice(1)}`;
}

interface WindowSpec { key: string; label: string; minutes?: number; modelId?: string; weekly: boolean }
const WINDOWS: readonly WindowSpec[] = [
  { key: 'five_hour', label: '5 hour', minutes: SESSION_MINUTES, weekly: false },
  { key: 'seven_day', label: 'weekly', minutes: WEEK_MINUTES, weekly: true },
  { key: 'seven_day_oauth_apps', label: 'weekly · OAuth apps', minutes: WEEK_MINUTES, weekly: true },
  { key: 'seven_day_opus', label: 'weekly · Opus', minutes: WEEK_MINUTES, modelId: 'opus', weekly: true },
  { key: 'seven_day_sonnet', label: 'weekly · Sonnet', minutes: WEEK_MINUTES, modelId: 'sonnet', weekly: true },
];

function windowMeasurement(raw: unknown, label: string, minutes: number | undefined, scope: HarnessUsageMeasurement['scope'], periodLabel: string): HarnessUsageMeasurement | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (!isObject(raw)) throw new Malformed();
  const used = raw.utilization;
  if (used === null || used === undefined) return undefined; // no number to show
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) throw new Malformed();
  const reset = raw.resets_at;
  if (reset !== null && reset !== undefined && typeof reset !== 'string') throw new Malformed();
  const resetsAt = parseOffsetTimestamp(reset);
  return {
    kind: 'rate-limit', unit: 'percent', used, remaining: Math.max(0, 100 - used), limit: 100, // already 0-100, not a fraction
    ...(resetsAt !== undefined ? { resetsAt } : {}),
    period: {
      label: periodLabel,
      ...(resetsAt !== undefined ? { endsAt: resetsAt } : {}),
      ...(resetsAt !== undefined && minutes ? { startsAt: resetsAt - minutes * 60_000 } : {}),
    },
    scope, label: `Claude · ${label}`,
  };
}

/**
 * Pure normalization of a `get_usage` response. `rate_limits_available:false` means plan limits
 * do not apply (API key/Bedrock/Vertex...) -> `unsupported`, never an empty ok snapshot.
 * Malformed individual windows are skipped; if any were malformed and nothing valid remains,
 * the result is a parse-failure. `session`, `behaviors`, `extra_usage` (scale unverified, money
 * in minor units) and unknown/codename windows are intentionally not normalized.
 */
export function parseClaudeUsage(response: unknown, account: ClaudeAccount = {}): HarnessUsageMeasurement[] {
  if (!isObject(response)) throw protocolFailure('Unexpected get_usage response');
  const available = response.rate_limits_available;
  if (typeof available !== 'boolean') throw protocolFailure('get_usage rate_limits_available is not a boolean');
  if (!available) throw new HarnessCapabilityError('unsupported', 'Claude plan limits do not apply to this session');
  const limits = response.rate_limits;
  if (!isObject(limits)) throw protocolFailure('get_usage claimed limits but returned none');

  const plan = claudePlanLabel(str(response.subscription_type) ?? account.subscriptionType);
  const baseScope = {
    providerId: PROVIDER_ID,
    ...(account.email ? { accountLabel: account.email } : {}), // a label only; never an accountId
    ...(plan ? { planLabel: plan } : {}),
  };
  const measurements: HarnessUsageMeasurement[] = [];
  const used = new Set<string>();
  let malformed = 0;
  const add = (build: () => HarnessUsageMeasurement | undefined) => {
    try {
      const measurement = build();
      if (measurement && !used.has(measurement.label ?? '')) { used.add(measurement.label ?? ''); measurements.push(measurement); }
    } catch (error) { if (!(error instanceof Malformed)) throw error; malformed++; }
  };

  for (const spec of WINDOWS) {
    add(() => windowMeasurement(limits[spec.key], spec.label, spec.minutes, spec.modelId ? { ...baseScope, modelId: spec.modelId } : baseScope, spec.minutes === WEEK_MINUTES ? 'weekly' : '5 hour'));
  }
  const scoped = limits.model_scoped;
  if (scoped !== undefined && scoped !== null) {
    if (!Array.isArray(scoped)) malformed++;
    else for (const entry of scoped) {
      // display_name is presentation text only: it names the row, never becomes a modelId.
      add(() => {
        if (!isObject(entry) || !str(entry.display_name)) throw new Malformed();
        return windowMeasurement(entry, `weekly · ${str(entry.display_name)}`, WEEK_MINUTES, baseScope, 'weekly');
      });
    }
  }
  if (malformed > 0 && measurements.length === 0) throw protocolFailure('claude usage windows were malformed');
  return measurements;
}

async function readUsage(session: HarnessCommandSession): Promise<HarnessUsageSnapshot> {
  try {
    const init = controlRequest('initialize');
    await session.writeLine(init.line);
    const account = classifyClaudeAccount(await readControlResponse(session, init.id));

    // Only after a successful initialize response.
    const usage = controlRequest('get_usage', { skip_behaviors: true });
    await session.writeLine(usage.line);
    const measurements = parseClaudeUsage(await readControlResponse(session, usage.id), account);

    // Data is accepted only after claude shuts down cleanly.
    await session.closeInput();
    const exit = await session.wait();
    if (exit.exitCode !== 0) throw new HarnessCapabilityError('command-failed', `claude exited with code ${exit.exitCode}`);
    return { observedAt: Date.now(), measurements };
  } catch (error) {
    if (error instanceof HarnessCapabilityError) throw error;
    if (error instanceof ControlError) throw new HarnessCapabilityError('command-failed', 'claude returned a control error');
    throw new HarnessCapabilityError('command-failed', String(error), error);
  }
}

export const claudeUsage: HarnessUsageCapability = {
  async get({ sessionExecutor }) {
    if (!sessionExecutor) throw new HarnessCapabilityError('unsupported', 'This environment cannot run interactive usage sessions');
    const request: HarnessCommandRequest = {
      command: 'claude', args: [...CLAUDE_USAGE_ARGS], env: { ...CLAUDE_USAGE_ENV }, timeoutMs: 30_000, maxOutputBytes: 512 * 1024,
    };
    const session = await sessionExecutor.open(request);
    try {
      return await readUsage(session);
    } finally {
      await session.dispose();
    }
  },
  // `get_usage` is experimental upstream and reads the subscription endpoint: one-minute freshness
  // and hard minimum, and a somewhat longer failure backoff because the interface may change.
  refresh: { cacheTtlMs: 60_000, minimumProbeIntervalMs: 60_000, failureBackoffMs: 180_000 },
};
