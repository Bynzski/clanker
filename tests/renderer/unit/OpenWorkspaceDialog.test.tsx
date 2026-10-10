// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OpenWorkspaceDialog from '../../../src/renderer/components/OpenWorkspaceDialog';
import { installElectronApiMock } from '../../setup/electron';
import { registerSshSettingsHandler } from '../../../src/renderer/lib/settingsHandoff';
import { openWorkspace } from '../../../src/renderer/lib/openWorkspace';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  installElectronApiMock({
    openDirectoryDialog: vi.fn().mockResolvedValue('/repo'),
    registerOpenWorkspace: vi.fn(async (_id: string, path: string, environmentId: string) => ({ success: true, location: { environmentId, path } })),
    gitListWorktrees: vi.fn().mockResolvedValue({ success: true, worktrees: [] }),
    sshEnvironmentList: vi.fn().mockResolvedValue([{ id: 'ssh-host', kind: 'ssh', label: 'Host', target: 'dev@host' }]),
    sshGetHomeDirectory: vi.fn().mockResolvedValue({ homePath: '/home/dev', initialPath: '/srv/repos' }),
  });
});
it('opens a local shell with no harness/model discovery or terminal selection', async () => {
  const onClose = vi.fn();
  render(<OpenWorkspaceDialog isOpen onClose={onClose} onOpen={openWorkspace} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose Folder…' }));
  await screen.findByDisplayValue('/repo');
  fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(useWorkspaceStore.getState().workspaces[0]).toMatchObject({ terminals: [], panes: [], layoutRoot: null });
  for (const method of ['getHarnessOptions', 'getHarnessModels', 'getEnvironmentHarnessOptions', 'getEnvironmentHarnessModels', 'spawnTerminal'] as const) {
    expect(window.electronAPI[method]).not.toHaveBeenCalled();
  }
  expect(screen.queryByText('Recipes')).toBeNull();
});
it('selects an existing workspace rather than creating a duplicate', async () => {
  const existing = await openWorkspace({ environmentId: 'local', path: '/repo' });
  render(<OpenWorkspaceDialog isOpen onClose={vi.fn()} onOpen={openWorkspace} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose Folder…' })); await screen.findByDisplayValue('/repo');
  fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
  await waitFor(() => expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(existing.id));
  expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalledOnce();
});
it('shows registration errors and permits retry without closing', async () => {
  const onOpen = vi.fn().mockRejectedValueOnce(new Error('Directory missing')).mockResolvedValueOnce(undefined);
  const onClose = vi.fn();
  render(<OpenWorkspaceDialog isOpen onClose={onClose} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose Folder…' })); await screen.findByDisplayValue('/repo');
  fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Directory missing');
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
it('guards repeated opens synchronously while busy', async () => {
  let finish!: () => void;
  const onOpen = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<OpenWorkspaceDialog isOpen onClose={vi.fn()} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose Folder…' })); await screen.findByDisplayValue('/repo');
  const button = screen.getByRole('button', { name: 'Open Workspace' });
  fireEvent.click(button); fireEvent.click(button);
  expect(onOpen).toHaveBeenCalledOnce();
  expect(screen.getByText('Opening…')).toBeDisabled();
  finish();
  await waitFor(() => expect(button).not.toBeDisabled());
});
it('opens an SSH absolute path through the selected environment', async () => {
  const user = userEvent.setup(); const onClose = vi.fn();
  render(<OpenWorkspaceDialog isOpen onClose={onClose} onOpen={openWorkspace} />);
  await user.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
  await user.click(await screen.findByRole('button', { name: 'Host, dev@host' }));
  const input = await screen.findByLabelText('Remote Directory Path');
  await waitFor(() => expect(input).toHaveValue('/srv/repos/'));
  fireEvent.change(input, { target: { value: '/srv/project' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalledWith(expect.any(String), '/srv/project', 'ssh-host');
  expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
});
it('rejects relative remote paths and routes server settings by exact ID', async () => {
  const request = vi.fn(); const stop = registerSshSettingsHandler(request);
  const user = userEvent.setup(); const onOpen = vi.fn();
  render(<OpenWorkspaceDialog isOpen onClose={vi.fn()} onOpen={onOpen} />);
  await user.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
  await user.click(await screen.findByRole('button', { name: 'Host, dev@host' }));
  fireEvent.change(await screen.findByLabelText('Remote Directory Path'), { target: { value: 'relative' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
  expect(screen.getByRole('alert')).toHaveTextContent('absolute POSIX path');
  expect(onOpen).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Choose location: Host' }));
  await user.click(screen.getByRole('button', { name: 'Settings for Host' }));
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'ssh-host' }));
  stop();
});

it('submits remote paths without the trailing slash used for type-ahead', async () => {
  const user = userEvent.setup(); const onClose = vi.fn();
  render(<OpenWorkspaceDialog isOpen onClose={onClose} onOpen={openWorkspace} />);
  await user.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
  await user.click(await screen.findByRole('button', { name: 'Host, dev@host' }));
  const input = await screen.findByLabelText('Remote Directory Path');
  await waitFor(() => expect(input).toHaveValue('/srv/repos/'));
  fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalledWith(expect.any(String), '/srv/repos', 'ssh-host');
});

it('suggests matching local folders while typing and continues into the chosen one', async () => {
  vi.mocked(window.electronAPI.readDirectory).mockResolvedValue([{ name: 'clanker', isDirectory: true }, { name: 'other', isDirectory: true }]);
  render(<OpenWorkspaceDialog isOpen onClose={vi.fn()} onOpen={openWorkspace} />);
  const input = screen.getByLabelText('Local Directory Path');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '/home/jay/cl' } });
  fireEvent.click(await screen.findByRole('button', { name: /\/home\/jay\/clanker/ }, { timeout: 2000 }));
  expect(window.electronAPI.readDirectory).toHaveBeenCalledWith('/home/jay/');
  expect(input).toHaveValue('/home/jay/clanker/');
  expect(screen.queryByRole('button', { name: /other/ })).toBeNull();
});

describe('suggestions settle once a folder is chosen', () => {
  const entries = [{ name: 'onlyup', isDirectory: true }, { name: 'other', isDirectory: true }];
  const choose = async (via: 'click' | 'enter') => {
    vi.mocked(window.electronAPI.readDirectory).mockResolvedValue(entries);
    render(<OpenWorkspaceDialog isOpen onClose={vi.fn()} onOpen={openWorkspace} />);
    const input = screen.getByLabelText('Local Directory Path');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '/home/jay/on' } });
    const option = await screen.findByRole('button', { name: /\/home\/jay\/onlyup/ }, { timeout: 2000 });
    if (via === 'click') fireEvent.click(option);
    else { fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' }); }
    expect(input).toHaveValue('/home/jay/onlyup/');
    vi.mocked(window.electronAPI.readDirectory).mockClear();
    return input;
  };
  const settleTime = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });

  it.each(['click', 'enter'] as const)('does not list the chosen folder\'s children again after %s', async (via) => {
    await choose(via);
    await settleTime();
    expect(window.electronAPI.readDirectory).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /\/home\/jay\/onlyup\// })).toBeNull();
  });

  it('a second Enter then opens the workspace in that folder', async () => {
    const input = await choose('enter');
    await settleTime();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalledWith(expect.any(String), '/home/jay/onlyup', 'local'));
  });

  it('typing again brings the suggestions back', async () => {
    const input = await choose('click');
    await settleTime();
    fireEvent.change(input, { target: { value: '/home/jay/onlyup/a' } });
    await waitFor(() => expect(window.electronAPI.readDirectory).toHaveBeenCalledWith('/home/jay/onlyup/'), { timeout: 2000 });
  });

  it('clicking the field brings the suggestions back', async () => {
    const input = await choose('click');
    await settleTime();
    fireEvent.click(input);
    await waitFor(() => expect(window.electronAPI.readDirectory).toHaveBeenCalledWith('/home/jay/onlyup/'), { timeout: 2000 });
  });

  it('ArrowDown on a settled field reopens the list', async () => {
    const input = await choose('enter');
    await settleTime();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => expect(window.electronAPI.readDirectory).toHaveBeenCalledWith('/home/jay/onlyup/'), { timeout: 2000 });
  });
});
