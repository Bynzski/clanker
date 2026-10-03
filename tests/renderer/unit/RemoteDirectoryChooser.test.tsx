// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemoteDirectoryChooser, { getPathCrumbs, resolveTypedPath } from '../../../src/renderer/components/RemoteDirectoryChooser';
import { installElectronApiMock } from '../../setup/electron';

function listing(path: string) {
  const parentPath = path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/';
  const names = path === '/home/user/workspaces' ? ['app-one', 'app-two'] : ['child'];
  return {
    path,
    parentPath,
    directories: names.map((name) => ({ name, path: `${path === '/' ? '' : path}/${name}` })),
  };
}

function renderChooser({ initialPath = '/home/user/workspaces', homePath = '/home/user' } = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <RemoteDirectoryChooser
      environmentId="env-1"
      initialPath={initialPath}
      homePath={homePath}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  return { onSelect, onClose };
}

describe('RemoteDirectoryChooser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronApiMock();
    vi.mocked(window.electronAPI.sshListDirectories).mockImplementation(async (_env, path) => listing(path));
  });

  afterEach(() => cleanup());

  it('lists folders and selects the current directory when nothing is highlighted', async () => {
    const { onSelect, onClose } = renderChooser();
    expect(screen.getByRole('dialog', { name: 'Browse remote directories' })).toBeInTheDocument();
    const list = await screen.findByRole('listbox', { name: 'Directories' });
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['app-one', 'app-two']);

    fireEvent.click(screen.getByRole('button', { name: 'Select folder' }));
    expect(onSelect).toHaveBeenCalledWith('/home/user/workspaces');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('single click highlights a folder for selection; double click opens it', async () => {
    const { onSelect } = renderChooser();
    const appOne = await screen.findByRole('option', { name: 'app-one' });
    fireEvent.click(appOne);
    expect(appOne).toHaveAttribute('aria-selected', 'true');
    expect(window.electronAPI.sshListDirectories).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Select folder' }));
    expect(onSelect).toHaveBeenCalledWith('/home/user/workspaces/app-one');

    fireEvent.doubleClick(appOne);
    await waitFor(() => {
      expect(window.electronAPI.sshListDirectories).toHaveBeenLastCalledWith('env-1', '/home/user/workspaces/app-one');
    });
  });

  it('navigates up, back, home and through places and breadcrumbs', async () => {
    renderChooser();
    fireEvent.doubleClick(await screen.findByRole('option', { name: 'app-one' }));
    await screen.findByRole('option', { name: 'child' });

    fireEvent.click(screen.getByRole('button', { name: 'Parent directory' }));
    await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenLastCalledWith('env-1', '/home/user/workspaces'));

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenLastCalledWith('env-1', '/home/user/workspaces/app-one'));

    const crumbs = within(await screen.findByRole('navigation', { name: 'Current location' }));
    fireEvent.click(crumbs.getByRole('button', { name: 'workspaces' }));
    await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenLastCalledWith('env-1', '/home/user/workspaces'));

    fireEvent.click(await screen.findByRole('button', { name: 'Home directory' }));
    await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenLastCalledWith('env-1', '/home/user'));

    const places = within(screen.getByRole('navigation', { name: 'Places' }));
    fireEvent.click(await places.findByRole('button', { name: 'Filesystem' }));
    await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenLastCalledWith('env-1', '/'));
    expect(await places.findByRole('button', { name: 'Filesystem' })).toHaveAttribute('aria-current', 'location');
  });

  it('accepts a typed location, expanding ~ against the remote home', async () => {
    const user = userEvent.setup();
    renderChooser();
    await screen.findByRole('option', { name: 'app-one' });
    fireEvent.click(screen.getByRole('button', { name: 'Type a location' }));
    const input = screen.getByRole('textbox', { name: 'Location' });
    expect(input).toHaveValue('/home/user/workspaces');
    await user.clear(input);
    await user.type(input, '~/projects{Enter}');
    await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenLastCalledWith('env-1', '/home/user/projects'));

    fireEvent.click(await screen.findByRole('button', { name: 'Type a location' }));
    const again = screen.getByRole('textbox', { name: 'Location' });
    await user.clear(again);
    await user.type(again, 'relative/path{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an absolute path');
  });

  it('preserves keyboard navigation and guards Enter semantics', async () => {
    const { onSelect } = renderChooser();
    const dialog = screen.getByRole('dialog', { name: 'Browse remote directories' });
    const appOne = await screen.findByRole('option', { name: 'app-one' });
    const appTwo = screen.getByRole('option', { name: 'app-two' });

    fireEvent.keyDown(dialog, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(appOne);
    fireEvent.keyDown(dialog, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(appTwo);
    expect(appTwo).toHaveAttribute('aria-selected', 'true');

    // Enter directly on the dialog selects the current directory.
    fireEvent.focus(dialog);
    fireEvent.keyDown(dialog, { key: 'Enter', code: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('/home/user/workspaces');

    // Enter on a folder opens it rather than submitting the dialog.
    onSelect.mockClear();
    fireEvent.keyDown(appOne, { key: 'Enter', code: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenLastCalledWith('env-1', '/home/user/workspaces/app-one'));
  });

  it('creates a folder without submitting the dialog and opens it', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.sshCreateDirectory).mockResolvedValue({ path: '/home/user/workspaces/new-project' });
    const { onSelect } = renderChooser();
    await screen.findByRole('option', { name: 'app-one' });

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await user.type(screen.getByLabelText('New folder name'), 'new-project{Enter}');

    expect(window.electronAPI.sshCreateDirectory).toHaveBeenCalledWith('env-1', '/home/user/workspaces', 'new-project');
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenLastCalledWith('env-1', '/home/user/workspaces/new-project'));
  });

  it('validates folder names and displays inline error', async () => {
    const user = userEvent.setup();
    renderChooser();
    await screen.findByRole('option', { name: 'app-one' });

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await user.type(screen.getByLabelText('New folder name'), 'invalid/name{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Folder name cannot contain slashes');
    expect(window.electronAPI.sshCreateDirectory).not.toHaveBeenCalled();
  });

  it('Escape leaves location editing before closing the chooser', async () => {
    const { onClose } = renderChooser();
    await screen.findByRole('option', { name: 'app-one' });
    fireEvent.click(screen.getByRole('button', { name: 'Type a location' }));
    const input = screen.getByRole('textbox', { name: 'Location' });
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Location' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dismisses dialog on Close/Cancel button or Escape', () => {
    const { onClose } = renderChooser();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close remote browser' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    const dialog = screen.getByRole('dialog', { name: 'Browse remote directories' });
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('remote chooser path helpers', () => {
  it('builds breadcrumbs from home or the filesystem root', () => {
    expect(getPathCrumbs('/home/user/a/b', '/home/user').map((crumb) => [crumb.kind, crumb.label, crumb.path])).toEqual([
      ['home', 'Home', '/home/user'],
      ['segment', 'a', '/home/user/a'],
      ['segment', 'b', '/home/user/a/b'],
    ]);
    expect(getPathCrumbs('/srv/repos', '/home/user').map((crumb) => crumb.path)).toEqual(['/', '/srv', '/srv/repos']);
    expect(getPathCrumbs('/home/username', '/home/user').map((crumb) => crumb.kind)).toEqual(['root', 'segment', 'segment']);
    expect(getPathCrumbs('/', '/home/user')).toEqual([{ label: '/', path: '/', kind: 'root' }]);
  });

  it('resolves typed locations', () => {
    expect(resolveTypedPath(' /srv/repos/ ', '/home/user')).toBe('/srv/repos');
    expect(resolveTypedPath('/', '/home/user')).toBe('/');
    expect(resolveTypedPath('~', '/home/user')).toBe('/home/user');
    expect(resolveTypedPath('~/x', '/home/user')).toBe('/home/user/x');
    expect(resolveTypedPath('~/x', '')).toBeNull();
    expect(resolveTypedPath('relative', '/home/user')).toBeNull();
    expect(resolveTypedPath('   ', '/home/user')).toBeNull();
  });
});
