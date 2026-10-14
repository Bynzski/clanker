import { afterEach, expect, it, vi } from 'vitest';
import { AssistantCronReader } from '../../../src/main/assistants/assistantCron';
import { parseRoutines, parseRuns, readSection } from '../../../src/main/assistants/assistantDetails';
import { HermesAssistantService } from '../../../src/main/assistants/hermesAssistantService';
import { FakeHermes, TOKEN } from '../../_helpers/fakeHermes';

const job = (profile: string) => ({ id: 'shared', profile, name: `${profile} task`, enabled: false, state: 'paused', schedule: { kind: 'interval' }, next_run_at: null, last_run_at: null, last_status: null, repeat: { completed: 0 }, latest_execution: null });
const run = (profile: string, id = 'shared') => ({ profile, id: `cron_${id}_20261014_010203`, source: 'cron', started_at: 100, ended_at: 110, title: 'raw secret', preview: 'private prompt and output' });
function fixture(read: (url: URL, signal?: AbortSignal) => Promise<unknown>, status = 200) {
  const hermes = new FakeHermes();
  const fetcher = vi.fn(async (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal; redirect?: string }) => {
    if (!new URL(url).pathname.startsWith('/api/cron/')) return hermes.fetch(url);
    expect(init?.headers).toEqual({ 'X-Hermes-Session-Token': TOKEN }); expect(init?.redirect).toBe('error');
    const value = await read(new URL(url), init?.signal);
    return { ok: status === 200, status, text: async () => JSON.stringify(value), json: async () => value };
  });
  const spawnServe = vi.fn(() => { throw new Error('Must never start a service'); });
  const service = new HermesAssistantService({ readSettings: () => ({ enabled: true, autoStart: false }), writeSettings: vi.fn(), onChanged: vi.fn(), onPtyData: vi.fn(), isShuttingDown: () => false, isHermesAvailable: () => true, fetch: fetcher, readRendezvous: async () => [], createWebSocket: hermes.createWebSocket, spawnServe });
  return { service, hermes, fetcher, spawnServe };
}
afterEach(() => vi.useRealTimers());

it.each(['default', 'fred', 'reviewer'])('isolates overlapping exact job ids for %s, without chat or mutation calls', async (owner) => {
  const { service, hermes, spawnServe } = fixture(async (url) => {
    const profile = url.searchParams.get('profile')!;
    return url.pathname.endsWith('/runs') ? { runs: [run(profile)] } : [job(profile)];
  });
  await service.refresh();
  const routines = owner === 'default' ? await service.readDefaultRoutines() : (await service.readDetails(`hermes:${owner}`)).routines;
  expect(routines).toMatchObject({ state: 'ready', data: [{ name: `${owner} task` }] });
  const history = owner === 'default' ? await service.readDefaultRoutineRuns('shared') : await service.readRoutineRuns(`hermes:${owner}`, 'shared');
  expect(history).toEqual({ state: 'ready', data: [{ source: 'cron', startedAt: 100, endedAt: 110 }] });
  expect(service.hasAssistant('hermes:default')).toBe(false);
  expect(service.get().profiles?.some(({ id }) => id === 'hermes:default')).toBe(false);
  expect(spawnServe).not.toHaveBeenCalled();
  expect(hermes.calls.filter(({ method }) => method.startsWith('session.') && method !== 'session.list')).toEqual([]);
  expect(hermes.ptySockets()).toEqual([]);
  await service.shutdown();
});
it.each([undefined, 'reviewer'])('withholds missing/foreign run ownership even if the current list still contains the job (%s)', async (profile) => {
  const { service } = fixture(async (url) => url.pathname.endsWith('/runs') ? { runs: [{ ...run('fred'), profile }] } : [job(url.searchParams.get('profile')!)]);
  await service.refresh(); expect(await service.readRoutineRuns('hermes:fred', 'shared')).toEqual({ state: 'unavailable' });
  await service.shutdown();
});
it('default lists must be explicitly default-owned; global/foreign/duplicate/sentinel jobs fail closed', () => {
  for (const rows of [[job('fred')], [{ ...job('default'), profile: undefined }], [job('default'), job('default')], [{ ...job('default'), id: 'unknown' }]]) {
    expect(() => parseRoutines(rows, 'default')).toThrow();
  }
});
it('checks exact agent-session ids, duplicates, source and explicit profile before projecting timestamps', () => {
  for (const row of [run('fred', 'shared_extra'), { ...run('fred'), source: 'other' }, { ...run('fred'), id: 'cron_shared_not-a-timestamp' }]) {
    expect(() => parseRuns({ runs: [row] }, 'fred', 'shared')).toThrow();
  }
  expect(() => parseRuns({ runs: [run('fred'), run('fred')] }, 'fred', 'shared')).toThrow();
  expect(() => parseRuns({ runs: [run('fred')] }, 'fred', '../bad')).toThrow();
});
it.each(['once', 'interval', 'cron'])('projects %s configuration without claiming scheduler health or execution', (kind) => {
  const projected = parseRoutines([{ ...job('fred'), enabled: true, state: 'scheduled', schedule: { kind }, next_run_at: '2099-01-01T00:00:00+00:00', scheduler_heartbeat_age_s: 0, worker_last_active: 999 }], 'fred')[0];
  expect(projected).toMatchObject({ enabled: true, state: 'scheduled', scheduleKind: kind, recordedRuns: 0, lastRunAbsent: true, lastResult: 'No result recorded' });
  expect(JSON.stringify(projected)).not.toMatch(/heartbeat|worker|health|running/);
});
it.each([['ok', 'Succeeded'], ['error', 'Failed'], ['interrupted', 'Interrupted'], ['delivery_failed', 'Delivery failed'], ['other private text', 'Unknown'], ['constructor', 'Unknown']])('projects only supported last-result claims (%s)', (status, label) => {
  expect(parseRoutines([{ ...job('fred'), last_status: status }], 'fred')[0].lastResult).toBe(label);
});
it.each(['claimed', 'running', 'completed', 'failed', 'unknown'])('projects a typed owner-matched latest ledger record (%s), not raw errors/process identity', (status) => {
  const result = parseRoutines([{ ...job('fred'), latest_execution: { job_id: 'shared', status, claimed_at: '2026-01-01T00:00:00Z', pid: 42, error: 'raw secret', process_id: 'private' } }], 'fred')[0];
  expect(result.latestAttempt).toEqual({ status, claimedAt: '2026-01-01T00:00:00Z', finishedAt: undefined });
  expect(JSON.stringify(result)).not.toMatch(/raw secret|pid|process/);
  expect(() => parseRoutines([{ ...job('fred'), latest_execution: { job_id: 'foreign', status } }], 'fred')).toThrow();
});
it('does not turn missing fields into no runs, no schedule or a success claim', () => {
  const result = parseRoutines([{ profile: 'fred', id: 'shared' }], 'fred')[0];
  expect(result).toMatchObject({ lastRunAbsent: false, nextRunAbsent: false, recordedRuns: undefined, scheduleKind: undefined, lastResult: 'Unknown', enabled: undefined });
});
it('drops prompt-derived labels, raw output and actual custom home/workdir paths', () => {
  const prompt = 'a confidential prompt without credential-looking words';
  const [result] = parseRoutines([{ ...job('fred'), prompt, name: prompt.slice(0, 50), hermes_home: '/srv/private-profile', workdir: '/opt/private-cwd', timezone: '/srv/private-profile', schedule_display: '/opt/private-cwd' }], 'fred');
  expect(result.name).toBe('Scheduled task'); expect(JSON.stringify(result)).not.toMatch(/confidential|private-profile|private-cwd/);
  expect(JSON.stringify(parseRuns({ runs: [run('fred')] }, 'fred', 'shared'))).not.toMatch(/secret|prompt|preview|title/);
});
it('removes a backend token before truncation of job display text', async () => {
  const { service } = fixture(async () => [{ ...job('default'), name: `a ${TOKEN.repeat(10)}` }]);
  await service.refresh(); const result = await service.readDefaultRoutines();
  expect(JSON.stringify(result)).not.toContain(TOKEN.slice(0, 16)); await service.shutdown();
});
it.each([404, 405, 501, 500])('distinguishes unsupported routes and failures from genuine empty lists (%s)', async (status) => {
  const { service } = fixture(async () => [], status); await service.refresh();
  expect(await service.readDefaultRoutines()).toEqual({ state: status === 500 ? 'error' : 'unsupported' }); await service.shutdown();
});
it('empty scoped history is not proof of never running; removed jobs fail the ownership recheck', async () => {
  let lists = 0;
  const { service } = fixture(async (url) => url.pathname.endsWith('/runs') ? { runs: [] } : ++lists === 1 ? [job('default')] : []);
  await service.refresh(); expect(await service.readDefaultRoutineRuns('shared')).toEqual({ state: 'error' }); await service.shutdown();
  expect(await readSection(async () => parseRuns({ runs: [] }, 'default', 'shared'))).toEqual({ state: 'ready', data: [] });
});
it('many jobs and runs fail visibly rather than silently accepting an incomplete result', () => {
  const jobs = Array.from({ length: 128 }, (_, i) => ({ ...job('fred'), id: `j${i}` }));
  expect(parseRoutines(jobs, 'fred')).toHaveLength(128); expect(() => parseRoutines([...jobs, job('fred')], 'fred')).toThrow();
  expect(() => parseRuns({ runs: Array.from({ length: 21 }, () => run('fred')) }, 'fred', 'shared')).toThrow();
});
it('default reads offline or with invalid ids never connect, spawn or probe', async () => {
  const { service, fetcher, spawnServe } = fixture(async () => []);
  expect(await service.readDefaultRoutines()).toEqual({ state: 'offline' });
  expect(await service.readDefaultRoutineRuns('../bad')).toEqual({ state: 'unavailable' });
  expect(fetcher).not.toHaveBeenCalled(); expect(spawnServe).not.toHaveBeenCalled(); await service.shutdown();
});
it('drops pending default data after refresh/disconnection; reconnect can read fresh data', async () => {
  let finish!: (value: unknown) => void; let delay = true;
  const { service, hermes } = fixture(async () => delay ? new Promise((resolve) => { finish = resolve; }) : [job('default')]);
  await service.refresh(); const pending = service.readDefaultRoutines(); await service.refresh(); finish([job('default')]);
  expect(await pending).toEqual({ state: 'unavailable' }); delay = false;
  const second = service.readDefaultRoutines(); hermes.wsSockets()[0].close();
  expect(await second).toEqual({ state: 'unavailable' });
  expect(await service.readDefaultRoutines()).toEqual({ state: 'offline' });
  await service.refresh(); expect(await service.readDefaultRoutines()).toMatchObject({ state: 'ready' }); await service.shutdown();
});
it('coalesces and bounds read concurrency; deadlines are errors, invalidation is unavailable', async () => {
  vi.useFakeTimers(); let calls = 0;
  const reader = new AssistantCronReader(() => ({ profile: 'default', token: TOKEN, live: () => true, read: (_path, signal) => {
    calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout'))));
  } }));
  const first = reader.routines({ kind: 'default' }); expect(reader.routines({ kind: 'default' })).toBe(first);
  const others = Array.from({ length: 7 }, (_, i) => reader.runs({ kind: 'default' }, `j${i}`));
  expect(await reader.runs({ kind: 'default' }, 'overflow')).toEqual({ state: 'unavailable' }); expect(calls).toBe(8);
  await vi.advanceTimersByTimeAsync(10001); expect(await first).toEqual({ state: 'error' }); await Promise.all(others);
  const pending = reader.routines({ kind: 'default' }); reader.invalidate(); expect(await pending).toEqual({ state: 'unavailable' });
});
