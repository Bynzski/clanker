import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testHome } from '../../_helpers/tempPaths';
const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('electron', () => ({
  app: { getPath: () => testHome(), on: vi.fn(), quit: vi.fn() }, BrowserWindow: vi.fn(),
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler), on: vi.fn() },
  clipboard: { writeText: vi.fn() },
}));
import { registerTerminalIpc, setAppShuttingDown } from '../../../src/main/ipc/terminalIpc';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { GitWorktreeListResult } from '../../../src/shared/types/git';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { ATTACH_OBSERVED_WORKTREE, INSPECT_OBSERVED_WORKTREE } from '../../../src/shared/ipcChannels';
import { snapshot } from '../../_helpers/attentionSnapshots';

const main = '/srv/repo', linked = '/srv/repo-agent';
let registry: WorkspaceRegistry;
let list: ReturnType<typeof vi.fn<() => Promise<GitWorktreeListResult>>>;
const webContents = { mainFrame: {}, isDestroyed: () => false };
const event = { sender: webContents, senderFrame: webContents.mainFrame };
const terminal = { workspaceId: 'ws', environmentId: 'ssh' };
let shuttingDown = false;
const invoke = (channel: string, sender: unknown = event, ...args: unknown[]) => handlers.get(channel)!(sender, ...args);
beforeEach(async () => {
  handlers.clear(); shuttingDown = false; setAppShuttingDown(false);
  const environment = {
    validateWorkspacePath: async (p: string) => ({ valid: true, resolvedPath: p }),
    execGit: async (cwd: string) => ({ stdout: `${cwd}\n${main}/.git\n`, stderr: '' }),
  } as unknown as WorkspaceEnvironment;
  registry = new WorkspaceRegistry(() => environment);
  await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: main, environmentId: 'ssh' });
  list = vi.fn().mockResolvedValue({ success: true, worktrees: [
    { path: main, branch: 'main', isMain: true, isLocked: false, isPrunable: false },
    { path: linked, branch: 'feature', isMain: false, isLocked: false, isPrunable: false },
  ] });
  registerTerminalIpc({
    getTerminals: () => new Map([['agent', terminal]]) as never,
    getMainWindow: () => ({ isDestroyed: () => false, webContents }) as never,
    getStore: () => ({}) as never, getSafeWorkspacePath: p => p, getHarnessOptions: () => ({}),
    getWorkspaceRegistry: () => registry, listObservedWorktrees: list, getAppShuttingDown: () => shuttingDown,
    agentAttentionBroker: { snapshot: () => snapshot('agent', 'running', 3, { sessionId: 'S', location: { path: linked, checkoutContextId: null }, locationProvenance: { state: 'current', sessionId: 'S' } }) } as never,
  });
});
describe('observed-worktree IPC boundary', () => {
  it('routes only live terminal identity and revalidates a confirmed descriptor', async () => {
    expect(await invoke(INSPECT_OBSERVED_WORKTREE, event, 'agent', 3)).toMatchObject({ candidate: { path: linked, branch: 'feature' } });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
    expect(await invoke(ATTACH_OBSERVED_WORKTREE, event, 'agent', 3, { path: linked, branch: 'feature' })).toMatchObject({ success: true, checkoutContext: { path: linked } });
  });
  it.each(['foreign-frame', 'foreign-sender', 'shutdown'])('refuses %s before probing', async kind => {
    if (kind === 'shutdown') shuttingDown = true;
    const sender = kind === 'foreign-frame' ? { ...event, senderFrame: {} } : kind === 'foreign-sender' ? { ...event, sender: {} } : event;
    for (const channel of [INSPECT_OBSERVED_WORKTREE, ATTACH_OBSERVED_WORKTREE]) {
      expect(await invoke(channel, sender, 'agent', 3, { path: linked, branch: 'feature' })).toMatchObject({ success: false });
    }
    expect(list).not.toHaveBeenCalled();
  });
  it('refuses caller-selected arbitrary roots, branches, unknown agents and stale revisions', async () => {
    expect(await invoke(ATTACH_OBSERVED_WORKTREE, event, 'agent', 3, { path: '/etc', branch: 'feature' })).toMatchObject({ success: false });
    expect(await invoke(ATTACH_OBSERVED_WORKTREE, event, 'agent', 3, { path: linked, branch: 'changed' })).toMatchObject({ success: false });
    expect(await invoke(ATTACH_OBSERVED_WORKTREE, event, 'agent', 3)).toMatchObject({ success: false });
    expect(await invoke(INSPECT_OBSERVED_WORKTREE, event, 'unknown', 3)).toMatchObject({ success: false });
    expect(await invoke(INSPECT_OBSERVED_WORKTREE, event, 'agent', 2)).toMatchObject({ success: false });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });
});
