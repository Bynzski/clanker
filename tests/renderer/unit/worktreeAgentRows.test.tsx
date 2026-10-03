// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkspaceNavigatorSection from '../../../src/renderer/components/WorkspaceNavigatorSection';
import WorkspaceRail from '../../../src/renderer/components/WorkspaceRail';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';

const ROOT = '/projects/clanker';
const context = (suffix: string, branch: string | null): CheckoutContext => ({
  id: `ws::ckt-${suffix}`, workspaceId: 'ws', environmentId: 'local', path: `/projects/clanker-worktrees/${suffix}`,
  kind: 'worktree', branch, mainCheckoutPath: ROOT,
});
const MAIN: CheckoutContext = { id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: ROOT, kind: 'main' };
const ACTIVE = context('active', 'issue-90');
const FINISHED = context('finished', 'issue-72-finished');

function openWorkspace(overrides: Parameters<typeof createWorkspaceFixture>[0] = {}) {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [], activeTerminalId: null });
  const { id: _id, lifecycle: _lifecycle, ...input } = createWorkspaceFixture({
    workspacePath: ROOT,
    checkoutContexts: [MAIN, ACTIVE, FINISHED],
    terminals: [
      createTerminalFixture({ id: 't-main', displayName: 'Samson', workingDir: ROOT, harnessId: 'codex', checkoutContextId: MAIN.id }),
      createTerminalFixture({ id: 't-wt', displayName: 'Delilah', workingDir: ACTIVE.path, harnessId: 'claude', checkoutContextId: ACTIVE.id }),
      createTerminalFixture({ id: 't-wt-finished', displayName: 'Jerry', workingDir: FINISHED.path, harnessId: 'pi', checkoutContextId: FINISHED.id }),
    ],
    panes: [], activeTerminalId: 't-main',
    ...overrides,
  });
  void _id; void _lifecycle;
  useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws' });
}
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;
const agentRows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.ws-agent-row')];

describe('worktree-backed agents in the sidebar', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    installElectronApiMock();
  });

  it('shows the branch on an agent running in an isolated worktree, with path and harness in its tooltip', () => {
    openWorkspace();
    const { container } = render(<WorkspaceNavigatorSection />);
    const row = agentRows(container).find((entry) => entry.querySelector('.ws-agent-branch')?.textContent === 'issue-90')!;

    expect(row).toBeTruthy();
    expect(within(row).getByLabelText('on branch issue-90')).toBeTruthy();
    expect(row.querySelector('.ws-agent-branch svg')).toBeTruthy();
    expect(row.title).toContain('Delilah · Claude · issue-90');
    expect(row.title).toContain('issue-90');
    expect(row.title).toContain(ACTIVE.path);
  });

  it('keeps the branch glyph when a very long branch name truncates', () => {
    const long = 'feature/this-is-an-intentionally-very-long-branch-name-to-test-truncation-in-the-sidebar';
    openWorkspace({ checkoutContexts: [MAIN, { ...ACTIVE, branch: long }] });
    const { container } = render(<WorkspaceNavigatorSection />);
    const badge = container.querySelector('.ws-agent-branch')!;

    // The text is the part that truncates (CSS ellipsis); the glyph and full name both remain present.
    expect(badge.querySelector('svg')).toBeTruthy();
    expect(badge.querySelector('span')?.textContent).toBe(long);
    expect(badge.getAttribute('aria-label')).toBe(`on branch ${long}`);
  });

  it('leaves a main-checkout agent exactly as it was: no badge, and the original two-part tooltip', () => {
    openWorkspace();
    const { container } = render(<WorkspaceNavigatorSection />);
    const main = agentRows(container).find((row) => row.querySelector('.ws-agent-name')?.textContent === 'Samson')!;

    expect(main).toBeTruthy();
    expect(main.querySelector('.ws-agent-branch')).toBeNull();
    expect(main.title).toBe('Samson · Codex');
    expect(main.title).not.toContain('\n');
  });

  it('does not treat a legacy linked-worktree workspace\'s own root as an isolated checkout', () => {
    openWorkspace({
      isLinkedWorktree: true,
      gitCurrentBranch: 'legacy-task',
      checkoutContexts: [{ ...MAIN, kind: 'worktree', branch: 'legacy-task' }],
      terminals: [createTerminalFixture({ id: 't-legacy', displayName: 'Samson', harnessId: 'codex', checkoutContextId: MAIN.id })],
    });
    const { container } = render(<WorkspaceNavigatorSection />);

    expect(container.querySelector('.ws-agent-branch')).toBeNull();
    expect(screen.queryByRole('list', { name: /inactive checkouts/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove checkout/ })).toBeNull();
  });

  describe('inactive checkouts', () => {
    it('lists only worktree contexts no agent references, quietly, beneath the agents', () => {
      openWorkspace({ terminals: [
        createTerminalFixture({ id: 't-main', displayName: 'Samson', harnessId: 'codex', checkoutContextId: MAIN.id }),
        createTerminalFixture({ id: 't-wt', displayName: 'Delilah', harnessId: 'claude', checkoutContextId: ACTIVE.id }),
      ] });
      render(<WorkspaceNavigatorSection />);

      const list = screen.getByRole('list', { name: /inactive checkouts/ });
      const rows = within(list).getAllByRole('listitem');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('issue-72-finished');
      expect(rows[0].title).toContain(FINISHED.path);
      expect(within(list).getByRole('button', { name: 'Remove checkout for branch issue-72-finished' })).toBeTruthy();
    });

    it('shows no inactive row while an agent is using the checkout, and shows it once the agent is gone', () => {
      openWorkspace();
      const { rerender } = render(<WorkspaceNavigatorSection />);
      expect(screen.queryByRole('list', { name: /inactive checkouts/ })).toBeNull();

      useWorkspaceStore.getState().removeTerminal('t-wt-finished');
      rerender(<WorkspaceNavigatorSection />);

      const list = screen.getByRole('list', { name: /inactive checkouts/ });
      expect(within(list).getByText('issue-72-finished')).toBeTruthy();
      // The agents that remain are untouched.
      expect(workspace().terminals.map((terminal) => terminal.id)).toEqual(['t-main', 't-wt']);
    });

    it('keeps a checkout shared by two agents active until both are closed', () => {
      openWorkspace({ terminals: [
        createTerminalFixture({ id: 'a', harnessId: 'codex', checkoutContextId: FINISHED.id }),
        createTerminalFixture({ id: 'b', harnessId: 'claude', checkoutContextId: FINISHED.id }),
      ], checkoutContexts: [MAIN, FINISHED] });
      const { rerender } = render(<WorkspaceNavigatorSection />);

      useWorkspaceStore.getState().removeTerminal('a');
      rerender(<WorkspaceNavigatorSection />);
      expect(screen.queryByRole('list', { name: /inactive checkouts/ })).toBeNull();

      useWorkspaceStore.getState().removeTerminal('b');
      rerender(<WorkspaceNavigatorSection />);
      expect(screen.getByRole('list', { name: /inactive checkouts/ })).toBeTruthy();
    });

    describe('removing', () => {
      const user = userEvent.setup();
      let releaseCheckoutContext: ReturnType<typeof vi.fn>;
      let gitInspectWorktree: ReturnType<typeof vi.fn>;
      let gitRemoveWorktree: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        openWorkspace({
          checkoutContexts: [MAIN, FINISHED],
          terminals: [createTerminalFixture({ id: 't-main', displayName: 'Samson', harnessId: 'codex', checkoutContextId: MAIN.id })],
        });
        releaseCheckoutContext = vi.fn().mockResolvedValue({ success: true });
        gitInspectWorktree = vi.fn().mockImplementation(async (_repo: string, path: string) => ({
          success: true, hasChanges: false, worktree: { path, branch: 'issue-72-finished', isMain: false, isLocked: false, isPrunable: false },
        }));
        gitRemoveWorktree = vi.fn().mockResolvedValue({ success: true });
        installElectronApiMock({ releaseCheckoutContext, gitInspectWorktree, gitRemoveWorktree });
      });

      const startRemoval = async () => {
        render(<WorkspaceNavigatorSection />);
        await user.click(screen.getByRole('button', { name: 'Remove checkout for branch issue-72-finished' }));
        return screen.findByRole('alertdialog');
      };
      const confirm = async () => user.click(screen.getByRole('button', { name: 'Remove worktree' }));

      it('asks first, naming the branch and saying it remains, and does nothing on Cancel', async () => {
        const dialog = await startRemoval();

        expect(within(dialog).getByText('Remove checkout for branch issue-72-finished?')).toBeTruthy();
        expect(dialog.textContent).toContain('The branch remains.');
        expect(dialog.textContent).toContain(FINISHED.path);
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(releaseCheckoutContext).not.toHaveBeenCalled();
        expect(workspace().checkoutContexts).toHaveLength(2);
      });

      it('runs the existing removal on confirm, then the row disappears and the workspace stays open', async () => {
        await startRemoval();
        await confirm();

        await waitFor(() => expect(screen.queryByRole('list', { name: /inactive checkouts/ })).toBeNull());
        expect(releaseCheckoutContext).toHaveBeenCalledExactlyOnceWith('ws', FINISHED.id);
        expect(gitInspectWorktree).toHaveBeenCalledWith(ROOT, FINISHED.path, [ROOT], 'ws');
        expect(gitRemoveWorktree).toHaveBeenCalledWith(ROOT, FINISHED.path, 'issue-72-finished', [ROOT], 'ws');
        expect(workspace().checkoutContexts!.map((entry) => entry.id)).toEqual([MAIN.id]);
        expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
        expect(workspace().workspacePath).toBe(ROOT);
        expect(screen.queryByRole('alert')).toBeNull();
      });

      it('shows a refusal from main and keeps the checkout row, since nothing was released', async () => {
        releaseCheckoutContext.mockResolvedValue({ success: false, error: '1 running terminal is still using this checkout; close it first' });
        await startRemoval();
        await confirm();

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('1 running terminal is still using this checkout');
        expect(alert.textContent).toContain('left on disk');
        expect(alert.textContent).toContain('branch was not deleted');
        expect(screen.getByRole('button', { name: 'Remove checkout for branch issue-72-finished' })).toBeTruthy();
        expect(gitInspectWorktree).not.toHaveBeenCalled();
        expect(workspace().checkoutContexts).toHaveLength(2);
      });

      it('shows the existing removal error when it fails after release, explains the checkout was left on disk, and keeps the message', async () => {
        gitInspectWorktree.mockResolvedValue({ success: true, hasChanges: true, worktree: { path: FINISHED.path, branch: 'issue-72-finished', isMain: false, isLocked: false, isPrunable: false } });
        await startRemoval();
        await confirm();

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('uncommitted, untracked, or ignored files');
        expect(alert.textContent).toContain(`left on disk at ${FINISHED.path}`);
        expect(alert.textContent).toContain('no longer listed here');
        expect(alert.textContent).toContain('branch was not deleted');
        // Released and forgotten: the row is gone, but the explanation stays readable until dismissed.
        expect(screen.queryByRole('list', { name: /inactive checkouts/ })).toBeNull();
        expect(workspace().checkoutContexts!.map((entry) => entry.id)).toEqual([MAIN.id]);
        expect(gitRemoveWorktree).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeTruthy();

        await user.click(within(alert).getByRole('button', { name: 'Dismiss message' }));
        expect(screen.queryByRole('alert')).toBeNull();
      });

      it('surfaces a removal failure and never retries, forces, or re-attaches', async () => {
        gitRemoveWorktree.mockResolvedValue({ success: false, error: 'Worktree branch changed; inspect it again' });
        await startRemoval();
        await confirm();

        // The existing error is not a sentence; the explanation that follows it still reads as one.
        expect((await screen.findByRole('alert')).textContent).toContain('Worktree branch changed; inspect it again. It was left on disk');
        expect(gitRemoveWorktree).toHaveBeenCalledTimes(1);
        expect(releaseCheckoutContext).toHaveBeenCalledTimes(1);
        expect(workspace().checkoutContexts!.map((entry) => entry.id)).not.toContain(FINISHED.id);
      });
    });
  });
});

describe('worktree-backed agents in the collapsed rail', () => {
  afterEach(() => cleanup());
  beforeEach(() => installElectronApiMock());

  it('names the branch and path in the worktree agent\'s label and tooltip, and marks it with a glyph', () => {
    openWorkspace();
    const { container } = render(<WorkspaceRail onExpand={() => undefined} />);
    const agent = screen.getByRole('button', { name: /Delilah · Claude · on branch issue-90/ });

    expect(agent.title).toContain('on branch issue-90');
    expect(agent.title).toContain(ACTIVE.path);
    expect(agent.className).toContain('worktree');
    expect(agent.querySelector('.ws-rail-agent-worktree')).toBeTruthy();
    expect(container.querySelectorAll('.ws-rail-agent-worktree')).toHaveLength(2);
  });

  it('leaves a main-checkout agent unchanged', () => {
    openWorkspace();
    render(<WorkspaceRail onExpand={() => undefined} />);
    const main = screen.getByRole('button', { name: 'Samson · Codex' });

    expect(main.title).toBe('Samson · Codex');
    expect(main.querySelector('.ws-rail-agent-worktree')).toBeNull();
    expect(main.className).not.toContain('worktree');
  });

  it('adds no checkout management: no inactive rows and no remove controls, even when a checkout is inactive', () => {
    openWorkspace({ terminals: [createTerminalFixture({ id: 't-main', displayName: 'Samson', harnessId: 'codex', checkoutContextId: MAIN.id })] });
    render(<WorkspaceRail onExpand={() => undefined} />);

    expect(screen.queryByText('issue-72-finished')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('list', { name: /inactive checkouts/ })).toBeNull();
  });

  it('does not mark a legacy linked-worktree workspace\'s own agents as isolated', () => {
    openWorkspace({
      isLinkedWorktree: true,
      checkoutContexts: [{ ...MAIN, kind: 'worktree', branch: 'legacy-task' }],
      terminals: [createTerminalFixture({ id: 't-legacy', displayName: 'Samson', harnessId: 'codex', checkoutContextId: MAIN.id })],
    });
    const { container } = render(<WorkspaceRail onExpand={() => undefined} />);
    expect(container.querySelector('.ws-rail-agent-worktree')).toBeNull();
    expect(screen.getByRole('button', { name: 'Samson · Codex' })).toBeTruthy();
  });
});
