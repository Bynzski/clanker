// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Header from '../../../src/renderer/components/Header';
import WorkspaceNavigatorSection from '../../../src/renderer/components/WorkspaceNavigatorSection';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { getSelectedAgentWorktreeContext, getUnusedWorktreeContexts } from '../../../src/renderer/lib/worktreeAgents';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { GitWorktree } from '../../../src/shared/types/git';

vi.mock('../../../src/renderer/components/GitButton', () => ({ default: () => null }));

const ROOT = '/projects/clanker';
const WT = (name: string) => `/projects/clanker-worktrees/${name}`;
const listed = (path: string, branch: string | null, extra: Partial<GitWorktree> = {}): GitWorktree =>
  ({ path, branch, isMain: false, isLocked: false, isPrunable: false, ...extra });
const MAIN_ENTRY = listed(ROOT, 'main', { isMain: true });
const ctx = (name: string, branch = name): CheckoutContext => ({
  id: `ws::ckt-${name}`, workspaceId: 'ws', environmentId: 'local', path: WT(name), kind: 'worktree', branch, mainCheckoutPath: ROOT,
});

function openWorkspace(overrides: Parameters<typeof createWorkspaceFixture>[0] = {}) {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [], activeTerminalId: null });
  const { id: _id, lifecycle: _l, ...input } = createWorkspaceFixture({
    workspacePath: ROOT, harness: 'codex', gitIsRepo: true, terminals: [], panes: [], activeTerminalId: null, ...overrides,
  });
  void _id; void _l;
  useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws' });
}
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;

describe('isolated agent picker: harness + working copy', () => {
  const user = userEvent.setup();
  let api: ReturnType<typeof installElectronApiMock>;
  let worktrees: GitWorktree[];
  let branches: string[];
  let nextTerminal: number;

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceNavigationStore.setState({ mode: 'tabs' });
    nextTerminal = 0;
    worktrees = [MAIN_ENTRY];
    branches = ['main'];
    api = installElectronApiMock({
      getHarnessOptions: vi.fn().mockResolvedValue({ codex: true, claude: true, opencode: true }),
      getHarnessDefaults: vi.fn().mockResolvedValue({
        codex: { model: '', favorites: [], flags: '', visible: true },
        claude: { model: '', favorites: [], flags: '', visible: true },
        opencode: { model: '', favorites: [], flags: '', visible: true },
      }),
      spawnTerminal: vi.fn().mockImplementation(async (_dir: string, harness?: string, _m?: string, _c?: string, _r?: boolean, _ws?: string, _env?: string, contextId?: string) => ({
        id: `term-${++nextTerminal}`, pid: 100 + nextTerminal, harnessId: harness, checkoutContextId: contextId,
      })),
      killTerminal: vi.fn().mockResolvedValue({ success: true }),
      gitGetBranchState: vi.fn().mockImplementation(async () => ({
        success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: branches.map((name) => ({ name, isCurrent: name === 'main' })),
      })),
      gitListWorktrees: vi.fn().mockImplementation(async () => ({ success: true, worktrees })),
      gitCreateWorktree: vi.fn().mockImplementation(async (_p: string, _base: string, branch: string) => ({
        success: true,
        worktree: listed(WT(branch), branch),
        checkoutContext: ctx(branch),
      })),
      adoptWorktreeCheckoutContext: vi.fn().mockImplementation(async (_ws: string, path: string) => {
        const entry = worktrees.find((item) => item.path === path)!;
        return { success: true, checkoutContext: ctx(entry.path.split('/').pop()!, entry.branch ?? undefined) };
      }),
      releaseCheckoutContext: vi.fn().mockResolvedValue({ success: true }),
    });
  });
  afterEach(() => cleanup());

  const openPicker = async () => {
    await user.click(await screen.findByRole('button', { name: 'New isolated agent' }));
    await screen.findByLabelText('New branch');
  };
  const launch = async (harnessLabel?: string) => {
    if (harnessLabel) await user.click(screen.getByRole('radio', { name: harnessLabel }));
    await user.click(screen.getByRole('button', { name: /^Launch/ }));
  };
  const section = (name: string) => within(screen.getByRole('group', { name }));

  describe('harness pane', () => {
    it('shows the toolbar harnesses with icons, marks the selection and changes the launched harness', async () => {
      openWorkspace();
      render(<Header />);
      await openPicker();

      const radios = screen.getAllByRole('radio');
      expect(radios.map((el) => el.getAttribute('title'))).toEqual(['Terminal', 'Codex', 'Claude', 'OpenCode']);
      expect(radios.every((el) => el.querySelector('svg, img'))).toBe(true);
      expect(screen.getByRole('radio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true');
      await user.click(screen.getByRole('radio', { name: 'Claude' }));
      expect(screen.getByRole('radio', { name: 'Claude' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'false');

      await user.type(screen.getByLabelText('New branch'), 'issue-1');
      await launch();
      await waitFor(() => expect(api.spawnTerminal).toHaveBeenCalled());
      expect(api.spawnTerminal.mock.calls[0][1]).toBe('claude');
    });
  });

  describe('new branch', () => {
    it('creates from the current branch and launches, as before', async () => {
      openWorkspace();
      render(<Header />);
      await openPicker();
      await user.type(screen.getByLabelText('New branch'), 'issue-123');
      await launch();

      await waitFor(() => expect(workspace().terminals).toHaveLength(1));
      expect(api.gitCreateWorktree).toHaveBeenCalledExactlyOnceWith(ROOT, 'main', 'issue-123', 'ws', { attachCheckoutContext: true });
      expect(api.adoptWorktreeCheckoutContext).not.toHaveBeenCalled();
    });

    it('does not launch until a branch name is entered', async () => {
      openWorkspace();
      render(<Header />);
      await openPicker();
      expect(screen.getByRole('button', { name: /^Launch/ })).toBeDisabled();
    });
  });

  describe('existing branches', () => {
    beforeEach(() => {
      branches = ['main', 'feature/foo', 'feature/bar'];
      worktrees = [MAIN_ENTRY, listed(WT('feature-bar'), 'feature/bar')];
    });

    it('lists only branches without a worktree and never the checked-out one', async () => {
      openWorkspace();
      render(<Header />);
      await openPicker();

      const existing = await screen.findByRole('group', { name: 'Existing branches' });
      expect(within(existing).getAllByRole('button').map((el) => el.textContent)).toEqual(['feature/foo']);
      expect(within(existing).queryByText('main')).toBeNull();
      // feature/bar is represented once, as its worktree.
      expect(within(existing).queryByText('feature/bar')).toBeNull();
      expect(section('Existing worktrees').getByText('feature/bar')).toBeTruthy();
    });

    it('selecting a branch only selects it; launching creates a worktree for that existing branch', async () => {
      openWorkspace();
      render(<Header />);
      await openPicker();
      await user.click(await section('Existing branches').findByRole('button', { name: 'feature/foo' }));
      expect(api.gitCreateWorktree).not.toHaveBeenCalled();
      expect(api.spawnTerminal).not.toHaveBeenCalled();

      await launch('Claude');
      await waitFor(() => expect(workspace().terminals).toHaveLength(1));
      expect(api.gitCreateWorktree).toHaveBeenCalledExactlyOnceWith(ROOT, 'feature/foo', 'feature/foo', 'ws', { attachCheckoutContext: true });
      expect(workspace().workspacePath).toBe(ROOT);
      expect(workspace().checkoutContexts!.map((context) => context.branch)).toEqual([undefined, 'feature/foo']);
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });

    it('refuses a branch deleted since the picker loaded without creating anything', async () => {
      openWorkspace();
      render(<Header />);
      await openPicker();
      await user.click(await section('Existing branches').findByRole('button', { name: 'feature/foo' }));
      branches = ['main', 'feature/bar'];
      await launch();

      expect(await screen.findByRole('alert')).toHaveTextContent('no longer exists');
      expect(api.gitCreateWorktree).not.toHaveBeenCalled();
    });
  });

  describe('existing worktrees', () => {
    it('reuses an inactive managed context without creating or adopting anything', async () => {
      worktrees = [MAIN_ENTRY, listed(WT('task-a'), 'task-a')];
      openWorkspace({ checkoutContexts: [{ id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: ROOT, kind: 'main' }, ctx('task-a')] });
      render(<><Header /><WorkspaceNavigatorSection /></>);
      await openPicker();

      const row = await section('Existing worktrees').findByRole('button', { name: /task-a/ });
      expect(row).toHaveTextContent('Available');
      await user.click(row);
      await launch();

      await waitFor(() => expect(workspace().terminals).toHaveLength(1));
      expect(api.adoptWorktreeCheckoutContext).not.toHaveBeenCalled();
      expect(api.gitCreateWorktree).not.toHaveBeenCalled();
      expect(api.spawnTerminal.mock.calls[0][7]).toBe('ws::ckt-task-a');
      expect(workspace().checkoutContexts).toHaveLength(2);
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });

    it('lets a second agent share an in-use context, which stays active until its last agent closes', async () => {
      worktrees = [MAIN_ENTRY, listed(WT('task-a'), 'task-a')];
      openWorkspace({ checkoutContexts: [{ id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: ROOT, kind: 'main' }, ctx('task-a')] });
      render(<><Header /><WorkspaceNavigatorSection /></>);

      // First agent.
      await openPicker();
      await user.click(await section('Existing worktrees').findByRole('button', { name: /task-a/ }));
      await launch();
      await waitFor(() => expect(workspace().terminals).toHaveLength(1));

      // Second agent: the row is labelled In use but is still selectable.
      await openPicker();
      const row = await section('Existing worktrees').findByRole('button', { name: /task-a/ });
      expect(row).toHaveTextContent('In use');
      expect(row).toBeEnabled();
      await user.click(row);
      await launch('Claude');
      await waitFor(() => expect(workspace().terminals).toHaveLength(2));

      expect(workspace().terminals.map((terminal) => terminal.checkoutContextId)).toEqual(['ws::ckt-task-a', 'ws::ckt-task-a']);
      expect(workspace().checkoutContexts!.filter((context) => context.path === WT('task-a'))).toHaveLength(1);
      expect(api.adoptWorktreeCheckoutContext).not.toHaveBeenCalled();
      expect(getUnusedWorktreeContexts(workspace())).toHaveLength(0);

      // Closing one keeps it active; closing the last leaves an inactive checkout.
      const [first, second] = workspace().terminals.map((terminal) => terminal.id);
      useWorkspaceStore.getState().removeTerminal(first);
      expect(getUnusedWorktreeContexts(workspace())).toHaveLength(0);
      useWorkspaceStore.getState().removeTerminal(second);
      expect(getUnusedWorktreeContexts(workspace()).map((context) => context.branch)).toEqual(['task-a']);
      expect(await screen.findByRole('list', { name: /inactive checkouts/ })).toBeTruthy();
    });

    it('adopts an unmanaged linked worktree through main, sending only the listed path', async () => {
      worktrees = [MAIN_ENTRY, listed(WT('old-task'), 'old-task')];
      openWorkspace();
      render(<><Header /><WorkspaceNavigatorSection /></>);
      await openPicker();

      const row = await section('Existing worktrees').findByRole('button', { name: /old-task/ });
      expect(row).toHaveTextContent('Unmanaged');
      await user.click(row);
      expect(api.adoptWorktreeCheckoutContext).not.toHaveBeenCalled();
      await launch('OpenCode');

      await waitFor(() => expect(workspace().terminals).toHaveLength(1));
      expect(api.adoptWorktreeCheckoutContext).toHaveBeenCalledExactlyOnceWith('ws', WT('old-task'));
      expect(api.gitCreateWorktree).not.toHaveBeenCalled();
      expect(workspace().checkoutContexts!.map((context) => context.path)).toEqual([ROOT, WT('old-task')]);
      expect(api.spawnTerminal.mock.calls[0][1]).toBe('opencode');
      expect(api.spawnTerminal.mock.calls[0][7]).toBe('ws::ckt-old-task');
      expect(getSelectedAgentWorktreeContext(workspace())?.branch).toBe('old-task');
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
      expect(registerNotCalled()).toBe(true);
    });

    const registerNotCalled = () => (api.registerOpenWorkspace as ReturnType<typeof vi.fn>).mock.calls.length === 0;

    it('shows a refused adoption and launches nothing', async () => {
      worktrees = [MAIN_ENTRY, listed(WT('old-task'), 'old-task')];
      api.adoptWorktreeCheckoutContext.mockResolvedValueOnce({ success: false, error: 'Git does not list that path as a worktree of this repository' });
      openWorkspace();
      render(<Header />);
      await openPicker();
      await user.click(await section('Existing worktrees').findByRole('button', { name: /old-task/ }));
      await launch();

      expect(await screen.findByRole('alert')).toHaveTextContent('does not list that path');
      expect(workspace().terminals).toHaveLength(0);
      expect(workspace().checkoutContexts).toHaveLength(1);
    });

    it('disables missing and locked worktrees as destinations and points at the Git menu', async () => {
      worktrees = [
        MAIN_ENTRY,
        listed(WT('gone'), 'gone', { isPrunable: true }),
        listed(WT('stuck'), 'stuck', { isLocked: true }),
      ];
      openWorkspace();
      render(<Header />);
      await openPicker();

      const gone = await section('Existing worktrees').findByRole('button', { name: /gone/ });
      const stuck = section('Existing worktrees').getByRole('button', { name: /stuck/ });
      expect(gone).toBeDisabled();
      expect(gone).toHaveTextContent('Missing');
      expect(stuck).toBeDisabled();
      expect(stuck).toHaveTextContent('Locked');
      expect(gone.getAttribute('title')).toContain('Git menu');
      expect(stuck.getAttribute('title')).toContain('Git menu');
      expect(screen.getByRole('button', { name: /^Launch/ })).toBeDisabled();
      // Management actions do not live in the picker.
      expect(screen.queryByRole('button', { name: /Remove|Unlock|Prune/ })).toBeNull();
    });

    it('does not offer the main checkout or the workspace\'s own root', async () => {
      worktrees = [MAIN_ENTRY, listed(WT('task-a'), 'task-a')];
      openWorkspace();
      render(<Header />);
      await openPicker();
      const existing = await screen.findByRole('group', { name: 'Existing worktrees' });
      expect(within(existing).getAllByRole('button')).toHaveLength(1);
    });
  });

  it('keeps ordinary harness launches going straight into the main checkout', async () => {
    openWorkspace();
    render(<Header />);
    await user.click(await screen.findByRole('button', { name: 'Codex' }));
    await waitFor(() => expect(workspace().terminals).toHaveLength(1));
    expect(api.spawnTerminal).toHaveBeenCalledExactlyOnceWith(ROOT, 'codex', undefined);
    expect(api.adoptWorktreeCheckoutContext).not.toHaveBeenCalled();
    expect(api.gitCreateWorktree).not.toHaveBeenCalled();
  });
});
