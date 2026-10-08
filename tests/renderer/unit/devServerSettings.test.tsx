// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DevServerSettingsDialog from '../../../src/renderer/components/DevServerSettingsDialog';
import { DevServerControls } from '../../../src/renderer/components/DevServerRow';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { DevServiceCommand } from '../../../src/shared/types/workspaceServices';
const command: DevServiceCommand = { workspaceId: 'ws', checkoutContextId: 'ctx', cwd: '/repo-worktrees/feature', checkoutRoot: '/repo-worktrees/feature', command: 'npm run dev', packageManager: 'npm', settingsRevision: 'a'.repeat(64) };
afterEach(cleanup);
function setup() {
  const api = installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command, environment: { PORT: '8788' } }) });
  const onSaved = vi.fn(), onClose = vi.fn();
  render(<DevServerSettingsDialog command={command} terminalId="agent" onSaved={onSaved} onClose={onClose} />);
  return { api, onSaved, onClose };
}
describe('checkout dev server settings UI', () => {
  it('loads authoritative settings and saves without starting a server or writing project files', async () => {
    const { api, onSaved, onClose } = setup();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', 'PORT=8788'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PORT=8789\nVITE_DEV_PORT=5175' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(api.workspaceServiceSaveSettings).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws', terminalId: 'agent', checkoutContextId: 'ctx', cwd: command.cwd, command: command.command, settingsRevision: command.settingsRevision, environment: { PORT: '8789', VITE_DEV_PORT: '5175' } });
    expect(onClose).toHaveBeenCalledOnce();
    expect(api.workspaceServiceStart).not.toHaveBeenCalled();
    expect(api.editorWriteFile).not.toHaveBeenCalled();
  });
  it('validates reserved variables and duplicate entries before IPC', async () => {
    const { api } = setup();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', 'PORT=8788'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'NODE_OPTIONS=--require evil' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('reserved'));
    expect(api.workspaceServiceSaveSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PORT=1\nPORT=2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Duplicate'));
  });
  it('reports concurrent-edit failure without dismissing or discarding the buffer', async () => {
    const { api, onClose } = setup();
    api.workspaceServiceSaveSettings.mockResolvedValue({ success: false, error: 'Settings changed; reopen' });
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', 'PORT=8788'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Settings changed; reopen');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'PORT=8788');
  });
  it('clears explicitly only when saved', async () => {
    const { api } = setup();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', 'PORT=8788'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear variables' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.workspaceServiceSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ environment: {} })));
  });
  it('disables saving when discovery resolves into a different checkout', async () => {
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command: { ...command, checkoutContextId: 'other' } }) });
    render(<DevServerSettingsDialog command={command} terminalId="agent" onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('checkout or command changed'));
    expect(screen.getByRole('button', { name: 'Save settings' })).toHaveProperty('disabled', true);
  });
  it('disables configuration for a live service and confirms the discovered revision on Run', async () => {
    const api = installElectronApiMock();
    const workspace = createWorkspaceFixture({ id: 'ws' });
    const { rerender } = render(<DevServerControls workspace={workspace} command={command} terminalId="agent" service={{ ...command, id: 'service', sourceTerminalId: 'agent', status: 'running' }} />);
    expect(screen.getByRole('button', { name: 'Configure Dev Server' })).toHaveProperty('disabled', true);
    rerender(<DevServerControls workspace={workspace} command={command} terminalId="agent" />);
    fireEvent.click(screen.getByRole('button', { name: /Run Dev Server/ }));
    await waitFor(() => expect(api.workspaceServiceStart).toHaveBeenCalledWith(expect.objectContaining({ settingsRevision: command.settingsRevision })));
  });
});
