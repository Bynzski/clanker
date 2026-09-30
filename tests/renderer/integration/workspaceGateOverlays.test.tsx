import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceGateModal, WorkspaceGateFullscreen } from '../../../src/renderer/components/WorkspaceGate';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import type { HarnessDefaultsMap } from '../../../src/shared/types/store';
import { createWorkspaceFixture } from '../../setup/fixtures';

const count = () => useWorkspaceStore.getState().workspaces[0]?.browserOverlayCount ?? useWorkspaceStore.getState().browserOverlayCount;
function Gate({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Origin</button>
    <WorkspaceGateModal isOpen={open} onClose={() => { setOpen(false); onClose(); }} onWorkspaceSelect={() => true} />
  </>;
}
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
  await screen.findByRole('radio', { name: 'Codex' });
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
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(count()).toBe(0);
    await waitFor(() => expect(screen.getByText('Origin')).toHaveFocus());
  });

  it('Escape closes favorites only, then the Gate, with balanced counts and focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Gate onClose={onClose} />);
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    expect(count()).toBe(2);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Favorite models' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBeInTheDocument();
    expect(count()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change model' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(count()).toBe(0);
    await waitFor(() => expect(screen.getByText('Origin')).toHaveFocus());
  });

  it('hands off to All Models without focus bouncing to the trigger or exposing the browser', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Gate onClose={onClose} />);
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    const trigger = screen.getByRole('button', { name: 'Change model' });
    const refocus = vi.fn();
    trigger.addEventListener('focus', refocus);
    const counts: number[] = [];
    const unsubscribe = useWorkspaceStore.subscribe(() => counts.push(count()));
    await user.click(screen.getByRole('button', { name: 'Browse all models' }));
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search models' })).toHaveFocus());
    expect(refocus).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Favorite models' })).not.toBeInTheDocument();
    expect(count()).toBe(2);
    expect(counts.every((value) => value >= 1)).toBe(true);
    unsubscribe();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'All Models' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBeInTheDocument();
    expect(count()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change model' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(count()).toBe(0);
  });

  it('reselecting the active harness closes favorites and All Models', async () => {
    const user = userEvent.setup();
    render(<Gate />);
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    await user.click(screen.getByRole('radio', { name: 'Codex' }));
    expect(screen.queryByRole('dialog', { name: 'Favorite models' })).not.toBeInTheDocument();
    expect(count()).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    await user.click(screen.getByRole('button', { name: 'Browse all models' }));
    // The underlying radios are inert while the child Dialog is open; the existing
    // harness shortcut can reselect from any non-editable focused control.
    act(() => screen.getByRole('button', { name: 'Close All Models' }).focus());
    await user.keyboard('c');
    expect(screen.queryByRole('dialog', { name: 'All Models' })).not.toBeInTheDocument();
    expect(count()).toBe(1);
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();
  });

  it('selects and launches the model while preserving the workspace callback contract', async () => {
    const user = userEvent.setup();
    const select = vi.fn().mockResolvedValue(false);
    render(<WorkspaceGateModal isOpen onClose={vi.fn()} onWorkspaceSelect={select} />);
    await screen.findByRole('radio', { name: 'Codex' });
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    await user.click(screen.getByRole('button', { name: 'Beta', pressed: false }));
    await user.type(screen.getByPlaceholderText('project name'), '/repo/');
    await user.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    await screen.findByRole('alert');
    expect(select).toHaveBeenCalledExactlyOnceWith('/repo/', 4, 'codex', 'b');
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBeInTheDocument();
    expect(count()).toBe(1);
  });

  it('persists favorite changes without changing selection and keeps favorites first', async () => {
    const user = userEvent.setup();
    let defaults: HarnessDefaultsMap = { codex: { model: 'a', favorites: ['a', 'b'], flags: '', visible: true } };
    vi.mocked(window.electronAPI.getHarnessDefaults).mockImplementation(async () => defaults);
    vi.mocked(window.electronAPI.setHarnessDefaults).mockImplementation(async (next) => { defaults = next; });
    render(<Gate />);
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    await user.click(screen.getByRole('button', { name: 'Remove Beta from favorites' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument());
    expect(defaults.codex?.favorites).toEqual(['a']);
    await user.click(screen.getByRole('button', { name: 'Browse all models' }));
    await user.click(screen.getByRole('button', { name: 'Add Gamma to favorites' }));
    await screen.findByRole('button', { name: 'Remove Gamma from favorites' });
    expect(defaults.codex?.favorites).toEqual(['a', 'g']);
    const choices = screen.getByRole('group', { name: 'Matching models' }).querySelectorAll('.model-choice');
    expect(Array.from(choices, (button) => button.textContent)).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(screen.getByRole('button', { name: 'Alpha', pressed: true })).toBeInTheDocument();
    expect(window.electronAPI.setHarnessDefaults).toHaveBeenCalledTimes(2);
  });

  it('keeps the fullscreen Gate non-modal while its model overlays open and close', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, browserOverlayCount: 0 });
    render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
    await screen.findByRole('radio', { name: 'Codex' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    expect(count()).toBe(1);
    await user.keyboard('{Escape}');
    expect(count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    await user.click(screen.getByRole('button', { name: 'Browse all models' }));
    expect(count()).toBe(1);
    await user.keyboard('{Escape}');
    expect(count()).toBe(0);
    expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('releases parent and child leases on unmount without releasing another owner', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.getState().pushBrowserOverlay('a');
    const { unmount } = render(<Gate />);
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    expect(count()).toBe(3);
    unmount();
    expect(count()).toBe(1);
  });
});
