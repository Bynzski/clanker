// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import { render, screen } from '@testing-library/react';
import StatusBar from '../../../src/renderer/components/StatusBar';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';

// Platform-neutral path constant for test fixtures
const TEST_PROJECT = path.join(path.sep === '\\' ? 'C:\\Users\\user' : '/home', 'user', 'my-project');

describe('StatusBar', () => {
  beforeEach(() => {
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

  it('shows workspace path when set', () => {
    const ws = createWorkspaceFixture({ workspacePath: TEST_PROJECT, terminals: [] });
    useWorkspaceStore.setState({
      workspaces: [ws],
      activeWorkspaceId: ws.id,
      activeWorkspaceLifecycle: 'active',
    });
    render(<StatusBar />);
    expect(screen.getByText(TEST_PROJECT)).toBeTruthy();
  });

  it('truncates long paths', () => {
    const longPath = '/very/long/path/' + 'subdir/'.repeat(10) + 'project';
    const ws = createWorkspaceFixture({ workspacePath: longPath, terminals: [] });
    useWorkspaceStore.setState({
      workspaces: [ws],
      activeWorkspaceId: ws.id,
      activeWorkspaceLifecycle: 'active',
    });
    render(<StatusBar />);
    const pathEl = screen.getByTitle(longPath);
    expect(pathEl.textContent).toContain('...');
  });

  it('shows terminal count with singular form', () => {
    const ws = createWorkspaceFixture({
      terminals: [createTerminalFixture({ id: 't1', pid: 1, workingDir: '/ws' })],
    });
    useWorkspaceStore.setState({
      workspaces: [ws],
      activeWorkspaceId: ws.id,
      activeWorkspaceLifecycle: 'active',
    });
    render(<StatusBar />);
    expect(screen.getByText(/1 terminal(?!s)/)).toBeTruthy();
  });

  it('shows terminal count with plural form', () => {
    const ws = createWorkspaceFixture({
      terminals: [
        createTerminalFixture({ id: 't1', pid: 1, workingDir: '/ws' }),
        createTerminalFixture({ id: 't2', pid: 2, workingDir: '/ws' }),
      ],
    });
    useWorkspaceStore.setState({
      workspaces: [ws],
      activeWorkspaceId: ws.id,
      activeWorkspaceLifecycle: 'active',
    });
    render(<StatusBar />);
    expect(screen.getByText(/2 terminals/)).toBeTruthy();
  });

  it('shows zero terminals', () => {
    const ws = createWorkspaceFixture({ terminals: [] });
    useWorkspaceStore.setState({
      workspaces: [ws],
      activeWorkspaceId: ws.id,
      activeWorkspaceLifecycle: 'active',
    });
    render(<StatusBar />);
    expect(screen.getByText(/0 terminals/)).toBeTruthy();
  });
});
