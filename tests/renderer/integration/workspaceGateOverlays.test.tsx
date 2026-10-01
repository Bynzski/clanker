import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceGateModal, WorkspaceGateFullscreen } from '../../../src/renderer/components/WorkspaceGate';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { HarnessDefaultsMap } from '../../../src/shared/types/store';

function Gate({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Origin</button><WorkspaceGateModal isOpen={open}
    onClose={() => { setOpen(false); onClose(); }} onWorkspaceSelect={vi.fn()} /></>;
}
const count = () => useWorkspaceStore.getState().browserOverlayCount;
beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'a' })], activeWorkspaceId: 'a', browserOverlayCount: 0 });
  installElectronApiMock({
    getLastWorkspace: vi.fn().mockResolvedValue('/repo/'),
    getHarnessOptions: vi.fn().mockResolvedValue({ codex: true }),
    getHarnessModels: vi.fn().mockResolvedValue([{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'g', label: 'Gamma' }]),
    getHarnessDefaults: vi.fn().mockResolvedValue({ codex: { model: 'a', favorites: ['a', 'b'], flags: '', visible: true } }),
  });
});
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Origin'));
  await screen.findByRole('button', { name: 'codex model' });
  return screen.getByRole('dialog', { name: 'New Workspace' });
}

describe('Workspace Gate overlay hierarchy', () => {
  it('opens a named Dialog, dismisses its backdrop and restores the origin', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Gate onClose={onClose} />);
    const gate = await open(user);
    expect(screen.getByText('Origin', { selector: 'button' }).closest('[aria-hidden="true"]')).not.toBeNull();
    expect(gate.contains(document.activeElement)).toBe(true);
    expect(count()).toBe(1);
    await user.click(document.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalledOnce();
    expect(count()).toBe(0);
    await waitFor(() => expect(screen.getByText('Origin')).toHaveFocus());
  });
  it('Escape closes the searchable picker first, then the modal, with balanced counts and focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Gate onClose={onClose} />);
    await open(user);
    await user.click(screen.getByRole('button', { name: 'codex model' }));
    expect(screen.getByRole('searchbox', { name: 'Search models' })).toHaveFocus();
    expect(count()).toBe(2);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Models' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBeInTheDocument();
    expect(count()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'codex model' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(count()).toBe(0);
    await waitFor(() => expect(screen.getByText('Origin')).toHaveFocus());
  });
  it('selects and launches the displayed model through the mixed-plan callback in the modal', async () => {
    const user = userEvent.setup();
    const select = vi.fn().mockResolvedValue(false);
    render(<WorkspaceGateModal isOpen onClose={vi.fn()} onWorkspaceSelect={select} />);
    await screen.findByRole('button', { name: 'codex model' });
    await user.click(screen.getByRole('button', { name: 'codex model' }));
    await user.click(screen.getByRole('button', { name: 'Beta', pressed: false }));
    await user.type(screen.getByLabelText('Workspace directory'), '/repo/');
    await user.click(screen.getByRole('button', { name: 'Add Codex terminal' }));
    await user.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    await screen.findByRole('alert');
    expect(select).toHaveBeenCalledExactlyOnceWith('/repo/', 1, 'codex', 'b', true, 'local', 'Local', [{ harness: 'codex', model: 'b' }]);
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBeInTheDocument();
    expect(count()).toBe(1);
  });
  it('persists favorite changes without selecting a different model and keeps favorites first', async () => {
    const user = userEvent.setup();
    let defaults: HarnessDefaultsMap = { codex: { model: 'a', favorites: ['a', 'b'], flags: '', visible: true } };
    vi.mocked(window.electronAPI.getHarnessDefaults).mockImplementation(async () => defaults);
    vi.mocked(window.electronAPI.setHarnessDefaults).mockImplementation(async (next) => { defaults = next; });
    render(<Gate />);
    await open(user);
    await user.click(screen.getByRole('button', { name: 'codex model' }));
    await user.click(screen.getByRole('button', { name: 'Remove Beta from favorites' }));
    await waitFor(() => expect(defaults.codex?.favorites).toEqual(['a']));
    await user.click(screen.getByRole('button', { name: 'Add Gamma to favorites' }));
    await waitFor(() => expect(defaults.codex?.favorites).toEqual(['a', 'g']));
    const choices = screen.getByRole('group', { name: 'Models' }).querySelectorAll('.searchable-picker-label');
    expect(Array.from(choices, (button) => button.textContent)).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(screen.getByRole('button', { name: 'Alpha', pressed: true })).toBeInTheDocument();
  });
  it('keeps fullscreen non-modal while using the identical searchable model picker', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, browserOverlayCount: 0 });
    render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
    await screen.findByRole('button', { name: 'codex model' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'codex model' }));
    expect(count()).toBe(1);
    expect(screen.getByRole('searchbox', { name: 'Search models' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(count()).toBe(0);
    expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeInTheDocument();
  });
  it('releases modal and picker leases on unmount without releasing another owner', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.getState().pushBrowserOverlay('a');
    const { unmount } = render(<Gate />);
    await open(user);
    await user.click(screen.getByRole('button', { name: 'codex model' }));
    expect(count()).toBe(3);
    unmount();
    expect(count()).toBe(1);
  });
});
