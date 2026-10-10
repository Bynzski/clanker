import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SshTargetsSettings from '../../../src/renderer/components/settings/SshTargetsSettings';
import { installElectronApiMock } from '../../setup/electron';

const config = { id: 'saved-host', kind: 'ssh' as const, label: 'Host', target: 'user@host', defaultWorkspaceRoot: '/srv/repos' };
const onSaved = vi.fn(); const onDeleted = vi.fn(); const onBusyChange = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); installElectronApiMock({ sshEnvironmentList: vi.fn().mockResolvedValue([config]), sshEnvironmentSave: vi.fn(async (value) => ({ success: true, config: value })), sshEnvironmentDelete: vi.fn().mockResolvedValue({ success: true }) });
});
async function show(initialTargetId?: string) {
  const view = render(<SshTargetsSettings initialTargetId={initialTargetId} onSaved={onSaved} onDeleted={onDeleted} onBusyChange={onBusyChange} />);
  await screen.findByText('Saved Environments (1)'); return view;
}
describe('canonical SSH Targets', () => {
  it('creates a target with its default root without testing a connection automatically', async () => {
    await show();
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'New Host' } });
    fireEvent.change(screen.getByLabelText('SSH Target'), { target: { value: 'new-host' } });
    fireEvent.change(screen.getByLabelText('Default workspace root (optional)'), { target: { value: '/opt/my projects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Target' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ label: 'New Host', target: 'new-host', defaultWorkspaceRoot: '/opt/my projects' })));
    expect(window.electronAPI.sshEnvironmentTest).not.toHaveBeenCalled(); expect(window.electronAPI.sshGetHomeDirectory).not.toHaveBeenCalled();
  });
  it('edits the exact ID and permits clearing the default root', async () => {
    await show(config.id);
    expect(screen.getByLabelText('Default workspace root (optional)')).toHaveValue('/srv/repos');
    fireEvent.change(screen.getByLabelText('Default workspace root (optional)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: config.id, kind: 'ssh', label: config.label, target: config.target }));
  });
  it.each([['SSH Target', '-bad'], ['Default workspace root (optional)', '~/repos']])('validates %s before mutation', async (field, value) => {
    await show(config.id); fireEvent.change(screen.getByLabelText(field), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })); expect(screen.getByRole('alert')).toBeVisible(); expect(window.electronAPI.sshEnvironmentSave).not.toHaveBeenCalled();
  });
  it('retains the draft after main refuses an in-use edit', async () => {
    vi.mocked(window.electronAPI.sshEnvironmentSave).mockResolvedValue({ success: false, error: 'Cannot edit an environment while a workspace is using it' });
    await show(config.id); fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })); expect(await screen.findByRole('alert')).toHaveTextContent('using it'); expect(screen.getByLabelText('Label')).toHaveValue('Draft'); expect(onSaved).not.toHaveBeenCalled();
  });
  it.each(['Cancel', 'Escape', 'confirm'])('confirms target deletion before mutation: %s', async (decision) => {
    const user = userEvent.setup(); await show(); await user.click(screen.getByRole('button', { name: 'Delete Host' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete SSH target Host?' })).toBeVisible(); expect(window.electronAPI.sshEnvironmentDelete).not.toHaveBeenCalled();
    if (decision === 'Escape') await user.keyboard('{Escape}'); else await user.click(screen.getByRole('button', { name: decision === 'confirm' ? 'Delete' : 'Cancel' }));
    expect(window.electronAPI.sshEnvironmentDelete).toHaveBeenCalledTimes(decision === 'confirm' ? 1 : 0);
    if (decision === 'confirm') expect(window.electronAPI.sshEnvironmentDelete).toHaveBeenCalledWith(config.id);
  });
  it('keeps configuration after main refuses an in-use deletion', async () => {
    vi.mocked(window.electronAPI.sshEnvironmentDelete).mockResolvedValue({ success: false, error: 'Target is in use' });
    const user = userEvent.setup(); await show(); await user.click(screen.getByRole('button', { name: 'Delete Host' })); await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Target is in use'); expect(onDeleted).not.toHaveBeenCalled(); expect(screen.getByText('user@host')).toBeVisible();
  });
  it('refreshes metadata without discarding an edited draft', async () => {
    await show(config.id); fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Unsaved draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Targets' }));
    await waitFor(() => expect(screen.getByLabelText('Label')).toBeEnabled());
    expect(screen.getByLabelText('Label')).toHaveValue('Unsaved draft'); expect(window.electronAPI.sshEnvironmentSave).not.toHaveBeenCalled();
  });
  it('tests connectivity only on explicit action, with errors preserved', async () => {
    vi.mocked(window.electronAPI.sshEnvironmentTest).mockResolvedValueOnce({ success: false, error: 'Host key rejected' }).mockResolvedValueOnce({ success: true });
    await show(config.id); expect(window.electronAPI.sshEnvironmentTest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' })); expect(await screen.findByRole('alert')).toHaveTextContent('Host key rejected');
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' })); expect(await screen.findByText('Connection successful!')).toBeVisible(); expect(window.electronAPI.sshEnvironmentTest).toHaveBeenCalledWith(config.target);
  });
  it('does not silently substitute another target for a missing requested ID', async () => {
    await show('gone'); expect(screen.getByRole('alert')).toHaveTextContent('no longer saved'); expect(screen.getByLabelText('Label')).toHaveValue(''); expect(window.electronAPI.sshEnvironmentTest).not.toHaveBeenCalled();
  });
  it('ignores a late save after unmount', async () => {
    let finish!: (result: { success: boolean; config: typeof config }) => void;
    vi.mocked(window.electronAPI.sshEnvironmentSave).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = await show(config.id); fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })); view.unmount(); await act(async () => finish({ success: true, config })); expect(onSaved).not.toHaveBeenCalled();
  });
});
