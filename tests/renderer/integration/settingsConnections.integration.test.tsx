import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OpenWorkspaceDialog from '../../../src/renderer/components/OpenWorkspaceDialog';
import { ApplicationSettingsProvider } from '../../../src/renderer/components/settings/ApplicationSettingsProvider';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { SshEnvironmentConfig } from '../../../src/shared/types/environments';

let list: SshEnvironmentConfig[];
const one: SshEnvironmentConfig = { id: 'one', kind: 'ssh', label: 'Twin', target: 'u@one' };
const two: SshEnvironmentConfig = { id: 'two', kind: 'ssh', label: 'Twin', target: 'u@two' };
const count = () => useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount ?? 0;
function Surface() {
  const [open, setOpen] = useState(true);
  return <ApplicationSettingsProvider><OpenWorkspaceDialog isOpen={open} onClose={() => setOpen(false)} onOpen={vi.fn()} /></ApplicationSettingsProvider>;
}
beforeEach(() => {
  list = [one, two];
  installElectronApiMock({
    getAiCommitSettings: vi.fn().mockResolvedValue({ enabled: false, provider: '', model: '' }),
    sshEnvironmentList: vi.fn(async () => [...list]),
    sshEnvironmentSave: vi.fn(async (config) => { list = [...list.filter((entry) => entry.id !== config.id), config]; return { success: true, config }; }),
    sshEnvironmentDelete: vi.fn(async (id) => { list = list.filter((entry) => entry.id !== id); return { success: true }; }),
    sshGetHomeDirectory: vi.fn().mockResolvedValue({ homePath: '/home/u', initialPath: '/work' }),
    getBaseDirectory: vi.fn().mockResolvedValue('/start'),
  });
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws', workspaces: [createWorkspaceFixture({ id: 'ws', browserVisible: true, browserOverlayCount: 0 })] });
});
async function add(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
  await user.click(screen.getByRole('button', { name: 'Add server…' }));
  await screen.findByRole('dialog', { name: 'Settings' });
  await waitFor(() => expect(screen.getByLabelText('Label')).toBeEnabled());
}
describe('Open Workspace → canonical SSH Targets bounded return', () => {
  it('preserves local draft and balanced leases/focus on cancellation without restarting the chooser', async () => {
    const user = userEvent.setup(); render(<Surface />);
    const path = screen.getByLabelText('Local Directory Path'); await waitFor(() => expect(path).toHaveValue('/start')); await user.clear(path); await user.type(path, '/draft');
    const counts: number[] = []; const off = useWorkspaceStore.subscribe(() => counts.push(count()));
    await add(user);
    expect(screen.queryByRole('dialog', { name: 'Open Workspace' })).toBeNull(); expect(count()).toBe(1);
    expect(window.electronAPI.sshEnvironmentTest).not.toHaveBeenCalled(); expect(window.electronAPI.sshGetHomeDirectory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back to Open Workspace' }));
    expect(await screen.findByLabelText('Local Directory Path')).toHaveValue('/draft');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose location: This PC' })).toHaveFocus());
    expect(count()).toBe(1); expect(Math.min(...counts)).toBeGreaterThanOrEqual(1); off();
    expect(window.electronAPI.sshEnvironmentSave).not.toHaveBeenCalled();
    await user.keyboard('{Escape}'); expect(count()).toBe(0);
  });
  it('saves a new target and returns with that exact ID selected after refreshing saved targets', async () => {
    const user = userEvent.setup(); render(<Surface />);
    const localPath = screen.getByLabelText('Local Directory Path'); await waitFor(() => expect(localPath).toHaveValue('/start'));
    await user.clear(localPath); await user.type(localPath, '/local-draft'); await add(user);
    await user.type(screen.getByLabelText('Label'), 'New'); await user.type(screen.getByLabelText('SSH Target'), 'u@new');
    await user.type(screen.getByLabelText('Default workspace root (optional)'), '/repos');
    await user.click(screen.getByRole('button', { name: 'Save Target' })); await screen.findByText('Target saved.');
    const created = list.find((entry) => entry.label === 'New')!;
    await user.click(screen.getByRole('button', { name: 'Back to Open Workspace' }));
    expect(await screen.findByRole('button', { name: 'Choose location: New' })).toBeVisible();
    expect(window.electronAPI.sshGetHomeDirectory).toHaveBeenCalledWith(created.id);
    expect(window.electronAPI.sshEnvironmentList).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole('button', { name: 'Choose location: New' })); await user.click(screen.getByRole('button', { name: 'This PC' }));
    expect(screen.getByLabelText('Local Directory Path')).toHaveValue('/local-draft');
  });
  it('edits the exact selected ID even when saved labels are identical, and removes stale chooser selection after confirmed deletion', async () => {
    const user = userEvent.setup(); render(<Surface />);
    await user.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
    await user.click(await screen.findByRole('button', { name: 'Twin, u@two' }));
    await user.click(screen.getByRole('button', { name: 'Choose location: Twin' }));
    await user.click(screen.getByRole('button', { name: 'Settings for Twin' }));
    expect(await screen.findByDisplayValue('u@two')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save Changes' })); await screen.findByText('Target saved.');
    expect(window.electronAPI.sshEnvironmentSave).toHaveBeenLastCalledWith(expect.objectContaining({ id: two.id }));
    // Duplicate labels are intentionally disambiguated by row identity in the test only.
    await user.click(screen.getByRole('button', { name: 'Delete Twin', description: /u@two/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' })); await screen.findByText('Target deleted.');
    expect(window.electronAPI.sshEnvironmentDelete).toHaveBeenCalledWith(two.id);
    await user.click(screen.getByRole('button', { name: 'Back to Open Workspace' }));
    expect(await screen.findByRole('button', { name: 'Choose location: This PC' })).toBeVisible();
  });
  it('preserves the edited target context across control-level search without matching private labels', async () => {
    const user = userEvent.setup(); render(<Surface />); await add(user);
    await user.click(screen.getByRole('button', { name: 'Edit Twin', description: /u@two/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search Settings' }), 'theme');
    await user.click(screen.getByRole('button', { name: 'Appearance · Theme' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search Settings' }), 'SSH root');
    await user.click(screen.getByRole('button', { name: 'SSH Targets · Default workspace root' }));
    expect(await screen.findByDisplayValue('u@two')).toBeVisible();
    expect(window.electronAPI.sshEnvironmentSave).not.toHaveBeenCalled(); expect(window.electronAPI.sshEnvironmentTest).not.toHaveBeenCalled();
  });
  it('does not reopen an originating chooser that was removed while Settings is open', async () => {
    const user = userEvent.setup();
    const view = render(<ApplicationSettingsProvider><OpenWorkspaceDialog isOpen onClose={vi.fn()} onOpen={vi.fn()} /></ApplicationSettingsProvider>);
    await add(user);
    view.rerender(<ApplicationSettingsProvider><OpenWorkspaceDialog isOpen={false} onClose={vi.fn()} onOpen={vi.fn()} /></ApplicationSettingsProvider>);
    await user.click(screen.getByRole('button', { name: 'Close Settings' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(count()).toBe(0);
  });
  it('keeps draft and modal ownership when the backend refuses an in-use target edit', async () => {
    vi.mocked(window.electronAPI.sshEnvironmentSave).mockResolvedValue({ success: false, error: 'Environment is in use' });
    const user = userEvent.setup(); render(<Surface />); await add(user);
    await user.type(screen.getByLabelText('Label'), 'Draft'); await user.type(screen.getByLabelText('SSH Target'), 'u@draft');
    await user.click(screen.getByRole('button', { name: 'Save Target' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('in use'); expect(screen.getByLabelText('Label')).toHaveValue('Draft'); expect(count()).toBe(1);
  });
  it('does not retarget busy edits and prevents closing until the explicit operation finishes', async () => {
    let finish!: (value: { success: boolean }) => void;
    vi.mocked(window.electronAPI.sshEnvironmentTest).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); render(<Surface />); await add(user);
    await user.type(screen.getByLabelText('SSH Target'), 'u@host'); await user.click(screen.getByRole('button', { name: 'Test Connection' }));
    expect(screen.getByRole('button', { name: 'Close Settings' })).toBeDisabled();
    await user.keyboard('{Escape}'); expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await act(async () => finish({ success: true })); expect(screen.getByRole('button', { name: 'Close Settings' })).toBeEnabled();
  });
});
