import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthenticationSettings, { type AuthenticationSection } from '../../../../src/renderer/components/settings/AuthenticationSettings';
import { Dialog, DialogContent, DialogTitle } from '../../../../src/renderer/components/ui/Dialog';
import { installElectronApiMock } from '../../../setup/electron';
import { useVcsStore } from '../../../../src/renderer/store/vcsStore';

const pat = { provider: 'github', scope: [], storedAt: '2026-01-01', validated: false };
const metadata = (saved = true) => ({ hasDefaultSshKey: false, defaultSshKeyPath: '/key', storedPats: saved ? [pat] : [], credentialHelpers: {} });
function Surface({ initial = 'ssh' }: { initial?: AuthenticationSection }) {
  const [section, setSection] = useState(initial);
  return <Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>Settings</DialogTitle><AuthenticationSettings section={section} onSectionChange={setSection} /></DialogContent></Dialog>;
}
beforeEach(() => {
  installElectronApiMock({ credentialCheckExists: vi.fn().mockResolvedValue({ exists: false }), credentialGetGlobalStatus: vi.fn().mockResolvedValue(metadata()) });
  useVcsStore.setState({ sshKey: { exists: false }, storedPats: { github: null, gitlab: null, bitbucket: null, unknown: null } });
});
describe('canonical Authentication content', () => {
  it('loads status without mounting a competing credentials dialog', async () => {
    render(<Surface />);
    expect(await screen.findByText('No SSH key configured')).toBeVisible();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'VCS Credentials' })).toBeNull();
  });
  it('reports status failure and permits explicit retry', async () => {
    vi.mocked(window.electronAPI.credentialCheckExists).mockRejectedValueOnce(new Error('Cannot read key'));
    const user = userEvent.setup(); render(<Surface />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot read key');
    await user.click(screen.getByRole('button', { name: 'Refresh key status' }));
    expect(await screen.findByText('No SSH key configured')).toBeVisible();
  });
  it('generates an SSH key and copies only its public key', async () => {
    vi.mocked(window.electronAPI.credentialGenerateSshKey).mockResolvedValue({ success: true, publicKey: 'ssh-ed25519 public', fingerprint: 'SHA256:fingerprint' });
    const user = userEvent.setup(); render(<Surface />);
    await user.click(await screen.findByRole('button', { name: 'Generate SSH Key' }));
    expect(await screen.findByDisplayValue('ssh-ed25519 public')).toBeVisible();
    expect(screen.getByText('SHA256:fingerprint')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Copy Public Key' }));
    expect(await navigator.clipboard.readText()).toBe('ssh-ed25519 public');
  });
  it.each(['Cancel', 'Escape', 'Backdrop', 'confirm'])('SSH deletion requires a decision: %s', async (decision) => {
    vi.mocked(window.electronAPI.credentialCheckExists).mockResolvedValue({ exists: true });
    vi.mocked(window.electronAPI.credentialGetPublicKey).mockResolvedValue({ success: true, publicKey: 'public', fingerprint: 'fingerprint' });
    vi.mocked(window.electronAPI.credentialDeleteSshKey).mockResolvedValue({ success: true });
    const user = userEvent.setup(); render(<Surface />);
    await user.click(await screen.findByRole('button', { name: 'Delete SSH Key' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete SSH key?' })).toBeVisible();
    expect(window.electronAPI.credentialDeleteSshKey).not.toHaveBeenCalled();
    if (decision === 'Escape') await user.keyboard('{Escape}');
    else if (decision === 'Backdrop') { const overlays = document.querySelectorAll('.clanker-dialog-overlay'); await user.click(overlays[overlays.length - 1]); }
    else await user.click(screen.getByRole('button', { name: decision === 'confirm' ? 'Delete' : 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    expect(window.electronAPI.credentialDeleteSshKey).toHaveBeenCalledTimes(decision === 'confirm' ? 1 : 0);
  });
  it.each(['github', 'gitlab', 'bitbucket'] as const)('saves %s tokens through existing IPC and clears input', async (provider) => {
    vi.mocked(window.electronAPI.credentialSavePat).mockResolvedValue({ success: true });
    const user = userEvent.setup(); render(<Surface initial={provider} />);
    const input = await screen.findByLabelText('New access token');
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, 'temporary-secret');
    await user.click(screen.getByRole('button', { name: 'Save Token' }));
    expect(window.electronAPI.credentialSavePat).toHaveBeenCalledExactlyOnceWith(provider, 'temporary-secret');
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.getByText(/do not configure Git credential helpers/)).toBeVisible();
  });
  it.each(['Cancel', 'Escape', 'Backdrop', 'confirm'])('token removal requires a decision: %s', async (decision) => {
    vi.mocked(window.electronAPI.credentialDeletePat).mockResolvedValue({ success: true });
    const user = userEvent.setup(); render(<Surface initial="github" />);
    await user.click(await screen.findByRole('button', { name: 'Remove Token' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete GitHub token?' })).toBeVisible();
    expect(window.electronAPI.credentialDeletePat).not.toHaveBeenCalled();
    if (decision === 'Escape') await user.keyboard('{Escape}');
    else if (decision === 'Backdrop') { const overlays = document.querySelectorAll('.clanker-dialog-overlay'); await user.click(overlays[overlays.length - 1]); }
    else await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: decision === 'confirm' ? 'Delete' : 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    expect(window.electronAPI.credentialDeletePat).toHaveBeenCalledTimes(decision === 'confirm' ? 1 : 0);
  });
  it('clears provider drafts and ignores a save response after switching provider', async () => {
    let finish!: (value: { success: boolean }) => void;
    vi.mocked(window.electronAPI.credentialSavePat).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); render(<Surface initial="github" />);
    const input = screen.getByLabelText('New access token'); await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, 'unsaved-secret'); await user.click(screen.getByRole('button', { name: 'Save Token' }));
    await user.selectOptions(screen.getByLabelText('Provider'), 'gitlab');
    await act(async () => finish({ success: false }));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Provider'), 'github');
    expect(screen.getByLabelText('New access token')).toHaveValue('');
  });
  it('retains failed token input and displays operation failures', async () => {
    vi.mocked(window.electronAPI.credentialSavePat).mockResolvedValue({ success: false, error: 'Secure storage unavailable' });
    const user = userEvent.setup(); render(<Surface initial="github" />);
    const input = screen.getByLabelText('New access token'); await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, 'temporary-secret'); await user.click(screen.getByRole('button', { name: 'Save Token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Secure storage unavailable'); expect(input).toHaveValue('temporary-secret');
    await user.click(screen.getByRole('button', { name: 'Cancel' })); expect(input).toHaveValue('');
  });
  it('does not claim an acknowledged save left no token when metadata refresh fails', async () => {
    vi.mocked(window.electronAPI.credentialGetGlobalStatus).mockResolvedValueOnce(metadata(false)).mockRejectedValueOnce(new Error('Metadata unavailable'));
    const user = userEvent.setup(); render(<Surface initial="github" />); await screen.findByText('Not configured');
    await user.type(screen.getByLabelText('New access token'), 'temporary-secret'); await user.click(screen.getByRole('button', { name: 'Save Token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Metadata unavailable'); expect(screen.queryByText('Not configured')).toBeNull();
    expect(screen.getByLabelText('New access token')).toHaveValue('');
  });
  it('shares in-flight status validation across provider changes', async () => {
    let finish!: (value: ReturnType<typeof metadata>) => void;
    vi.mocked(window.electronAPI.credentialGetGlobalStatus).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); render(<Surface initial="github" />);
    await waitFor(() => expect(window.electronAPI.credentialGetGlobalStatus).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByLabelText('Provider'), 'gitlab');
    expect(window.electronAPI.credentialGetGlobalStatus).toHaveBeenCalledTimes(1);
    await act(async () => finish(metadata()));
    expect(screen.getByText('Not configured')).toBeVisible();
  });
  it('drains previous validation before mutation and cancels a waiting save after unmount', async () => {
    let finish!: (value: ReturnType<typeof metadata>) => void;
    vi.mocked(window.electronAPI.credentialGetGlobalStatus).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); const view = render(<AuthenticationSettings section="github" onSectionChange={vi.fn()} />);
    await waitFor(() => expect(window.electronAPI.credentialGetGlobalStatus).toHaveBeenCalledTimes(1));
    view.rerender(<AuthenticationSettings section="gitlab" loadStatus={false} onSectionChange={vi.fn()} />);
    await user.type(screen.getByLabelText('New access token'), 'temporary-secret'); await user.click(screen.getByRole('button', { name: 'Save Token' }));
    expect(window.electronAPI.credentialSavePat).not.toHaveBeenCalled(); view.unmount();
    await act(async () => finish(metadata())); expect(window.electronAPI.credentialSavePat).not.toHaveBeenCalled();
  });
  it.each(['key', 'token'])('retains known credential status and reports %s deletion failures', async (kind) => {
    vi.mocked(window.electronAPI.credentialCheckExists).mockResolvedValue({ exists: true });
    vi.mocked(window.electronAPI.credentialGetPublicKey).mockResolvedValue({ success: true, publicKey: 'public' });
    vi.mocked(window.electronAPI.credentialDeleteSshKey).mockResolvedValue({ success: false, error: 'Deletion refused' });
    vi.mocked(window.electronAPI.credentialDeletePat).mockResolvedValue({ success: false, error: 'Deletion refused' });
    const user = userEvent.setup(); render(<Surface initial={kind === 'key' ? 'ssh' : 'github'} />);
    await user.click(await screen.findByRole('button', { name: kind === 'key' ? 'Delete SSH Key' : 'Remove Token' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Deletion refused');
    expect(screen.getByText(kind === 'key' ? 'SSH key configured' : /Token saved/)).toBeVisible();
  });
  it('retains known key existence when the public-key read fails', async () => {
    vi.mocked(window.electronAPI.credentialCheckExists).mockResolvedValue({ exists: true });
    vi.mocked(window.electronAPI.credentialGetPublicKey).mockResolvedValue({ success: false, error: 'Public key unreadable' });
    render(<Surface />); expect(await screen.findByRole('alert')).toHaveTextContent('Public key unreadable'); expect(screen.getByText('SSH key configured')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete SSH Key' })).toBeEnabled();
  });
  it('ignores late key generation after unmount', async () => {
    let finish!: (value: { success: boolean; publicKey: string }) => void;
    vi.mocked(window.electronAPI.credentialGenerateSshKey).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); const view = render(<Surface />);
    await user.click(await screen.findByRole('button', { name: 'Generate SSH Key' })); view.unmount();
    await act(async () => finish({ success: true, publicKey: 'late' })); expect(useVcsStore.getState().sshKey.exists).toBe(false);
  });
  it('reports token status failures without claiming no credential exists', async () => {
    vi.mocked(window.electronAPI.credentialGetGlobalStatus).mockRejectedValue(new Error('Status unavailable'));
    render(<Surface initial="github" />); expect(await screen.findByRole('alert')).toHaveTextContent('Status unavailable');
    expect(screen.getByText('Token status unavailable')).toBeVisible();
  });
});
