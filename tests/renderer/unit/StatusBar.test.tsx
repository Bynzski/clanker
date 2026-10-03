// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import StatusBar from '../../../src/renderer/components/StatusBar';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

// Platform-neutral path constant for test fixtures
const TEST_PROJECT = path.join(path.sep === '\\' ? 'C:\\Users\\user' : '/home', 'user', 'my-project');

describe('StatusBar', () => {
  beforeEach(() => {
    installElectronApiMock();
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

  it('shows app version from electronAPI', async () => {
    render(<StatusBar />);
    await waitFor(() => {
      expect(screen.getByText('v1.0.0')).toBeTruthy();
    });
  });
});
