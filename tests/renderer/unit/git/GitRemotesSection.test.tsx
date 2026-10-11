import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GitRemotesSection from '../../../../src/renderer/components/git/GitRemotesSection';
import { installElectronApiMock } from '../../../setup/electron';

const remote = { name: 'origin', fetchUrl: 'https://host/repo.git', pushUrl: 'https://host/repo.git' };
function fixture(remotes = [remote]) {
  const onRemotesChanged = vi.fn();
  const onError = vi.fn();
  render(<GitRemotesSection workspacePath="/repo" workspaceId="ws" remotes={remotes} provider="unknown"
    onRemotesChanged={onRemotesChanged} onError={onError} />);
  return { onRemotesChanged, onError };
}
beforeEach(() => { installElectronApiMock(); });
describe('GitRemotesSection shared controls', () => {
  it('keeps validation, suggestions, Enter submission and loading in the shared form', async () => {
    let finish!: (result: { success: boolean }) => void;
    vi.mocked(window.electronAPI.gitAddRemote).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { onRemotesChanged } = fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Add remote' }));
    const name = screen.getByLabelText('Name');
    const url = screen.getByLabelText('URL');
    expect(name).toHaveClass('clanker-input');
    await waitFor(() => expect(name).toHaveFocus());
    fireEvent.change(name, { target: { value: 'origin' } });
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(name, { target: { value: 'bad name' } });
    expect(screen.getByRole('alert')).toHaveTextContent('lowercase letters');
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(window.electronAPI.gitAddRemote).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'upstream' }));
    expect(name).toHaveValue('upstream');
    fireEvent.change(url, { target: { value: 'https://host/upstream.git' } });
    fireEvent.keyDown(url, { key: 'Enter' });
    expect(window.electronAPI.gitAddRemote).toHaveBeenCalledWith('/repo', 'upstream', 'https://host/upstream.git', 'ws');
    expect(name).toBeDisabled();
    expect(url).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Adding...' })).toBeDisabled();
    await act(async () => finish({ success: true }));
    expect(onRemotesChanged).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('renames with Enter and cancels add/edit with Escape', async () => {
    vi.mocked(window.electronAPI.gitRenameRemote).mockResolvedValue({ success: true });
    fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Rename remote' }));
    fireEvent.change(screen.getByLabelText('New Name'), { target: { value: 'upstream' } });
    fireEvent.keyDown(screen.getByLabelText('New Name'), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByLabelText('New Name')).toBeNull());
    expect(window.electronAPI.gitRenameRemote).toHaveBeenCalledWith('/repo', 'origin', 'upstream', 'ws');
    fireEvent.click(screen.getByRole('button', { name: 'Rename remote' }));
    fireEvent.keyDown(screen.getByLabelText('New Name'), { key: 'Escape' });
    expect(screen.queryByLabelText('New Name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add remote' }));
    fireEvent.keyDown(screen.getByLabelText('URL'), { key: 'Escape' });
    expect(screen.queryByLabelText('URL')).toBeNull();
  });

  it('opens confirmation dialog on remove, cancels cleanly, and removes on confirm', async () => {
    const withinDialogRemoveButton = () => within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove remote' });
    const { onError, onRemotesChanged } = fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Remove remote' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/Remove remote 'origin'\?/)).toBeInTheDocument();
    expect(screen.getByText(/Fetch URL: https:\/\/host\/repo\.git/)).toBeInTheDocument();

    // Cancel leaves remote unchanged
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(window.electronAPI.gitRemoveRemote).not.toHaveBeenCalled();

    // Reopen and confirm removal failure
    vi.mocked(window.electronAPI.gitRemoveRemote).mockResolvedValue({ success: false, error: 'host unavailable' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove remote' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(withinDialogRemoveButton());
    await waitFor(() => expect(onError).toHaveBeenCalledWith('host unavailable'));
    expect(window.electronAPI.gitRemoveRemote).toHaveBeenCalledWith('/repo', 'origin', 'ws');

    // Confirm removal success
    vi.mocked(window.electronAPI.gitRemoveRemote).mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove remote' }));
    fireEvent.click(withinDialogRemoveButton());
    await waitFor(() => expect(onRemotesChanged).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
