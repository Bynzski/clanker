import { describe, expect, it, vi } from 'vitest';
import { AssistantService } from '../../../src/main/assistants/assistantService';
import type { AssistantSettings } from '../../../src/shared/types/assistants';

function fixture() {
  let settings: AssistantSettings = { enabled: false, pins: [] };
  const discover = vi.fn().mockResolvedValue([{ name: 'default', label: 'Default', home: '/profiles/default' }]);
  const resolve = vi.fn().mockResolvedValue({ name: 'default', label: 'Default', home: '/profiles/default' });
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
  it('window reset invalidates pending manual discovery and launch results', async () => {
    const { service, resolve } = fixture();
    service.configure({ enabled: true, pins: [] });
    let finish!: (value: { name: string; label: string; home: string }) => void;
    resolve.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const pending = service.addProfile('hermes', 'reviewer');
    service.reset();
    finish({ name: 'reviewer', label: 'Reviewer', home: '/profile' });
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
    resolve.mockResolvedValueOnce({ name: 'reviewer', label: 'Reviewer', home: '/profiles/reviewer' });
    const snapshot = await service.discover();
    expect(snapshot.profiles[0].profileName).toBe('reviewer');
    expect(snapshot.discoveryError).toMatch(/manual|unavailable/);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });
  it('discards late discovery after the integration is disabled', async () => {
    const { service, discover } = fixture();
    service.configure({ enabled: true, pins: [] });
    let finish!: (value: { name: string; label: string; home: string }[]) => void;
    discover.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const pending = service.discover();
    service.configure({ enabled: false, pins: [] });
    finish([{ name: 'default', label: 'Default', home: '/profiles/default' }]);
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
    resolve.mockResolvedValueOnce({ name: 'alias', label: 'Alias', home: '/profiles/default' });
    const snapshot = await service.addProfile('hermes', 'alias');
    const [first, second] = snapshot.profiles;
    resolve.mockImplementation(async (_executor, name) => ({ name, label: name, home: '/profiles/default' }));
    const results = await Promise.all([first, second].map((profile) => service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true })));
    expect(results.map((r) => r.action)).toEqual(['created', 'focus']);
    expect(spawn).toHaveBeenCalledOnce();
  });
  it('requires refresh when a profile name now resolves to a different home', async () => {
    const { service, resolve, spawn } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    resolve.mockResolvedValueOnce({ name: 'default', label: 'Default', home: '/profiles/replacement' });
    await expect(service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true })).rejects.toThrow(/changed|refresh/);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('supports manual native profile selection without creating or switching profiles', async () => {
    const { service, resolve, discover } = fixture();
    service.configure({ enabled: true, pins: [] });
    resolve.mockResolvedValueOnce({ name: 'reviewer', label: 'Reviewer', home: '/profiles/reviewer' });
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
    let finish!: (value: { name: string; label: string; home: string }) => void;
    resolve.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const pending = service.launch({ profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true });
    if (change === 'closed') workspaces.delete('ws-1');
    if (change === 'replaced') workspaces.set('ws-1', { workspaceId: 'ws-1', location: { environmentId: 'local', path: '/replaced' } });
    if (change === 'disabled') service.configure({ enabled: false, pins: [] });
    finish({ name: 'default', label: 'Default', home: '/profiles/default' });
    await expect(pending).rejects.toThrow(/changed|disabled|registered/);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('coalesces simultaneous launch requests before PTY creation', async () => {
    const { service, resolve, spawn } = fixture();
    service.configure({ enabled: true, pins: [] });
    const { profiles: [profile] } = await service.discover();
    let finish!: (value: { name: string; label: string; home: string }) => void;
    resolve.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const request = { profileId: profile.id, workspaceId: 'ws-1', acknowledgeExternalActivity: true };
    const first = service.launch(request);
    const second = service.launch(request);
    finish({ name: 'default', label: 'Default', home: '/profiles/default' });
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
