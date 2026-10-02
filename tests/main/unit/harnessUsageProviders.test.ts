import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { parseOmpUsage, OMP_USAGE_COMMAND } from '../../../src/main/harnesses/omp/usage';
import { parseAgyUsage, parseAgyVersion, isSafeAgyVersion, AGY_USAGE_COMMAND, AGY_VERSION_COMMAND } from '../../../src/main/harnesses/agy/usage';
import { parseHermesUsage, parseHermesTimestamp, HERMES_USAGE_COMMAND } from '../../../src/main/harnesses/hermes/usage';
import { validateUsageSnapshot, toRendererMeasurements } from '../../../src/main/usage/usageSnapshot';
import type { HarnessCommandExecutor, HarnessCommandResult } from '../../../src/main/harnesses/commandExecution';

// All identities below are obviously fake. Shapes follow current upstream output
// (omp 18.4.x `usage --json`, Hermes 0.21.x `usage --json`).
const percentLimit = (id: string, windowId: string, label: string, usedFraction: number, resetsAt: number, extra: object = {}) => ({
  id, label, scope: { provider: 'openai-codex', windowId, shared: true },
  window: { id: windowId, label, durationMs: windowId === '5h' ? 18_000_000 : 604_800_000, resetsAt },
  amount: { used: usedFraction * 100, limit: 100, remaining: 100 - usedFraction * 100, usedFraction, remainingFraction: 1 - usedFraction, unit: 'percent' },
  status: 'ok', ...extra,
});
const codexReport = (email: string, accountId: string, fetchedAt = 1_790_000_000_000) => ({
  provider: 'openai-codex', fetchedAt,
  limits: [percentLimit('c:primary', '5h', '5 hours', 0.31, 1_790_018_000_000), percentLimit('c:secondary', '7d', '7 days', 0.68, 1_790_604_800_000)],
  resetCredits: { availableCount: 2 },
  metadata: { planType: 'plus', email, accountId, orgId: 'org-fake', futureField: { nested: true } },
});
const sample = {
  generatedAt: 1_790_000_100_000,
  reports: [
    codexReport('alice@example.invalid', 'acct-fake-1'),
    codexReport('bob@example.invalid', 'acct-fake-2', 1_789_999_000_000),
    {
      provider: 'google-antigravity', fetchedAt: 1_790_000_000_500,
      limits: [
        { id: 'g:1', label: 'Gemini', scope: { provider: 'google-antigravity', projectId: 'proj-fake', windowId: 'weekly' },
          window: { id: 'weekly', label: 'Weekly', durationMs: 604_800_000, resetsAt: 1_790_500_000_000 },
          amount: { unit: 'percent', remainingFraction: 0.25, usedFraction: 0.75 } },
        { id: 'g:2', label: 'Claude & GPT (shared)', scope: { provider: 'google-antigravity', windowId: '5h', shared: true, sharedGroup: '3p-5h:5h' },
          window: { id: '5h', label: '5 Hour', durationMs: 18_000_000 }, amount: { unit: 'percent', used: 10, limit: 100 } },
        { id: 'g:3', label: 'Claude copy', scope: { provider: 'google-antigravity', windowId: '5h', shared: true, sharedGroup: '3p-5h:5h' },
          window: { id: '5h', label: '5 Hour' }, amount: { unit: 'percent', used: 10, limit: 100 } },
      ],
      metadata: { endpoint: 'x', projectId: 'proj-fake', email: 'carol@example.invalid' },
    },
    {
      provider: 'openrouter', fetchedAt: 1_790_000_000_900,
      limits: [
        { id: 'o:credits', label: 'Credits', scope: { provider: 'openrouter', modelId: 'm-fake' }, amount: { unit: 'usd', used: 3.5, limit: 10 }, notes: ['Overage: none'] },
        { id: 'o:tok', label: 'Tokens', scope: { provider: 'openrouter' }, window: { id: 'monthly', label: 'Monthly' }, amount: { unit: 'tokens', limit: 1000, remaining: 400 } },
      ],
    },
  ],
  accountsWithoutUsage: [{ provider: 'somewhere', email: 'dave@example.invalid' }],
  disabledCredentials: [], capacity: { 'openai-codex': [{ window: '5h', accounts: 2 }] }, futureTopLevel: 1,
};
const omp = (value: unknown) => parseOmpUsage(JSON.stringify(value));

describe('OMP usage parser', () => {
  const snapshot = omp(sample);
  it('keeps multiple providers and accounts in one snapshot (shared copies collapsed)', () => {
    expect(snapshot.measurements.map((m) => `${m.scope?.providerId}:${m.label}`)).toEqual([
      'openai-codex:5 hours', 'openai-codex:7 days', 'openai-codex:5 hours', 'openai-codex:7 days',
      'google-antigravity:Gemini', 'google-antigravity:Claude & GPT (shared)', 'openrouter:Credits', 'openrouter:Tokens',
    ]);
    expect(new Set(snapshot.measurements.map((m) => m.scope?.providerId))).toEqual(new Set(['openai-codex', 'google-antigravity', 'openrouter']));
  });
  it('preserves reliable identity separately and never invents account IDs', () => {
    const scopes = snapshot.measurements.map((m) => m.scope);
    expect(scopes[0]).toMatchObject({ providerId: 'openai-codex', accountId: 'acct-fake-1', accountLabel: 'alice@example.invalid', planLabel: 'plus' });
    expect(scopes[2]).toMatchObject({ accountId: 'acct-fake-2', accountLabel: 'bob@example.invalid' });
    expect(scopes[4]).toEqual({ providerId: 'google-antigravity', accountLabel: 'carol@example.invalid' });
    expect(scopes[6]).toEqual({ providerId: 'openrouter', modelId: 'm-fake' });
  });
  it('normalizes percent/fraction limits with authoritative window metadata', () => {
    expect(snapshot.measurements[0]).toEqual({
      kind: 'rate-limit', unit: 'percent', used: 31, remaining: 69, limit: 100, resetsAt: 1_790_018_000_000,
      period: { startsAt: 1_790_000_000_000, endsAt: 1_790_018_000_000, label: '5 hours' },
      scope: expect.any(Object), label: '5 hours',
    });
    // Fraction-only: derived from usedFraction (0.75) and does not depend on remaining.
    expect(snapshot.measurements[4]).toMatchObject({ unit: 'percent', used: 75, remaining: 25, limit: 100 });
    // used/limit percent without fractions.
    expect(snapshot.measurements[5]).toMatchObject({ unit: 'percent', used: 10, remaining: 90 });
    expect(snapshot.measurements[5].resetsAt).toBeUndefined();
  });
  it('does not infer window length from primary/secondary ids', () => {
    const swapped = omp({ reports: [{ provider: 'p', limits: [{ id: 'p:primary', label: 'Monthly', scope: { provider: 'p' },
      window: { id: 'monthly', label: 'Monthly', durationMs: 2_592_000_000, resetsAt: 5e12 }, amount: { unit: 'percent', used: 5, limit: 100 } }] }] });
    expect(swapped.measurements[0].period).toEqual({ startsAt: 5e12 - 2_592_000_000, endsAt: 5e12, label: 'Monthly' });
  });
  it('preserves native absolute units and picks semantic kinds', () => {
    expect(snapshot.measurements[6]).toMatchObject({ kind: 'spend', unit: 'usd', used: 3.5, limit: 10, remaining: 6.5, description: 'Overage: none' });
    expect(snapshot.measurements[7]).toMatchObject({ kind: 'tokens', unit: 'tokens', limit: 1000, remaining: 400, used: 600 });
    expect(omp({ reports: [{ provider: 'p', limits: [{ id: 'x', label: 'Req', scope: { provider: 'p' }, amount: { unit: 'requests', used: 3, limit: 50 } }] }] }).measurements[0])
      .toMatchObject({ kind: 'allowance', unit: 'requests', used: 3, remaining: 47 });
  });
  it('clamps negative fractions only and keeps overage visible', () => {
    const run = (usedFraction: number) => omp({ reports: [{ provider: 'p', limits: [{ id: 'x', label: 'x', scope: { provider: 'p' }, amount: { unit: 'percent', usedFraction } }] }] }).measurements[0];
    expect(run(-0.2)).toMatchObject({ used: 0, remaining: 100 });
    expect(run(1.2)).toMatchObject({ used: 120, remaining: 0 });
  });
  it('does not reinterpret arbitrary numbers as percentages', () => {
    const m = omp({ reports: [{ provider: 'p', limits: [{ id: 'x', label: 'x', scope: { provider: 'p' }, amount: { unit: 'credits', used: 37, limit: 200 } }] }] }).measurements[0];
    expect(m).toMatchObject({ unit: 'credits', used: 37, limit: 200, remaining: 163 });
  });
  it('uses the oldest report fetch time as the honest data age', () => {
    expect(snapshot.observedAt).toBe(1_789_999_000_000);
    expect(omp({ generatedAt: 42, reports: [] }).observedAt).toBe(42);
  });
  it('returns an ok empty snapshot for empty reports and accountsWithoutUsage, with no fake rows', () => {
    expect(omp({ generatedAt: 5, reports: [], accountsWithoutUsage: [{ provider: 'x', email: 'e@example.invalid' }], disabledCredentials: [], capacity: {} }))
      .toEqual({ observedAt: 5, measurements: [] });
    expect(omp({ reports: [{ provider: 'p', limits: [] }, { provider: 'q', limits: [{ id: 'n', label: 'n', scope: { provider: 'q' }, amount: { unit: 'unknown' } }] }], generatedAt: 1 }).measurements).toEqual([]);
  });
  it('ignores unknown additive fields and leaks no raw OMP fields', () => {
    const text = JSON.stringify(validateUsageSnapshot(snapshot));
    for (const raw of ['futureField', 'orgId', 'resetCredits', 'capacity', 'accountsWithoutUsage', 'sharedGroup', 'status', 'org-fake', 'proj-fake', 'endpoint']) expect(text).not.toContain(raw);
    expect(JSON.stringify(toRendererMeasurements(validateUsageSnapshot(snapshot)))).not.toMatch(/acct-fake/);
  });
  it('rejects corrupt roots and unparsable output', () => {
    for (const bad of ['', 'not json', '{"reports":', '[]', 'null', '{}', '{"reports":{}}', '"x"', 'Loading…\n{"reports":[]}']) {
      expect(() => parseOmpUsage(bad), bad).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    }
  });
  it('keeps valid data when one report or limit is malformed, but fails when nothing valid remains', () => {
    const good = codexReport('a@example.invalid', 'acct-fake-1');
    expect(omp({ reports: [42, { provider: 'x' }, good] }).measurements).toHaveLength(2);
    const withBadLimit = { ...good, limits: [...good.limits, { id: 'bad', label: 'b', scope: {}, amount: { unit: 'percent', used: 'many' } }, 'junk'] };
    expect(omp({ reports: [withBadLimit] }).measurements).toHaveLength(2);
    for (const value of [
      { reports: [42] },
      { reports: [{ provider: 'p', limits: 'no' }] },
      { reports: [{ provider: 'p', limits: [{ id: 'x', label: 'x', scope: {}, amount: { unit: 'percent', used: '5' } }] }] },
      { reports: [{ provider: 'p', limits: [{ id: 'x', label: 'x', scope: {}, amount: 'nope' }] }] },
      { reports: [{ provider: 'p', limits: [{ id: 'x', label: 'x', scope: {}, amount: { used: 1 } }] }] },
      { reports: [{ provider: 'p', limits: [{ id: 'x', label: 'x', scope: {}, window: 'weekly', amount: { unit: 'percent', used: 1 } }] }] },
    ]) expect(() => omp(value), JSON.stringify(value)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  });
  it('does not turn scope.tier into a plan label (tier can name a model/quota meter)', () => {
    const report = { provider: 'openai-codex', limits: [{ id: 'c:spark', label: 'Spark', scope: { provider: 'openai-codex', accountId: 'acct-fake-1', tier: 'spark', modelId: 'model-fake' },
      window: { id: '5h', label: '5 hours' }, amount: { unit: 'percent', used: 5, limit: 100 } }] };
    const m = omp({ reports: [report] }).measurements[0];
    expect(m.scope).toEqual({ providerId: 'openai-codex', accountId: 'acct-fake-1', modelId: 'model-fake' });
    expect(JSON.stringify(m)).not.toContain('spark');
    expect(omp({ reports: [{ ...report, metadata: { planType: 'pro' } }] }).measurements[0].scope?.planLabel).toBe('pro');
  });
  it('produces output the shared validator accepts', () => {
    expect(() => validateUsageSnapshot(snapshot)).not.toThrow();
  });
});

describe('Hermes usage parser', () => {
  const doc = {
    provider: 'openai-codex', source: 'usage_api', title: 'Account limits', plan: 'Plus', fetched_at: '2026-10-02T13:34:15.744572+00:00',
    windows: [
      { label: 'Session', used_percent: 37.5, resets_at: '2026-10-02T15:23:55+00:00', detail: null },
      { label: 'Weekly', used_percent: 68.0, resets_at: null, detail: 'Resets when you next use it' },
      { label: 'Credits', used_percent: null, resets_at: null, detail: 'n/a' },
    ],
    details: ['You have 2 resets banked'], unavailable_reason: null, future_key: [1],
  };
  const hermes = (value: unknown) => parseHermesUsage(JSON.stringify(value));

  it('maps the documented document to percent measurements', () => {
    const snapshot = hermes(doc);
    expect(snapshot.observedAt).toBe(Date.parse('2026-10-02T13:34:15.744Z'));
    expect(snapshot.measurements).toEqual([
      { kind: 'rate-limit', unit: 'percent', used: 37.5, remaining: 62.5, limit: 100, resetsAt: Date.parse('2026-10-02T15:23:55Z'),
        label: 'Session', period: { label: 'Session' }, scope: { providerId: 'openai-codex', planLabel: 'Plus' } },
      { kind: 'allowance', unit: 'percent', used: 68, remaining: 32, limit: 100,
        label: 'Weekly', period: { label: 'Weekly' }, scope: { providerId: 'openai-codex', planLabel: 'Plus' }, description: 'Resets when you next use it' },
    ]); // null used_percent window carries no quota number and is skipped
    expect(JSON.stringify(snapshot)).not.toMatch(/accountId|future_key|banked/);
  });
  it('omits unparsable optional dates and never guesses local time', () => {
    expect(hermes({ ...doc, fetched_at: 'garbage', windows: [{ label: 'S', used_percent: 1, resets_at: 'tomorrow' }] }).measurements[0].resetsAt).toBeUndefined();
    expect(parseHermesTimestamp('2026-10-02T13:34:15')).toBeUndefined(); // no offset
    expect(parseHermesTimestamp('2026-10-02T13:34:15.744572Z')).toBe(Date.parse('2026-10-02T13:34:15.744Z'));
    expect(parseHermesTimestamp(1790000000)).toBeUndefined();
  });
  it('accepts an empty window list and details-only snapshots as ok/empty', () => {
    expect(hermes({ ...doc, windows: [] }).measurements).toEqual([]);
  });
  it('treats unavailable_reason without measurements as unsupported, not unauthenticated', () => {
    expect(() => hermes({ ...doc, windows: [], unavailable_reason: 'whatever the text says' })).toThrow(expect.objectContaining({ kind: 'unsupported' }));
    expect(hermes({ ...doc, unavailable_reason: 'partial' }).measurements).toHaveLength(2);
  });
  it('rejects malformed output and values', () => {
    for (const bad of ['', 'nope', '[]', '{}', '{"windows":{}}', 'warn\n{"windows":[]}']) expect(() => parseHermesUsage(bad), bad).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    for (const windows of [['x'], [{ used_percent: 1 }], [{ label: 'a', used_percent: '37' }], [{ label: 'a', used_percent: 101 }], [{ label: 'a', used_percent: -1 }], [{ label: 'a', used_percent: true }]]) {
      expect(() => parseHermesUsage(JSON.stringify({ ...doc, windows })), JSON.stringify(windows)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    }
  });
});

describe('providers execute only through context.executor', () => {
  const ok = (stdout: string): HarnessCommandResult => ({ stdout, stderr: '', exitCode: 0 });
  const context = (result: HarnessCommandResult, transport: 'local' | 'ssh') => {
    const run = vi.fn(async () => result);
    return { run, ctx: { executor: { run } as HarnessCommandExecutor, transport, signal: new AbortController().signal } };
  };
  const cases = [
    { id: 'omp', command: OMP_USAGE_COMMAND, stdout: JSON.stringify(sample) },
    { id: 'hermes', command: HERMES_USAGE_COMMAND, stdout: JSON.stringify({ provider: 'p', fetched_at: '2026-10-02T13:34:15+00:00', windows: [{ label: 'S', used_percent: 1 }] }) },
  ] as const;

  it.each(cases)('$id runs exactly its structured command, identically for local and SSH', async ({ id, command, stdout }) => {
    const usage = getHarnessProvider(id).usage!;
    const outcomes = [];
    for (const transport of ['local', 'ssh'] as const) {
      const { run, ctx } = context(ok(stdout), transport);
      outcomes.push(await usage.get(ctx));
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ command: command.command, args: [...command.args] }));
      const request = (run.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      expect(Object.keys(request).sort()).toEqual(['args', 'command', 'maxOutputBytes', 'timeoutMs']); // no cwd/env/stdin/secrets
      expect(request.timeoutMs as number).toBeLessThanOrEqual(30_000);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
  });

  it.each(cases)('$id never uses invalidate/other subcommands and never branches on transport', async ({ id }) => {
    const source = readFileSync(resolve(__dirname, `../../../src/main/harnesses/${id}/usage.ts`), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/invalidate|child_process|electron|SshEnvironment|transport\s*[=!]==|\.transport/);
  });

  it('OMP non-zero exits are generic command failures', async () => {
    const { ctx } = context({ stdout: '', stderr: 'token=sk-secret', exitCode: 2 }, 'local');
    await expect(getHarnessProvider('omp').usage!.get(ctx)).rejects.toMatchObject({ kind: 'command-failed' });
  });
  it('Hermes exit 1 is a generic failure and never unauthenticated, whatever stderr says', async () => {
    for (const stderr of ['No account usage available: no credential is configured', 'fetch failed', '']) {
      const { ctx } = context({ stdout: '', stderr, exitCode: 1 }, 'ssh');
      const error = await getHarnessProvider('hermes').usage!.get(ctx).catch((e) => e);
      expect(error).toMatchObject({ kind: 'command-failed' });
      expect(error.kind).not.toBe('unauthenticated');
    }
  });
  it('refresh policies are deliberate hard limits', () => {
    for (const id of ['omp', 'hermes'] as const) {
      const policy = getHarnessProvider(id).usage!.refresh!;
      expect(policy.minimumProbeIntervalMs).toBeGreaterThanOrEqual(60_000);
      expect(policy.cacheTtlMs).toBeGreaterThanOrEqual(60_000);
      expect(policy.failureBackoffMs).toBeGreaterThanOrEqual(60_000);
    }
  });
});

describe('through the usage service with the canonical registry', () => {
  it('OMP, Hermes and Agy report data, the other four are unsupported, and renderer data has no account IDs', async () => {
    const { HarnessUsageService } = await import('../../../src/main/usage/harnessUsageService');
    const executeHarnessCommand = vi.fn(async (request: { command: string }) => ({
      stdout: request.command === 'agy' ? ((request as { args?: string[] }).args?.[0] === '--version' ? '1.2.14' : JSON.stringify(envelope(groups)))
        : request.command === 'omp' ? JSON.stringify(sample)
        : JSON.stringify({ provider: 'p', fetched_at: '2026-10-02T13:34:15+00:00', windows: [{ label: 'S', used_percent: 5 }] }),
      stderr: '', exitCode: 0,
    }));
    const environment = { id: 'local', kind: 'local', executeHarnessCommand, probeAvailableHarnessIds: async () => ['omp', 'hermes', 'agy'] };
    const workspace = { workspaceId: 'w', location: { environmentId: 'local', path: '/w' }, environment };
    const service = new HarnessUsageService({ getWorkspace: () => workspace } as never);
    const response = await service.get('w');
    const status = Object.fromEntries(response.entries.map((entry) => [entry.harnessId, entry.status]));
    expect(status).toEqual({ codex: 'unsupported', opencode: 'unsupported', pi: 'unsupported', omp: 'ok', claude: 'unsupported', hermes: 'ok', agy: 'ok' });
    expect(JSON.stringify(response)).not.toContain('acct-fake');
    expect(service.getCachedSnapshots('w').find((entry) => entry.harnessId === 'omp')!.snapshot.measurements[0].scope?.accountId).toBe('acct-fake-1');
  });
});

// ---------------------------------------------------------------------------
// Antigravity
// ---------------------------------------------------------------------------
const bucket = (id: string, window: string, fraction: unknown, reset: unknown = '2026-10-07T08:08:35Z', extra: object = {}) =>
  ({ id, name: window === '5h' ? 'Five Hour Limit Remaining' : 'Weekly Limit Remaining', description: 'x', window, remaining_fraction: fraction, reset_time: reset, ...extra });
const envelope = (groups: unknown, overrides: object = {}) => ({
  conversation_id: '', status: 'SUCCESS', response: 'Gemini Models\tWeekly Limit Remaining 83%', duration_seconds: 0, num_turns: 0,
  usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
  command: { name: 'usage', data: { description: 'Usage', groups, future: 1 } }, futureTop: true, ...overrides,
});
const groups = [
  { name: 'Gemini Models', description: 'Gemini Flash, Gemini Pro', buckets: [bucket('gemini-weekly', 'weekly', 0.83), bucket('gemini-5h', '5h', 1, '2026-10-02T18:46:53Z')] },
  { name: 'Claude and GPT models', description: 'Claude, GPT', buckets: [bucket('3p-weekly', 'weekly', 0.4412519931793213), bucket('3p-5h', '5h', 0)] },
];
const agy = (value: unknown, text?: string) => parseAgyUsage(text ?? JSON.stringify(value), () => 777);

describe('Antigravity version gate', () => {
  it.each([['1.1.11', true], ['1.1.12', true], ['1.2.14\n', true], ['v1.2.12', true], ['2.0.0', true], ['10.0.0', true],
    ['1.1.10', false], ['1.0.99', false], ['0.9.99', false],
    ['1.1.11-rc.1', false], ['1.1.11-beta', false], ['1.1.11+build', false],
    ['', false], ['agy', false], ['1.1', false], ['1.1.x', false], ['go1.22.0\n1.1.11', false], ['agy version 1.2.14', false], ['1.2.14\n1.0.0', false], ['Node v20.1.1', false]])(
    'version output %j -> safe=%s', (output, safe) => {
      expect(isSafeAgyVersion(parseAgyVersion(output))).toBe(safe);
    });

  const run = (versionOut: string, exitCode = 0) => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const executor = { run: vi.fn(async (request: { command: string; args?: string[] }) => {
      calls.push({ command: request.command, args: request.args ?? [] });
      return request.args?.[0] === '--version' ? { stdout: versionOut, stderr: '', exitCode } : { stdout: JSON.stringify(envelope(groups)), stderr: '', exitCode: 0 };
    }) };
    return { calls, get: () => getHarnessProvider('agy').usage!.get({ executor, transport: 'local', signal: new AbortController().signal }) };
  };

  it.each(['1.1.10', '1.1.11-rc.1', 'garbage', '', '1.2.14 and 0.1.0', 'v1.1'])('never runs /usage for unsafe or unverified version %j', async (versionOut) => {
    const { calls, get } = run(versionOut);
    await expect(get()).rejects.toMatchObject({ kind: 'unsupported' });
    expect(calls).toEqual([{ ...AGY_VERSION_COMMAND, args: ['--version'] }]);
    expect(calls.some((call) => call.args.some((arg) => arg.includes('/usage')))).toBe(false);
  });
  it('never runs /usage when --version itself fails', async () => {
    const { calls, get } = run('1.2.14', 1);
    await expect(get()).rejects.toMatchObject({ kind: 'command-failed' });
    expect(calls).toHaveLength(1);
  });
  it.each(['1.1.11', '1.2.14\n'])('runs --version then exactly the verified usage command for %j', async (versionOut) => {
    const { calls, get } = run(versionOut);
    const snapshot = await get();
    expect(calls).toEqual([{ command: 'agy', args: ['--version'] }, { command: 'agy', args: ['--output-format', 'json', '-p=/usage'] }]);
    expect(AGY_USAGE_COMMAND.args).toEqual(['--output-format', 'json', '-p=/usage']);
    expect(snapshot.measurements).toHaveLength(4);
  });
  it('is identical for local and SSH and carries no cwd/env/stdin', async () => {
    const results = [];
    for (const transport of ['local', 'ssh'] as const) {
      const seen: Record<string, unknown>[] = [];
      const executor = { run: async (request: Record<string, unknown>) => { seen.push(request); return { stdout: (request.args as string[])[0] === '--version' ? '1.2.14' : JSON.stringify(envelope(groups)), stderr: '', exitCode: 0 }; } };
      results.push(await getHarnessProvider('agy').usage!.get({ executor: executor as never, transport, signal: new AbortController().signal }));
      for (const request of seen) expect(Object.keys(request).sort()).toEqual(['args', 'command', 'maxOutputBytes', 'timeoutMs']);
    }
    expect(results[1].measurements).toEqual(results[0].measurements);
    const source = readFileSync(resolve(__dirname, '../../../src/main/harnesses/agy/usage.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/child_process|electron|SshEnvironment|transport|\.agy|credentials?\.json|auth\.json/);
  });
});

describe('Antigravity envelope parser', () => {
  it('normalizes groups/buckets, keeping identical windows in different groups distinct', () => {
    const snapshot = agy(envelope(groups));
    expect(snapshot.observedAt).toBe(777);
    expect(snapshot.measurements.map((m) => m.label)).toEqual([
      'Gemini Models · Weekly Limit Remaining', 'Gemini Models · Five Hour Limit Remaining',
      'Claude and GPT models · Weekly Limit Remaining', 'Claude and GPT models · Five Hour Limit Remaining',
    ]);
    expect(snapshot.measurements[0]).toEqual({
      kind: 'rate-limit', unit: 'percent', used: 17, remaining: 83, limit: 100, resetsAt: Date.parse('2026-10-07T08:08:35Z'),
      period: { label: 'weekly', endsAt: Date.parse('2026-10-07T08:08:35Z'), startsAt: Date.parse('2026-10-07T08:08:35Z') - 604_800_000 },
      scope: { providerId: 'google-antigravity' }, label: 'Gemini Models · Weekly Limit Remaining',
    });
    expect(snapshot.measurements[1].period).toMatchObject({ label: '5 hour', startsAt: Date.parse('2026-10-02T18:46:53Z') - 18_000_000 });
    expect(snapshot.measurements[3]).toMatchObject({ remaining: 0, used: 100 });
    expect(snapshot.measurements[2]).toMatchObject({ remaining: 44.1252, used: 55.8748 });
  });
  it('clamps fractions, preserves unknown windows, tolerates a missing/invalid reset, and never invents identity', () => {
    const m = agy(envelope([{ name: 'G', buckets: [
      bucket('a', 'weekly', 1.4), bucket('b', 'weekly', -0.2), bucket('c', 'monthly', 0.5, null), bucket('d', '5h', 0.5, '2026-10-07T08:08:35'), bucket('e', 'weekly', 0.5, 'soon'),
      bucket('f', 'fortnightly', 0.25, '2026-10-07T08:08:35Z'),
    ] }])).measurements;
    expect(m.map((x) => x.remaining)).toEqual([100, 0, 50, 50, 50, 25]);
    expect(m[2]).toMatchObject({ period: { label: 'monthly' } });
    expect(m[2]).not.toHaveProperty('resetsAt');
    expect(m[2].period).not.toHaveProperty('startsAt');
    expect(m[3].resetsAt).toBeUndefined(); // timezone-less is never read as local time
    expect(m[4].resetsAt).toBeUndefined();
    expect(m[5]).toMatchObject({ period: { label: 'fortnightly' }, resetsAt: Date.parse('2026-10-07T08:08:35Z') });
    for (const x of m) expect(x.scope).toEqual({ providerId: 'google-antigravity' });
  });
  it('supports a tier with weekly-only data', () => {
    expect(agy(envelope([{ name: 'G', buckets: [bucket('w', 'weekly', 0.5)] }])).measurements).toHaveLength(1);
  });
  it('skips disabled buckets rather than reporting full capacity', () => {
    const snapshot = agy(envelope([{ name: 'G', buckets: [bucket('a', 'weekly', 1, undefined, { disabled: true }), bucket('b', '5h', 0.6)] }]));
    expect(snapshot.measurements).toHaveLength(1);
    expect(snapshot.measurements[0].remaining).toBe(60);
    expect(agy(envelope([{ name: 'G', buckets: [bucket('a', 'weekly', 1, undefined, { disabled: true })] }])).measurements).toEqual([]);
  });
  it('skips fraction-less buckets and ignores unknown fields', () => {
    const snapshot = agy(envelope([{ name: 'G', extra: 1, buckets: [{ id: 'x', window: 'weekly', future: 1 }, bucket('b', '5h', 0.6, undefined, { newField: { a: 1 } })] }]));
    expect(snapshot.measurements).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/newField|future|extra|response/);
  });
  it('keeps valid data beside malformed groups/buckets but rejects all-malformed output', () => {
    expect(agy(envelope([42, { name: 'bad' }, { name: 'G', buckets: ['x', bucket('b', '5h', 'half'), bucket('ok', '5h', 0.5)] }])).measurements).toHaveLength(1);
    for (const bad of [[42], [{ name: 'bad' }], [{ name: 'G', buckets: [bucket('b', '5h', 'half')] }], [{ name: 'G', buckets: [bucket('b', 5 as unknown as string, 0.5)] }]]) {
      expect(() => agy(envelope(bad)), JSON.stringify(bad)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    }
  });
  it('rejects structurally wrong envelopes', () => {
    for (const value of [
      envelope(groups, { command: undefined }), envelope(groups, { command: { name: 'quota', data: { groups } } }), envelope(groups, { command: { name: 'usage' } }),
      envelope(groups, { command: { name: 'usage', data: { groups: {} } } }), [], 'x', null,
    ]) expect(() => agy(value), JSON.stringify(value)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    expect(() => agy(null, '')).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  });
  it('does not parse the human response text', () => {
    expect(() => agy(envelope(undefined, { response: 'Gemini Models\tWeekly 83%' }))).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  });
});

describe('Antigravity model-turn guard', () => {
  it.each([
    ['conversation id', { conversation_id: 'conv-fake-1' }],
    ['turn count', { num_turns: 1 }],
    ['input tokens', { usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 15 } }],
    ['only output tokens', { usage: { output_tokens: 1 } }],
    ['cache tokens', { usage: { cache_read_tokens: 3 } }],
    ['non-numeric turns', { num_turns: '0' }],
    ['non-object usage', { usage: 5 }],
    ['the issue regression fixture', { conversation_id: 'some-id', num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 } }],
  ])('rejects a reply showing %s and demands a long backoff', (_name, overrides) => {
    const error = (() => { try { agy(envelope(groups, overrides)); } catch (e) { return e as { kind: string; retryAfterMs?: number }; } })();
    expect(error).toMatchObject({ kind: 'command-failed' });
    expect(error!.retryAfterMs).toBeGreaterThanOrEqual(3_600_000);
  });
  it('rejects a model-turn style reply that has no command block', () => {
    expect(() => agy({ conversation_id: 'c', status: 'SUCCESS', response: 'Hello', num_turns: 1, usage: { input_tokens: 4 } })).toThrow(expect.objectContaining({ kind: 'command-failed' }));
  });
  it('accepts absent turn fields', () => {
    const rest: Record<string, unknown> = { ...envelope(groups) };
    for (const key of ['conversation_id', 'num_turns', 'usage']) delete rest[key];
    expect(agy(rest).measurements).toHaveLength(4);
  });
});

describe('Antigravity status and error classification', () => {
  const failing = (value: unknown, exitCode = 0) => getHarnessProvider('agy').usage!.get({
    executor: { run: async (r: { args?: string[] }) => (r.args?.[0] === '--version' ? { stdout: '1.2.14', stderr: 'token=sk-secret', exitCode: 0 } : { stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: 'token=sk-secret', exitCode }) } as never,
    transport: 'ssh', signal: new AbortController().signal,
  }).catch((e) => e);

  it.each(['Authentication required. Run agy auth to log in.', 'not authenticated: no stored credentials found', 'Login required', 'Your credentials have been revoked', 'credential revoked', 'token revoked', 'token expired and refresh token is not set'])(
    'classifies the structured auth rejection %j', async (message) => {
      expect(await failing({ status: 'ERROR', error: message })).toMatchObject({ kind: 'unauthenticated' });
      expect(await failing({ status: 'ERROR', error: { message } }, 1)).toMatchObject({ kind: 'unauthenticated' });
    });
  it.each(['authentication failed or timed out', 'network error', 'request failed', 'internal error'])('keeps generic failure %j generic', async (message) => {
    const error = await failing({ status: 'ERROR', error: message });
    expect(error).toMatchObject({ kind: 'command-failed' });
    expect(error.message).not.toContain(message);
  });
  it('never classifies auth from the human response field', async () => {
    expect(await failing({ status: 'ERROR', response: 'Authentication required. Run agy auth to log in.' })).toMatchObject({ kind: 'command-failed' });
    expect(await failing({ status: 'ERROR', response: 'not authenticated', message: 'internal error' })).toMatchObject({ kind: 'command-failed' });
    expect(await failing({ status: 'ERROR', error_message: 'login required' })).toMatchObject({ kind: 'unauthenticated' });
    expect(await failing({ status: 'ERROR', message: 'login required', response: 'x' })).toMatchObject({ kind: 'unauthenticated' });
  });
  it('never inspects stderr and does not leak it', async () => {
    const error = await failing('', 1);
    expect(error).toMatchObject({ kind: 'command-failed' });
    expect(JSON.stringify(error.message)).not.toContain('sk-secret');
  });
  it('treats a non-SUCCESS envelope as a failure even with exit 0', async () => {
    expect(await failing({ status: 'FAILURE', response: 'boom', command: { name: 'usage', data: { groups } } })).toMatchObject({ kind: 'command-failed' });
  });
});

describe('Antigravity noisy stdout', () => {
  const good = JSON.stringify(envelope(groups));
  it('selects the single valid envelope among log lines', () => {
    expect(agy(null, `2026/10/02 INFO starting\n${good}\nWARN done`).measurements).toHaveLength(4);
    expect(agy(null, `noise {"a":1}\n{"unrelated":true}\n${good}\n`).measurements).toHaveLength(4);
  });
  it('does not accept JSON fragments embedded in prose', () => {
    expect(() => agy(null, `prefix ${good} suffix`)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    expect(() => agy(null, 'just logs\nand more logs')).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
  });
  it('fails on conflicting valid envelopes but accepts a repeated identical one', () => {
    const other = JSON.stringify(envelope([{ name: 'Other', buckets: [bucket('z', '5h', 0.1)] }]));
    expect(() => agy(null, `${good}\n${other}`)).toThrow(expect.objectContaining({ kind: 'parse-failure' }));
    expect(agy(null, `${good}\n${good}`).measurements).toHaveLength(4);
  });
});
