// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import StatusBar from '../../../src/renderer/components/StatusBar';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { EMPTY_ATTENTION, snapshot, storeState } from '../../_helpers/attentionSnapshots';

// Platform-neutral path constant for test fixtures
const TEST_PROJECT = path.join(path.sep === '\\' ? 'C:\\Users\\user' : '/home', 'user', 'my-project');

describe('StatusBar', () => {
  beforeEach(() => {
    installElectronApiMock();
    useAgentAttentionStore.setState(EMPTY_ATTENTION);
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      activeWorkspaceLifecycle: null,
    });
  });

  it('shows "No workspace selected" when no workspace path', () => {
    render(<StatusBar />);
    expect(screen.getByText('No workspace selected')).toBeTruthy();
  });

  it('shows the project name and keeps the full path as a tooltip', () => {
    const ws = createWorkspaceFixture({ workspacePath: TEST_PROJECT, terminals: [] });
    useWorkspaceStore.setState({
      workspaces: [ws],
      activeWorkspaceId: ws.id,
      activeWorkspaceLifecycle: 'active',
    });
    render(<StatusBar />);
    expect(screen.getByText('my-project')).toBeTruthy();
    expect(screen.getByTitle(TEST_PROJECT)).toBeTruthy();
    expect(document.querySelector('.status-environment')).toBeNull();
  });

  it('shows the active SSH environment and removes it when switching to local', () => {
    const local = createWorkspaceFixture({ id: 'local', workspacePath: '/projects/local', environmentId: 'local', environmentLabel: 'Local', terminals: [] });
    const remote = createWorkspaceFixture({ id: 'remote', workspacePath: '/srv/projects/remote', environmentId: 'ssh-opaque-id', environmentLabel: 'devbox', terminals: [], gitCurrentBranch: 'feature', gitIsRepo: true });
    useWorkspaceStore.setState({ workspaces: [local, remote], activeWorkspaceId: 'remote', activeWorkspaceLifecycle: 'active' });

    render(<StatusBar />);
    expect(document.querySelector('.status-environment')).toHaveTextContent('devbox');
    expect(document.querySelector('.status-environment')).toHaveAttribute('title', 'SSH · devbox');
    expect(screen.getByText('feature')).toBeTruthy();
    expect(screen.getByText('remote')).toBeTruthy();

    act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'local' }));
    expect(document.querySelector('.status-environment')).toBeNull();
    expect(screen.getByText('local')).toBeTruthy();
    expect(screen.queryByText('feature')).toBeNull();
  });

  it('shows the source project for a linked worktree instead of its generated folder', () => {
    const worktreePath = '/projects/build-it-worktrees/test-tree-5f66ef4178e31b5f4a9b';
    const ws = createWorkspaceFixture({
      name: 'test-tree-5f66ef4178e31b5f4a9b',
      workspacePath: worktreePath,
      isLinkedWorktree: true,
      terminals: [],
    });
    useWorkspaceStore.setState({
      workspaces: [ws],
      activeWorkspaceId: ws.id,
      activeWorkspaceLifecycle: 'active',
    });
    render(<StatusBar />);
    expect(screen.getByText('build-it')).toBeTruthy();
    expect(screen.getByTitle(worktreePath)).toBeTruthy();
    expect(screen.queryByText(/5f66ef4178e31b5f4a9b/)).toBeNull();
  });

  it('shows the focused worktree branch beside its project', () => {
    const main = createWorkspaceFixture({ id: 'main', workspacePath: '/projects/build-it', gitCurrentBranch: 'main', gitIsRepo: true, terminals: [] });
    const worktree = createWorkspaceFixture({
      id: 'worktree',
      workspacePath: '/projects/build-it-worktrees/test-tree-5f66ef4178e31b5f4a9b',
      isLinkedWorktree: true,
      gitCurrentBranch: 'test-tree',
      gitIsRepo: true,
      terminals: [],
    });
    useWorkspaceStore.setState({ workspaces: [main, worktree], activeWorkspaceId: 'worktree', activeWorkspaceLifecycle: 'active' });

    render(<StatusBar />);

    expect(screen.getByText('build-it')).toBeTruthy();
    expect(screen.getByText('test-tree')).toBeTruthy();
    expect(screen.queryByText('main')).toBeNull();
  });

  describe('follows the selected agent\'s registered checkout context', () => {
    const ROOT = '/projects/clanker';
    const main = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: ROOT, kind: 'main' as const };
    const worktree = (suffix: string, branch: string | null) => ({
      id: `ws::ckt-${suffix}`, workspaceId: 'ws', environmentId: 'local', path: `/projects/clanker-worktrees/${suffix}`,
      kind: 'worktree' as const, branch,
    });
    const A = worktree('a', 'issue-90');
    const B = worktree('b', 'feature/test-isolated');
    const agent = (id: string, checkoutContextId?: string) => ({ id, pid: 1, workingDir: ROOT, checkoutContextId });

    function open(activeTerminalId: string | null, overrides: Parameters<typeof createWorkspaceFixture>[0] = {}) {
      const ws = createWorkspaceFixture({
        id: 'ws', workspacePath: ROOT, gitCurrentBranch: 'main', gitIsRepo: true, gitIsDetached: false,
        checkoutContexts: [main, A, B],
        terminals: [agent('t-main', main.id), agent('t-a', A.id), agent('t-b', B.id)],
        activeTerminalId,
        ...overrides,
      });
      useWorkspaceStore.setState({ workspaces: [ws], activeWorkspaceId: 'ws', activeWorkspaceLifecycle: 'active' });
    }
    const select = (terminalId: string) => act(() => useWorkspaceStore.getState().selectWorkspace('ws', terminalId));
    const branchText = () => document.querySelector('.status-branch')?.textContent;
    const pathTitle = () => document.querySelector('.status-project')?.getAttribute('title');

    it('shows the workspace branch and path for a main-checkout agent', () => {
      open('t-main');
      render(<StatusBar />);

      expect(screen.getByText('clanker')).toBeTruthy();
      expect(branchText()).toBe('main');
      expect(pathTitle()).toBe(ROOT);
      expect(document.querySelector('.status-branch')).toHaveAttribute('title', 'main');
    });

    it('shows the context branch and path when an isolated agent is selected', () => {
      open('t-a');
      render(<StatusBar />);

      expect(screen.getByText('clanker')).toBeTruthy();
      expect(branchText()).toBe('issue-90');
      expect(pathTitle()).toBe(A.path);
      expect(document.querySelector('.status-branch')?.getAttribute('title')).toContain(A.path);
    });

    it('follows selection: main -> isolated -> another isolated -> back to main', () => {
      open('t-main');
      render(<StatusBar />);
      expect([branchText(), pathTitle()]).toEqual(['main', ROOT]);

      select('t-a');
      expect([branchText(), pathTitle()]).toEqual(['issue-90', A.path]);

      select('t-b');
      expect([branchText(), pathTitle()]).toEqual(['feature/test-isolated', B.path]);

      select('t-main');
      expect([branchText(), pathTitle()]).toEqual(['main', ROOT]);
    });

    it('is presentation only: selecting an isolated agent leaves the workspace path and Git state alone', () => {
      open('t-main', { gitCurrentBranch: 'main', gitChanges: [] });
      render(<StatusBar />);
      const before = useWorkspaceStore.getState().getWorkspaceById('ws')!;

      select('t-b');

      const after = useWorkspaceStore.getState().getWorkspaceById('ws')!;
      expect(after.workspacePath).toBe(ROOT);
      expect(after.gitCurrentBranch).toBe(before.gitCurrentBranch);
      expect(after.gitIsRepo).toBe(before.gitIsRepo);
      expect(after.gitIsDetached).toBe(before.gitIsDetached);
      expect(after.checkoutContexts).toEqual(before.checkoutContexts);
    });

    it('still reflects the workspace\'s own branch changes while a main agent is selected', () => {
      open('t-main');
      render(<StatusBar />);
      act(() => useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((entry) => ({ ...entry, gitCurrentBranch: 'checked-out-by-an-agent' })),
      })));
      expect(branchText()).toBe('checked-out-by-an-agent');
    });

    it('shows HEAD for an isolated context recorded without a branch', () => {
      open('t-a', { checkoutContexts: [main, { ...A, branch: null }, B] });
      render(<StatusBar />);
      expect(branchText()).toBe('HEAD');
    });

    it('does not treat an unregistered checkout as a context, however the agent got there', () => {
      // An agent that made its own worktree is still bound to what Clanker registered: nothing here
      // knows about that directory, and none of its facts are read from the terminal.
      open('t-rogue', {
        terminals: [{ id: 't-rogue', pid: 1, workingDir: `${ROOT}/.claude/worktrees/self-made`, checkoutContextId: undefined }],
      });
      render(<StatusBar />);

      expect(branchText()).toBe('main');
      expect(pathTitle()).toBe(ROOT);
    });

    it('follows the selected agent\'s reported location back to the workspace checkout after it left its worktree', () => {
      open('t-a');
      render(<StatusBar />);
      expect([branchText(), pathTitle()]).toEqual(['issue-90', A.path]);

      act(() => useAgentAttentionStore.setState(storeState([snapshot('t-a', 'completed', 4, { location: { path: ROOT, checkoutContextId: main.id } })])));
      expect([branchText(), pathTitle()]).toEqual(['main', ROOT]);

      act(() => useAgentAttentionStore.setState(storeState([snapshot('t-a', 'running', 5, { location: { path: `${B.path}/lib`, checkoutContextId: B.id } })])));
      expect([branchText(), pathTitle()]).toEqual(['feature/test-isolated', B.path]);
    });

    it('marks the selected agent\'s checkout as removed once Git no longer has it', () => {
      open('t-a', { checkoutContexts: [main, { ...A, missing: true }, B] });
      render(<StatusBar />);
      expect(branchText()).toBe('issue-90 · removed');
      expect(document.querySelector('.status-branch')?.getAttribute('title')).toContain('checkout removed');
    });

    it('ignores a terminal bound to a context the workspace does not have', () => {
      open('t-x', { terminals: [agent('t-x', 'ws::ckt-never-registered')] });
      render(<StatusBar />);
      expect([branchText(), pathTitle()]).toEqual(['main', ROOT]);
    });

    it('does not apply another workspace\'s isolated context', () => {
      const other = createWorkspaceFixture({
        id: 'other', workspacePath: '/projects/other', gitCurrentBranch: 'other-main', gitIsRepo: true,
        checkoutContexts: [{ id: 'other::main', workspaceId: 'other', environmentId: 'local', path: '/projects/other', kind: 'main' }],
        terminals: [agent('t-foreign', A.id)],
        activeTerminalId: 't-foreign',
      });
      useWorkspaceStore.setState({ workspaces: [other], activeWorkspaceId: 'other', activeWorkspaceLifecycle: 'active' });
      render(<StatusBar />);
      expect([branchText(), pathTitle()]).toEqual(['other-main', '/projects/other']);
    });

    it('keeps a legacy linked-worktree workspace showing its own branch, whichever of its agents is selected', () => {
      const legacyRoot = '/projects/build-it-worktrees/task-5f66ef4178e31b5f4a9b';
      const legacyMain = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: legacyRoot, kind: 'worktree' as const, branch: 'task' };
      open('t-legacy', {
        workspacePath: legacyRoot, isLinkedWorktree: true, gitCurrentBranch: 'task',
        checkoutContexts: [legacyMain],
        terminals: [agent('t-legacy', legacyMain.id)],
      });
      render(<StatusBar />);

      expect(screen.getByText('build-it')).toBeTruthy();
      expect(branchText()).toBe('task');
      expect(pathTitle()).toBe(legacyRoot);
    });

    it('handles a workspace with no selected agent', () => {
      open(null, { terminals: [] });
      render(<StatusBar />);
      expect([branchText(), pathTitle()]).toEqual(['main', ROOT]);
    });

    it('keeps the SSH environment label while an isolated agent is selected', () => {
      const remoteContext = { ...A, environmentId: 'vps', path: '/srv/clanker-worktrees/a' };
      open('t-a', {
        workspacePath: '/srv/clanker', environmentId: 'vps', environmentLabel: 'devbox',
        checkoutContexts: [{ ...main, environmentId: 'vps', path: '/srv/clanker' }, remoteContext],
        terminals: [agent('t-a', A.id)],
      });
      render(<StatusBar />);

      expect(document.querySelector('.status-environment')).toHaveTextContent('devbox');
      expect(branchText()).toBe('issue-90');
      expect(pathTitle()).toBe('/srv/clanker-worktrees/a');
    });
  });

  it('shows app version from electronAPI', async () => {
    render(<StatusBar />);
    await waitFor(() => {
      expect(screen.getByText('v1.0.0')).toBeTruthy();
    });
  });
});
