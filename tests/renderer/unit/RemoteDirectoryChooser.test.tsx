// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemoteDirectoryChooser from '../../../src/renderer/components/RemoteDirectoryChooser';
import { installElectronApiMock } from '../../setup/electron';

describe('RemoteDirectoryChooser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronApiMock();
    vi.mocked(window.electronAPI.sshListDirectories).mockResolvedValue({
      path: '/home/user/workspaces',
      parentPath: '/home/user',
      directories: [
        { name: 'app-one', path: '/home/user/workspaces/app-one' },
        { name: 'app-two', path: '/home/user/workspaces/app-two' },
      ],
    });
  });

  afterEach(() => cleanup());

  it('renders directory listing and allows selecting current directory', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <RemoteDirectoryChooser
        environmentId="env-1"
        initialPath="/home/user/workspaces"
        homePath="/home/user"
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Browse remote directories' })).toBeInTheDocument();
    expect(await screen.findByText('app-one')).toBeInTheDocument();
    expect(screen.getByText('app-two')).toBeInTheDocument();

    const selectBtn = screen.getByRole('button', { name: 'Select this directory' });
    fireEvent.click(selectBtn);
    expect(onSelect).toHaveBeenCalledWith('/home/user/workspaces');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('navigates via directory button click and parent directory navigation', async () => {
    const onSelect = vi.fn();
    render(
      <RemoteDirectoryChooser
        environmentId="env-1"
        initialPath="/home/user/workspaces"
        homePath="/home/user"
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText('app-one')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /app-one/ }));

    await waitFor(() => {
      expect(window.electronAPI.sshListDirectories).toHaveBeenCalledWith('env-1', '/home/user/workspaces/app-one');
    });

    const parentBtn = screen.getByRole('button', { name: 'Parent directory' });
    fireEvent.click(parentBtn);

    await waitFor(() => {
      expect(window.electronAPI.sshListDirectories).toHaveBeenCalledWith('env-1', '/home/user');
    });
  });

  it('preserves keyboard navigation and guards Enter semantics', async () => {
    const onSelect = vi.fn();
    render(
      <RemoteDirectoryChooser
        environmentId="env-1"
        initialPath="/home/user/workspaces"
        homePath="/home/user"
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: 'Browse remote directories' });
    expect(await screen.findByText('app-one')).toBeInTheDocument();

    const appOneBtn = screen.getByRole('button', { name: /app-one/ });
    const appTwoBtn = screen.getByRole('button', { name: /app-two/ });

    // Arrow down moves focus into list
    fireEvent.keyDown(dialog, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(appOneBtn);

    fireEvent.keyDown(dialog, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(appTwoBtn);

    // Enter directly on dialog container selects current path
    fireEvent.focus(dialog);
    fireEvent.keyDown(dialog, { key: 'Enter', code: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('/home/user/workspaces');

    // Clicking a directory button initiates traversal rather than dialog submit
    onSelect.mockClear();
    fireEvent.click(appOneBtn);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('handles folder creation without submitting the dialog on Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    vi.mocked(window.electronAPI.sshCreateDirectory).mockResolvedValue({
      path: '/home/user/workspaces/new-project',
    });

    render(
      <RemoteDirectoryChooser
        environmentId="env-1"
        initialPath="/home/user/workspaces"
        homePath="/home/user"
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText('app-one')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const folderInput = screen.getByLabelText('New folder name');
    expect(folderInput).toBeInTheDocument();

    await user.type(folderInput, 'new-project{Enter}');

    expect(window.electronAPI.sshCreateDirectory).toHaveBeenCalledWith('env-1', '/home/user/workspaces', 'new-project');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('validates folder names and displays inline error', async () => {
    const user = userEvent.setup();
    render(
      <RemoteDirectoryChooser
        environmentId="env-1"
        initialPath="/home/user/workspaces"
        homePath="/home/user"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText('app-one')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const folderInput = screen.getByLabelText('New folder name');

    await user.type(folderInput, 'invalid/name{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Folder name cannot contain slashes');
    expect(window.electronAPI.sshCreateDirectory).not.toHaveBeenCalled();
  });

  it('dismisses dialog on Close/Cancel button or Escape', () => {
    const onClose = vi.fn();
    render(
      <RemoteDirectoryChooser
        environmentId="env-1"
        initialPath="/home/user/workspaces"
        homePath="/home/user"
        onSelect={vi.fn()}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close remote browser' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    const dialog = screen.getByRole('dialog', { name: 'Browse remote directories' });
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
