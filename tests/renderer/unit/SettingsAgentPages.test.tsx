import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Header from '../../setup/HeaderWithSettings';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAssistantsStore } from '../../../src/renderer/store/assistantsStore';
import { HARNESS_DESCRIPTORS } from '../../../src/shared/harnessDescriptors';
import type { AssistantSnapshot } from '../../../src/shared/types/assistants';

vi.mock('../../../src/renderer/components/GitButton', () => ({ default: () => null }));
const snapshot = (available = true): AssistantSnapshot => ({ available, settings: { enabled: false, autoStart: false },
  service: { state: 'disabled', ownership: null }, assistants: [], surfaces: [] });
const options = { codex: { name: 'Codex', command: 'codex', args: [], icon: 'terminal' },
  hermes: { name: 'Hermes', command: 'hermes', args: [], icon: 'terminal' }, pi: { name: 'Pi', command: 'pi', args: [], icon: 'terminal' } };

beforeEach(() => {
  installElectronApiMock();
  useAssistantsStore.getState().reset();
  useWorkspaceStore.setState({ activeWorkspaceId: 'local', workspaces: [
    createWorkspaceFixture({ id: 'local', environmentId: 'local', browserVisible: true, browserOverlayCount: 0 }),
    createWorkspaceFixture({ id: 'remote', environmentId: 'ssh-one', lifecycle: 'parked', browserVisible: true, browserOverlayCount: 0 }),
  ] });
  vi.mocked(window.electronAPI.getAiCommitSettings).mockResolvedValue({ enabled: false, provider: '', model: '' });
  vi.mocked(window.electronAPI.listHarnessAccounts).mockImplementation(async (environmentId, harness) => ({ environmentId, harness,
    managedSupported: environmentId === 'local', unsupportedReason: environmentId === 'local' ? undefined : 'Managed accounts are unavailable on SSH.',
    accounts: [{ id: 'default', harness, kind: 'default', status: 'unknown', selected: true }] }));
  vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue(options);
  vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockResolvedValue(options);
  vi.mocked(window.electronAPI.getHarnessDefaults).mockResolvedValue({
    codex: { model: '', favorites: [], flags: '', visible: true },
    hermes: { model: '', favorites: [], flags: '', visible: true },
    pi: { model: '', favorites: [], flags: '', visible: true },
  });
  vi.mocked(window.electronAPI.getHarnessModels).mockResolvedValue([{ id: 'm', label: 'Model M' }]);
});
async function openPage(user: ReturnType<typeof userEvent.setup>, name: string) {
  render(<Header />);
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name }));
}
async function selectHarness(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name }));
}

describe('canonical agent Settings pages', () => {
  it('has canonical Authentication instead of Legacy and gates the Assistants destination', async () => {
    const user = userEvent.setup();
    await openPage(user, 'Authentication');
    expect(screen.queryByRole('button', { name: 'Assistants' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'AI commit messages' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Agent attention/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'SSH Keys' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'SSH Targets' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Legacy Settings' })).toBeNull();
    act(() => useAssistantsStore.setState({ snapshot: snapshot() }));
    expect(screen.getByRole('button', { name: 'Assistants' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Assistants' }));
    act(() => useAssistantsStore.setState({ snapshot: snapshot(false) }));
    expect(screen.queryByRole('button', { name: 'Assistants' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
  });

  it('has one selected detail, persists flags and capability preferences without mounting accounts', async () => {
    const user = userEvent.setup();
    await openPage(user, 'Harnesses');
    await selectHarness(user, 'Codex');
    await user.click(screen.getByRole('checkbox', { name: 'Agent attention for Codex' }));
    await user.click(screen.getByRole('checkbox', { name: 'Clanker bridge for Codex' }));
    await user.type(screen.getByRole('textbox', { name: 'Extra flags' }), '--fast');
    expect(window.electronAPI.setHarnessDefaults).toHaveBeenLastCalledWith(expect.objectContaining({ codex: expect.objectContaining({ attentionEnabled: true, agentBridgeEnabled: true, flags: '--fast' }) }));
    expect(window.electronAPI.listHarnessAccounts).not.toHaveBeenCalled();
    await selectHarness(user, 'Hermes');
    expect(screen.queryByRole('checkbox', { name: 'Clanker bridge for Hermes' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Agent attention for Hermes' })).toBeEnabled();
    expect(screen.queryByRole('region', { name: 'Codex preferences' })).toBeNull();
    expect('agentBridge' in HARNESS_DESCRIPTORS.hermes).toBe(false);
    await selectHarness(user, 'Pi');
    expect(screen.queryByRole('checkbox', { name: 'Show Pi in Usage' })).toBeNull();
  });

  it.each(['local', 'remote'])('configures SSH-only Hermes attention from %s Settings', async (workspaceId) => {
    useWorkspaceStore.getState().selectWorkspace(workspaceId);
    const user = userEvent.setup();
    await openPage(user, 'Harnesses');
    await selectHarness(user, 'Hermes');
    const attention = screen.getByRole('checkbox', { name: 'Agent attention for Hermes' });
    expect(attention).toBeEnabled();
    expect(screen.getByText(/SSH launches only; local attention is unsupported/)).toBeVisible();
    await user.click(attention);
    expect(window.electronAPI.setHarnessDefaults).toHaveBeenLastCalledWith(expect.objectContaining({ hermes: expect.objectContaining({ attentionEnabled: true }) }));
  });

  it.each(['local', 'remote'])('configures local-only MCP bridge from %s Settings', async (workspaceId) => {
    useWorkspaceStore.getState().selectWorkspace(workspaceId);
    const user = userEvent.setup();
    await openPage(user, 'Harnesses');
    await selectHarness(user, 'Codex');
    const bridge = screen.getByRole('checkbox', { name: 'Clanker bridge for Codex' });
    expect(bridge).toBeEnabled();
    expect(screen.getByText(/Local launches only. Your own MCP configuration/)).toBeVisible();
    await user.click(bridge);
    expect(window.electronAPI.setHarnessDefaults).toHaveBeenLastCalledWith(expect.objectContaining({ codex: expect.objectContaining({ agentBridgeEnabled: true }) }));
  });

  it.each([true, false])('uses local AI commit capability when local Codex availability is %s and SSH is the opposite', async (localAvailable) => {
    useWorkspaceStore.getState().selectWorkspace('remote');
    vi.mocked(window.electronAPI.getAiCommitSettings).mockResolvedValue({ enabled: true, provider: 'codex', model: 'saved-model' });
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue(localAvailable ? options : { hermes: options.hermes });
    vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockResolvedValue(localAvailable ? {} : options);
    const user = userEvent.setup();
    await openPage(user, 'Git Preferences');
    await waitFor(() => expect(screen.getByRole('option', { name: localAvailable ? 'Codex' : 'Codex (unavailable)' })).toBeVisible());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'AI commit model' })).toHaveValue('saved-model'));
    expect(screen.getByRole('combobox', { name: 'AI commit provider' })).toHaveValue('codex');
    expect(window.electronAPI.getHarnessOptions).toHaveBeenCalledTimes(1);
    if (localAvailable) expect(window.electronAPI.getHarnessModels).toHaveBeenCalledExactlyOnceWith('codex');
    else expect(window.electronAPI.getHarnessModels).not.toHaveBeenCalled();
    expect(window.electronAPI.setAiCommitModel).not.toHaveBeenCalled();
    expect(window.electronAPI.setAiCommitProvider).not.toHaveBeenCalled();
  });

  it('keeps Git Preferences local capability and saved model stable through pending SSH discovery and back', async () => {
    vi.mocked(window.electronAPI.getAiCommitSettings).mockResolvedValue({ enabled: true, provider: 'codex', model: 'saved-model' });
    vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    await openPage(user, 'Git Preferences');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'AI commit model' })).toHaveValue('saved-model'));
    expect(window.electronAPI.getHarnessOptions).toHaveBeenCalledTimes(1);
    act(() => useWorkspaceStore.getState().selectWorkspace('remote'));
    expect(screen.getByRole('option', { name: 'Codex' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'AI commit model' })).toHaveValue('saved-model');
    act(() => useWorkspaceStore.getState().selectWorkspace('local'));
    await waitFor(() => expect(window.electronAPI.getHarnessOptions).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('combobox', { name: 'AI commit model' })).toHaveValue('saved-model');
    expect(window.electronAPI.getHarnessModels).toHaveBeenCalledExactlyOnceWith('codex');
    expect(window.electronAPI.getEnvironmentHarnessOptions).toHaveBeenCalledExactlyOnceWith('ssh-one');
    expect(window.electronAPI.setAiCommitModel).not.toHaveBeenCalled();
  });

  it('reports failed local discovery without losing saved AI preferences or using SSH availability', async () => {
    useWorkspaceStore.getState().selectWorkspace('remote');
    vi.mocked(window.electronAPI.getHarnessOptions).mockRejectedValue(new Error('local discovery failed'));
    vi.mocked(window.electronAPI.getAiCommitSettings).mockResolvedValue({ enabled: true, provider: 'codex', model: 'saved-model' });
    const user = userEvent.setup();
    await openPage(user, 'Git Preferences');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not discover local AI commit providers');
    expect(screen.getByRole('combobox', { name: 'AI commit provider' })).toHaveValue('codex');
    expect(screen.getByRole('combobox', { name: 'AI commit model' })).toHaveValue('saved-model');
    expect(window.electronAPI.getHarnessModels).not.toHaveBeenCalled();
  });

  it('routes harness Manage Accounts into the sole accounts controller and focuses its information', async () => {
    const user = userEvent.setup();
    await openPage(user, 'Harnesses');
    await selectHarness(user, 'Codex');
    await user.click(screen.getByRole('button', { name: 'Manage Codex accounts' }));
    expect(screen.getByRole('button', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('combobox', { name: 'Harness' })).toHaveValue('codex');
    const accounts = await screen.findByLabelText('Codex accounts');
    await waitFor(() => expect(accounts).toHaveFocus());
    expect(window.electronAPI.listHarnessAccounts).toHaveBeenCalledExactlyOnceWith('local', 'codex');
  });

  it('reports catalog errors and retries without substituting the saved model', async () => {
    vi.mocked(window.electronAPI.getHarnessModels).mockRejectedValueOnce(new Error('Catalog unavailable'));
    const user = userEvent.setup();
    await openPage(user, 'Harnesses');
    await selectHarness(user, 'Codex');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load models');
    await user.click(screen.getByRole('button', { name: 'Retry models' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Codex default model' }));
    expect(screen.getByRole('button', { name: 'Model M' })).toBeVisible();
  });

  it('rejects failed favorite persistence, restores the favorite state and reports the failure', async () => {
    const user = userEvent.setup();
    await openPage(user, 'Harnesses');
    await selectHarness(user, 'Codex');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Codex default model' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Codex default model' }));
    vi.mocked(window.electronAPI.setHarnessDefaults).mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'Add Model M to favorites' }));
    expect(await screen.findByText('Could not save model favorites.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Model M to favorites' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Models' })).toBeInTheDocument();
  });

  it('does not roll back a newer acknowledged preference snapshot after a late favorite failure', async () => {
    const user = userEvent.setup();
    await openPage(user, 'Harnesses');
    await selectHarness(user, 'Codex');
    let fail!: (error: Error) => void;
    vi.mocked(window.electronAPI.setHarnessDefaults).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    await user.click(screen.getByRole('button', { name: 'Codex default model' }));
    await user.click(screen.getByRole('button', { name: 'Add Model M to favorites' }));
    await user.keyboard('{Escape}');
    await user.type(screen.getByRole('textbox', { name: 'Extra flags' }), '--safe');
    await act(async () => fail(new Error('late save failure')));
    expect(screen.getByRole('textbox', { name: 'Extra flags' })).toHaveValue('--safe');
    await user.click(screen.getByRole('button', { name: 'Codex default model' }));
    expect(screen.getByRole('button', { name: 'Remove Model M from favorites' })).toBeVisible();
  });

  it('ignores a late local model catalog after environment change and performs no remote model probe', async () => {
    let finish!: (models: Array<{ id: string; label: string }>) => void;
    vi.mocked(window.electronAPI.getHarnessModels).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    await openPage(user, 'Harnesses');
    await selectHarness(user, 'Codex');
    act(() => useWorkspaceStore.getState().selectWorkspace('remote'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Codex default model' })).toBeEnabled());
    await act(async () => finish([{ id: 'old', label: 'Old local model' }]));
    await user.click(screen.getByRole('button', { name: 'Codex default model' }));
    expect(screen.queryByText('Old local model')).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('checkbox', { name: 'Clanker bridge for Codex' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Accounts' }));
    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(window.electronAPI.getHarnessModels).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.getEnvironmentHarnessOptions).toHaveBeenCalledExactlyOnceWith('ssh-one');
  });

  it('preserves remote saved models and favorites without requesting a remote catalog', async () => {
    useWorkspaceStore.getState().selectWorkspace('remote');
    vi.mocked(window.electronAPI.getHarnessDefaults).mockResolvedValue({ codex: { model: 'saved', favorites: ['favorite'], flags: '', visible: true } });
    const user = userEvent.setup();
    await openPage(user, 'Harnesses');
    await selectHarness(user, 'Codex');
    const model = screen.getByRole('button', { name: 'Codex default model' });
    expect(model).toHaveTextContent('saved');
    await user.click(model);
    await user.click(screen.getByRole('button', { name: 'Remove favorite from favorites' }));
    expect(window.electronAPI.setHarnessDefaults).toHaveBeenLastCalledWith(expect.objectContaining({ codex: expect.objectContaining({ model: 'saved', favorites: [] }) }));
    expect(window.electronAPI.getHarnessModels).not.toHaveBeenCalled();
  });

  it('cancels an auth start that completes only after leaving the Accounts page', async () => {
    let finish!: (value: { flowId: string; state: { status: 'waiting-for-browser' } }) => void;
    vi.mocked(window.electronAPI.startHarnessAccountAdd).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    await openPage(user, 'Accounts');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Codex' })).toBeEnabled());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Harness' }), 'codex');
    await user.click(await screen.findByRole('button', { name: 'Add account' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(screen.getByRole('button', { name: 'Harnesses' }));
    await act(async () => finish({ flowId: 'late-page', state: { status: 'waiting-for-browser' } }));
    expect(window.electronAPI.cancelHarnessAccountAuth).toHaveBeenCalledExactlyOnceWith('late-page');
    expect(screen.queryByText('Finish signing in in your browser…')).toBeNull();
  });

  it('shows account-load failures with Retry and refuses a selected harness that becomes unavailable', async () => {
    vi.mocked(window.electronAPI.listHarnessAccounts).mockRejectedValueOnce(new Error('Host unavailable'));
    const user = userEvent.setup();
    await openPage(user, 'Accounts');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Codex' })).toBeEnabled());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Harness' }), 'codex');
    await user.click(await screen.findByRole('button', { name: 'Retry accounts' }));
    await screen.findByLabelText('Codex accounts');
    vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockResolvedValue({});
    act(() => useWorkspaceStore.getState().selectWorkspace('remote'));
    expect(await screen.findByText(/Codex is unavailable in this environment/)).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Harness' })).toHaveValue('codex');
    expect(screen.queryByRole('button', { name: 'Add account' })).toBeNull();
    expect(vi.mocked(window.electronAPI.listHarnessAccounts).mock.calls.every(([env]) => env === 'local')).toBe(true);
  });

  it('moves Assistants controls without automatically starting or retrying the service', async () => {
    vi.mocked(window.electronAPI.getAssistants).mockResolvedValue(snapshot());
    vi.mocked(window.electronAPI.configureAssistants).mockImplementation(async (settings) => ({ ...snapshot(), settings, service: { state: 'offline', ownership: null } }));
    const user = userEvent.setup();
    render(<Header />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(await screen.findByRole('button', { name: 'Assistants' }));
    expect(window.electronAPI.configureAssistants).not.toHaveBeenCalled();
    expect(window.electronAPI.refreshAssistants).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: 'Enable Hermes Assistants' }));
    expect(window.electronAPI.configureAssistants).toHaveBeenLastCalledWith({ enabled: true, autoStart: false });
    await user.click(screen.getByRole('checkbox', { name: 'Start Hermes service when needed' }));
    expect(window.electronAPI.configureAssistants).toHaveBeenLastCalledWith({ enabled: true, autoStart: true });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(window.electronAPI.refreshAssistants).toHaveBeenCalledTimes(1);
  });

  it('shows AI commit save failures on Git Preferences without affecting Git operations', async () => {
    const user = userEvent.setup();
    await openPage(user, 'Git Preferences');
    vi.mocked(window.electronAPI.setAiCommitEnabled).mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('checkbox', { name: 'AI commit messages' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save AI commit setting');
    expect(screen.getByRole('checkbox', { name: 'AI commit messages' })).not.toBeChecked();
  });
});
