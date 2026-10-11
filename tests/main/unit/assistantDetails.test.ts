import { describe, expect, it, vi } from 'vitest';
import { parseActivity, parseHistory, parseProfile, parseRoutines, parseRuns, readHermesRest, readSection } from '../../../src/main/assistants/assistantDetails';
import { HermesAssistantService } from '../../../src/main/assistants/hermesAssistantService';
import { RpcError } from '../../../src/main/assistants/hermesTransport';
import { FakeHermes, TOKEN } from '../../_helpers/fakeHermes';

const job = { id: 'job_1', profile: 'fred', name: 'Morning', enabled: false, state: 'paused', schedule_display: 'Every day', next_run_at: null };
function setup(read: (url: string) => Promise<unknown>) {
  const hermes = new FakeHermes();
  const fetcher = vi.fn(async (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal; redirect?: string }) => {
    if (!new URL(url).pathname.startsWith('/api/cron/')) return hermes.fetch(url);
    expect(init?.headers).toEqual({ 'X-Hermes-Session-Token': TOKEN });
    expect(init?.redirect).toBe('error');
    const value = await read(url);
    return { ok: true, status: 200, text: async () => JSON.stringify(value), json: async () => value };
  });
  const service = new HermesAssistantService({ readSettings: () => ({ enabled: true, autoStart: false }), writeSettings: vi.fn(), onChanged: vi.fn(), onPtyData: vi.fn(), isShuttingDown: () => false, isHermesAvailable: () => true, fetch: fetcher, createWebSocket: hermes.createWebSocket });
  return { service, hermes, fetcher };
}
describe('display-safe read projections', () => {
  it('projects capabilities, never SOUL, homes, MCP URLs or credentials', () => {
    const result = parseProfile({ name: 'fred', soul: 'private', path: '/home/private', model: { default: 'model', provider: 'provider', api_key: 'secret' }, skills: [{ name: 'read', enabled: true }], toolsets: [{ name: 'terminal', enabled: false }], mcp_servers: [{ name: 'docs', enabled: true, url: 'https://token@example.test' }] }, 'fred');
    expect(result).toEqual({ model: 'model', provider: 'provider', skills: [{ name: 'read', enabled: true }], toolsets: [{ name: 'terminal', enabled: false }], mcpServers: [{ name: 'docs', enabled: true }] });
    expect(() => parseProfile({ name: 'reviewer' }, 'fred')).toThrow();
    expect(parseActivity({ skill_count: -1, worker_session: { last_active: 123 } })).toMatchObject({ skillCount: undefined, workerLastActive: 123 });
  });
  it('rejects foreign and duplicate jobs rather than returning an empty list', () => {
    expect(parseRoutines([job], 'fred')[0]).toMatchObject({ enabled: false, state: 'paused', nextRun: undefined });
    expect(() => parseRoutines([job], 'reviewer')).toThrow();
    expect(() => parseRoutines([job, job], 'fred')).toThrow();
    expect(() => parseRoutines(new Array(129).fill(job), 'fred')).toThrow();
  });
  it('keeps script-only output, with unknown results and redacted preview; refuses foreign runs', () => {
    expect(parseRuns({ runs: [{ id: 'cron_output:job_1:date', source: 'cron_output', title: 'Output', started_at: 100, ended_at: 100, preview: 'token=SECRET https://example.test /home/private/file' }] }, 'fred', 'job_1')).toEqual([{ title: 'Output', source: 'cron_output', startedAt: 100, endedAt: 100, preview: 'token=[redacted] [redacted] [redacted]' }]);
    expect(() => parseRuns({ runs: [{ id: 'cron_job_1_date', source: 'cron', profile: 'reviewer' }] }, 'fred', 'job_1')).toThrow();
    expect(() => parseRuns({ runs: [{ id: 'cron_job_2_date', source: 'cron' }] }, 'fred', 'job_1')).toThrow();
  });
  it('does not expose workers or canonical chats in ordinary history', () => {
    expect(parseHistory({ sessions: [{ title: 'Bot Chat', source: 'cli' }, { title: 'worker', source: 'cron' }, { title: 'Ordinary', source: 'cli' }] })).toEqual([{ title: 'Ordinary', lastActive: undefined }]);
  });
  it('distinguishes unsupported contracts from errors and real empty data', async () => {
    expect(await readSection(async () => { throw new RpcError('unsafe path', -32601); })).toEqual({ state: 'unsupported' });
    expect(await readSection(async () => { throw new Error('token=secret'); })).toEqual({ state: 'error' });
    expect(await readSection(async () => [])).toEqual({ state: 'ready', data: [] });
    const fetcher = vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null }));
    expect(await readSection(() => readHermesRest(fetcher, { port: 9119, token: TOKEN }, '/api/cron/jobs?profile=fred', new AbortController().signal))).toEqual({ state: 'unsupported' });
  });
  it('bounds streamed REST reads', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => null, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); controller.close(); } }) }));
    await expect(readHermesRest(fetcher, { port: 1, token: TOKEN }, '/api/cron/jobs', new AbortController().signal)).rejects.toThrow('Response too large');
  });
});
describe('lazy, independent Assistant reads', () => {
  it('does no heavy reads during roster refresh; older describe and failed cron never affect Bot Chat', async () => {
    const { service, hermes, fetcher } = setup(async () => { throw new Error('private backend failure'); });
    await service.refresh();
    expect(hermes.rpcCalls).toEqual(['profiles.list']);
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/api/cron/'))).toHaveLength(0);
    await service.openSurface('hermes:fred');
    const surface = hermes.ptySockets()[0];
    const details = await service.readDetails('hermes:fred');
    expect(details).toMatchObject({ assistantId: 'hermes:fred', profile: { state: 'unsupported' }, routines: { state: 'error' } });
    expect(surface.closed).toBe(false);
    expect(service.get().service.state).toBe('connected');
    await service.shutdown();
  });
  it('resolves only known profile ids, validates job ownership before and after runs', async () => {
    const { service, hermes, fetcher } = setup(async (url) => new URL(url).pathname.endsWith('/runs') ? { runs: [{ id: 'cron_output:job_1:date', source: 'cron_output', started_at: 100 }] } : [job]);
    await service.refresh();
    expect(await service.readRoutineRuns('hermes:fred', 'job_1')).toMatchObject({ state: 'ready', data: [{ source: 'cron_output' }] });
    expect(await service.readRoutineRuns('hermes:reviewer', 'job_1')).toEqual({ state: 'error' });
    const count = fetcher.mock.calls.length;
    expect(await service.readDetails('hermes:unknown')).toMatchObject({ profile: { state: 'unavailable' } });
    expect(await service.readRoutineRuns('hermes:fred', '../secret')).toEqual({ state: 'unavailable' });
    expect(fetcher.mock.calls.length).toBe(count);
    expect(hermes.calls.filter((call) => call.method.startsWith('session.') && call.method !== 'session.list')).toEqual([]);
    await service.shutdown();
  });
  it('never returns the backend credential even if upstream embeds it in a title', async () => {
    const { service } = setup(async () => [{ ...job, name: TOKEN }]);
    await service.refresh();
    const details = await service.readDetails('hermes:fred');
    expect(details.routines).toMatchObject({ state: 'ready', data: [{ name: '[redacted]' }] });
    expect(JSON.stringify(details)).not.toContain(TOKEN);
    await service.shutdown();
  });
  it('refuses results if the job disappeared during the run read', async () => {
    let lists = 0;
    const { service } = setup(async (url) => new URL(url).pathname.endsWith('/runs')
      ? { runs: [{ id: 'cron_output:job_1:date', source: 'cron_output' }] } : ++lists === 1 ? [job] : []);
    await service.refresh();
    expect(await service.readRoutineRuns('hermes:fred', 'job_1')).toEqual({ state: 'error' });
    expect(lists).toBe(2);
    await service.shutdown();
  });
  it('drops in-flight results when a profile is removed', async () => {
    let finish!: (value: unknown) => void;
    const { service, hermes } = setup(() => new Promise((resolve) => { finish = resolve; }));
    await service.refresh();
    const pending = service.readDetails('hermes:fred');
    hermes.profiles = hermes.profiles.filter((profile) => profile.name !== 'fred');
    await service.refresh(); finish([job]);
    expect(await pending).toMatchObject({ profile: { state: 'unavailable' }, routines: { state: 'unavailable' } });
    await service.shutdown();
  });
});
