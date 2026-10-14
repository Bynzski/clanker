import { afterEach, expect, it, vi } from 'vitest';
import { HermesAssistantService } from '../../../src/main/assistants/hermesAssistantService';
import { record } from '../../../src/main/assistants/assistantDetails';
import { FakeHermes, TOKEN } from '../../_helpers/fakeHermes';

const owned: HermesAssistantService[] = [];
afterEach(async () => { await Promise.all(owned.splice(0).map((service) => service.shutdown())); });
const job = (profile: string) => ({ profile, id: 'shared', name: `${profile} task`, enabled: false, state: 'paused' });
async function fixture() {
  const hermes = new FakeHermes();
  const profile = { name: 'fred', path: '/srv/private/fred', has_avatar: false,
    description: 'Operational role', canonical_session: { id: 'existing-chat' },
    ui_meta: { 'hermes-bots': { title: 'Fred', description: 'Tagline', groupId: 'group', hidden: false }, other: { intact: true } },
    ui_meta_revisions: { 'hermes-bots': 1 } };
  const defaults = { name: 'default', path: '/srv/private/default' };
  let profiles: unknown[] = [profile, defaults];
  hermes.respond = (method, params) => {
    if (method === 'profiles.list') return { result: { profiles } };
    if (method === 'profiles.configure') {
      const expected = record(params.ui_meta_expected_revisions)['hermes-bots'];
      if (expected !== profile.ui_meta_revisions['hermes-bots']) return { result: { ok: false, applied: { ui_meta_conflicts: { 'hermes-bots': {} } } } };
      Object.assign(profile.ui_meta['hermes-bots'], record(record(params.ui_meta)['hermes-bots']));
      profile.ui_meta_revisions['hermes-bots']++;
      return { result: { ok: true, applied: { ui_meta: true, ui_meta_revisions: { ...profile.ui_meta_revisions } } } };
    }
    return undefined;
  };
  let finish!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
    const route = new URL(url);
    if (!route.pathname.startsWith('/api/cron/')) return hermes.fetch(url);
    const owner = route.searchParams.get('profile')!;
    const value = route.pathname.endsWith('/runs') ? await new Promise((resolve) => { finish = resolve; signal = init?.signal; }) : [job(owner)];
    return { ok: true, status: 200, text: async () => JSON.stringify(value), json: async () => value };
  });
  const spawnServe = vi.fn(() => { throw new Error('No startup for reads'); });
  const service = new HermesAssistantService({ readSettings: () => ({ enabled: true, autoStart: false }), writeSettings: vi.fn(),
    isHermesAvailable: () => true, isShuttingDown: () => false, onChanged: vi.fn(), onPtyData: vi.fn(), fetch: fetcher,
    createWebSocket: hermes.createWebSocket, readRendezvous: async () => [], spawnServe });
  owned.push(service); await service.refresh();
  const edit = () => {
    const view = service.readPresentation('hermes:fred').cosmetics;
    if (view.state !== 'ready') throw new Error('Expected metadata');
    return view.data;
  };
  const history = async (owner = 'fred') => {
    const pending = owner === 'default' ? service.readDefaultRoutineRuns('shared') : service.readRoutineRuns(`hermes:${owner}`, 'shared');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    return { pending, complete: () => finish({ runs: [{ id: 'cron_shared_20260101_010000', profile: owner, source: 'cron', started_at: 100,
      title: TOKEN, preview: '/srv/private/fred SECRET_OUTPUT' }] }), aborted: () => signal?.aborted };
  };
  return { service, hermes, profile, defaults, edit, history, spawnServe, setProfiles: (value: unknown[]) => { profiles = value; } };
}

it.each(['fred', 'default'])('CAS preflight/postflight keeps a valid concurrent %s history read and preserves private metadata', async (owner) => {
  const ctx = await fixture(); const baseline = ctx.edit(); const read = await ctx.history(owner);
  expect(await ctx.service.readAvatar('hermes:fred')).toEqual({ state: 'ready', data: null });
  expect((await ctx.service.updatePresentation('hermes:fred', { ...baseline, title: 'Cosmetic', tagline: 'New tagline' })).state).toBe('saved');
  expect(read.aborted()).toBe(false); read.complete();
  expect(await read.pending).toEqual({ state: 'ready', data: [{ source: 'cron', startedAt: 100, endedAt: undefined }] });
  expect(ctx.profile).toMatchObject({ description: 'Operational role', canonical_session: { id: 'existing-chat' }, ui_meta: { other: { intact: true }, 'hermes-bots': { hidden: false, groupId: 'group' } } });
  expect(ctx.service.get().assistants.map((row) => row.id)).toEqual(['hermes:fred']);
  expect(JSON.stringify([ctx.service.get(), ctx.service.readPresentation('hermes:fred'), await read.pending])).not.toMatch(/SECRET_OUTPUT|\/srv\/private|tok_ABCDEFGHIJKLMNOP/);
  expect(ctx.hermes.ptySockets()).toHaveLength(0); expect(ctx.spawnServe).not.toHaveBeenCalled();
});

it('combined profile/history details redact native credentials and custom homes before truncation', async () => {
  const ctx = await fixture(); const respond = ctx.hermes.respond;
  ctx.hermes.respond = (method, params) => {
    if (method === 'profiles.describe') return { result: { name: 'fred', model: { default: `${'x'.repeat(145)}${TOKEN}`, provider: ctx.profile.path }, skills: [{ name: `${'x'.repeat(67)}${TOKEN}` }] } };
    if (method === 'session.list') return { result: { sessions: [{ title: `${'x'.repeat(145)}${TOKEN}`, source: 'cli' }, { title: ctx.profile.path, source: 'cli' }] } };
    return respond?.(method, params);
  };
  const value = await ctx.service.readDetails('hermes:fred');
  expect(value.profile.state).toBe('ready'); expect(value.history.state).toBe('ready');
  expect(JSON.stringify(value)).toContain('[redacted]');
  expect(JSON.stringify(value)).not.toContain(TOKEN.slice(0, 10));
  expect(JSON.stringify(value)).not.toContain('/srv/private');
});

it('a superseded cosmetic preflight cannot write using a cached baseline', async () => {
  const ctx = await fixture(); const baseline = ctx.edit();
  let release!: () => void;
  ctx.hermes.holdRoster = new Promise((resolve) => { release = resolve; });
  const write = ctx.service.updatePresentation('hermes:fred', { ...baseline, title: 'Draft' });
  const refresh = ctx.service.refresh();
  release();
  expect((await write).state).toBe('error'); await refresh;
  expect(ctx.hermes.calls.filter(({ method }) => method === 'profiles.configure')).toHaveLength(0);
  expect(ctx.edit().title).toBe('Fred');
});

it('cron reads do not rebase a dirty cosmetic token; a native metadata change still conflicts', async () => {
  const ctx = await fixture(); const baseline = ctx.edit();
  await ctx.service.readDefaultRoutines(); await ctx.service.readDetails('hermes:fred');
  expect(ctx.edit().editToken).toBe(baseline.editToken);
  ctx.profile.ui_meta['hermes-bots'].title = 'Other native client'; ctx.profile.ui_meta_revisions['hermes-bots']++;
  expect((await ctx.service.updatePresentation('hermes:fred', { ...baseline, title: 'Stale draft' })).state).toBe('conflict');
  expect(ctx.hermes.calls.filter(({ method }) => method === 'profiles.configure')).toHaveLength(0);
});

it.each(['explicit refresh', 'profile removed', 'profile home changed', 'default home changed', 'disconnect', 'disable'])('%s rejects old cron results; connection boundaries also reject old edit tokens', async (boundary) => {
  const ctx = await fixture(); const baseline = ctx.edit(); const read = await ctx.history(boundary === 'default home changed' ? 'default' : 'fred');
  if (boundary === 'disconnect') ctx.hermes.wsSockets()[0].close(1006);
  else if (boundary === 'disable') ctx.service.configure({ enabled: false, autoStart: false });
  else if (boundary === 'explicit refresh') await ctx.service.refresh();
  else {
    if (boundary === 'profile removed') ctx.setProfiles([ctx.defaults]);
    if (boundary === 'profile home changed') ctx.profile.path = '/srv/new/fred';
    if (boundary === 'default home changed') ctx.defaults.path = '/srv/new/default';
    const update = await ctx.service.updatePresentation('hermes:fred', { ...baseline, title: 'Cosmetic' });
    if (boundary !== 'default home changed') {
      expect(update.state).toBe('unavailable');
      expect(ctx.hermes.calls.filter(({ method }) => method === 'profiles.configure')).toHaveLength(0);
    }
  }
  expect(read.aborted()).toBe(true); read.complete(); expect(await read.pending).toEqual({ state: 'unavailable' });
  if (boundary === 'disconnect' || boundary === 'disable') {
    expect((await ctx.service.updatePresentation('hermes:fred', { ...baseline, title: 'Late draft' })).state).toBe('unavailable');
    if (boundary === 'disable') ctx.service.configure({ enabled: true, autoStart: false });
    await ctx.service.refresh();
    expect((await ctx.service.updatePresentation('hermes:fred', { ...baseline, title: 'Old token after reconnect' })).state).toBe('conflict');
    expect(await ctx.service.readDefaultRoutines()).toMatchObject({ state: 'ready' });
  }
  expect(ctx.hermes.ptySockets()).toHaveLength(0); expect(ctx.spawnServe).not.toHaveBeenCalled();
});
