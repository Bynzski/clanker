import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshWorktreeInventory, useWorktreeInventory } from '../../../src/renderer/lib/worktreeInventory';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { GitWorktreeListResult } from '../../../src/shared/types/git';

const external = { path: '/external/topic', branch: 'topic', isMain: false, isLocked: false, isPrunable: false };
const listing: GitWorktreeListResult = { success: true, worktrees: [external] };
const open = () => useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({ id: 'ws', workspacePath: '/repo', terminals: [], panes: [] }));
beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  useWorktreeInventory.setState({ byWorkspace: {} });
  open();
});
describe('Git inventory is descriptive and independent of registrations', () => {
  it('discovers an external checkout without adopting it or starting a process', async () => {
    const api = installElectronApiMock({ gitListWorktrees: vi.fn().mockResolvedValue(listing) });
    await refreshWorktreeInventory('ws');
    expect(useWorktreeInventory.getState().byWorkspace.ws.worktrees).toEqual([external]);
    expect(useWorkspaceStore.getState().getWorkspaceById('ws')!.checkoutContexts).toHaveLength(1);
    expect(api.adoptWorktreeCheckoutContext).not.toHaveBeenCalled();
    expect(api.spawnTerminal).not.toHaveBeenCalled();
  });
  it('retains last-known rows and an actionable error when listing fails', async () => {
    const api = installElectronApiMock({ gitListWorktrees: vi.fn().mockResolvedValue(listing) });
    await refreshWorktreeInventory('ws');
    api.gitListWorktrees.mockRejectedValue(new Error('SSH disconnected'));
    await refreshWorktreeInventory('ws');
    expect(useWorktreeInventory.getState().byWorkspace.ws).toMatchObject({ success: false, worktrees: [external], error: 'SSH disconnected' });
  });
  it('coalesces concurrent reads and rejects a response after close/reopen with the same identity', async () => {
    let finish!: (result: GitWorktreeListResult) => void;
    installElectronApiMock({ gitListWorktrees: vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; })) });
    const request = refreshWorktreeInventory('ws');
    expect(refreshWorktreeInventory('ws')).toBe(request);
    await Promise.resolve();
    useWorkspaceStore.setState({ workspaces: [] });
    open();
    finish(listing);
    await request;
    expect(useWorktreeInventory.getState().byWorkspace.ws).toBeUndefined();
  });
});
