import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { claudeUsage, parseClaudeUsage, classifyClaudeAccount, claudePlanLabel, CLAUDE_USAGE_ARGS, CLAUDE_USAGE_ENV } from '../../../src/main/harnesses/claude/usage';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { HarnessCapabilityError } from '../../../src/main/harnesses/types';
import type { HarnessCommandRequest, HarnessCommandSession } from '../../../src/main/harnesses/commandExecution';
import { validateUsageSnapshot, toRendererMeasurements } from '../../../src/main/usage/usageSnapshot';

type Msg = Record<string, unknown>;
interface Script { respond(message: Msg, sent: Msg[]): Array<Msg | string>; exit?: { exitCode: number; stderr?: string } | Error }

function fakeSession(script: Script) {
  const sent: Msg[] = []; const queue: string[] = []; const events: string[] = []; const raw: string[] = [];
  let closed = false;
  const session: HarnessCommandSession & { disposed: number } = {
    disposed: 0,
    async writeLine(line) {
      if (closed) throw new HarnessCapabilityError('command-failed', 'closed');
      raw.push(line);
      const message = JSON.parse(line) as Msg;
      sent.push(message); events.push(`write:${String((message.request as Msg | undefined)?.subtype)}`);
      for (const out of script.respond(message, sent)) queue.push(typeof out === 'string' ? out : JSON.stringify(out));
    },
    async readLine() { events.push('read'); return queue.shift() ?? null; },
    async closeInput() { closed = true; events.push('closeInput'); },
    async wait() { events.push('wait'); if (script.exit instanceof Error) throw script.exit; return { stderr: script.exit?.stderr ?? '', exitCode: script.exit?.exitCode ?? 0 }; },
    async dispose() { this.disposed++; events.push('dispose'); },
  };
  return { session, sent, events, raw };
}
const run = (script: Script, noSessionExecutor = false) => {
  const fake = fakeSession(script);
  const opened: HarnessCommandRequest[] = [];
  const executor = { run: vi.fn() };
  const promise = claudeUsage.get({
    executor: executor as never,
    ...(noSessionExecutor ? {} : { sessionExecutor: { open: async (request) => { opened.push(request); return fake.session; } } }),
    transport: 'ssh', signal: new AbortController().signal,
  });
  return { ...fake, opened, executor, promise };
};

const ok = (message: Msg, response: unknown): Msg => ({ type: 'control_response', response: { subtype: 'success', request_id: (message as { request_id: string }).request_id, response } });
const err = (message: Msg, text = 'secret detail token=sk-abc'): Msg => ({ type: 'control_response', response: { subtype: 'error', request_id: (message as { request_id: string }).request_id, error: text } });
const subscriber = { account: { email: 'alice@example.invalid', organization: 'Org Fake', subscriptionType: 'Claude Pro', apiProvider: 'firstParty' } };
const w = (utilization: number | null, resets_at: string | null = '2026-10-02T15:30:00.357531+00:00') => ({ utilization, resets_at });
const usage = (overrides: Msg = {}) => ({
  session: { total_cost_usd: 1.5, model_usage: { m: {} } }, subscription_type: 'pro', rate_limits_available: true, behaviors: null,
  rate_limits: { five_hour: w(42), seven_day: w(6, '2026-10-04T21:00:00+00:00'), seven_day_opus: null, model_scoped: [], extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 100, utilization: 2, currency: 'EUR' }, tangelo: w(10), limits: [{ kind: 'session' }], future: 1 },
  ...overrides,
});

function server(handlers: Partial<Record<string, (message: Msg, sent: Msg[]) => Array<Msg | string>>> = {}, exit?: Script['exit']): Script {
  return {
    exit,
    respond(message, sent) {
      const subtype = String((message.request as Msg | undefined)?.subtype);
      const override = handlers[subtype];
      if (override) return override(message, sent);
      if (subtype === 'initialize') return [{ type: 'system', subtype: 'status' }, { type: 'control_response', response: { subtype: 'success', request_id: 'other', response: {} } }, ok(message, subscriber)];
      if (subtype === 'get_usage') return [{ type: 'keep_alive' }, ok(message, usage())];
      return [];
    },
  };
}

describe('Claude usage protocol and no-turn safety', () => {
  it('is registered on the canonical provider', () => {
    expect(getHarnessProvider('claude').usage).toBe(claudeUsage);
    expect(claudeUsage.refresh).toEqual({ cacheTtlMs: 60_000, minimumProbeIntervalMs: 60_000, failureBackoffMs: 180_000 });
  });
  it('is unsupported without a session executor and never uses one-shot run()', async () => {
    const { promise, executor } = run(server(), true);
    await expect(promise).rejects.toMatchObject({ kind: 'unsupported' });
    expect(executor.run).not.toHaveBeenCalled();
  });
  it('opens exactly the verified isolated claude command with a bounded session', async () => {
    const { promise, opened, executor } = run(server());
    await promise;
    expect(opened).toEqual([{ command: 'claude', args: [...CLAUDE_USAGE_ARGS], env: { ...CLAUDE_USAGE_ENV }, timeoutMs: 30_000, maxOutputBytes: 512 * 1024 }]);
    expect(executor.run).not.toHaveBeenCalled();
  });
  it('sends only initialize then get_usage control requests, with unique ids, and never a user/prompt frame', async () => {
    const { promise, sent, raw } = run(server());
    await promise;
    expect(sent.map((m) => [m.type, (m.request as Msg).subtype])).toEqual([['control_request', 'initialize'], ['control_request', 'get_usage']]);
    expect(new Set(sent.map((m) => m.request_id)).size).toBe(2);
    expect(sent[0].request).toEqual({ subtype: 'initialize' });
    expect(sent[1].request).toEqual({ subtype: 'get_usage', skip_behaviors: true });
    for (const line of raw) expect(line).not.toMatch(/"type":"user"|"message"|"prompt"|"content"/);
    expect(raw.every((line) => (JSON.parse(line) as Msg).type === 'control_request')).toBe(true);
  });
  it('sends get_usage only after the initialize response', async () => {
    const { promise, events } = run(server());
    await promise;
    expect(events.indexOf('write:get_usage')).toBeGreaterThan(events.indexOf('read'));
    expect(events.slice(events.indexOf('closeInput'))).toEqual(['closeInput', 'wait', 'dispose']);
  });
  it('ignores unrelated system/keep-alive frames and control responses for other ids', async () => {
    const result = await run(server({ get_usage: (m) => [{ type: 'system', subtype: 'x' }, { type: 'control_response', response: { subtype: 'success', request_id: 'zzz', response: { rate_limits_available: false } } }, ok(m, usage())] })).promise;
    expect(result.measurements.length).toBe(2);
  });
  it.each([
    ['assistant', { type: 'assistant', message: {} }], ['user', { type: 'user' }], ['result', { type: 'result' }], ['stream_event', { type: 'stream_event' }],
  ])('fails when a %s frame shows a model turn started', async (_name, frame) => {
    await expect(run(server({ get_usage: (m) => [frame, ok(m, usage())] })).promise).rejects.toMatchObject({ kind: 'command-failed' });
  });
  it.each([
    ['permission', { type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }],
    ['hook callback', { type: 'control_request', request_id: 'h1', request: { subtype: 'hook_callback' } }],
    ['mcp message', { type: 'control_request', request_id: 'm1', request: { subtype: 'mcp_message' } }],
  ])('never grants an unexpected %s request: the probe fails and nothing is written back', async (_name, frame) => {
    const { promise, sent } = run(server({ initialize: (m) => [frame, ok(m, subscriber)] }));
    await expect(promise).rejects.toMatchObject({ kind: 'command-failed' });
    expect(sent).toHaveLength(1); // only initialize; no control_response/permission grant
  });
  it('rejects a matching control error without leaking its text', async () => {
    for (const subtype of ['initialize', 'get_usage']) {
      const error = await run(server({ [subtype]: (m) => [err(m)] })).promise.catch((e) => e);
      expect(error).toMatchObject({ kind: 'command-failed' });
      expect(error.message).not.toContain('sk-abc');
    }
  });
  it.each([['malformed JSON', '{nope'], ['array', '[1]'], ['string', '"x"']])('rejects %s as parse-failure', async (_n, line) => {
    await expect(run(server({ initialize: () => [line] })).promise).rejects.toMatchObject({ kind: 'parse-failure' });
  });
  it('rejects EOF before either response', async () => {
    for (const subtype of ['initialize', 'get_usage']) await expect(run(server({ [subtype]: () => [{ type: 'system' }] })).promise, subtype).rejects.toMatchObject({ kind: 'command-failed' });
  });
  it('rejects a matching response with an unexpected subtype', async () => {
    await expect(run(server({ initialize: (m) => [{ type: 'control_response', response: { subtype: 'weird', request_id: (m as { request_id: string }).request_id } }] })).promise).rejects.toMatchObject({ kind: 'parse-failure' });
  });
  it('fails a valid usage response when the process then exits non-zero or the session fails', async () => {
    const nonZero = await run(server({}, { exitCode: 2, stderr: 'token=sk-secret' })).promise.catch((e) => e);
    expect(nonZero).toMatchObject({ kind: 'command-failed' });
    expect(nonZero.message).not.toContain('sk-secret');
    for (const kind of ['transport-failure', 'timeout', 'output-limit', 'aborted'] as const) {
      await expect(run(server({}, new HarnessCapabilityError(kind, 'x'))).promise, kind).rejects.toMatchObject({ kind });
    }
  });
  it('always disposes the session', async () => {
    for (const result of [run(server()), run(server({ initialize: () => [] })), run(server({}, { exitCode: 1 })), run(server({ initialize: (m) => [ok(m, { account: { tokenSource: 'none' } })] }))]) {
      await result.promise.catch(() => undefined);
      expect(result.session.disposed).toBe(1);
    }
  });
});

describe('Claude probe isolation', () => {
  it('disables hooks and MCP, avoids IDE discovery and persistence, and adds no tool/turn flags', () => {
    const args = [...CLAUDE_USAGE_ARGS];
    expect(args.slice(0, 5)).toEqual(['--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json']);
    expect(args[args.indexOf('--settings') + 1]).toBe('{"disableAllHooks":true}');
    expect(JSON.parse(args[args.indexOf('--mcp-config') + 1])).toEqual({ mcpServers: {} });
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
    for (const forbidden of ['--print', '-p', '--ide', '--bare', '--permission-mode', '--dangerously-skip-permissions', '--continue', '--resume', '--model', '--allowedTools']) expect(args).not.toContain(forbidden);
    expect(CLAUDE_USAGE_ENV).toEqual({ ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_AUTO_CONNECT_IDE: '0', CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1' });
  });
  it('does not touch account selection, config dir or Clanker attention variables', () => {
    for (const key of Object.keys(CLAUDE_USAGE_ENV)) expect(key).not.toMatch(/CONFIG_DIR|API_KEY|AUTH|TOKEN|BEDROCK|VERTEX|CLANKER/);
  });
  it('is the provider that owns the argv, with no SDK, direct spawn, Electron or auth-file access', () => {
    const source = readFileSync(resolve(__dirname, '../../../src/main/harnesses/claude/usage.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/claude-agent-sdk|child_process|electron|SshEnvironment|\.credentials|\.claude\.json|auth\.json|transport/);
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'));
    expect(JSON.stringify(pkg.dependencies ?? {})).not.toContain('claude-agent-sdk');
  });
});

describe('Claude account classification', () => {
  const init = (account: unknown) => run(server({ initialize: (m) => [ok(m, { account })] }));
  it('continues for a first-party Claude.ai subscription', async () => {
    expect((await init(subscriber.account).promise).measurements.length).toBe(2);
  });
  it.each([
    ['API key', { tokenSource: 'none', apiKeySource: 'ANTHROPIC_API_KEY', apiProvider: 'firstParty' }],
    ['Bedrock', { apiProvider: 'bedrock' }], ['Vertex', { apiProvider: 'vertex' }], ['gateway', { apiProvider: 'gateway' }], ['unknown third party', { apiProvider: 'someNewCloud' }],
  ])('%s is unsupported, not unauthenticated, and get_usage is never sent', async (_name, account) => {
    const { promise, sent } = init(account);
    await expect(promise).rejects.toMatchObject({ kind: 'unsupported' });
    expect(sent).toHaveLength(1);
  });
  it('reliably signed out (tokenSource none, no identity) is unauthenticated', async () => {
    await expect(init({ tokenSource: 'none', apiProvider: 'firstParty' }).promise).rejects.toMatchObject({ kind: 'unauthenticated' });
  });
  it('absent or ambiguous account info is not claimed as signed out; get_usage decides', async () => {
    await expect(run(server({ initialize: (m) => [ok(m, {})], get_usage: (m) => [ok(m, usage({ rate_limits_available: false, rate_limits: null, subscription_type: null }))] })).promise).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(init({ apiProvider: 'firstParty' }).promise).resolves.toBeDefined(); // no tokenSource evidence: proceeds
    expect(() => classifyClaudeAccount('x')).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    expect(() => classifyClaudeAccount({ account: 5 })).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  });
  it('a generic initialization failure stays generic', async () => {
    await expect(init(subscriber.account).promise).resolves.toBeDefined();
    await expect(run(server({ initialize: (m) => [err(m, 'not logged in')] })).promise).rejects.toMatchObject({ kind: 'command-failed' });
  });
});

describe('Claude usage normalization', () => {
  const parse = (response: unknown, account = { email: 'alice@example.invalid', subscriptionType: 'Claude Pro' }) => parseClaudeUsage(response, account);
  const limits = (rate_limits: unknown, extra: Msg = {}) => ({ subscription_type: 'pro', rate_limits_available: true, rate_limits, ...extra });

  it('normalizes five_hour and seven_day with percentages used as-is (not multiplied)', () => {
    const [five, week] = parse(usage());
    expect(five).toEqual({
      kind: 'rate-limit', unit: 'percent', used: 42, remaining: 58, limit: 100, resetsAt: Date.parse('2026-10-02T15:30:00.357Z'),
      period: { label: '5 hour', endsAt: Date.parse('2026-10-02T15:30:00.357Z'), startsAt: Date.parse('2026-10-02T15:30:00.357Z') - 300 * 60_000 },
      scope: { providerId: 'anthropic-claude', accountLabel: 'alice@example.invalid', planLabel: 'Pro' }, label: 'Claude · 5 hour',
    });
    expect(week).toMatchObject({ label: 'Claude · weekly', used: 6, remaining: 94, period: { label: 'weekly' } });
  });
  it('handles each window alone, 0, 100 and overage', () => {
    expect(parse(limits({ five_hour: w(0) }))[0]).toMatchObject({ used: 0, remaining: 100 });
    expect(parse(limits({ seven_day: w(100) }))[0]).toMatchObject({ used: 100, remaining: 0 });
    expect(parse(limits({ seven_day: w(130) }))[0]).toMatchObject({ used: 130, remaining: 0 });
  });
  it('skips null utilization and tolerates missing or invalid resets', () => {
    expect(parse(limits({ five_hour: w(null), seven_day: w(5) }))).toHaveLength(1);
    const m = parse(limits({ five_hour: w(5, null), seven_day: w(6, 'soon'), seven_day_opus: w(7, '2026-10-04T21:00:00') }));
    expect(m).toHaveLength(3);
    for (const x of m) expect(x).not.toHaveProperty('resetsAt');
    expect(m[0].period).toEqual({ label: '5 hour' });
  });
  it('keeps explicit named weekly families as distinct rows with family model ids', () => {
    const m = parse(limits({ seven_day: w(1), seven_day_oauth_apps: w(2), seven_day_opus: w(3), seven_day_sonnet: w(4) }));
    expect(m.map((x) => x.label)).toEqual(['Claude · weekly', 'Claude · weekly · OAuth apps', 'Claude · weekly · Opus', 'Claude · weekly · Sonnet']);
    expect(m.map((x) => x.scope?.modelId)).toEqual([undefined, undefined, 'opus', 'sonnet']);
  });
  it('model_scoped entries become weekly rows named by display_name, never a modelId', () => {
    const m = parse(limits({ seven_day: w(1), model_scoped: [{ display_name: 'Fable', utilization: 57, resets_at: '2026-10-04T21:00:00Z' }, { display_name: 'Other', utilization: 3, resets_at: null }] }));
    expect(m.map((x) => x.label)).toEqual(['Claude · weekly', 'Claude · weekly · Fable', 'Claude · weekly · Other']);
    expect(m[1]).toMatchObject({ used: 57, period: { label: 'weekly' } });
    for (const x of m) expect(x.scope).not.toHaveProperty('modelId');
  });
  it('does not duplicate a family reported both as a named field and in model_scoped', () => {
    expect(parse(limits({ seven_day_opus: w(3), model_scoped: [{ display_name: 'Opus', utilization: 3, resets_at: null }] }))).toHaveLength(1);
  });
  it('skips malformed model_scoped entries but keeps valid siblings', () => {
    const m = parse(limits({ model_scoped: ['x', { display_name: 5, utilization: 1 }, { display_name: 'Bad', utilization: -1 }, { display_name: 'Good', utilization: 9, resets_at: null }] }));
    expect(m.map((x) => x.label)).toEqual(['Claude · weekly · Good']);
  });
  it('rate_limits_available:false is unsupported and never an empty ok snapshot', () => {
    for (const response of [limits(null, { rate_limits_available: false }), { subscription_type: null, rate_limits_available: false, rate_limits: null }]) {
      expect(() => parse(response)).toThrow(expect.objectContaining({ kind: 'unsupported' }));
    }
  });
  it('available but no active numeric windows is a legitimate empty snapshot', () => {
    expect(parse(limits({ five_hour: null, seven_day: w(null), model_scoped: [] }))).toEqual([]);
  });
  it('rejects corrupt shapes as parse-failure', () => {
    for (const bad of [null, 'x', [], {}, { rate_limits_available: 'yes' }, limits(null), limits('x'), limits([]), { rate_limits_available: null, rate_limits: {} }]) {
      expect(() => parse(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ kind: expect.stringMatching(/parse-failure|unsupported/) }));
    }
    expect(() => parse(limits(null))).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    for (const rate_limits of [{ five_hour: 'x' }, { five_hour: w('42' as unknown as number) }, { five_hour: w(NaN as number), seven_day: w(-5) }, { five_hour: { utilization: 5, resets_at: 5 } }, { model_scoped: 'x' }]) {
      expect(() => parse(limits(rate_limits)), JSON.stringify(rate_limits)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    }
  });
  it('skips one malformed window when another is valid', () => {
    expect(parse(limits({ five_hour: 'bad', seven_day: w(5) }))).toHaveLength(1);
  });
  it('ignores session cost, behaviors, extra_usage, unknown codename windows and additive fields', () => {
    const text = JSON.stringify(parse(usage()));
    for (const leaked of ['1.5', 'tangelo', 'EUR', 'monthly_limit', 'extra', 'future', 'limits']) expect(text).not.toContain(leaked);
    expect(parse(usage())).toHaveLength(2);
  });
  it('prefers the usage plan, falls back to the init plan, and never invents an unknown plan', () => {
    expect(parse(limits({ five_hour: w(1) }, { subscription_type: 'max' }))[0].scope?.planLabel).toBe('Max');
    expect(parse(limits({ five_hour: w(1) }, { subscription_type: null }))[0].scope?.planLabel).toBe('Pro'); // from "Claude Pro"
    expect(parse(limits({ five_hour: w(1) }, { subscription_type: 'enterprise' }))[0].scope?.planLabel).toBe('Enterprise');
    expect(parse(limits({ five_hour: w(1) }, { subscription_type: 'team' }))[0].scope?.planLabel).toBe('Team');
    expect(parse(limits({ five_hour: w(1) }, { subscription_type: 'max_20x_future' }))[0].scope?.planLabel).toBe('Max_20x_future');
    expect(parse(limits({ five_hour: w(1) }, { subscription_type: null }), {} as never)[0].scope).not.toHaveProperty('planLabel');
    expect(claudePlanLabel(undefined)).toBeUndefined();
  });
  it('email is a label only: no accountId, and nothing opaque reaches the renderer', () => {
    const snapshot = validateUsageSnapshot({ observedAt: 1, measurements: parse(usage()) });
    expect(JSON.stringify(snapshot)).not.toContain('accountId');
    const rendered = JSON.stringify(toRendererMeasurements({ ...snapshot, measurements: snapshot.measurements.map((m) => ({ ...m, scope: { ...m.scope, accountId: 'opaque-future-id' } })) }));
    expect(rendered).not.toContain('opaque-future-id');
    expect(rendered).toContain('alice@example.invalid');
  });
  it('end to end: a probe returns the normalized snapshot with the probe completion time', async () => {
    const before = Date.now();
    const snapshot = await run(server()).promise;
    expect(snapshot.observedAt).toBeGreaterThanOrEqual(before);
    expect(snapshot.measurements.map((m) => m.label)).toEqual(['Claude · 5 hour', 'Claude · weekly']);
    expect(snapshot.measurements[0].scope?.accountLabel).toBe('alice@example.invalid');
  });
});
