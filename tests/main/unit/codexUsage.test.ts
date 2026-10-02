import { describe, expect, it, vi } from 'vitest';
import { codexUsage, parseCodexRateLimits, CODEX_APP_SERVER_COMMAND, type CodexAccountInfo } from '../../../src/main/harnesses/codex/usage';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { HarnessCapabilityError } from '../../../src/main/harnesses/types';
import type { HarnessCommandSession, HarnessCommandRequest } from '../../../src/main/harnesses/commandExecution';
import { validateUsageSnapshot, toRendererMeasurements } from '../../../src/main/usage/usageSnapshot';

type Msg = Record<string, unknown>;
interface Script {
  /** Called for each client message; returns server lines to emit (objects are JSON-encoded). */
  respond(message: Msg, sent: Msg[]): Array<Msg | string>;
  exit?: { exitCode: number; stderr?: string } | Error;
}

/** Deterministic fake of the bounded session seam: no processes, no network. */
function fakeSession(script: Script) {
  const sent: Msg[] = [];
  const queue: Array<string> = [];
  const events: string[] = [];
  let inputClosed = false;
  const session: HarnessCommandSession & { disposed: number } = {
    disposed: 0,
    async writeLine(line) {
      if (inputClosed) throw new HarnessCapabilityError('command-failed', 'closed');
      const message = JSON.parse(line) as Msg;
      sent.push(message);
      events.push(`write:${String(message.method)}`);
      for (const out of script.respond(message, sent)) queue.push(typeof out === 'string' ? out : JSON.stringify(out));
    },
    async readLine() { events.push('read'); return queue.shift() ?? null; },
    async closeInput() { inputClosed = true; events.push('closeInput'); },
    async wait() {
      events.push('wait');
      if (script.exit instanceof Error) throw script.exit;
      return { stderr: script.exit?.stderr ?? '', exitCode: script.exit?.exitCode ?? 0 };
    },
    async dispose() { this.disposed++; events.push('dispose'); },
  };
  return { session, sent, events };
}

const run = (script: Script, extra: { noSessionExecutor?: boolean } = {}) => {
  const fake = fakeSession(script);
  const opened: HarnessCommandRequest[] = [];
  const promise = codexUsage.get({
    executor: { run: vi.fn() } as never,
    ...(extra.noSessionExecutor ? {} : { sessionExecutor: { open: async (request) => { opened.push(request); return fake.session; } } }),
    transport: 'local', signal: new AbortController().signal,
    clientInfo: { name: 'clanker-grid', title: 'Clanker Grid', version: '9.9.9' },
  });
  return { ...fake, opened, promise };
};

const window = (usedPercent: number, windowDurationMins: number | null, resetsAt: number | null) => ({ usedPercent, windowDurationMins, resetsAt });
const snapshot = (overrides: Msg = {}) => ({
  limitId: 'codex', limitName: null, normalModelSlug: null, primary: window(31, 300, 1_790_954_635), secondary: window(68, 10_080, 1_791_388_806),
  credits: { hasCredits: true, unlimited: false, balance: '12.50' }, individualLimit: null, spendControlReached: false, planType: null, rateLimitReachedType: null, ...overrides,
});
const rateLimits = (extra: Msg = {}) => ({
  ordinaryUsageAllowed: true, rateLimits: snapshot(), rateLimitsByLimitId: { codex: snapshot() }, rateLimitResetCredits: { availableCount: 2, credits: null },
  accountId: 'acct-fake-1', rateLimitUpsell: null, futureField: { a: 1 }, ...extra,
});
const chatgpt = { account: { type: 'chatgpt', email: 'alice@example.invalid', planType: 'plus' }, requiresOpenaiAuth: true };

/** A well-behaved server; `handlers` override individual methods. */
function server(handlers: Partial<Record<string, (message: Msg, sent: Msg[]) => Array<Msg | string>>> = {}, exit?: Script['exit']): Script {
  return {
    exit,
    respond(message, sent) {
      const override = handlers[String(message.method)];
      if (override) return override(message, sent);
      switch (message.method) {
        case 'initialize': return [{ method: 'remoteControl/status/changed', params: {} }, { id: message.id, result: { userAgent: 'x' } }];
        case 'account/read': return [{ method: 'account/updated' }, { id: message.id, result: chatgpt }];
        case 'account/rateLimits/read': return [{ id: 777, result: 'unrelated' }, { method: 'account/rateLimits/updated' }, { id: message.id, result: rateLimits() }];
        default: return [];
      }
    },
  };
}
const rpcError = (id: unknown, code: number, message: string) => ({ id, error: { code, message } });

describe('Codex usage protocol', () => {
  it('is registered on the canonical provider', () => {
    expect(getHarnessProvider('codex').usage).toBe(codexUsage);
    expect(codexUsage.refresh).toEqual({ cacheTtlMs: 60_000, minimumProbeIntervalMs: 60_000, failureBackoffMs: 120_000 });
  });

  it('is unsupported without a session executor, and never uses one-shot run()', async () => {
    const executor = { run: vi.fn() };
    await expect(codexUsage.get({ executor: executor as never, transport: 'ssh', signal: new AbortController().signal })).rejects.toMatchObject({ kind: 'unsupported' });
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('opens exactly `codex app-server` with a bounded session and runs the handshake in order', async () => {
    const { promise, opened, sent, events } = run(server());
    const snapshotResult = await promise;
    expect(opened).toEqual([{ command: 'codex', args: ['app-server'], timeoutMs: 30_000, maxOutputBytes: 512 * 1024 }]);
    expect(CODEX_APP_SERVER_COMMAND.args).toEqual(['app-server']);
    expect(sent.map((m) => m.method)).toEqual(['initialize', 'initialized', 'account/read', 'account/rateLimits/read']);
    expect(sent[0]).toEqual({ id: 1, method: 'initialize', params: { clientInfo: { name: 'clanker-grid', title: 'Clanker Grid', version: '9.9.9' }, capabilities: null } });
    expect(sent[1]).toEqual({ method: 'initialized' }); // notification: no id, no params
    expect(sent[2]).toMatchObject({ method: 'account/read', params: { refreshToken: false } });
    expect(sent[3]).toMatchObject({ method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } });
    expect(JSON.stringify(sent[3])).not.toContain('supportsLunaReserve');
    // initialized only after the initialize response was read.
    expect(events.indexOf('write:initialized')).toBeGreaterThan(events.indexOf('read'));
    expect(snapshotResult.measurements).toHaveLength(2);
  });

  it('waits for the initialize response before sending `initialized`', async () => {
    const order: string[] = [];
    const script = server({
      initialize: (message) => { order.push('initialize'); return [{ method: 'noise' }, { method: 'noise2' }, { id: message.id, result: {} }]; },
      initialized: () => { order.push('initialized'); return []; },
    });
    await run(script).promise;
    expect(order).toEqual(['initialize', 'initialized']);
  });

  it('ignores notifications, server requests and unrelated response ids; ids are unique per request', async () => {
    const { promise, sent } = run(server({
      'account/read': (m) => [{ id: m.id, method: 'server/request', params: {} }, { id: 12345, result: {} }, { id: m.id, result: chatgpt }],
    }));
    await promise;
    expect(new Set(sent.filter((m) => m.id !== undefined).map((m) => m.id)).size).toBe(3);
  });

  it('rejects a matching JSON-RPC error without leaking its text', async () => {
    const { promise } = run(server({ initialize: (m) => [rpcError(m.id, -32000, 'secret detail token=sk-abc')] }));
    const error = await promise.catch((e) => e);
    expect(error).toMatchObject({ kind: 'command-failed' });
    expect(error.message).not.toContain('sk-abc');
  });

  it.each([
    ['malformed JSON', ['{not json']], ['array', ['[1,2]']], ['string', ['"x"']], ['number', ['5']],
  ])('rejects %s from the server as parse-failure', async (_name, lines) => {
    const { promise } = run(server({ initialize: () => lines }));
    await expect(promise).rejects.toMatchObject({ kind: 'parse-failure' });
  });
  it('rejects a matching message that has neither result nor error', async () => {
    const { promise } = run(server({ initialize: (m) => [{ id: m.id }] }));
    await expect(promise).rejects.toMatchObject({ kind: 'parse-failure' });
  });
  it('rejects EOF before the expected response', async () => {
    for (const method of ['initialize', 'account/read', 'account/rateLimits/read']) {
      const { promise } = run(server({ [method]: () => [{ method: 'only-noise' }] }));
      await expect(promise, method).rejects.toMatchObject({ kind: 'command-failed' });
    }
  });

  it('requires a clean shutdown (closeInput then wait) before returning data', async () => {
    const { promise, events } = run(server());
    await promise;
    const tail = events.slice(events.indexOf('closeInput'));
    expect(tail).toEqual(['closeInput', 'wait', 'dispose']);
  });
  it('fails a valid-looking response when the app-server then exits non-zero', async () => {
    const { promise } = run(server({}, { exitCode: 3, stderr: 'token=sk-secret' }));
    const error = await promise.catch((e) => e);
    expect(error).toMatchObject({ kind: 'command-failed' });
    expect(error.message).not.toContain('sk-secret');
  });
  it.each(['transport-failure', 'timeout', 'output-limit', 'aborted'] as const)('fails when the session then reports %s', async (kind) => {
    const { promise } = run(server({}, new HarnessCapabilityError(kind, 'x')));
    await expect(promise).rejects.toMatchObject({ kind });
  });
  it('always disposes the session, on success and every failure path', async () => {
    const results = [run(server()), run(server({ initialize: () => [] })), run(server({}, { exitCode: 1 })), run(server({ 'account/read': (m) => [{ id: m.id, result: { account: null, requiresOpenaiAuth: true } }] }))];
    for (const result of results) { await result.promise.catch(() => undefined); expect(result.session.disposed).toBe(1); }
  });
});

describe('Codex rate-limit compatibility retry', () => {
  const calls = (script: Script) => { const r = run(script); return r; };
  it.each([-32600, -32602])('retries once with null params after %s, using a new request id', async (code) => {
    let count = 0;
    const { promise, sent } = calls(server({ 'account/rateLimits/read': (m) => (++count === 1 ? [rpcError(m.id, code, 'invalid params')] : [{ id: m.id, result: rateLimits() }]) }));
    expect((await promise).measurements).toHaveLength(2);
    const reads = sent.filter((m) => m.method === 'account/rateLimits/read');
    expect(reads).toHaveLength(2);
    expect(reads[0].params).toEqual({ excludeResetCreditDetails: true });
    expect(reads[1].params).toBeNull();
    expect(reads[1].id).not.toBe(reads[0].id);
  });
  it.each([
    ['method not found', -32601, 'nope', 'command-failed'],
    ['server error', -32000, 'backend down', 'command-failed'],
    ['internal error', -32603, 'failed to fetch codex rate limits', 'command-failed'],
    ['signed-out auth error', -32600, 'codex account authentication required to read rate limits', 'unauthenticated'],
    ['non-ChatGPT auth error', -32600, 'chatgpt authentication required to read rate limits', 'unsupported'],
  ])('does not retry after %s', async (_name, code, message, kind) => {
    const { promise, sent } = calls(server({ 'account/rateLimits/read': (m) => [rpcError(m.id, code, message)] }));
    await expect(promise).rejects.toMatchObject({ kind });
    expect(sent.filter((m) => m.method === 'account/rateLimits/read')).toHaveLength(1);
  });
  it('does not retry after EOF, a parse failure, or a transport failure', async () => {
    for (const handler of [() => [], () => ['{bad']] as Array<() => string[]>) {
      const { promise, sent } = calls(server({ 'account/rateLimits/read': handler }));
      await promise.catch(() => undefined);
      expect(sent.filter((m) => m.method === 'account/rateLimits/read')).toHaveLength(1);
    }
    const { promise, sent } = calls({ ...server(), respond: (m, s) => { if (m.method === 'account/rateLimits/read') throw new HarnessCapabilityError('transport-failure', 'ssh died'); return server().respond(m, s); } });
    await expect(promise).rejects.toMatchObject({ kind: 'transport-failure' });
    expect(sent.filter((m) => m.method === 'account/rateLimits/read')).toHaveLength(1);
  });
  it('fails (classified) if the legacy retry also fails', async () => {
    const { promise } = calls(server({ 'account/rateLimits/read': (m) => [rpcError(m.id, -32602, 'still invalid')] }));
    await expect(promise).rejects.toMatchObject({ kind: 'command-failed' });
  });
});

describe('Codex account state', () => {
  const withAccount = (result: unknown) => run(server({ 'account/read': (m) => [{ id: m.id, result }] }));
  it('continues for a ChatGPT account', async () => {
    expect((await withAccount(chatgpt).promise).measurements.length).toBeGreaterThan(0);
  });
  it('signed out + requiresOpenaiAuth -> unauthenticated, without reading limits', async () => {
    const { promise, sent } = withAccount({ account: null, requiresOpenaiAuth: true });
    await expect(promise).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(sent.some((m) => m.method === 'account/rateLimits/read')).toBe(false);
  });
  it('no account but auth not required -> unsupported', async () => {
    await expect(withAccount({ account: null, requiresOpenaiAuth: false }).promise).rejects.toMatchObject({ kind: 'unsupported' });
  });
  it.each([{ type: 'apiKey' }, { type: 'amazonBedrock', usesCodexManagedCredentials: true }])('API-key/other managed auth (%j) is unsupported, not unauthenticated', async (account) => {
    const { promise, sent } = withAccount({ account, requiresOpenaiAuth: true });
    await expect(promise).rejects.toMatchObject({ kind: 'unsupported' });
    expect(sent.some((m) => m.method === 'account/rateLimits/read')).toBe(false);
  });
  it('an unknown future account type is tried, and is unsupported if limits cannot be read', async () => {
    const future = { account: { type: 'enterpriseSso' }, requiresOpenaiAuth: false };
    expect((await withAccount(future).promise).measurements.length).toBeGreaterThan(0);
    const failing = run(server({ 'account/read': (m) => [{ id: m.id, result: future }], 'account/rateLimits/read': (m) => [rpcError(m.id, -32000, 'nope')] }));
    await expect(failing.promise).rejects.toMatchObject({ kind: 'unsupported' });
  });
  it('rejects a malformed account response', async () => {
    for (const result of ['x', { account: 5 }, { account: { email: 'a' } }]) await expect(withAccount(result).promise).rejects.toMatchObject({ kind: 'parse-failure' });
  });
});

describe('Codex rate-limit normalization', () => {
  const chatgptAccount: CodexAccountInfo = { kind: 'chatgpt', email: 'alice@example.invalid', planType: 'plus' };
  const parse = (result: unknown, account = chatgptAccount) => parseCodexRateLimits(result, account);

  it('normalizes the legacy single snapshot, converting reset seconds to milliseconds', () => {
    const [five, week] = parse({ rateLimits: snapshot(), rateLimitsByLimitId: null, accountId: 'acct-fake-1' });
    expect(five).toEqual({
      kind: 'rate-limit', unit: 'percent', used: 31, remaining: 69, limit: 100, resetsAt: 1_790_954_635_000,
      period: { label: '5 hour', endsAt: 1_790_954_635_000, startsAt: 1_790_954_635_000 - 300 * 60_000 },
      scope: { providerId: 'openai-codex', accountId: 'acct-fake-1', accountLabel: 'alice@example.invalid', planLabel: 'plus' },
      label: 'Codex · 5 hour',
    });
    expect(week).toMatchObject({ label: 'Codex · weekly', used: 68, remaining: 32, resetsAt: 1_791_388_806_000, period: { label: 'weekly' } });
  });
  it('seconds-vs-milliseconds regression: a value that is already milliseconds is refused, not trusted', () => {
    expect(parse({ rateLimits: snapshot({ secondary: null }) })[0].resetsAt).toBe(1_790_954_635_000);
    expect(parse({ rateLimits: snapshot({ secondary: null }) })[0].resetsAt! / 1000).toBeCloseTo(1_790_954_635, 0);
    expect(() => parse({ rateLimits: snapshot({ primary: window(5, 300, 1_790_954_635_000), secondary: null }) })).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  });
  it('uses the multi-limit map and suppresses the duplicate legacy snapshot', () => {
    const m = parse({ rateLimits: snapshot(), rateLimitsByLimitId: { codex: snapshot() } });
    expect(m).toHaveLength(2);
  });
  it('keeps every independent meter family, labelled by limitName/limitId and carrying model and per-meter plan', () => {
    const m = parse({ accountId: 'a', rateLimitsByLimitId: {
      codex: snapshot(),
      codex_other: snapshot({ limitId: 'codex_other', limitName: 'Spark', normalModelSlug: 'spark-model', planType: 'pro', primary: window(10, 300, 1_790_954_635), secondary: window(20, 10_080, 1_791_388_806) }),
    } });
    expect(m.map((x) => x.label)).toEqual(['Codex · 5 hour', 'Codex · weekly', 'Spark · 5 hour', 'Spark · weekly']);
    expect(m[0].scope?.planLabel).toBe('plus'); // account plan when the meter has none
    expect(m[2].scope).toMatchObject({ planLabel: 'pro', modelId: 'spark-model' }); // meter plan wins
  });
  it('handles primary-only, secondary-only, unknown durations and missing resets', () => {
    expect(parse({ rateLimits: snapshot({ secondary: null }) })).toHaveLength(1);
    expect(parse({ rateLimits: snapshot({ primary: null }) })[0].label).toBe('Codex · weekly');
    const m = parse({ rateLimits: snapshot({ primary: window(5, 90, null), secondary: window(6, 60 * 24 * 3, 1_790_954_635) }) });
    expect(m[0].label).toBe('Codex · 90 min');
    expect(m[0]).not.toHaveProperty('resetsAt');
    expect(m[1].label).toBe('Codex · 3 day');
    const noDuration = parse({ rateLimits: snapshot({ primary: window(5, null, 1_790_954_635), secondary: null }) })[0];
    expect(noDuration.label).toBe('Codex · primary window');
    expect(noDuration.period).toEqual({ endsAt: 1_790_954_635_000 });
  });
  it('does not infer durations from primary/secondary naming', () => {
    const m = parse({ rateLimits: snapshot({ primary: window(5, 10_080, 1_790_954_635), secondary: window(6, 300, 1_790_954_635) }) });
    expect(m.map((x) => x.period?.label)).toEqual(['weekly', '5 hour']);
  });
  it('keeps 0, 100 and overage', () => {
    const m = parse({ rateLimits: snapshot({ primary: window(0, 300, 1), secondary: window(100, 300, 1) }) });
    expect([m[0].used, m[0].remaining, m[1].used, m[1].remaining]).toEqual([0, 100, 100, 0]);
    expect(parse({ rateLimits: snapshot({ primary: window(130, 300, 1), secondary: null }) })[0]).toMatchObject({ used: 130, remaining: 0 });
  });
  it('omits identity that is absent and ignores unknown fields and null optionals', () => {
    const m = parse({ rateLimits: { ...snapshot({ planType: null }), extra: 1 }, accountId: null }, { kind: 'unknown' });
    expect(m[0].scope).toEqual({ providerId: 'openai-codex' });
    expect(JSON.stringify(m)).not.toMatch(/extra|futureField/);
  });
  it('makes no credit measurement (credits repeat per snapshot and have no safe unit)', () => {
    const m = parse({ rateLimitsByLimitId: { a: snapshot({ credits: { hasCredits: true, unlimited: true, balance: '9999999' } }), b: snapshot() } });
    expect(m.every((x) => x.unit === 'percent')).toBe(true);
    expect(JSON.stringify(m)).not.toMatch(/9999999|12\.50/);
  });
  it('represents individualLimit only as its percentage, never as money', () => {
    const m = parse({ rateLimits: snapshot({ primary: null, secondary: null, individualLimit: { limit: '100.00', used: '30.00', remainingPercent: 70, resetsAt: 1_790_954_635 } }) });
    expect(m).toEqual([expect.objectContaining({ kind: 'allowance', unit: 'percent', used: 30, remaining: 70, limit: 100, resetsAt: 1_790_954_635_000, label: 'Codex · spend limit' })]);
    expect(JSON.stringify(m)).not.toMatch(/usd|100\.00|30\.00/);
  });
  it('skips a malformed meter when others are valid, but fails when nothing valid remains', () => {
    const ok = snapshot();
    expect(parse({ rateLimitsByLimitId: { bad: snapshot({ primary: window(-1, 300, 1) }), also: 'x', good: ok } })).toHaveLength(2);
    for (const bad of [
      { rateLimitsByLimitId: { a: 'x' } }, { rateLimits: snapshot({ primary: { usedPercent: '5', windowDurationMins: 300, resetsAt: 1 } }) },
      { rateLimits: snapshot({ primary: window(Infinity as number, 300, 1) }) }, { rateLimits: snapshot({ primary: window(5, -3, 1) }) },
      { rateLimits: snapshot({ primary: window(5, 300, 0) }) }, { rateLimits: snapshot({ primary: 5 }) },
      { rateLimits: snapshot({ primary: null, secondary: null, individualLimit: { remainingPercent: 150, resetsAt: 1 } }) },
    ]) expect(() => parse(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  });
  it('rejects unusable roots and empty results', () => {
    for (const bad of [null, 'x', [], {}, { rateLimits: null, rateLimitsByLimitId: {} }, { rateLimitsByLimitId: 5 }]) {
      expect(() => parse(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    }
  });
  it('a snapshot with no windows is a legitimate empty meter, not corruption', () => {
    expect(parse({ rateLimits: snapshot({ primary: null, secondary: null }) })).toEqual([]);
  });
});

describe('Codex through the shared boundary', () => {
  it('keeps accountId in main and strips it for the renderer; observedAt is the probe completion time', async () => {
    const before = Date.now();
    const result = await run(server()).promise;
    const internal = validateUsageSnapshot(result);
    expect(internal.observedAt).toBeGreaterThanOrEqual(before);
    expect(internal.measurements[0].scope?.accountId).toBe('acct-fake-1');
    const rendered = JSON.stringify(toRendererMeasurements(internal));
    expect(rendered).not.toContain('acct-fake-1');
    expect(rendered).toContain('alice@example.invalid');
  });
});
