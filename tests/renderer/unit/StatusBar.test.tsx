// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('shows app version from electronAPI', async () => {
    render(<StatusBar />);
    await waitFor(() => {
      expect(screen.getByText('v1.0.0')).toBeTruthy();
    });
  });
});
