import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesAssistantService } from '../../../src/main/assistants/hermesAssistantService';
import { record } from '../../../src/main/assistants/assistantDetails';
import { ASSISTANT_TAGLINE_LIMIT, ASSISTANT_TITLE_LIMIT } from '../../../src/shared/types/assistantPresentation';
import { FakeHermes, TOKEN } from '../../_helpers/fakeHermes';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
const asset = { found: true, mime: 'image/png', size: png.length, data: `data:image/png;base64,${png.toString('base64')}` };
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));
const owned: HermesAssistantService[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(owned.splice(0).map((service) => service.shutdown())); });

async function fixture() {
  const hermes = new FakeHermes(); let now = 0;
  const profile: Record<string, unknown> = { name: 'fred', description: 'Operational routing role', display_name: 'Profile display', has_avatar: true,
    ui_meta: { 'hermes-bots': { title: 'Native title', description: 'Native tagline', hidden: false, groupId: 'group-one', appearance: { color: 'blue' }, private: TOKEN }, other: { intact: true } },
    ui_meta_revisions: { 'hermes-bots': 3, other: 8 }, canonical_session: { id: 'stable-chat' }, path: '/home/private', soul: 'private prompt' };
  let profiles = [profile];
  let configureMode: 'success' | 'failure' | 'unsupported' | 'conflict' | 'unconfirmed' = 'success';
  let avatar: unknown = asset;
  hermes.respond = (method, params) => {
    if (method === 'profiles.list') return { result: { profiles } };
    if (method === 'profiles.get_asset') return { result: avatar };
    if (method === 'profiles.configure') {
      if (configureMode === 'unsupported') return { error: { code: -32601, message: `unknown ${TOKEN}` } };
      if (configureMode === 'failure') return { result: { ok: false, applied: { ui_meta: false }, error: TOKEN } };
      const expected = record(params.ui_meta_expected_revisions)['hermes-bots'];
      const revisions = record(profile.ui_meta_revisions);
      if (configureMode === 'conflict' || expected !== (revisions['hermes-bots'] ?? 0)) {
        revisions['hermes-bots'] = Number(revisions['hermes-bots']) + 1;
        record(record(profile.ui_meta)['hermes-bots']).title = 'Desktop winner';
        return { result: { ok: false, applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { actual: revisions['hermes-bots'] } } } } };
      }
      record(profile.ui_meta)['hermes-bots'] = record(params.ui_meta)['hermes-bots'];
      revisions['hermes-bots'] = Number(expected) + 1;
      return { result: { ok: true, applied: { ui_meta: true, ...(configureMode !== 'unconfirmed' ? { ui_meta_revisions: { 'hermes-bots': revisions['hermes-bots'] } } : {}) } } };
    }
    return undefined;
  };
  const spawnServe = vi.fn(() => { throw new Error('must not start a backend'); });
  const changed = vi.fn(); const decode = vi.fn(() => ({ bytes: png, width: 1, height: 1 }));
  const service = new HermesAssistantService({ readSettings: () => ({ enabled: true, autoStart: false }), writeSettings: vi.fn(),
    isHermesAvailable: () => true, isShuttingDown: () => false, onChanged: changed, onPtyData: vi.fn(), fetch: hermes.fetch as never,
    createWebSocket: hermes.createWebSocket, readRendezvous: async () => [], spawnServe, decodeAvatar: decode, now: () => now });
  owned.push(service); await service.refresh();
  const edit = () => {
    const value = service.readPresentation('hermes:fred').cosmetics;
    if (value.state !== 'ready') throw new Error('fixture metadata unavailable');
    return value.data;
  };
  const save = (title = 'New title', tagline = 'New tagline') => service.updatePresentation('hermes:fred', { ...edit(), title, tagline });
  const writes = () => hermes.calls.filter(({ method }) => method === 'profiles.configure');
  return { service, hermes, profile, edit, save, writes, decode, spawnServe, changed,
    setMode: (mode: typeof configureMode) => { configureMode = mode; }, setAvatar: (value: unknown) => { avatar = value; },
    setProfiles: (value: typeof profiles) => { profiles = value; }, advance: (ms: number) => { now += ms; } };
}

describe('native Bot Mode cosmetics', () => {
  it('projects native title/tagline but never operational descriptions, raw metadata, paths or credentials', async () => {
    const { service, edit } = await fixture();
    expect(edit()).toMatchObject({ title: 'Native title', tagline: 'Native tagline', editToken: expect.any(String) });
    expect(JSON.stringify(service.readPresentation('hermes:fred'))).not.toMatch(/Operational|private|soul|groupId|appearance|ui_meta/);
    expect(JSON.stringify(service.readPresentation('hermes:fred'))).not.toContain(TOKEN);
    expect(service.get().assistants[0]).toMatchObject({ id: 'hermes:fred', displayName: 'Native title', description: 'Native tagline' });
  });
  it('redacts actual custom profile paths and backend credentials before truncating public labels/activity', async () => {
    const { profile, service, edit } = await fixture();
    const privatePath = `/srv/private-hermes/${'x'.repeat(90)}/profiles/fred`; profile.path = privatePath;
    record(record(profile.ui_meta)['hermes-bots']).title = `Title ${privatePath}`;
    profile.model = TOKEN; profile.last_session = { title: TOKEN };
    await service.refresh();
    expect(JSON.stringify([service.get(), service.readPresentation('hermes:fred')])).not.toContain('/srv/private-hermes/');
    expect(JSON.stringify(service.get())).not.toContain(TOKEN);
    expect(edit().editToken).toBeUndefined();
  });
  it('namespace-preserving CAS writes only cosmetics and keeps assistant/chat identity unchanged', async () => {
    const ctx = await fixture(); const { service, profile, hermes } = ctx;
    const before = service.get().assistants[0].id;
    const result = await ctx.save();
    expect(result.state).toBe('saved');
    expect(ctx.writes()[0].params).toEqual({ name: 'fred', ui_meta: { 'hermes-bots': { title: 'New title', description: 'New tagline', hidden: false,
      groupId: 'group-one', appearance: { color: 'blue' }, private: TOKEN } }, ui_meta_expected_revisions: { 'hermes-bots': 3 } });
    expect(profile.description).toBe('Operational routing role');
    expect(record(profile.ui_meta).other).toEqual({ intact: true });
    expect(record(profile.ui_meta_revisions).other).toBe(8);
    expect(profile.canonical_session).toEqual({ id: 'stable-chat' });
    expect(service.get().assistants[0]).toMatchObject({ id: before, displayName: 'New title', description: 'New tagline' });
    expect(hermes.calls.every(({ method }) => ['profiles.list', 'profiles.configure'].includes(method))).toBe(true);
    expect(ctx.spawnServe).not.toHaveBeenCalled();
  });
  it('editing a Hermes-hidden selected profile preserves its native hiding and grouping', async () => {
    const { profile, service, save } = await fixture();
    record(record(profile.ui_meta)['hermes-bots']).hidden = true; await service.refresh();
    expect(service.get().assistants).toEqual([]);
    expect((await save()).state).toBe('saved');
    expect(record(record(profile.ui_meta)['hermes-bots'])).toMatchObject({ hidden: true, groupId: 'group-one' });
    expect(service.get().profiles?.[0]).toMatchObject({ id: 'hermes:fred', displayName: 'New title', hiddenInHermes: true });
    expect(service.get().assistants).toEqual([]);
  });
  it('clearing bot cosmetics restores existing display/operational-description fallback without editing either', async () => {
    const { save, service, edit, profile } = await fixture();
    expect((await save('', '')).state).toBe('saved');
    expect(edit()).toMatchObject({ title: '', tagline: '' });
    expect(service.get().assistants[0]).toMatchObject({ displayName: 'Profile display', description: 'Operational routing role' });
    delete profile.display_name; await service.refresh();
    expect(service.get().assistants[0].displayName).toBe('Fred');
  });
  it('supports absent bot metadata with revision 0 and preserves other namespaces', async () => {
    const { profile, service, save, writes } = await fixture();
    delete record(profile.ui_meta)['hermes-bots']; profile.ui_meta_revisions = { other: 8 }; await service.refresh();
    expect((await save()).state).toBe('saved');
    expect(record(writes()[0].params.ui_meta_expected_revisions)['hermes-bots']).toBe(0);
  });
  it.each([undefined, null, [], { 'hermes-bots': -1 }, { 'hermes-bots': null }, { 'hermes-bots': true }])('never writes without a valid native revision contract %j', async (revisions) => {
    const { profile, service, edit, save, writes } = await fixture(); profile.ui_meta_revisions = revisions; await service.refresh();
    expect(edit().editToken).toBeUndefined();
    expect((await save()).state).not.toBe('saved'); expect(writes()).toEqual([]);
  });
  it('rejects malformed, excessive or redacted native fields rather than replacing unrelated metadata', async () => {
    const { profile, service, edit, writes, save } = await fixture();
    for (const bot of [[], 'invalid', null, { title: TOKEN }, { title: 'x'.repeat(81) }, { huge: 'x'.repeat(33000) }, { largeId: Number.MAX_SAFE_INTEGER + 1 }]) {
      record(profile.ui_meta)['hermes-bots'] = bot; await service.refresh();
      expect(edit().editToken).toBeUndefined(); expect((await save()).state).not.toBe('saved');
      expect(JSON.stringify(service.get())).not.toContain(TOKEN);
    }
    expect(writes()).toEqual([]);
  });
  it('detects another client changing even an unrelated field, without rebasing the old editor', async () => {
    const { profile, edit, service, writes } = await fixture(); const update = { ...edit(), title: 'Unsaved' };
    record(record(profile.ui_meta)['hermes-bots']).groupId = 'new-group'; // Even a legacy writer not incrementing CAS is detected on preflight.
    const result = await service.updatePresentation('hermes:fred', update);
    expect(result.state).toBe('conflict'); expect(writes()).toEqual([]);
    expect(result.presentation?.cosmetics).toMatchObject({ state: 'ready', data: { title: 'Native title' } });
  });
  it('detects same-value native revision changes and refreshes authoritative values', async () => {
    const { profile, edit, service, writes } = await fixture(); const update = { ...edit(), title: 'Unsaved' };
    record(profile.ui_meta_revisions)['hermes-bots'] = 4;
    expect((await service.updatePresentation('hermes:fred', update)).state).toBe('conflict'); expect(writes()).toEqual([]);
  });
  it('respects a CAS rejection occurring after preflight, reloads the winner and never retries the write', async () => {
    const { setMode, save, writes } = await fixture(); setMode('conflict');
    const result = await save(); expect(result.state).toBe('conflict'); expect(writes()).toHaveLength(1);
    expect(result.presentation?.cosmetics).toMatchObject({ state: 'ready', data: { title: 'Desktop winner' } });
  });
  it.each(['failure', 'unsupported', 'unconfirmed'] as const)('reports %s and re-reads rather than optimistically echoing the request', async (mode) => {
    const { setMode, save, writes, hermes } = await fixture(); setMode(mode);
    const result = await save(); expect(result.state).toBe(mode === 'unsupported' ? 'unsupported' : 'error');
    expect(result.presentation?.cosmetics.state).toBe('ready');
    expect(hermes.calls[hermes.calls.length - 1]?.method).toBe('profiles.list'); expect(writes()).toHaveLength(1);
    if (mode === 'unsupported' && result.presentation?.cosmetics.state === 'ready') expect(result.presentation.cosmetics.data.editToken).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
  it('bounds renderer text and rejects extra write capabilities and foreign/unknown IDs', async () => {
    const { service, edit, writes } = await fixture();
    for (const value of [{ ...edit(), title: 'x'.repeat(ASSISTANT_TITLE_LIMIT + 1) }, { ...edit(), tagline: 'x'.repeat(ASSISTANT_TAGLINE_LIMIT + 1) },
      { ...edit(), title: 'line\nbreak' }, { ...edit(), soul: 'must not write' }, { ...edit(), editToken: 42 }]) expect((await service.updatePresentation('hermes:fred', value)).state).toBe('invalid');
    for (const id of ['hermes:default', 'hermes:unknown', 'hermes:ssh-host:fred', '../fred']) {
      expect(service.readPresentation(id).cosmetics.state).toBe('unavailable');
      expect((await service.readAvatar(id)).state).toBe('unavailable');
      expect((await service.updatePresentation(id, edit())).state).toBe('unavailable');
    }
    expect(writes()).toEqual([]);
  });
  it('invalidates edit handles across disconnect/reconnect and cannot confirm an old in-flight write', async () => {
    const { service, hermes, save, edit, writes } = await fixture(); const old = edit();
    let release!: () => void; hermes.holds.set('profiles.configure', new Promise((resolve) => { release = resolve; }));
    const pending = save(); await flush(); expect(writes()).toHaveLength(1);
    hermes.wsSockets()[0].close();
    expect((await pending).state).toBe('unavailable');
    expect(service.readPresentation('hermes:fred').cosmetics.state).toBe('unavailable');
    hermes.holds.clear(); release(); await service.refresh();
    expect(edit().editToken).not.toBe(old.editToken);
    expect((await service.updatePresentation('hermes:fred', { ...old, title: 'stale' })).state).toBe('conflict');
    expect(writes()).toHaveLength(1);
  });
  it('a native write timeout is an unconfirmed outcome, followed by an authoritative read and no retry', async () => {
    const { hermes, save, writes } = await fixture();
    let release!: () => void; hermes.holds.set('profiles.configure', new Promise((resolve) => { release = resolve; }));
    vi.useFakeTimers();
    const pending = save(); await vi.advanceTimersByTimeAsync(0);
    expect(writes()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_001);
    const result = await pending;
    expect(result.state).toBe('error'); expect(writes()).toHaveLength(1);
    expect(result.presentation?.cosmetics).toMatchObject({ state: 'ready', data: { title: 'Native title' } });
    expect(hermes.calls[hermes.calls.length - 1]?.method).toBe('profiles.list');
    hermes.holds.clear(); release();
  });
  it('serializes writes for a profile and a removed profile cannot receive a delayed save', async () => {
    const { hermes, save, setProfiles, writes } = await fixture();
    let release!: () => void; hermes.holdRoster = new Promise((resolve) => { release = resolve; });
    const pending = save(); await flush();
    expect((await save()).state).toBe('unavailable');
    setProfiles([]); hermes.holdRoster = null; release();
    expect((await pending).state).toBe('unavailable'); expect(writes()).toEqual([]);
  });
});

describe('local avatar lifecycle and resource bounds', () => {
  it('coalesces/cache reads and invalidates them on explicit refresh; never calls an asset write', async () => {
    const { service, hermes, advance } = await fixture();
    const [a, b] = await Promise.all([service.readAvatar('hermes:fred'), service.readAvatar('hermes:fred')]);
    expect(a).toEqual(b); expect(a.state).toBe('ready');
    expect(hermes.calls.filter(({ method }) => method === 'profiles.get_asset')).toHaveLength(1);
    await service.readAvatar('hermes:fred'); advance(60_001); await service.readAvatar('hermes:fred');
    expect(hermes.calls.filter(({ method }) => method === 'profiles.get_asset')).toHaveLength(2);
    await service.refresh(); await service.readAvatar('hermes:fred');
    expect(hermes.calls.filter(({ method }) => method === 'profiles.get_asset')).toHaveLength(3);
    expect(hermes.calls.some(({ method }) => method === 'profiles.set_asset')).toBe(false);
  });
  it('an ambiguous duplicate native profile cannot gain avatar or edit authority', async () => {
    const { service, profile, setProfiles, hermes } = await fixture();
    setProfiles([profile, { ...profile, path: '/other/profile' }]); await service.refresh();
    expect(service.readPresentation('hermes:fred').cosmetics.state).toBe('error');
    expect(await service.readAvatar('hermes:fred')).toEqual({ state: 'unavailable' });
    expect(hermes.calls.some(({ method }) => method === 'profiles.get_asset')).toBe(false);
  });
  it('skips known absent assets and handles unsupported/malformed reads without affecting the service', async () => {
    const { profile, service, hermes, setAvatar } = await fixture(); profile.has_avatar = false; await service.refresh();
    expect(await service.readAvatar('hermes:fred')).toEqual({ state: 'ready', data: null });
    expect(hermes.calls.some(({ method }) => method === 'profiles.get_asset')).toBe(false);
    delete profile.has_avatar; setAvatar({ found: false }); await service.refresh();
    expect(await service.readAvatar('hermes:fred')).toEqual({ state: 'ready', data: null });
    setAvatar({ found: true, mime: 'image/svg+xml', data: '<svg/>' }); await service.refresh();
    expect(await service.readAvatar('hermes:fred')).toEqual({ state: 'error' });
    const respond = hermes.respond!; hermes.respond = (method, params) => method === 'profiles.get_asset' ? { error: { code: -32601, message: TOKEN } } : respond(method, params);
    await service.refresh(); expect(await service.readAvatar('hermes:fred')).toEqual({ state: 'unsupported' });
    expect(service.get().service.state).toBe('connected');
  });
  it('rejects stale avatar results after refresh and disconnect, and recovers on retry', async () => {
    const { service, hermes } = await fixture();
    let release!: () => void; hermes.holds.set('profiles.get_asset', new Promise((resolve) => { release = resolve; }));
    const pending = service.readAvatar('hermes:fred'); await flush(); await service.refresh();
    hermes.holds.clear(); release(); expect(await pending).toEqual({ state: 'unavailable' });
    expect((await service.readAvatar('hermes:fred')).state).toBe('ready');
    await service.refresh(); hermes.holds.set('profiles.get_asset', new Promise((resolve) => { release = resolve; }));
    const disconnected = service.readAvatar('hermes:fred'); await flush(); hermes.wsSockets()[0].close();
    expect(await disconnected).toEqual({ state: 'unavailable' });
    hermes.holds.clear(); release(); await service.refresh(); expect((await service.readAvatar('hermes:fred')).state).toBe('ready');
  });
  it('bounds a hung native avatar RPC and recovers after refresh without disconnecting the service', async () => {
    const { service, hermes } = await fixture();
    let release!: () => void; hermes.holds.set('profiles.get_asset', new Promise((resolve) => { release = resolve; }));
    vi.useFakeTimers();
    const pending = service.readAvatar('hermes:fred'); await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toEqual({ state: 'error' }); expect(service.get().service.state).toBe('connected');
    hermes.holds.clear(); release(); await service.refresh();
    expect((await service.readAvatar('hermes:fred')).state).toBe('ready');
  });
  it('limits simultaneous reads to four and retains at most sixteen cached thumbnails', async () => {
    const { service, hermes, setProfiles, profile } = await fixture();
    setProfiles(Array.from({ length: 64 }, (_, i) => ({ ...profile, name: `p${i}` }))); await service.refresh();
    let release!: () => void; hermes.holds.set('profiles.get_asset', new Promise((resolve) => { release = resolve; }));
    const reads = Array.from({ length: 64 }, (_, i) => service.readAvatar(`hermes:p${i}`)); await flush();
    expect(hermes.calls.filter(({ method }) => method === 'profiles.get_asset')).toHaveLength(4);
    hermes.holds.clear(); release(); await Promise.all(reads);
    expect(hermes.calls.filter(({ method }) => method === 'profiles.get_asset')).toHaveLength(64);
    await service.readAvatar('hermes:p63'); expect(hermes.calls.filter(({ method }) => method === 'profiles.get_asset')).toHaveLength(64);
    await service.readAvatar('hermes:p0'); expect(hermes.calls.filter(({ method }) => method === 'profiles.get_asset')).toHaveLength(65);
  });
});
