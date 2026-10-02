import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getHarnessProvider } from '../../../src/main/harnesses/registry';
import { parseOmpUsage, OMP_USAGE_COMMAND } from '../../../src/main/harnesses/omp/usage';
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
  it('OMP and Hermes report data, the other five are unsupported, and renderer data has no account IDs', async () => {
    const { HarnessUsageService } = await import('../../../src/main/usage/harnessUsageService');
    const executeHarnessCommand = vi.fn(async (request: { command: string }) => ({
      stdout: request.command === 'omp' ? JSON.stringify(sample)
        : JSON.stringify({ provider: 'p', fetched_at: '2026-10-02T13:34:15+00:00', windows: [{ label: 'S', used_percent: 5 }] }),
      stderr: '', exitCode: 0,
    }));
    const environment = { id: 'local', kind: 'local', executeHarnessCommand, probeAvailableHarnessIds: async () => ['omp', 'hermes'] };
    const workspace = { workspaceId: 'w', location: { environmentId: 'local', path: '/w' }, environment };
    const service = new HarnessUsageService({ getWorkspace: () => workspace } as never);
    const response = await service.get('w');
    const status = Object.fromEntries(response.entries.map((entry) => [entry.harnessId, entry.status]));
    expect(status).toEqual({ codex: 'unsupported', opencode: 'unsupported', pi: 'unsupported', omp: 'ok', claude: 'unsupported', hermes: 'ok', agy: 'unsupported' });
    expect(JSON.stringify(response)).not.toContain('acct-fake');
    expect(service.getCachedSnapshots('w').find((entry) => entry.harnessId === 'omp')!.snapshot.measurements[0].scope?.accountId).toBe('acct-fake-1');
  });
});
