// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Header from '../../setup/HeaderWithSettings';
import WorkspaceNavigatorSection from '../../../src/renderer/components/WorkspaceNavigatorSection';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { launchSession } from '../../../src/renderer/lib/sessionLaunch';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { GitWorktreeCreateResult } from '../../../src/shared/types/git';

// The Git popover polls and is irrelevant here.
vi.mock('../../../src/renderer/components/GitButton', () => ({ default: () => null }));

const ROOT = '/projects/clanker';
const WORKTREE = '/projects/clanker-worktrees/issue-90-x';
const SSH_ROOT = '/srv/clanker';
const SSH_WORKTREE = '/srv/clanker-worktrees/issue-90-x';

const worktreeContext = (workspaceId: string, path = WORKTREE, environmentId = 'local'): CheckoutContext => ({
  id: `${workspaceId}::ckt-x`, workspaceId, environmentId, path, kind: 'worktree', branch: 'issue-90-x', mainCheckoutPath: environmentId === 'local' ? ROOT : SSH_ROOT,
});

function openWorkspace(overrides: Parameters<typeof createWorkspaceFixture>[0] = {}) {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [], activeTerminalId: null });
  const { id: _id, lifecycle: _lifecycle, ...input } = createWorkspaceFixture({
    workspacePath: ROOT, harness: 'codex', gitIsRepo: true, terminals: [], panes: [], activeTerminalId: null, ...overrides,
  });
  void _id; void _lifecycle;
  useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws' });
  return useWorkspaceStore.getState().getWorkspaceById('ws')!;
}
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;

describe('explicit sessions from New Agent', () => {
  let spawnTerminal: ReturnType<typeof vi.fn>;
  let gitCreateWorktree: ReturnType<typeof vi.fn>;
  let gitGetBranchState: ReturnType<typeof vi.fn>;
  let registerOpenWorkspace: ReturnType<typeof vi.fn>;
  let releaseCheckoutContext: ReturnType<typeof vi.fn>;
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceNavigationStore.setState({ mode: 'tabs' });
    let n = 0;
    spawnTerminal = vi.fn().mockImplementation(async (_dir: string, harness?: string, _m?: string, _c?: string, _r?: boolean, _ws?: string, _env?: string, contextId?: string) => ({
      id: `term-${++n}`, pid: 100 + n, harnessId: harness, checkoutContextId: contextId,
    }));
    gitGetBranchState = vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'feature/base', isDetached: false, branches: [] });
    gitCreateWorktree = vi.fn().mockImplementation(async (_p: string, _b: string, _br: string, workspaceId: string): Promise<GitWorktreeCreateResult> => ({
      success: true,
      worktree: { path: WORKTREE, branch: 'issue-90-x', isMain: false, isLocked: false, isPrunable: false },
      checkoutContext: worktreeContext(workspaceId),
    }));
    registerOpenWorkspace = vi.fn();
    releaseCheckoutContext = vi.fn().mockResolvedValue({ success: true });
    installElectronApiMock({
      getHarnessOptions: vi.fn().mockResolvedValue({ codex: true, claude: true }),
      getHarnessDefaults: vi.fn().mockResolvedValue({
        codex: { model: '', favorites: [], flags: '', visible: true },
        claude: { model: '', favorites: [], flags: '', visible: true },
      }),
      gitListWorktrees: vi.fn().mockImplementation(async () => ({ success: true, worktrees: (workspace()?.checkoutContexts ?? []).map((context) => ({
        path: context.path, branch: context.branch ?? 'feature/base', isMain: context.kind === 'main', isLocked: false, isPrunable: false,
      })) })),
      spawnTerminal, gitCreateWorktree, gitGetBranchState, registerOpenWorkspace, releaseCheckoutContext,
      killTerminal: vi.fn().mockResolvedValue({ success: true }),
    });
  });
  afterEach(() => cleanup());

  async function openPopover() {
    await user.click(await screen.findByRole('button', { name: 'New Agent' }));
    return screen.findByLabelText('New branch');
  }
  async function submit(branch = 'issue-90-x', harness?: string) {
    const input = await openPopover();
    if (harness) await user.click(screen.getByRole('radio', { name: new RegExp('^' + harness + '$', 'i') }));
    await user.type(input, branch);
    await user.click(screen.getByRole('button', { name: /^Launch/ }));
  }

  describe('creating a session in a new worktree', () => {
    it('creates with the explicit attach option from the current branch, records the context, and launches into it', async () => {
      openWorkspace();
      render(<Header />);

      await submit('issue-90-x');

      await waitFor(() => expect(workspace().terminals).toHaveLength(1));
      expect(gitGetBranchState).toHaveBeenCalledWith(ROOT, 'ws');
      expect(gitCreateWorktree).toHaveBeenCalledExactlyOnceWith(ROOT, 'HEAD', 'issue-90-x', 'ws', { attachCheckoutContext: true, newBranch: {} });
      expect(workspace().checkoutContexts).toEqual([
        { id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: ROOT, kind: 'main' },
        worktreeContext('ws'),
      ]);
      expect(spawnTerminal).toHaveBeenCalledExactlyOnceWith(WORKTREE, 'codex', undefined, undefined, undefined, 'ws', 'local', 'ws::ckt-x');
      expect(workspace().terminals[0]).toMatchObject({ workspaceId: 'ws', workingDir: WORKTREE, checkoutContextId: 'ws::ckt-x' });
      // Closed on success, and still one workspace that was never registered a second time.
      await waitFor(() => expect(screen.queryByLabelText('New branch')).toBeNull());
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
      expect(registerOpenWorkspace).not.toHaveBeenCalled();
      expect(workspace().workspacePath).toBe(ROOT);
    });

    it('uses HEAD as the base when the checkout is detached', async () => {
      gitGetBranchState.mockResolvedValue({ success: true, isRepo: true, currentBranch: null, isDetached: true, branches: [] });
      openWorkspace();
      render(<Header />);
      await submit();
      await waitFor(() => expect(gitCreateWorktree).toHaveBeenCalled());
      expect(gitCreateWorktree.mock.calls[0][1]).toBe('HEAD');
    });

    it('reads the branch from Git at creation time, not from the displayed state', async () => {
      openWorkspace({ gitCurrentBranch: 'stale-display-branch' });
      render(<Header />);
      await submit();
      await waitFor(() => expect(gitCreateWorktree).toHaveBeenCalled());
      expect(gitCreateWorktree.mock.calls[0][1]).toBe('HEAD');
    });

    it('launches the harness picked in the popover with the toolbar\'s model rules', async () => {
      openWorkspace({ model: 'gpt-x' });
      render(<Header />);
      await submit('issue-90-x', 'claude');
      await waitFor(() => expect(spawnTerminal).toHaveBeenCalled());
      // Same rule as the pills: the workspace model applies only to the workspace's own harness.
      expect(spawnTerminal.mock.calls[0][1]).toBe('claude');
      expect(spawnTerminal.mock.calls[0][2]).toBeUndefined();
    });

    it('works the same way for an SSH workspace, with its own root and no model', async () => {
      gitCreateWorktree.mockImplementation(async (_p: string, _b: string, _br: string, workspaceId: string) => ({
        success: true,
        worktree: { path: SSH_WORKTREE, branch: 'issue-90-x', isMain: false, isLocked: false, isPrunable: false },
        checkoutContext: worktreeContext(workspaceId, SSH_WORKTREE, 'vps'),
      }));
      // A remote workspace offers the harnesses installed on its host.
      Object.assign(window.electronAPI, { getEnvironmentHarnessOptions: vi.fn().mockResolvedValue({ codex: true }) });
      openWorkspace({ workspacePath: SSH_ROOT, environmentId: 'vps', model: 'ignored-on-ssh' });
      render(<Header />);

      await submit();

      await waitFor(() => expect(workspace().terminals).toHaveLength(1));
      expect(gitCreateWorktree).toHaveBeenCalledExactlyOnceWith(SSH_ROOT, 'HEAD', 'issue-90-x', 'ws', { attachCheckoutContext: true, newBranch: {} });
      expect(spawnTerminal).toHaveBeenCalledExactlyOnceWith(SSH_WORKTREE, 'codex', undefined, undefined, undefined, 'ws', 'vps', 'ws::ckt-x');
      expect(workspace().workspacePath).toBe(SSH_ROOT);
      expect(workspace().checkoutContexts!.map((context) => context.path)).toEqual([SSH_ROOT, SSH_WORKTREE]);
      expect(registerOpenWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    it('shows a creation error, launches nothing and keeps the popover open', async () => {
      gitCreateWorktree.mockResolvedValue({ success: false, error: 'Branch name is invalid' });
      openWorkspace();
      render(<Header />);

      await submit('bad name');

      expect(await screen.findByRole('alert')).toHaveTextContent('Branch name is invalid');
      expect(spawnTerminal).not.toHaveBeenCalled();
      expect(workspace().checkoutContexts).toHaveLength(1);
      expect(screen.getByLabelText('New branch')).toBeTruthy();
    });

    it('reports a created-but-unattached worktree, launches no terminal, and deletes nothing', async () => {
      gitCreateWorktree.mockResolvedValue({
        success: false, created: true,
        worktree: { path: WORKTREE, branch: 'issue-90-x', isMain: false, isLocked: false, isPrunable: false },
        error: 'The worktree for branch "issue-90-x" was created at /projects/clanker-worktrees/issue-90-x but could not be attached to this workspace: registry unavailable. The checkout and branch were kept.',
      });
      const removeWorktree = vi.fn();
      Object.assign(window.electronAPI, { gitRemoveWorktree: removeWorktree });
      openWorkspace();
      render(<Header />);

      await submit();

      expect(await screen.findByRole('alert')).toHaveTextContent('could not be attached');
      expect(spawnTerminal).not.toHaveBeenCalled();
      expect(removeWorktree).not.toHaveBeenCalled();
      expect(workspace().checkoutContexts).toHaveLength(1);
      expect(workspace().terminals).toHaveLength(0);
    });

    it('treats a success without a returned context as a kept, unattached checkout', async () => {
      gitCreateWorktree.mockResolvedValue({ success: true, worktree: { path: WORKTREE, branch: 'issue-90-x', isMain: false, isLocked: false, isPrunable: false } });
      openWorkspace();
      render(<Header />);
      await submit();
      expect(await screen.findByRole('alert')).toHaveTextContent('was not attached');
      expect(spawnTerminal).not.toHaveBeenCalled();
    });

    it('keeps the context when the agent cannot start, so the checkout shows up as an inactive row', async () => {
      spawnTerminal.mockRejectedValue(new Error('spawn failed'));
      openWorkspace();
      render(<><Header /><WorkspaceNavigatorSection /></>);

      await submit('issue-90-x');

      expect(await screen.findByRole('alert')).toHaveTextContent('spawn failed');
      expect(workspace().checkoutContexts!.map((context) => context.id)).toEqual([mainCheckoutContextId('ws'), 'ws::ckt-x']);
      expect(workspace().terminals).toHaveLength(0);
      // Nothing was deleted, and the stranded checkout is visible and removable.
      expect(workspace().checkoutContexts?.some((context) => context.branch === 'issue-90-x')).toBe(true);
    });

    it('refuses to create when the focused workspace is no longer the one the request came from', async () => {
      openWorkspace();
      const { id: _id, lifecycle: _l, ...other } = createWorkspaceFixture({ workspacePath: '/projects/other', gitIsRepo: true, terminals: [], panes: [], activeTerminalId: null });
      void _id; void _l;
      useWorkspaceStore.getState().addWorkspace({ ...other, id: 'other' });
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('other');

      const result = await launchSession({ workspaceId: 'ws', harnessId: 'codex', target: { kind: 'new-branch' as const, branch: 'issue-90-x' }, visibleHarnessIds: ['codex'] });

      expect(result).toMatchObject({ ok: false, checkoutCreated: false, error: expect.stringContaining('focused workspace changed') });
      expect(gitGetBranchState).not.toHaveBeenCalled();
      expect(gitCreateWorktree).not.toHaveBeenCalled();
      expect(spawnTerminal).not.toHaveBeenCalled();
    });

    it('refuses to create from a legacy worktree workspace or without a branch, before touching Git', async () => {
      openWorkspace({ isLinkedWorktree: true });
      expect(await launchSession({ workspaceId: 'ws', harnessId: 'codex', target: { kind: 'new-branch' as const, branch: 'x' }, visibleHarnessIds: ['codex'] }))
        .toMatchObject({ ok: false });
      openWorkspace();
      expect(await launchSession({ workspaceId: 'ws', harnessId: 'codex', target: { kind: 'new-branch' as const, branch: '   ' }, visibleHarnessIds: ['codex'] }))
        .toMatchObject({ ok: false, error: 'Enter a task branch' });
      expect(gitGetBranchState).not.toHaveBeenCalled();
      expect(gitCreateWorktree).not.toHaveBeenCalled();
    });

    it('releases a context the workspace refuses to hold instead of leaving main holding it', async () => {
      openWorkspace();
      // Main returns a context that does not belong to this workspace: the store must not accept it.
      gitCreateWorktree.mockResolvedValue({
        success: true,
        worktree: { path: WORKTREE, branch: 'issue-90-x', isMain: false, isLocked: false, isPrunable: false },
        checkoutContext: worktreeContext('someone-else'),
      });
      const result = await launchSession({ workspaceId: 'ws', harnessId: 'codex', target: { kind: 'new-branch' as const, branch: 'issue-90-x' }, visibleHarnessIds: ['codex'] });

      expect(result).toMatchObject({ ok: false, checkoutCreated: true });
      expect(releaseCheckoutContext).toHaveBeenCalledWith('ws', 'someone-else::ckt-x');
      expect(spawnTerminal).not.toHaveBeenCalled();
      expect(workspace().checkoutContexts).toHaveLength(1);
    });
  });

  describe('when focus moves to another workspace during creation', () => {
    const otherWorkspace = () => {
      const { id: _id, lifecycle: _l, ...other } = createWorkspaceFixture({ workspacePath: '/projects/other', gitIsRepo: true, terminals: [], panes: [], activeTerminalId: null });
      void _id; void _l;
      useWorkspaceStore.getState().addWorkspace({ ...other, id: 'other' });
    };
    const request = { workspaceId: 'ws', harnessId: 'codex', target: { kind: 'new-branch' as const, branch: 'issue-90-x' }, visibleHarnessIds: ['codex'] };

    it('creates nothing when focus moved while the current branch was being read', async () => {
      openWorkspace();
      gitGetBranchState.mockImplementation(async () => {
        otherWorkspace();
        return { success: true, isRepo: true, currentBranch: 'feature/base', isDetached: false, branches: [] };
      });

      const result = await launchSession(request);

      expect(result).toMatchObject({ ok: false, checkoutCreated: false, error: expect.stringContaining('focused workspace changed') });
      expect(gitCreateWorktree).not.toHaveBeenCalled();
      expect(spawnTerminal).not.toHaveBeenCalled();
    });

    it('keeps the created checkout and its context, but starts no agent in the background workspace', async () => {
      openWorkspace();
      gitCreateWorktree.mockImplementation(async (_p: string, _b: string, _br: string, workspaceId: string): Promise<GitWorktreeCreateResult> => {
        otherWorkspace();
        return {
          success: true,
          worktree: { path: WORKTREE, branch: 'issue-90-x', isMain: false, isLocked: false, isPrunable: false },
          checkoutContext: worktreeContext(workspaceId),
        };
      });
      const removeWorktree = vi.fn();
      Object.assign(window.electronAPI, { gitRemoveWorktree: removeWorktree });

      const result = await launchSession(request);

      expect(result).toMatchObject({ ok: false, checkoutCreated: true, error: expect.stringContaining('focus moved to another workspace') });
      expect(spawnTerminal).not.toHaveBeenCalled();
      // Nothing was undone: the context is attached to its owning workspace, which gained no agent.
      expect(useWorkspaceStore.getState().getWorkspaceById('ws')!.checkoutContexts!.map((context) => context.id)).toEqual([mainCheckoutContextId('ws'), 'ws::ckt-x']);
      expect(useWorkspaceStore.getState().getWorkspaceById('ws')!.terminals).toHaveLength(0);
      expect(useWorkspaceStore.getState().getWorkspaceById('other')!.terminals).toHaveLength(0);
      expect(releaseCheckoutContext).not.toHaveBeenCalled();
      expect(removeWorktree).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
      expect(registerOpenWorkspace).not.toHaveBeenCalled();
    });

    it('leaves the preserved checkout visible as an inactive row when the user returns to its workspace', async () => {
      openWorkspace();
      gitCreateWorktree.mockImplementation(async (_p: string, _b: string, _br: string, workspaceId: string): Promise<GitWorktreeCreateResult> => {
        otherWorkspace();
        return {
          success: true,
          worktree: { path: WORKTREE, branch: 'issue-90-x', isMain: false, isLocked: false, isPrunable: false },
          checkoutContext: worktreeContext(workspaceId),
        };
      });
      await launchSession(request);

      act(() => useWorkspaceStore.getState().selectWorkspace('ws'));
      render(<WorkspaceNavigatorSection />);

      expect(workspace().checkoutContexts?.some((context) => context.branch === 'issue-90-x')).toBe(true);
    });

    it('still launches normally when focus stays put', async () => {
      openWorkspace();
      expect(await launchSession(request)).toEqual({ ok: true });
      expect(spawnTerminal).toHaveBeenCalledTimes(1);
    });
  });

});
