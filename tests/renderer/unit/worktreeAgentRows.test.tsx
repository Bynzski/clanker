// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import WorkspaceNavigatorSection from '../../../src/renderer/components/WorkspaceNavigatorSection';
import WorkspaceRail from '../../../src/renderer/components/WorkspaceRail';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { EMPTY_ATTENTION, snapshot, storeState } from '../../_helpers/attentionSnapshots';
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
    installElectronApiMock({ gitListWorktrees: vi.fn(async () => ({ success: true, worktrees: (workspace()?.checkoutContexts ?? []).map((entry) => ({ path: entry.path, branch: entry.branch ?? null, isMain: entry.id === MAIN.id, isLocked: false, isPrunable: entry.missing === true })) })) });
  });

  it('contains no checkout inventory, selection or management, including inactive and external worktrees', () => {
    openWorkspace({ terminals: [] });
    render(<WorkspaceNavigatorSection />);
    expect(screen.queryByRole('list', { name: /inactive checkouts/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /checkout|Repair|Remove/i })).toBeNull();
    expect(window.electronAPI.adoptWorktreeCheckoutContext).not.toHaveBeenCalled();
    expect(window.electronAPI.gitListWorktrees).not.toHaveBeenCalled();
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

describe('worktree agents follow the location their harness reports', () => {
  afterEach(() => {
    cleanup();
    useAgentAttentionStore.setState(EMPTY_ATTENTION);
  });
  beforeEach(() => installElectronApiMock());

  /** Delilah (launched into ACTIVE) reports she is now in `path`, resolved by main to `checkoutContextId`. */
  const delilahAt = (path: string, checkoutContextId: string | null) =>
    useAgentAttentionStore.setState(storeState([snapshot('t-wt', 'completed', 3, { location: { path, checkoutContextId } })]));
  const delilah = (container: HTMLElement) => agentRows(container).find((row) => row.querySelector('.ws-agent-name')?.textContent === 'Delilah')!;

  it('drops the branch badge once the agent reports it is back on the workspace\'s own checkout', () => {
    openWorkspace();
    delilahAt(ROOT, MAIN.id);
    const { container } = render(<WorkspaceNavigatorSection />);

    expect(delilah(container).querySelector('.ws-agent-branch')).toBeNull();
    expect(delilah(container).title).not.toContain(ACTIVE.path);
  });

  it('shows the branch of whichever isolated checkout the agent reports being in', () => {
    openWorkspace();
    delilahAt(`${FINISHED.path}/src`, FINISHED.id);
    const { container } = render(<WorkspaceNavigatorSection />);

    expect(within(delilah(container)).getByLabelText('on branch issue-72-finished')).toBeTruthy();
    expect(delilah(container).title).toContain(FINISHED.path);
  });

  it('shows no branch for an agent that reports a directory outside every registered checkout', () => {
    openWorkspace();
    delilahAt('/tmp/scratch', null);
    const { container } = render(<WorkspaceNavigatorSection />);

    expect(delilah(container).querySelector('.ws-agent-branch')).toBeNull();
  });

  it('keeps the launch checkout\'s branch until the agent reports a location', () => {
    openWorkspace();
    useAgentAttentionStore.setState(storeState([snapshot('t-wt', 'running', 2)]));
    const { container } = render(<WorkspaceNavigatorSection />);

    expect(within(delilah(container)).getByLabelText('on branch issue-90')).toBeTruthy();
  });

  it('never re-binds a terminal when its authenticated location changes', () => {
    openWorkspace();
    delilahAt(FINISHED.path, FINISHED.id);
    render(<WorkspaceNavigatorSection />);
    expect(workspace().terminals.find((terminal) => terminal.id === 't-wt')?.checkoutContextId).toBe(ACTIVE.id);
    expect(screen.queryByRole('list', { name: /inactive checkouts/ })).toBeNull();
  });

  it('updates the collapsed rail the same way', () => {
    openWorkspace();
    delilahAt(ROOT, MAIN.id);
    render(<WorkspaceRail onExpand={() => undefined} />);
    const agent = screen.getByRole('button', { name: /^Delilah · Claude/ });

    expect(agent.getAttribute('aria-label')).not.toContain('on branch');
    expect(agent.className).not.toContain('worktree');
  });
});

describe('an agent whose checkout Git no longer has', () => {
  afterEach(() => cleanup());
  beforeEach(() => installElectronApiMock());
  const REMOVED = { ...ACTIVE, branch: 'feature/update-page-subtitle', missing: true };
  const withRemoved = () => openWorkspace({
    checkoutContexts: [MAIN, REMOVED, FINISHED],
    terminals: [
      createTerminalFixture({ id: 't-wt', displayName: 'Billy', workingDir: ACTIVE.path, harnessId: 'agy', checkoutContextId: ACTIVE.id }),
    ],
  });

  it('shows the branch as removed, not as a live checkout, in the sidebar', () => {
    withRemoved();
    const { container } = render(<WorkspaceNavigatorSection />);
    const badge = container.querySelector('.ws-agent-branch')!;

    expect(badge.classList.contains('missing')).toBe(true);
    expect(badge.textContent).toBe('feature/update-page-subtitle · removed');
    expect(badge.getAttribute('aria-label')).toBe('on branch feature/update-page-subtitle, checkout removed');
    expect(agentRows(container)[0].title).toContain('checkout removed');
  });

  it('says so in the collapsed rail', () => {
    withRemoved();
    render(<WorkspaceRail onExpand={() => undefined} />);
    expect(screen.getByRole('button', { name: /Billy · Antigravity · on branch feature\/update-page-subtitle \(checkout removed\)/ })).toBeTruthy();
  });

  it('keeps missing checkout recovery out of the sidebar', () => {
    openWorkspace({ checkoutContexts: [MAIN, { ...ACTIVE, missing: true }] });
    render(<WorkspaceNavigatorSection />);
    expect(screen.queryByRole('button', { name: /Repair|Remove|Forget/ })).toBeNull();
  });
});
