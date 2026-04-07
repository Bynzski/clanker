// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBar from '../../../src/renderer/components/StatusBar';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';

describe('StatusBar', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      terminals: [],
      workspacePath: '',
    });
  });

  it('shows "No workspace selected" when no workspace path', () => {
    render(<StatusBar />);
    expect(screen.getByText('No workspace selected')).toBeTruthy();
  });

  it('shows workspace path when set', () => {
    useWorkspaceStore.setState({ workspacePath: '/home/user/my-project' });
    render(<StatusBar />);
    expect(screen.getByText('/home/user/my-project')).toBeTruthy();
  });

  it('truncates long paths', () => {
    const longPath = '/very/long/path/' + 'subdir/'.repeat(10) + 'project';
    useWorkspaceStore.setState({ workspacePath: longPath });
    render(<StatusBar />);
    const pathEl = screen.getByTitle(longPath);
    expect(pathEl.textContent).toContain('...');
  });

  it('shows terminal count with singular form', () => {
    useWorkspaceStore.setState({ terminals: [{ id: 't1', pid: 1, workingDir: '/ws' }] });
    render(<StatusBar />);
    expect(screen.getByText(/1 terminal(?!s)/)).toBeTruthy();
  });

  it('shows terminal count with plural form', () => {
    useWorkspaceStore.setState({
      terminals: [
        { id: 't1', pid: 1, workingDir: '/ws' },
        { id: 't2', pid: 2, workingDir: '/ws' },
      ],
    });
    render(<StatusBar />);
    expect(screen.getByText(/2 terminals/)).toBeTruthy();
  });

  it('shows zero terminals', () => {
    useWorkspaceStore.setState({ terminals: [] });
    render(<StatusBar />);
    expect(screen.getByText(/0 terminals/)).toBeTruthy();
  });
});
