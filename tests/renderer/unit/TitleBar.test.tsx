// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { installElectronApiMock } from '../../setup/electron';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import TitleBar from '../../../src/renderer/components/TitleBar';

describe('TitleBar', () => {
  beforeEach(() => {
    installElectronApiMock();
    useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'titlebar' })], activeWorkspaceId: 'titlebar' });
  });

  it('renders the app name', () => {
    render(<TitleBar />);
    expect(screen.getByText('Clanker Grid')).toBeTruthy();
  });

  it('renders minimize, maximize, and close buttons', () => {
    render(<TitleBar />);
    expect(screen.getByTitle('Minimize window')).toBeTruthy();
    expect(screen.getByTitle('Maximize window')).toBeTruthy();
    expect(screen.getByTitle('Close window')).toBeTruthy();
    expect(document.querySelector('.titlebar-controls')).toHaveClass('window-controls');
    expect(screen.getByRole('button', { name: 'Maximize window' })).toHaveClass('window-controls-button', 'titlebar-control');
    expect(screen.getByRole('tablist', { name: 'Workspaces' }).closest('.titlebar-center')).toBeTruthy();
  });

  it('calls minimizeWindow when minimize is clicked', () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTitle('Minimize window'));
    expect(window.electronAPI.minimizeWindow).toHaveBeenCalled();
  });

  it('calls closeWindow when close is clicked', () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTitle('Close window'));
    expect(window.electronAPI.closeWindow).toHaveBeenCalled();
  });

  it('calls toggleMaximizeWindow when maximize is clicked', () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTitle('Maximize window'));
    expect(window.electronAPI.toggleMaximizeWindow).toHaveBeenCalled();
  });

  it('omits workspace tabs in sidebar mode but keeps brand, drag center and controls', () => {
    useWorkspaceNavigationStore.setState({ mode: 'sidebar' });
    const { container } = render(<TitleBar />);
    expect(screen.queryByRole('tablist', { name: 'Workspaces' })).toBeNull();
    expect(screen.getByText('Clanker Grid')).toBeTruthy();
    expect(container.querySelector('.titlebar-center')).toBeTruthy();
    expect(container.querySelector('.titlebar-center')?.children).toHaveLength(0);
    expect(screen.getByTitle('Close window')).toBeTruthy();
    useWorkspaceNavigationStore.setState({ mode: 'tabs' });
  });
});
