import { describe, expect, it, vi } from 'vitest';
import { AssistantService } from '../../../src/main/assistants/assistantService';
import type { AssistantSettings } from '../../../src/shared/types/assistants';

function fixture() {
  let settings: AssistantSettings = { enabled: false, pins: [] };
  const discover = vi.fn().mockResolvedValue([{ name: 'default', label: 'Default', home: '/profiles/default', rootHome: '/hermes-root' }]);
  const resolve = vi.fn().mockResolvedValue({ name: 'default', label: 'Default', home: '/profiles/default', rootHome: '/hermes-root' });
  const spawn = vi.fn().mockResolvedValue({ id: 'term-1', pid: 42, attentionEnabled: false });
  const workspace = { workspaceId: 'ws-1', location: { environmentId: 'local', path: '/repo/worktree' } };
  const workspaces = new Map([[workspace.workspaceId, workspace]]);
  const onChanged = vi.fn();
  const killTerminal = vi.fn();
  const service = new AssistantService({
    readSettings: () => settings,
    writeSettings: (next) => { settings = next; },
    getProfilesCapability: (id) => id === 'hermes' ? { probeUnsetEnvironmentKeys: [], discover, resolve, buildLaunch: () => ({ command: 'hermes', args: ['-p', 'default', '--tui', '--in', '/repo/worktree'], env: {}, unsetEnvironmentKeys: [] }) } : undefined,
    executor: () => ({ run: vi.fn() }),
    profileHarnessIds: ['hermes'],
    getWorkspace: (id) => workspaces.get(id) ?? null,
    spawn,
    killTerminal,
    onChanged,
    isShuttingDown: () => false,
  });
  return { service, discover, resolve, spawn, workspaces, workspace, onChanged, killTerminal };
}

describe('optional assistants', () => {
  const native = (name: string) => ({ name, label: name, home: `/profiles/${name}`, rootHome: '/hermes-root' });
  const many = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => native(`${prefix}${i}`));
  const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };

  describe('discovery generations', () => {
    it('does not coalesce a post-re-enable request onto a discovery invalidated by disable', async () => {
      const { service, discover } = fixture();
      service.configure({ enabled: true, pins: [] });
      const a = deferred<ReturnType<typeof native>[]>();
      const b = deferred<ReturnType<typeof native>[]>();
      discover.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
      const first = service.discover();
      service.configure({ enabled: false, pins: [] });
      service.configure({ enabled: true, pins: [] });
      const second = service.discover();
      expect(second).not.toBe(first);
      expect(discover).toHaveBeenCalledTimes(2);
      b.resolve([native('fresh')]);
      const fresh = await second;
      expect(fresh).toMatchObject({ profilesChecked: true });
      expect(fresh.profiles.map((profile) => profile.profileName)).toEqual(['fresh']);
      a.resolve([native('stale')]);
      await first;
      const after = service.get();
      expect(after.profiles.map((profile) => profile.profileName)).toEqual(['fresh']);
      expect(after.profilesChecked).toBe(true);
      expect(after.discoveryError).toBeUndefined();
      // The stale operation's cleanup must not have cleared the newer operation's slot or state.
      await service.discover({ ifUnchecked: true });
      expect(discover).toHaveBeenCalledTimes(2);
    });
    it('a stale failing discovery cannot set an error or checked state over the newer one', async () => {
      const { service, discover } = fixture();
      service.configure({ enabled: true, pins: [] });
      const a = deferred<ReturnType<typeof native>[]>();
      discover.mockReturnValueOnce(a.promise).mockResolvedValueOnce([native('fresh')]);
      const first = service.discover();
      service.configure({ enabled: false, pins: [] });
      service.configure({ enabled: true, pins: [] });
      await service.discover();
      a.resolve(Promise.reject(new Error('late failure')) as never);
      await first;
      expect(service.get().discoveryError).toBeUndefined();
    });
    it('still coalesces simultaneous requests within one generation', async () => {
      const { service, discover } = fixture();
      service.configure({ enabled: true, pins: [] });
      const gate = deferred<ReturnType<typeof native>[]>();
      discover.mockReturnValueOnce(gate.promise);
      const one = service.discover();
      const two = service.discover();
      gate.resolve([native('x')]);
      await Promise.all([one, two]);
      expect(discover).toHaveBeenCalledTimes(1);
    });
    it('discards a late result after disable without re-enable, and after reset', async () => {
      for (const invalidate of [(s: AssistantService) => { s.configure({ enabled: false, pins: [] }); }, (s: AssistantService) => s.reset()]) {
        const { service, discover } = fixture();
        service.configure({ enabled: true, pins: [] });
        const gate = deferred<ReturnType<typeof native>[]>();
        discover.mockReturnValueOnce(gate.promise);
        const pending = service.discover();
        invalidate(service);
        gate.resolve([native('late')]);
        await pending;
        expect(service.get().profiles).toEqual([]);
        expect(service.get().profilesChecked).toBe(false);
      }
    });
    it('after reset a new request performs a new probe instead of the invalidated one', async () => {
      const { service, discover } = fixture();
      service.configure({ enabled: true, pins: [] });
      const gate = deferred<ReturnType<typeof native>[]>();
      discover.mockReturnValueOnce(gate.promise).mockResolvedValueOnce([native('fresh')]);
      const old = service.discover();
      service.reset();
      expect((await service.discover()).profiles.map((p) => p.profileName)).toEqual(['fresh']);
      gate.resolve([]);
      await old;
      expect(discover).toHaveBeenCalledTimes(2);
    });
  });

  describe('atomic 64-profile roster limit', () => {
    const names = (service: AssistantService) => service.get().profiles.map((profile) => profile.profileName).sort();
    it('keeps exactly 64 final rows', async () => {
      const { service, discover } = fixture();
      service.configure({ enabled: true, pins: [] });
      discover.mockResolvedValueOnce(many(64));
      const snapshot = await service.discover();
      expect(snapshot.profiles).toHaveLength(64);
      expect(snapshot).toMatchObject({ profilesChecked: true });
      expect(snapshot.discoveryError).toBeUndefined();
    });
    it('cold start with discovery plus pins reaching 65 identities changes nothing but the status', async () => {
      const { service, discover, resolve, onChanged } = fixture();
      service.configure({ enabled: true, pins: [{ harnessId: 'hermes', profileName: 'pinned-extra' }] });
      discover.mockResolvedValueOnce(many(64));
      resolve.mockImplementation(async (_executor: unknown, name: string) => native(name));
      onChanged.mockClear();
      const before = service.get();
      const snapshot = await service.discover({ ifUnchecked: true });
      expect(snapshot.profiles).toEqual([]);
      expect(snapshot.profiles).toEqual(before.profiles);
      expect(snapshot).toMatchObject({ profilesChecked: true });
      expect(snapshot.discoveryError).toMatch(/Too many Assistant profiles \(limit 64\)/);
      expect(snapshot.discoveryError).not.toContain('/profiles');
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(onChanged).toHaveBeenCalledWith(snapshot);
    });
    it('cold start where the provider itself returns 65 stays empty, checked, with the limit error only', async () => {
      const { service, discover, onChanged } = fixture();
      service.configure({ enabled: true, pins: [] });
      discover.mockResolvedValueOnce(many(65));
      onChanged.mockClear();
      const snapshot = await service.discover({ ifUnchecked: true });
      expect(snapshot.profiles).toEqual([]);
      expect(snapshot.profilesChecked).toBe(true);
      expect(snapshot.discoveryError).toMatch(/Too many Assistant profiles \(limit 64\)/);
      expect(snapshot.discoveryError).not.toMatch(/Automatic profile discovery unavailable/);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    it('an existing roster survives a provider returning 65 directly, with ids and launches intact', async () => {
      const { service, discover, resolve } = fixture();
      service.configure({ enabled: true, pins: [] });
      resolve.mockResolvedValue(native('keep'));
      discover.mockResolvedValueOnce([native('keep'), native('other')]);
      const before = await service.discover();
      const keep = before.profiles.find((profile) => profile.profileName === 'keep')!;
      await service.launch({ profileId: keep.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true });
      const withLaunch = service.get();
      discover.mockResolvedValueOnce(many(65, 'big'));
      const after = await service.discover();
      expect(after.profiles).toEqual(withLaunch.profiles);
      expect(after.launches).toEqual(withLaunch.launches);
      expect(after.profilesChecked).toBe(true);
      expect(after.discoveryError).toMatch(/limit 64/);
      expect(after.discoveryError).not.toMatch(/Automatic profile discovery unavailable/);
    });
    it('accepts exactly 64 rows returned directly by the provider', async () => {
      const { service, discover } = fixture();
      service.configure({ enabled: true, pins: [] });
      discover.mockResolvedValueOnce(many(64));
      const snapshot = await service.discover();
      expect(snapshot.profiles).toHaveLength(64);
      expect(snapshot.discoveryError).toBeUndefined();
    });
    it('an overflowing refresh retains the previous roster exactly, including ids', async () => {
      const { service, discover, resolve } = fixture();
      service.configure({ enabled: true, pins: [] });
      discover.mockResolvedValueOnce(many(3, 'old'));
      const before = await service.discover();
      expect(before.profiles).toHaveLength(3);
      service.configure({ enabled: true, pins: [{ harnessId: 'hermes', profileName: 'pinned-extra' }] });
      resolve.mockImplementation(async (_executor: unknown, name: string) => native(name));
      discover.mockResolvedValueOnce(many(64, 'new')); // 64 discovered + 1 pin = 65 final identities
      const after = await service.discover();
      expect(after.profiles).toEqual(before.profiles);
      expect(after.launches).toEqual(before.launches);
      expect(after.profilesChecked).toBe(true);
      expect(after.discoveryError).toMatch(/limit 64/);
    });
    it('counts an owned launch absent from the new discovery toward the final roster', async () => {
      const { service, discover, resolve, onChanged } = fixture();
      service.configure({ enabled: true, pins: [] });
      resolve.mockResolvedValue(native('owned'));
      discover.mockResolvedValueOnce([native('owned')]);
      const [{ id }] = (await service.discover()).profiles;
      await service.launch({ profileId: id, workspaceId: 'ws-1', acknowledgeExternalActivity: true });
      const before = service.get();
      discover.mockResolvedValueOnce(many(64, 'other'));
      onChanged.mockClear();
      const after = await service.discover();
      expect(after.profiles).toEqual(before.profiles);
      expect(after.launches).toEqual(before.launches);
      expect(after.discoveryError).toMatch(/limit 64/);
      expect(after.profilesChecked).toBe(true);
      expect(names(service)).toEqual(['owned']);
      // 63 other + the owned one is exactly 64 and succeeds, keeping the owned row.
      discover.mockResolvedValueOnce(many(63, 'other'));
      const ok = await service.discover();
      expect(ok.profiles).toHaveLength(64);
      expect(ok.discoveryError).toBeUndefined();
      expect(ok.profiles.find((profile) => profile.profileName === 'owned')?.id).toBe(id);
    });
  });
  it('cold start with persisted pins is unchecked, probe-free, and distinct from a checked failure', async () => {
    const { service, discover, resolve } = fixture();
    service.configure({ enabled: true, pins: [{ harnessId: 'hermes', profileName: 'gone' }] });
    const cold = service.get();
    expect(cold).toMatchObject({ profiles: [], profilesChecked: false });
    expect(cold.discoveryError).toBeUndefined();
    expect(discover).not.toHaveBeenCalled();
    resolve.mockRejectedValue(new Error('missing'));
    const checked = await service.discover({ ifUnchecked: true });
    expect(checked.profilesChecked).toBe(true);
    expect(checked.discoveryError).toMatch(/unavailable/);
  });
  it('coalesces concurrent cold-start hydration and never re-probes once checked', async () => {
    const { service, discover } = fixture();
    service.configure({ enabled: true, pins: [] });
    await Promise.all([service.discover({ ifUnchecked: true }), service.discover({ ifUnchecked: true })]);
    await service.discover({ ifUnchecked: true });
    expect(discover).toHaveBeenCalledTimes(1);
    await service.discover();
    expect(discover).toHaveBeenCalledTimes(2);
  });
  it('rejects hydration while disabled without probing, and window reset returns to unchecked', async () => {
    const { service, discover } = fixture();
    await expect(service.discover({ ifUnchecked: true })).rejects.toThrow(/disabled/);
    expect(discover).not.toHaveBeenCalled();
    service.configure({ enabled: true, pins: [] });
    await service.discover();
    service.reset();
    expect(service.get().profilesChecked).toBe(false);
  });
  it('window reset invalidates pending manual discovery and launch results', async () => {
    const { service, resolve } = fixture();
    service.configure({ enabled: true, pins: [] });
    let finish!: (value: { name: string; label: string; home: string; rootHome: string }) => void;
    resolve.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const pending = service.addProfile('hermes', 'reviewer');
    service.reset();
    finish({ name: 'reviewer', label: 'Reviewer', home: '/profile', rootHome: '/hermes-root' });
    await expect(pending).rejects.toThrow(/changed/);
    expect(service.get().profiles).toEqual([]);
  });
  it('closes owned terminals when their workspace is unregistered', async () => {
    const { service, killTerminal } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    await service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true });
    service.closeWorkspace('ws-1');
    expect(killTerminal).toHaveBeenCalledWith('term-1');
    expect(service.get().launches).toEqual([]);
  });
  it('refreshes removed profiles without retaining a launchable stale row', async () => {
    const { service, discover, resolve } = fixture();
    service.configure({ enabled: true, pins: [{ harnessId: 'hermes', profileName: 'default' }] });
    await service.discover();
    discover.mockResolvedValueOnce([]);
    resolve.mockRejectedValueOnce(new Error('Profile was deleted'));
    const snapshot = await service.discover();
    expect(snapshot.profiles).toEqual([]);
    expect(snapshot.settings.pins).toHaveLength(1);
    expect(snapshot.discoveryError).toMatch(/unavailable/);
  });
  it('recovers pinned manual profiles when automatic discovery is unsupported without exposing diagnostics', async () => {
    const { service, discover, resolve } = fixture();
    service.configure({ enabled: true, pins: [{ harnessId: 'hermes', profileName: 'reviewer' }] });
    discover.mockRejectedValueOnce(new Error('secret environment dump'));
    resolve.mockResolvedValueOnce({ name: 'reviewer', label: 'Reviewer', home: '/profiles/reviewer', rootHome: '/hermes-root' });
    const snapshot = await service.discover();
    expect(snapshot.profiles[0].profileName).toBe('reviewer');
    expect(snapshot.discoveryError).toMatch(/manual|unavailable/);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });
  it('discards late discovery after the integration is disabled', async () => {
    const { service, discover } = fixture();
    service.configure({ enabled: true, pins: [] });
    let finish!: (value: { name: string; label: string; home: string; rootHome: string }[]) => void;
    discover.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const pending = service.discover();
    service.configure({ enabled: false, pins: [] });
    finish([{ name: 'default', label: 'Default', home: '/profiles/default', rootHome: '/hermes-root' }]);
    await pending;
    expect(service.get().profiles).toEqual([]);
  });
  it('rejects malformed persisted presentation preferences and strips non-preference fields', () => {
    const { service } = fixture();
    expect(() => service.configure({ enabled: 'yes', pins: [] } as unknown as AssistantSettings)).toThrow(/Invalid/);
    expect(() => service.configure({ enabled: true, pins: [{ harnessId: 'hermes', profileName: '--yolo' }] })).toThrow(/Invalid/);
    expect(() => service.configure({ enabled: true, pins: [{ harnessId: 'hermes', profileName: 'default', workspace: { environmentId: 'local', path: '../repo' } }] })).toThrow(/Invalid/);
    const snapshot = service.configure({ enabled: true, pins: [], auth: 'must-not-persist' } as AssistantSettings);
    expect(snapshot.settings).toEqual({ enabled: true, pins: [] });
  });
  it('normalizes and deduplicates global and workspace pins using canonical workspace identity', () => {
    const { service } = fixture();
    const snapshot = service.configure({ enabled: true, pins: [
      { harnessId: 'hermes', profileName: 'default' },
      { harnessId: 'hermes', profileName: 'default' },
      { harnessId: 'hermes', profileName: 'default', workspace: { environmentId: 'local', path: '/repo/worktree/' } },
    ] });
    expect(snapshot.settings.pins).toEqual([
      { harnessId: 'hermes', profileName: 'default' },
      { harnessId: 'hermes', profileName: 'default', workspace: { environmentId: 'local', path: '/repo/worktree' } },
    ]);
  });
  it('reserves canonical native homes even when two profile names resolve to the same home', async () => {
    const { service, resolve, spawn } = fixture();
    service.configure({ enabled: true, pins: [] });
    await service.discover();
    resolve.mockResolvedValueOnce({ name: 'alias', label: 'Alias', home: '/profiles/default', rootHome: '/hermes-root' });
    const snapshot = await service.addProfile('hermes', 'alias');
    const [first, second] = snapshot.profiles;
    resolve.mockImplementation(async (_executor, name) => ({ name, label: name, home: '/profiles/default', rootHome: '/hermes-root' }));
    const results = await Promise.all([first, second].map((profile) => service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true })));
    expect(results.map((r) => r.action)).toEqual(['created', 'focus']);
    expect(spawn).toHaveBeenCalledOnce();
  });
  it('requires refresh when a profile name now resolves to a different home', async () => {
    const { service, resolve, spawn } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    resolve.mockResolvedValueOnce({ name: 'default', label: 'Default', home: '/profiles/replacement', rootHome: '/hermes-root' });
    await expect(service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true })).rejects.toThrow(/changed|refresh/);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('allows a launch when the re-resolved canonical home and native root are unchanged', async () => {
    const { service, resolve, spawn } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    resolve.mockResolvedValueOnce({ name: 'default', label: 'Default', home: '/profiles/default', rootHome: '/hermes-root' });
    await expect(service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true })).resolves.toMatchObject({ action: 'created' });
    expect(spawn).toHaveBeenCalledOnce();
  });
  it('requires refresh when the same canonical home now belongs to a different native root', async () => {
    const { service, resolve, spawn } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    resolve.mockResolvedValueOnce({ name: 'default', label: 'Default', home: '/profiles/default', rootHome: '/another-root' });
    await expect(service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true })).rejects.toThrow(/root changed|refresh/);
    expect(spawn).not.toHaveBeenCalled();
    expect(service.get().launches).toEqual([]);
  });
  it.each(['discovered', 're-resolved'] as const)('fails closed when the %s profile metadata lacks a native root', async (missing) => {
    const { service, resolve, discover, spawn } = fixture();
    service.configure({ enabled: true, pins: [] });
    if (missing === 'discovered') discover.mockResolvedValueOnce([{ name: 'default', label: 'Default', home: '/profiles/default' }]);
    const { profiles: [profile] } = await service.discover();
    if (missing === 're-resolved') resolve.mockResolvedValueOnce({ name: 'default', label: 'Default', home: '/profiles/default' });
    else resolve.mockResolvedValueOnce({ name: 'default', label: 'Default', home: '/profiles/default', rootHome: '/hermes-root' });
    await expect(service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true })).rejects.toThrow(/root changed|refresh/);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('never exposes native home or root through the renderer-facing snapshot', async () => {
    const { service } = fixture();
    service.configure({ enabled: true, pins: [] });
    const snapshot = await service.discover();
    expect(JSON.stringify(snapshot)).not.toMatch(/hermes-root|\/profiles\//);
    expect(Object.keys(snapshot.profiles[0]).sort()).toEqual(['harnessId', 'id', 'label', 'profileName']);
  });
  it('supports manual native profile selection without creating or switching profiles', async () => {
    const { service, resolve, discover } = fixture();
    service.configure({ enabled: true, pins: [] });
    resolve.mockResolvedValueOnce({ name: 'reviewer', label: 'Reviewer', home: '/profiles/reviewer', rootHome: '/hermes-root' });
    const snapshot = await service.addProfile('hermes', 'reviewer');
    expect(resolve).toHaveBeenCalledWith(expect.anything(), 'reviewer');
    expect(snapshot.profiles[0]).toMatchObject({ harnessId: 'hermes', profileName: 'reviewer' });
    expect(discover).not.toHaveBeenCalled();
  });
  it.each(['closed', 'disabled', 'exited'] as const)('kills a late PTY result after the launch is %s', async (change) => {
    const { service, spawn, workspaces, killTerminal } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    let finish!: (value: { id: string; pid: number; attentionEnabled: boolean }) => void;
    spawn.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const pending = service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    if (change === 'closed') workspaces.delete('ws-1');
    if (change === 'disabled') service.configure({ enabled: false, pins: [] });
    if (change === 'exited') service.releaseTerminal('term-1');
    finish({ id: 'term-1', pid: 42, attentionEnabled: false });
    await expect(pending).rejects.toThrow(/changed|disabled|exited/);
    expect(killTerminal).toHaveBeenCalledWith('term-1');
    expect(service.get().launches).toEqual([]);
  });
  it('releases ownership on terminal close so the next request creates a fresh launch', async () => {
    const { service, spawn } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    const request = { profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true };
    await service.launch(request);
    service.releaseTerminal('term-1');
    spawn.mockResolvedValueOnce({ id: 'term-2', pid: 43, attentionEnabled: false });
    await expect(service.launch(request)).resolves.toMatchObject({ action: 'created', terminalId: 'term-2' });
  });
  it.each(['closed', 'replaced', 'disabled'] as const)('rejects a %s owner while profile resolution is pending', async (change) => {
    const { service, resolve, spawn, workspaces } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    let finish!: (value: { name: string; label: string; home: string; rootHome: string }) => void;
    resolve.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const pending = service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true });
    if (change === 'closed') workspaces.delete('ws-1');
    if (change === 'replaced') workspaces.set('ws-1', { workspaceId: 'ws-1', location: { environmentId: 'local', path: '/replaced' } });
    if (change === 'disabled') service.configure({ enabled: false, pins: [] });
    finish({ name: 'default', label: 'Default', home: '/profiles/default', rootHome: '/hermes-root' });
    await expect(pending).rejects.toThrow(/changed|disabled|registered/);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('coalesces simultaneous launch requests before PTY creation', async () => {
    const { service, resolve, spawn } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    let finish!: (value: { name: string; label: string; home: string; rootHome: string }) => void;
    resolve.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const request = { profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true };
    const first = service.launch(request);
    const second = service.launch(request);
    finish({ name: 'default', label: 'Default', home: '/profiles/default', rootHome: '/hermes-root' });
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.action)).toEqual(['created', 'focus']);
    expect(spawn).toHaveBeenCalledOnce();
  });
  it('launches in the captured registered local workspace and focuses the same profile across workspaces', async () => {
    const { service, spawn, workspaces } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    const request = { profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true };
    const result = await service.launch(request);
    expect(result).toMatchObject({ action: 'created', terminalId: 'term-1', workspaceId: 'ws-1', pid: 42 });
    expect(spawn).toHaveBeenCalledWith('ws-1', 'hermes', expect.objectContaining({ args: ['-p', 'default', '--tui', '--in', '/repo/worktree'] }));
    workspaces.set('ws-2', { workspaceId: 'ws-2', location: { environmentId: 'local', path: '/another-worktree' } });
    await expect(service.launch({ ...request, workspaceId: 'ws-2' })).resolves.toMatchObject({ action: 'focus', workspaceId: 'ws-1', terminalId: 'term-1' });
    expect(spawn).toHaveBeenCalledOnce();
    expect(service.get().launches).toEqual([{ profileId: profile.id, workspaceId: 'ws-1', terminalId: 'term-1', state: 'open' }]);
  });
  describe('request ownership while waiting on another workspace\'s launch', () => {
    const NATIVE = { home: '/profiles/default', rootHome: '/hermes-root' };
    const flush = () => new Promise<void>((done) => setTimeout(done, 0));
    const mutate = (workspaces: Map<string, { workspaceId: string; location: { environmentId: string; path: string } }>, change: 'closed' | 'replaced') => {
      if (change === 'closed') workspaces.delete('ws-2');
      if (change === 'replaced') workspaces.set('ws-2', { workspaceId: 'ws-2', location: { environmentId: 'local', path: '/replacement' } });
    };
    async function pendingOwner(alias: boolean) {
      const f = fixture();
      f.service.configure({ enabled: true, pins: [] });
      f.workspaces.set('ws-2', { workspaceId: 'ws-2', location: { environmentId: 'local', path: '/second/worktree' } });
      const { profiles: [first] } = await f.service.discover();
      let second = first;
      if (alias) {
        f.resolve.mockResolvedValueOnce({ name: 'alias', label: 'Alias', ...NATIVE });
        second = (await f.service.addProfile('hermes', 'alias')).profiles[1];
        f.resolve.mockImplementation(async (_executor: unknown, name: string) => ({ name, label: name, ...NATIVE }));
      }
      let finishSpawn!: (value: { id: string; pid: number; attentionEnabled: boolean }) => void;
      f.spawn.mockImplementationOnce(() => new Promise((done) => { finishSpawn = done; }));
      const owner = f.service.launch({ profileId: first.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true });
      await vi.waitFor(() => expect(f.spawn).toHaveBeenCalledOnce());
      const waiter = f.service.launch({ profileId: second.id, workspaceId: 'ws-2', acknowledgeExternalActivity: true });
      await flush();
      return { ...f, first, owner, waiter, finishOwner: () => finishSpawn({ id: 'term-1', pid: 42, attentionEnabled: false }) };
    }

    const PATHS = [{ alias: false, label: 'same-profile' }, { alias: true, label: 'alias-home' }] as const;
    const STALE = ['closed', 'replaced'] as const;

    describe.each(PATHS)('$label waiter', ({ alias }) => {
      it.each(STALE)('rejects when the waiter workspace is %s, leaving the owner and its PTY untouched', async (change) => {
        const { service, spawn, workspaces, killTerminal, owner, waiter, finishOwner, first } = await pendingOwner(alias);
        mutate(workspaces, change);
        const rejected = expect(waiter).rejects.toThrow(/changed|registered/);
        finishOwner();
        await expect(owner).resolves.toMatchObject({ action: 'created', terminalId: 'term-1', workspaceId: 'ws-1' });
        await rejected;
        expect(spawn).toHaveBeenCalledOnce();
        expect(killTerminal).not.toHaveBeenCalled();
        expect(service.get().launches).toEqual([{ profileId: first.id, workspaceId: 'ws-1', terminalId: 'term-1', state: 'open' }]);
      });

      it('receives focus on the owner terminal while still valid', async () => {
        const { service, spawn, killTerminal, owner, waiter, finishOwner, first } = await pendingOwner(alias);
        finishOwner();
        const [created, focused] = await Promise.all([owner, waiter]);
        expect(created).toMatchObject({ action: 'created', terminalId: 'term-1', workspaceId: 'ws-1' });
        expect(focused).toMatchObject({ action: 'focus', terminalId: 'term-1', workspaceId: 'ws-1' });
        expect(spawn).toHaveBeenCalledOnce();
        expect(killTerminal).not.toHaveBeenCalled();
        expect(service.get().launches).toEqual([{ profileId: first.id, workspaceId: 'ws-1', terminalId: 'term-1', state: 'open' }]);
      });
    });

    it('requires a currently registered local caller even when the profile is already owned', async () => {
      const { service, workspaces, killTerminal, spawn } = fixture();
      service.configure({ enabled: true, pins: [] });
      workspaces.set('ws-2', { workspaceId: 'ws-2', location: { environmentId: 'local', path: '/second/worktree' } });
      workspaces.set('remote', { workspaceId: 'remote', location: { environmentId: 'dev-vps', path: '/srv/project' } });
      const { profiles: [profile] } = await service.discover();
      await service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true });
      const request = (workspaceId: string) => ({ profileId: profile.id, workspaceId, acknowledgeExternalActivity: true });
      await expect(service.launch(request('ws-2'))).resolves.toMatchObject({ action: 'focus', terminalId: 'term-1', workspaceId: 'ws-1' });
      workspaces.delete('ws-2');
      await expect(service.launch(request('ws-2'))).rejects.toThrow(/registered local workspace/);
      await expect(service.launch(request('never-registered'))).rejects.toThrow(/registered local workspace/);
      await expect(service.launch(request('remote'))).rejects.toThrow(/registered local workspace/);
      expect(spawn).toHaveBeenCalledOnce();
      expect(killTerminal).not.toHaveBeenCalled();
      expect(service.get().launches).toEqual([{ profileId: profile.id, workspaceId: 'ws-1', terminalId: 'term-1', state: 'open' }]);
    });
  });
  it('discovers display-safe opaque profiles only after opting in', async () => {
    const { service, discover } = fixture();
    service.configure({ enabled: true, pins: [] });
    const snapshot = await service.discover();
    expect(discover).toHaveBeenCalledOnce();
    expect(snapshot.profiles).toEqual([{ id: expect.any(String), harnessId: 'hermes', profileName: 'default', label: 'Default' }]);
    expect(JSON.stringify(snapshot)).not.toContain('/profiles/');
  });
  it('does not probe profiles when disabled', async () => {
    const { service, discover } = fixture();
    expect(service.get().settings.enabled).toBe(false);
    await expect(service.discover()).rejects.toThrow('disabled');
    expect(discover).not.toHaveBeenCalled();
  });
});
