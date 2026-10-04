import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesBotService, parseBotRoster, type HermesBotServiceDeps } from '../../../src/main/assistants/hermesBotService';
import { readPersistedAssistantSettings } from '../../../src/main/assistants/assistantSettings';
import type { AssistantSettings, AssistantSnapshot } from '../../../src/shared/types/assistants';
import { FakeHermes, TOKEN, fakeChild } from '../../_helpers/fakeHermes';

const flush = async (ms = 5) => { await new Promise((resolve) => setTimeout(resolve, ms)); };

function setup(initial: unknown = { enabled: false, autoStart: false }, overrides: Partial<HermesBotServiceDeps> = {}) {
  const hermes = new FakeHermes();
  let stored: unknown = initial;
  const children: ReturnType<typeof fakeChild>[] = [];
  const spawnServe = vi.fn(() => { const child = fakeChild(); children.push(child); return child; });
  const snapshots: AssistantSnapshot[] = [];
  const ptyData: Array<[string, string]> = [];
  const service = new HermesBotService({
    readSettings: () => stored,
    writeSettings: (settings: AssistantSettings) => { stored = settings; },
    onChanged: (snapshot) => snapshots.push(snapshot),
    onPtyData: (botId, data) => ptyData.push([botId, data]),
    isShuttingDown: () => false,
    isHermesAvailable: () => true,
    fetch: hermes.fetch as never,
    createWebSocket: hermes.createWebSocket,
    spawnServe,
    generateToken: () => 'owned-token-0123456789abcdefghijklmnop',
    startTimeoutMs: 40,
    stopGraceMs: 20,
    ...overrides,
  });
  const ready = (child: ReturnType<typeof fakeChild>, port = 40123) => { child.stdout.write(`HERMES_BACKEND_READY port=${port}\n`); };
  return { service, hermes, spawnServe, children, snapshots, ptyData, ready, stored: () => stored };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('settings and enablement', () => {
  it('disabled performs zero probes, sockets or spawns', async () => {
    const { service, hermes, spawnServe } = setup();
    service.start();
    await flush();
    expect(hermes.fetch).not.toHaveBeenCalled();
    expect(hermes.createWebSocket).not.toHaveBeenCalled();
    expect(spawnServe).not.toHaveBeenCalled();
    expect(service.get()).toMatchObject({ settings: { enabled: false, autoStart: false }, service: { state: 'disabled', ownership: null }, bots: [] });
    await expect(service.refresh()).rejects.toThrow(/disabled/);
  });
  it('tolerates a legacy pins config: keeps enabled, drops pins, defaults autoStart', () => {
    expect(readPersistedAssistantSettings({ enabled: true, pins: [{ harnessId: 'hermes', profileName: 'x' }] })).toEqual({ enabled: true, autoStart: false });
    expect(readPersistedAssistantSettings(undefined)).toEqual({ enabled: false, autoStart: false });
    expect(readPersistedAssistantSettings('garbage')).toEqual({ enabled: false, autoStart: false });
    const { service } = setup({ enabled: true, pins: [1, 2] });
    expect(service.get().settings).toEqual({ enabled: true, autoStart: false });
  });
  it('rejects malformed renderer settings and persists only the two booleans', () => {
    const { service, stored } = setup();
    expect(() => service.configure({ enabled: true })).toThrow();
    expect(() => service.configure({ enabled: 'yes', autoStart: false })).toThrow();
    service.configure({ enabled: false, autoStart: true, token: 'x', pins: [] });
    expect(stored()).toEqual({ enabled: false, autoStart: true });
  });
});

describe('Hermes CLI availability', () => {
  it('is dormant when Hermes is not installed even with persisted enabled+autoStart: no probe, no spawn, preference kept', async () => {
    const { service, hermes, spawnServe, stored } = setup({ enabled: true, autoStart: true }, { isHermesAvailable: () => false });
    service.start();
    await flush();
    expect((await service.refresh()).available).toBe(false);
    service.configure({ enabled: true, autoStart: true });
    await flush();
    expect(hermes.fetch).not.toHaveBeenCalled();
    expect(hermes.createWebSocket).not.toHaveBeenCalled();
    expect(spawnServe).not.toHaveBeenCalled();
    expect(service.get()).toMatchObject({ available: false, settings: { enabled: true, autoStart: true }, service: { state: 'disabled' } });
    expect(stored()).toEqual({ enabled: true, autoStart: true });
  });
  it('treats a throwing availability check as not installed', () => {
    const { service } = setup({ enabled: true, autoStart: false }, { isHermesAvailable: () => { throw new Error('boom'); } });
    expect(service.get().available).toBe(false);
  });
  it('the same persisted settings work once Hermes is available on the next construction', async () => {
    const first = setup({ enabled: true, autoStart: true }, { isHermesAvailable: () => false });
    first.service.start(); await flush();
    expect(first.hermes.fetch).not.toHaveBeenCalled();
    const second = setup(first.stored());
    second.service.start();
    await flush(20);
    expect(second.service.get()).toMatchObject({ available: true, service: { state: 'connected' } });
  });
  it('disabling still cleans up an owned child regardless of availability bookkeeping', async () => {
    const { service, hermes, children, ready } = setup({ enabled: true, autoStart: true });
    hermes.running = false;
    const pending = service.refresh(); await flush(); hermes.running = true; ready(children[0]); await pending;
    service.configure({ enabled: false, autoStart: true });
    await flush(30);
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('existing backend adoption', () => {
  it('adopts a compatible running backend without ever spawning, even with autoStart', async () => {
    const { service, hermes, spawnServe } = setup({ enabled: true, autoStart: true });
    const snapshot = await service.refresh();
    expect(spawnServe).not.toHaveBeenCalled();
    expect(snapshot.service).toMatchObject({ state: 'connected', ownership: 'external' });
    expect(hermes.fetched[0]).toBe('http://127.0.0.1:9119/api/status');
    expect(hermes.wsSockets()[0].url).toBe(`ws://127.0.0.1:9119/api/ws?token=${TOKEN}`);
  });
  it('never stops an external backend on disable or shutdown', async () => {
    const { service, hermes, spawnServe } = setup({ enabled: true, autoStart: true });
    await service.refresh();
    service.configure({ enabled: false, autoStart: true });
    await flush();
    await service.shutdown();
    expect(spawnServe).not.toHaveBeenCalled();
    expect(hermes.wsSockets().every((socket) => socket.closed)).toBe(true);
    expect(service.get().service.ownership).toBeNull();
  });
  it('offline with autoStart off stays offline and never spawns', async () => {
    const { service, hermes, spawnServe } = setup({ enabled: true, autoStart: false });
    hermes.running = false;
    const snapshot = await service.refresh();
    expect(snapshot.service.state).toBe('offline');
    expect(spawnServe).not.toHaveBeenCalled();
  });
  it('a healthy service that cannot be authenticated is detected-unusable: no competing backend, nothing killed', async () => {
    for (const mutate of [(h: FakeHermes) => { h.authRequired = true; }, (h: FakeHermes) => { h.bootstrap = '<html>nothing</html>'; }, (h: FakeHermes) => { h.bootstrap = 'x'.repeat(70_000); }]) {
      const { service, hermes, spawnServe } = setup({ enabled: true, autoStart: true });
      mutate(hermes);
      const snapshot = await service.refresh();
      expect(snapshot.service.state).toBe('detected-unusable');
      expect(spawnServe).not.toHaveBeenCalled();
      expect(hermes.createWebSocket).not.toHaveBeenCalled();
    }
  });
  it.each([
    ['too short', 'window.__HERMES_SESSION_TOKEN__="short";'],
    ['unquoted', 'window.__HERMES_SESSION_TOKEN__=abcdefghijklmnopqrstuvwxyz;'],
    ['injected', 'window.__HERMES_SESSION_TOKEN__="abcdefghijklmnopqrstuvwxyz\\"+alert(1)+\\"";'],
    ['bad characters', 'window.__HERMES_SESSION_TOKEN__="abcdefghijklmnopqrstuvwxyz!@#$%^";'],
    ['other variable', 'window.__SOMETHING_ELSE__="abcdefghijklmnopqrstuvwxyz0123456789";'],
  ])('accepts only the exact bounded token assignment (%s rejected)', async (_name, html) => {
    const { service, hermes } = setup({ enabled: true, autoStart: false });
    hermes.bootstrap = html;
    expect((await service.refresh()).service.state).toBe('detected-unusable');
  });
  it('a non-Hermes listener on the port is not adopted', async () => {
    const { service, hermes, spawnServe } = setup({ enabled: true, autoStart: false });
    hermes.fetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }), text: async () => '' }));
    expect((await service.refresh()).service.state).toBe('offline');
    expect(spawnServe).not.toHaveBeenCalled();
  });
});

describe('Clanker-owned backend', () => {
  it('starts with the generated token when offline and autoStart is on, then adopts the printed port', async () => {
    const { service, hermes, spawnServe, children, ready } = setup({ enabled: true, autoStart: true });
    hermes.running = false;
    const pending = service.refresh();
    await flush();
    expect(spawnServe).toHaveBeenCalledWith('owned-token-0123456789abcdefghijklmnop');
    hermes.running = true;
    ready(children[0]);
    const snapshot = await pending;
    expect(snapshot.service).toMatchObject({ state: 'connected', ownership: 'clanker' });
    expect(hermes.wsSockets()[0].url).toBe('ws://127.0.0.1:40123/api/ws?token=owned-token-0123456789abcdefghijklmnop');
  });
  it('accepts the readiness sentinel on stderr', async () => {
    const { service, hermes, children } = setup({ enabled: true, autoStart: true });
    hermes.running = false;
    const pending = service.refresh();
    await flush();
    hermes.running = true;
    children[0].stderr.write('noise\nHERMES_BACKEND_READY port=40200\n');
    expect((await pending).service.state).toBe('connected');
    expect(hermes.wsSockets()[0].url).toContain(':40200/');
  });
  it.each([
    ['timeout', () => undefined, /not become ready/],
    ['near-miss sentinel', (c: ReturnType<typeof fakeChild>) => { c.stdout.write('HERMES_BACKEND_READY port=abc\nhermes_backend_ready port=1\nHERMES_BACKEND_READY port=1 extra\n'); }, /not become ready/],
    ['out-of-range port', (c: ReturnType<typeof fakeChild>) => { c.stdout.write('HERMES_BACKEND_READY port=99999\n'); }, /invalid port/],
    ['port in use', (c: ReturnType<typeof fakeChild>) => { c.stderr.write('BACKEND_PORT_IN_USE port=9119\n'); }, /already in use/],
    ['exit before ready', (c: ReturnType<typeof fakeChild>) => { setTimeout(() => c.crash(3), 1); }, /exited before/],
  ])('reports startup failure: %s', async (_name, act, message) => {
    const { service, hermes, children } = setup({ enabled: true, autoStart: true });
    hermes.running = false;
    const pending = service.refresh();
    await flush();
    act(children[0]);
    const snapshot = await pending;
    expect(snapshot.service.state).toBe('error');
    expect(snapshot.service.error).toMatch(message);
    expect(snapshot.service.error).not.toContain('owned-token');
    await flush(30);
    expect(children[0].kill).toHaveBeenCalled();
  });
  it('reports a spawn failure (hermes not installed) as an error without a token in it', async () => {
    const { service, hermes } = setup({ enabled: true, autoStart: true }, { spawnServe: () => { throw new Error('hermes is not installed /secret/path owned-token'); } });
    hermes.running = false;
    const snapshot = await service.refresh();
    expect(snapshot.service.state).toBe('error');
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|owned-token/);
  });
  it('stops exactly the owned child on disable and on shutdown', async () => {
    for (const stop of ['disable', 'shutdown'] as const) {
      const { service, hermes, children, ready } = setup({ enabled: true, autoStart: true });
      hermes.running = false;
      const pending = service.refresh(); await flush(); hermes.running = true; ready(children[0]); await pending;
      if (stop === 'disable') service.configure({ enabled: false, autoStart: true }); else await service.shutdown();
      await flush(30);
      expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
      expect(children[0].kill).not.toHaveBeenCalledWith('SIGKILL');
    }
  });
  it('allows one bounded restart per failure episode and never loops', async () => {
    const { service, hermes, spawnServe, children, ready } = setup({ enabled: true, autoStart: true });
    hermes.running = false;
    const first = service.refresh(); await flush(); hermes.running = true; ready(children[0]); await first;
    hermes.running = false; // nothing else is listening on the default port
    children[0].crash();
    await flush(10);
    expect(spawnServe).toHaveBeenCalledTimes(2);
    hermes.running = true;
    ready(children[1], 40124);
    await flush(10);
    expect(service.get().service.state).toBe('connected');
    hermes.running = false;
    children[1].crash(); // immediately again: same episode, no further restart
    await flush(20);
    expect(spawnServe).toHaveBeenCalledTimes(2);
    expect(service.get().service).toMatchObject({ state: 'error', error: 'Hermes service stopped unexpectedly' });
  });
  it('a crash with autoStart off is not restarted', async () => {
    const { service, hermes, spawnServe, children, ready } = setup({ enabled: true, autoStart: true });
    hermes.running = false;
    const first = service.refresh(); await flush(); hermes.running = true; ready(children[0]); await first;
    service.configure({ enabled: true, autoStart: false });
    children[0].crash();
    await flush(10);
    expect(spawnServe).toHaveBeenCalledTimes(1);
    expect(service.get().service.state).toBe('error');
  });
});

describe('roster', () => {
  it('lists every valid named profile except default, with or without Bot metadata; routes by slug; names by Bot title > display name > prettified slug', async () => {
    const { service } = setup({ enabled: true, autoStart: false });
    const { bots } = await service.refresh();
    expect(bots.map((bot) => [bot.id, bot.profileName, bot.displayName, bot.canonicalSessionId])).toEqual([
      ['hermes:fred', 'fred', 'Fred', undefined],
      ['hermes:reviewer', 'reviewer', 'Code Reviewer', 'sess-rev-tip'],
      ['hermes:ops-agent', 'ops-agent', 'Ops Agent', 'sess-ops'],
    ]);
    expect(bots.find((bot) => bot.profileName === 'fred')?.description).toBe('Fred is a general-purpose assistant.');
    expect(bots.find((bot) => bot.profileName === 'reviewer')?.description).toBe('Reviews changes');
    const names = bots.map((bot) => bot.profileName);
    expect(names).not.toContain('default');
    expect(names).not.toContain('hidden-one');
    expect(names).not.toContain('bad name!');
    expect(JSON.stringify(bots)).not.toMatch(/path|home|token/i);
  });
  it('does not require a messaging gateway, Bot metadata or an existing canonical chat for eligibility', () => {
    const roster = parseBotRoster({ profiles: [
      { name: 'solo', canonical_session: null, gateway_running: false },
      { name: 'default', is_default: true, ui_meta: { 'hermes-bots': { title: 'Hermes' } } },
      { name: 'renamed-default', is_default: true },
    ] });
    expect(roster.map((entry) => entry.slug)).toEqual(['solo']);
    expect(roster[0].hadCanonical).toBe(false);
  });
  it('falls back to the profile display name and then a prettified slug; malformed shapes are skipped', () => {
    const roster = parseBotRoster({ profiles: [
      { name: 'a', display_name: 'Alpha' },
      { name: 'b-slug_two' },
      'junk', null, { name: 42 },
    ] });
    expect(roster.map((entry) => entry.public.displayName)).toEqual(['Alpha', 'B Slug Two']);
    expect(roster.map((entry) => entry.slug)).toEqual(['a', 'b-slug_two']);
    expect(() => parseBotRoster({})).toThrow();
  });
  it('a late roster result cannot overwrite a newer service generation', async () => {
    const { service, hermes } = setup({ enabled: true, autoStart: false });
    let release!: () => void;
    hermes.holdRoster = new Promise<void>((resolve) => { release = resolve; });
    const stale = service.refresh();
    await flush();
    service.configure({ enabled: false, autoStart: false });
    await flush();
    hermes.holdRoster = null;
    service.configure({ enabled: true, autoStart: false });
    await flush(15);
    expect(service.get().bots).toHaveLength(3);
    hermes.profiles = [{ name: 'late' }];
    release();
    await stale;
    await flush();
    expect(service.get().bots.map((bot) => bot.profileName)).toEqual(['fred', 'reviewer', 'ops-agent']);
  });
  it('coalesces same-generation refreshes into one roster call', async () => {
    const { service, hermes } = setup({ enabled: true, autoStart: false });
    await Promise.all([service.refresh(), service.refresh()]);
    expect(hermes.rpcCalls.filter((call) => call === 'profiles.list')).toHaveLength(1);
    await service.refresh();
    expect(hermes.wsSockets()).toHaveLength(1);
    expect(hermes.rpcCalls.filter((call) => call === 'profiles.list')).toHaveLength(2);
  });
  it('the snapshot never contains the backend token', async () => {
    const { service, snapshots } = setup({ enabled: true, autoStart: false });
    await service.refresh();
    expect(JSON.stringify([service.get(), ...snapshots])).not.toContain(TOKEN);
  });
});

describe('canonical Bot Chat resolution', () => {
  const open = async () => {
    const ctx = setup({ enabled: true, autoStart: false });
    await ctx.service.refresh();
    return ctx;
  };
  const methods = (hermes: FakeHermes) => hermes.calls.map((call) => call.method).filter((method) => method !== 'profiles.list');
  const ptyParams = (hermes: FakeHermes, index = 0) => new URL(hermes.ptySockets()[index].url).searchParams;

  it('uses an existing canonical chat found by exact lookup and never creates', async () => {
    const { service, hermes } = await open();
    hermes.canonical.reviewer = 'sess-existing-tip';
    expect((await service.openSurface('hermes:reviewer')).state).toBe('connecting');
    expect(hermes.calls.find((call) => call.method === 'session.list')?.params).toEqual({ profile: 'reviewer', title: 'Bot Chat', limit: 200, include_hidden: true });
    expect(methods(hermes)).toEqual(['session.list']);
    expect(ptyParams(hermes).get('profile')).toBe('reviewer');
    expect(ptyParams(hermes).get('resume')).toBe('sess-existing-tip');
  });
  it('first open creates exactly one canonical chat with the supported contract, materialized by session.title, with no prompt', async () => {
    const { service, hermes } = await open();
    await service.openSurface('hermes:fred');
    expect(methods(hermes)).toEqual(['session.list', 'session.create', 'session.title']);
    expect(hermes.calls.find((call) => call.method === 'session.create')?.params).toEqual({ profile: 'fred', title: 'Bot Chat', hidden: true, follow_profile_config: true });
    expect(hermes.calls.find((call) => call.method === 'session.title')?.params).toEqual({ session_id: 'rt-1', title: 'Bot Chat' });
    expect(methods(hermes)).not.toContain('prompt.submit');
    expect(hermes.canonical.fred).toBe('stored-1');
    expect(hermes.ptySockets()).toHaveLength(1);
    expect(ptyParams(hermes).get('profile')).toBe('fred');
    expect(ptyParams(hermes).get('resume')).toBe('stored-1');
    expect(service.get().bots.find((bot) => bot.id === 'hermes:fred')?.canonicalSessionId).toBe('stored-1');
  });
  it('never injects a Clanker workspace cwd into creation, lookup or PTY resume', async () => {
    const { service, hermes } = await open();
    await service.openSurface('hermes:fred');
    for (const call of hermes.calls) expect(Object.keys(call.params)).not.toEqual(expect.arrayContaining(['cwd']));
    for (const key of ['cwd', 'workspace', 'fresh']) expect(ptyParams(hermes).has(key)).toBe(false);
    expect(JSON.stringify(hermes.calls)).not.toMatch(/cwd/);
  });
  it('double/concurrent opens coalesce into one resolution and one connection', async () => {
    const { service, hermes } = await open();
    const [a, b] = await Promise.all([service.openSurface('hermes:fred'), service.openSurface('hermes:fred')]);
    expect(a).toEqual(b);
    expect(hermes.calls.filter((call) => call.method === 'session.create')).toHaveLength(1);
    expect(hermes.ptySockets()).toHaveLength(1);
    const again = await service.openSurface('hermes:fred');
    expect(again.state).toMatch(/connecting|open/);
    expect(hermes.calls.filter((call) => call.method === 'session.list')).toHaveLength(1);
    expect(hermes.ptySockets()).toHaveLength(1);
  });
  it('adopts the winner when another writer takes the canonical title, never creating a second chat', async () => {
    const { service, hermes } = await open();
    hermes.titleRace = 'sess-winner';
    await service.openSurface('hermes:fred');
    expect(methods(hermes)).toEqual(['session.list', 'session.create', 'session.title', 'session.list']);
    expect(ptyParams(hermes).get('resume')).toBe('sess-winner');
    expect(hermes.calls.filter((call) => call.method === 'session.create')).toHaveLength(1);
  });
  it('fails closed on a failed registry lookup: nothing is created and no PTY opens', async () => {
    const { service, hermes } = await open();
    hermes.listFails = true;
    expect(await service.openSurface('hermes:fred')).toMatchObject({ state: 'unavailable' });
    expect(methods(hermes)).toEqual(['session.list']);
    expect(hermes.ptySockets()).toHaveLength(0);
    expect(service.get().surfaces).toEqual([{ botId: 'hermes:fred', state: 'unavailable' }]);
    // Retry after the registry recovers resolves normally.
    hermes.listFails = false;
    expect((await service.openSurface('hermes:fred')).state).toBe('connecting');
    expect(hermes.ptySockets()).toHaveLength(1);
  });
  it('fails closed when a profile the roster saw with a canonical chat answers an empty lookup', async () => {
    const { service, hermes } = await open();
    hermes.listEmpty = true;
    expect(await service.openSurface('hermes:reviewer')).toMatchObject({ state: 'unavailable' });
    expect(methods(hermes)).toEqual(['session.list']);
    expect(hermes.ptySockets()).toHaveLength(0);
  });
  it('fails closed (no prompt, no second create) when materializing the title fails for another reason', async () => {
    const { service, hermes } = await open();
    hermes.titleFails = true;
    expect(await service.openSurface('hermes:fred')).toMatchObject({ state: 'unavailable' });
    expect(methods(hermes)).toEqual(['session.list', 'session.create', 'session.title']);
    expect(hermes.ptySockets()).toHaveLength(0);
  });
  it('a refresh keeps the same canonical chat and a reconnect resolves the existing chat instead of minting another', async () => {
    const { service, hermes } = await open();
    await service.openSurface('hermes:fred');
    await flush();
    await service.refresh();
    expect(hermes.calls.filter((call) => call.method === 'session.create')).toHaveLength(1);
    hermes.running = false;
    hermes.wsSockets()[0].close(1006);
    hermes.running = true;
    // A fresh process: the roster now reports the chat Hermes created.
    hermes.profiles = hermes.profiles.map((profile) => profile.name === 'fred' ? { ...profile, canonical_session: { id: 'stored-1' } } : profile);
    await service.refresh();
    await service.openSurface('hermes:fred');
    expect(hermes.calls.filter((call) => call.method === 'session.create')).toHaveLength(1);
    const urls = hermes.ptySockets().map((socket) => new URL(socket.url).searchParams);
    expect(urls.map((params) => params.get('resume'))).toEqual(['stored-1', 'stored-1']);
  });
});

describe('Bot Chat PTY surfaces', () => {
  const open = async () => {
    const ctx = setup({ enabled: true, autoStart: false });
    await ctx.service.refresh();
    return ctx;
  };
  it('opens one /api/pty connection with the exact profile slug and canonical resume id; second open does not duplicate', async () => {
    const { service, hermes } = await open();
    const first = await service.openSurface('hermes:reviewer');
    await flush();
    const second = await service.openSurface('hermes:reviewer');
    expect(hermes.ptySockets()).toHaveLength(1);
    const url = new URL(hermes.ptySockets()[0].url);
    expect(url.host).toBe('127.0.0.1:9119');
    expect(url.searchParams.get('profile')).toBe('reviewer');
    expect(url.searchParams.get('resume')).toBe('sess-rev-tip');
    expect(url.searchParams.get('token')).toBe(TOKEN);
    expect(url.searchParams.get('attach')).toBe('clanker-assistant-reviewer');
    expect(url.searchParams.has('cwd')).toBe(false);
    expect(url.searchParams.has('fresh')).toBe(false);
    expect([first.state, second.state]).toEqual(['connecting', 'open']);
    expect(service.get().surfaces).toEqual([{ botId: 'hermes:reviewer', state: 'open' }]);
  });
  it('forwards input, output (text and binary, split multi-byte) and Hermes resize framing', async () => {
    const { service, hermes, ptyData } = await open();
    await service.openSurface('hermes:reviewer');
    await flush();
    const socket = hermes.ptySockets()[0];
    service.writePty('hermes:reviewer', 'hello\r');
    service.resizePty('hermes:reviewer', 100, 30);
    expect(socket.sent).toEqual(['hello\r', '\x1b[RESIZE:100;30]']);
    socket.emit('message', { data: 'plain' });
    const bytes = Buffer.from('é');
    socket.emit('message', { data: new Uint8Array([bytes[0]]).buffer });
    socket.emit('message', { data: new Uint8Array([bytes[1]]).buffer });
    expect(ptyData).toEqual([['hermes:reviewer', 'plain'], ['hermes:reviewer', 'é']]);
    expect((await service.openSurface('hermes:reviewer')).replay).toBe('plainé');
  });
  it('applies a size recorded before the socket opened', async () => {
    const { service, hermes } = await open();
    await service.openSurface('hermes:reviewer');
    service.resizePty('hermes:reviewer', 80, 24);
    await flush();
    expect(hermes.ptySockets()[0].sent).toEqual(['\x1b[RESIZE:80;24]']);
  });
  it('ignores malformed ids, oversized writes and invalid sizes; never opens an unknown or default Bot', async () => {
    const { service, hermes } = await open();
    await expect(service.openSurface('../x')).rejects.toThrow();
    await expect(service.openSurface('hermes:default')).rejects.toThrow(/not connected/);
    await service.openSurface('hermes:reviewer'); await flush();
    service.writePty('hermes:reviewer', 'x'.repeat(70_000));
    service.writePty('nope', 'x');
    service.resizePty('hermes:reviewer', 0, 10);
    service.resizePty('hermes:reviewer', 10.5, 10);
    expect(hermes.ptySockets()[0].sent).toEqual([]);
  });
  it('keeps open surfaces connected through unrelated navigation and closes them on shutdown', async () => {
    const { service, hermes } = await open();
    await service.openSurface('hermes:reviewer'); await service.openSurface('hermes:ops-agent'); await flush();
    expect(hermes.ptySockets()).toHaveLength(2);
    // The renderer navigating between workspaces/Assistants never reaches main; only an explicit close does.
    expect(hermes.ptySockets().every((socket) => !socket.closed)).toBe(true);
    await service.shutdown();
    expect(hermes.ptySockets().every((socket) => socket.closed)).toBe(true);
  });
  it('a lost service surfaces disconnected state and re-attaches to the same canonical chat, never a new one', async () => {
    const { service, hermes } = await open();
    await service.openSurface('hermes:reviewer'); await flush();
    hermes.running = false;
    hermes.wsSockets()[0].close(1006);
    expect(service.get().service.state).toBe('offline');
    expect(service.get().surfaces).toEqual([{ botId: 'hermes:reviewer', state: 'disconnected' }]);
    expect(hermes.ptySockets()).toHaveLength(1);
    hermes.running = true;
    hermes.canonical.reviewer = 'sess-rev-tip';
    await service.refresh();
    expect((await service.openSurface('hermes:reviewer')).state).toBe('connecting');
    const urls = hermes.ptySockets().map((socket) => new URL(socket.url));
    expect(urls).toHaveLength(2);
    expect(urls[1].searchParams.get('resume')).toBe('sess-rev-tip');
    expect(urls[1].searchParams.get('attach')).toBe(urls[0].searchParams.get('attach'));
  });
  it('treats close code 4410 as the Bot Chat process ending', async () => {
    const { service, hermes } = await open();
    await service.openSurface('hermes:reviewer'); await flush();
    hermes.ptySockets()[0].close(4410);
    expect(service.get().surfaces).toEqual([{ botId: 'hermes:reviewer', state: 'ended' }]);
  });
  it('closeSurface closes the socket; disable closes every surface', async () => {
    const { service, hermes } = await open();
    await service.openSurface('hermes:reviewer'); await service.openSurface('hermes:ops-agent'); await flush();
    service.closeSurface('hermes:reviewer');
    expect(hermes.ptySockets()[0].closed).toBe(true);
    service.configure({ enabled: false, autoStart: false });
    expect(hermes.ptySockets()[1].closed).toBe(true);
    expect(service.get().surfaces).toEqual([]);
  });
});
