import { useKeybindingStore } from '../../../src/renderer/store/keybindingStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Header from '../../setup/HeaderWithSettings';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAssistantsStore } from '../../../src/renderer/store/assistantsStore';
import { searchSettings } from '../../../src/renderer/components/settings/settingsSearch';

vi.mock('../../../src/renderer/components/GitButton', () => ({ default: () => null }));
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const scroll = vi.fn();
beforeEach(() => {
  installElectronApiMock({ getAiCommitSettings: vi.fn().mockResolvedValue({ enabled: false, provider: '', model: '' }),
    getHarnessOptions: vi.fn().mockResolvedValue({ codex: { name: 'Codex', command: 'codex', args: [], icon: 'terminal' } }) });
  useAssistantsStore.getState().reset();
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws', workspaces: [createWorkspaceFixture({ id: 'ws', browserVisible: true, browserOverlayCount: 0 })] });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll }); scroll.mockClear();
});
afterEach(() => { if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView'); });
async function open(user: ReturnType<typeof userEvent.setup>) {
  render(<Header />); await user.click(screen.getByRole('button', { name: 'Settings' })); return screen.getByRole('searchbox', { name: 'Search Settings' });
}
describe('lightweight Settings control navigation', () => {
  it.each(['Theme', 'Sidebar', 'Keyboard', 'Model', 'Attention', 'MCP', 'Account', 'Hermes', 'AI commit', 'SSH', 'GitHub token', 'Authentication'])('finds actual controls for %s without indexing values', (term) => {
    expect(searchSettings(term, true).length).toBeGreaterThan(0);
    expect(searchSettings('private-secret-value', true)).toEqual([]);
  });
  it('filters unavailable Assistants and unsupported bridge capabilities', () => {
    expect(searchSettings('assistants', false)).toEqual([]);
    expect(searchSettings('Hermes MCP', true)).toEqual([]);
  });
  it('typing and keyboard dismissal do not discover models, retrieve credentials or start auth', async () => {
    const user = userEvent.setup(); const input = await open(user);
    await user.type(input, 'GitHub token');
    expect(screen.getByRole('button', { name: 'Authentication · GitHub token' })).toBeVisible();
    expect(window.electronAPI.credentialGetGlobalStatus).not.toHaveBeenCalled(); expect(window.electronAPI.credentialGetPublicKey).not.toHaveBeenCalled();
    expect(window.electronAPI.getHarnessModels).not.toHaveBeenCalled(); expect(window.electronAPI.sshEnvironmentTest).not.toHaveBeenCalled(); expect(window.electronAPI.startHarnessAccountAdd).not.toHaveBeenCalled();
    await user.keyboard('{Escape}'); expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible(); expect(input).toHaveValue('');
  });
  it('selects the exact harness and reveals/focuses MCP without discovery or mutation', async () => {
    const user = userEvent.setup(); const input = await open(user); await user.type(input, 'Codex MCP');
    await user.click(screen.getByRole('button', { name: 'Codex · Clanker MCP bridge' }));
    const control = await screen.findByRole('checkbox', { name: 'Clanker bridge for Codex' });
    await waitFor(() => expect(control).toHaveFocus()); expect(scroll).toHaveBeenCalled();
    expect(window.electronAPI.getHarnessModels).not.toHaveBeenCalled(); expect(window.electronAPI.setHarnessDefaults).not.toHaveBeenCalled();
  });
  it('navigates search by arrow keys and Enter and focuses the shortcut search field', async () => {
    const user = userEvent.setup(); const input = await open(user); await user.type(input, 'Keyboard');
    await user.keyboard('{ArrowDown}'); expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveFocus(); await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search shortcuts' })).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Keyboard Shortcuts' })).toHaveAttribute('aria-current', 'page');
  });
  it('focuses a specific shortcut without recording or persisting a binding', async () => {
    const user = userEvent.setup(); await open(user);
    await user.type(screen.getByRole('searchbox', { name: 'Search Settings' }), 'Save File shortcut');
    await user.click(screen.getByRole('button', { name: 'Keyboard · Save File shortcut' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Save File shortcut' })).toHaveFocus());
    expect(useKeybindingStore.getState().capturing).toBe(false); expect(window.electronAPI.setKeybindingOverrides).not.toHaveBeenCalled();
  });
  it('navigates to an exact provider without saving, deleting or revealing stored token values', async () => {
    const user = userEvent.setup(); const input = await open(user); await user.type(input, 'GitLab token');
    await user.click(screen.getByRole('button', { name: 'Authentication · GitLab token' }));
    expect(screen.getByLabelText('Provider')).toHaveValue('gitlab');
    await waitFor(() => expect(screen.getByLabelText('New access token')).toHaveFocus());
    expect(screen.getByLabelText('New access token')).toHaveValue(''); expect(window.electronAPI.credentialGetGlobalStatus).not.toHaveBeenCalled(); expect(window.electronAPI.credentialSavePat).not.toHaveBeenCalled(); expect(window.electronAPI.credentialDeletePat).not.toHaveBeenCalled();
  });
  it('does not substitute a different harness when a search capability is unavailable', async () => {
    const user = userEvent.setup(); const input = await open(user); await user.type(input, 'Hermes attention');
    await user.click(screen.getByRole('button', { name: 'Hermes · Agent attention' }));
    expect(screen.getByText(/selected harness is unavailable/)).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: 'Agent attention for Codex' })).toBeNull(); expect(window.electronAPI.getHarnessModels).not.toHaveBeenCalled();
  });
  it('preserves the active environment for Accounts but never starts authentication', async () => {
    const user = userEvent.setup(); const input = await open(user); await user.type(input, 'Codex Account');
    await user.click(screen.getByRole('button', { name: 'Codex · Accounts' }));
    expect(screen.getByRole('combobox', { name: 'Harness' })).toHaveValue('codex');
    expect(window.electronAPI.listHarnessAccounts).toHaveBeenCalledWith('local', 'codex'); expect(window.electronAPI.startHarnessAccountAdd).not.toHaveBeenCalled();
  });
  it('selecting SSH search never connects to a host', async () => {
    const user = userEvent.setup(); const input = await open(user); await user.type(input, 'SSH root'); await user.click(screen.getByRole('button', { name: 'SSH Targets · Default workspace root' }));
    await waitFor(() => expect(screen.getByLabelText('Default workspace root (optional)')).toHaveFocus());
    expect(window.electronAPI.sshEnvironmentTest).not.toHaveBeenCalled(); expect(window.electronAPI.sshGetHomeDirectory).not.toHaveBeenCalled();
  });
  it('search focus does not jump to a late control after the user moved on', async () => {
    let finish!: (value: Awaited<ReturnType<typeof window.electronAPI.getHarnessDefaults>>) => void;
    vi.mocked(window.electronAPI.getHarnessDefaults).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); const input = await open(user); await user.type(input, 'Codex MCP'); await user.click(screen.getByRole('button', { name: 'Codex · Clanker MCP bridge' }));
    screen.getByRole('button', { name: 'Harnesses' }).focus();
    await act(async () => finish({ codex: { visible: true, model: '', flags: '', favorites: [] } }));
    expect(screen.getByRole('button', { name: 'Harnesses' })).toHaveFocus();
  });
});
