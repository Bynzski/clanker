import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installElectronApiMock } from '../../setup/electron';

import AssistantsSettings from '../../../src/renderer/components/settings/AssistantsSettings';
import type { AssistantSnapshot } from '../../../src/shared/types/assistants';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import Header from '../../../src/renderer/components/Header';
import WorkspaceSidebar from '../../../src/renderer/components/WorkspaceSidebar';
vi.mock('../../../src/renderer/components/FileExplorer', () => ({ default: () => null }));
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';

const enabled: AssistantSnapshot = { settings: { enabled: true, pins: [] }, profiles: [{ id: 'hermes:research', harnessId: 'hermes', profileName: 'research', label: 'Research' }], launches: [], externalActivity: 'unknown' };

beforeEach(() => {
  installElectronApiMock();
  useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a/', environmentId: 'local' })], activeWorkspaceId: 'ws-a' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('offers explicit optional enablement without profile discovery while disabled', async () => {
  const path = '../../../src/renderer/components/settings/AssistantsSettings';
  const module = await import(/* @vite-ignore */ path).catch(() => null);
  expect(module, 'Assistants settings must exist').not.toBeNull();
  const Component = module!.default;
  render(<Component />);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Enable Assistants (optional)' })).not.toBeChecked());
  expect(window.electronAPI.discoverAssistants).not.toHaveBeenCalled();
});

it('enables explicitly, discovers native profiles and refreshes without changing native defaults', async () => {
  const api = window.electronAPI;
  vi.mocked(api.discoverAssistants).mockResolvedValue(enabled);
  render(<AssistantsSettings />);
  const toggle = await screen.findByRole('checkbox', { name: 'Enable Assistants (optional)' });
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  expect(await screen.findByText('Research')).toBeInTheDocument();
  expect(api.configureAssistants).toHaveBeenCalledWith({ enabled: true, pins: [] });
  expect(api.discoverAssistants).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh profiles' }));
  await waitFor(() => expect(api.discoverAssistants).toHaveBeenCalledTimes(2));
  expect(api.setHarnessDefaults).not.toHaveBeenCalled();
});

it('persists independent global and canonical current-workspace pins', async () => {
  const api = window.electronAPI;
  vi.mocked(api.getAssistants).mockResolvedValue(enabled);
  vi.mocked(api.configureAssistants).mockImplementation(async (settings) => ({ ...enabled, settings }));
  render(<AssistantsSettings />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Pin Research globally' }));
  await waitFor(() => expect(api.configureAssistants).toHaveBeenLastCalledWith({ enabled: true, pins: [{ harnessId: 'hermes', profileName: 'research' }] }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Pin Research here' })).toBeEnabled());
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pin Research here' }));
  await waitFor(() => expect(api.configureAssistants).toHaveBeenLastCalledWith({ enabled: true, pins: [
    { harnessId: 'hermes', profileName: 'research' },
    { harnessId: 'hermes', profileName: 'research', workspace: { environmentId: 'local', path: '/projects/a' } },
  ] }));
});

it('recovers missing pinned profiles with explicit existing native name entry, never creates profiles', async () => {
  const api = window.electronAPI;
  const missing = { ...enabled, profiles: [], settings: { enabled: true, pins: [{ harnessId: 'hermes', profileName: 'research' }] }, discoveryError: 'Native discovery unavailable' };
  vi.mocked(api.getAssistants).mockResolvedValue(missing);
  vi.mocked(api.addAssistantProfile).mockResolvedValue(enabled);
  render(<AssistantsSettings />);
  expect(await screen.findByText('research — unavailable')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Native discovery unavailable');
  fireEvent.change(screen.getByRole('textbox', { name: 'Existing Hermes profile name' }), { target: { value: 'research' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add existing profile' }));
  expect(await screen.findByText('Research')).toBeInTheDocument();
  expect(api.addAssistantProfile).toHaveBeenCalledWith('hermes', 'research');
});

it('requires external-activity acknowledgement before a new local task and inserts the owned terminal', async () => {
  const api = window.electronAPI;
  vi.mocked(api.getAssistants).mockResolvedValue(enabled);
  vi.mocked(api.launchAssistant).mockResolvedValue({ action: 'created', workspaceId: 'ws-a', terminalId: 'assistant-terminal', pid: 42, harnessId: 'hermes', profileId: 'hermes:research', profileName: 'research', attentionEnabled: false });
  render(<AssistantsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'New task here' }));
  expect(api.launchAssistant).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toHaveTextContent('External activity is unknown');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(api.launchAssistant).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'New task here' }));
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge and launch' }));
  await waitFor(() => expect(useWorkspaceStore.getState().getWorkspaceById('ws-a')?.terminals).toContainEqual(expect.objectContaining({ id: 'assistant-terminal', pid: 42, harnessId: 'hermes' })));
  expect(api.launchAssistant).toHaveBeenCalledWith({ profileId: 'hermes:research', workspaceId: 'ws-a', acknowledgeExternalActivity: true });
});

it('focuses an existing owned launch in another workspace repeatedly without starting another PTY', async () => {
  const api = window.electronAPI;
  const other = createWorkspaceFixture({ id: 'ws-b', workspacePath: '/projects/b', terminals: [{ id: 'owned', pid: 7, workingDir: '/projects/b', harnessId: 'hermes' }] });
  useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, other] }));
  vi.mocked(api.getAssistants).mockResolvedValue({ ...enabled, launches: [{ profileId: 'hermes:research', workspaceId: 'ws-b', terminalId: 'owned', state: 'open' }] });
  render(<AssistantsSettings />);
  const focus = await screen.findByRole('button', { name: 'Focus existing' });
  expect(screen.getByRole('button', { name: 'New task here' })).toBeDisabled();
  fireEvent.click(focus);
  expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-b');
  expect(useWorkspaceStore.getState().activeTerminalId).toBe('owned');
  fireEvent.click(focus);
  expect(api.launchAssistant).not.toHaveBeenCalled();
  expect(api.killTerminal).not.toHaveBeenCalled();
});

it('disables new tasks explicitly in SSH workspaces', async () => {
  vi.mocked(window.electronAPI.getAssistants).mockResolvedValue(enabled);
  useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'ssh', environmentId: 'ssh:server', workspacePath: '/remote/project' })], activeWorkspaceId: 'ssh' });
  render(<AssistantsSettings />);
  expect(await screen.findByRole('button', { name: 'New task here' })).toBeDisabled();
  expect(screen.getByText('Assistants launch in local workspaces only; SSH is not supported.')).toBeInTheDocument();
  expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
});

it.each(['closed', 'replaced', 'switched'] as const)('handles a %s launch owner without inserting into the newly active workspace', async (change) => {
  const api = window.electronAPI;
  vi.mocked(api.getAssistants).mockResolvedValue(enabled);
  let resolve!: (result: import('../../../src/shared/types/assistants').AssistantLaunchResult) => void;
  vi.mocked(api.launchAssistant).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const view = render(<AssistantsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'New task here' }));
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge and launch' }));
  await waitFor(() => expect(api.launchAssistant).toHaveBeenCalled());
  const b = createWorkspaceFixture({ id: 'ws-b', workspacePath: '/projects/b' });
  const original = useWorkspaceStore.getState().getWorkspaceById('ws-a')!;
  useWorkspaceStore.setState({ workspaces: change === 'closed' ? [b] : [{ ...original, workspacePath: change === 'replaced' ? '/replacement' : original.workspacePath }, b], activeWorkspaceId: 'ws-b' });
  view.unmount();
  resolve({ action: 'created', workspaceId: 'ws-a', terminalId: 'late', pid: 9, harnessId: 'hermes', profileId: 'hermes:research', profileName: 'research', attentionEnabled: false });
  if (change === 'switched') {
    await waitFor(() => expect(useWorkspaceStore.getState().getWorkspaceById('ws-a')?.terminals.some((terminal) => terminal.id === 'late')).toBe(true));
    expect(api.killTerminal).not.toHaveBeenCalled();
  } else await waitFor(() => expect(api.killTerminal).toHaveBeenCalledWith('late'));
  expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-b');
  expect(useWorkspaceStore.getState().getWorkspaceById('ws-b')?.terminals.some((terminal) => terminal.id === 'late')).toBe(false);
});

it.each(['tabs', 'sidebar'] as const)('makes optional Assistants usable through existing settings in %s mode', async (mode) => {
  useWorkspaceNavigationStore.setState({ mode });
  render(<Header placement={mode === 'tabs' ? 'bar' : 'titlebar'} />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(await screen.findByRole('checkbox', { name: 'Enable Assistants (optional)' })).not.toBeChecked();
  expect(useWorkspaceNavigationStore.getState().mode).toBe(mode);
});

it('shows pinned Assistants in the sidebar, hides disabled roster and respects workspace identity', async () => {
  const api = window.electronAPI;
  useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 280 });
  const disabledView = render(<WorkspaceSidebar />);
  await waitFor(() => expect(api.getAssistants).toHaveBeenCalled());
  expect(screen.queryByRole('region', { name: 'Assistants' })).not.toBeInTheDocument();
  expect(api.discoverAssistants).not.toHaveBeenCalled();
  disabledView.unmount();
  vi.mocked(api.getAssistants).mockResolvedValue({ ...enabled, settings: { enabled: true, pins: [{ harnessId: 'hermes', profileName: 'research', workspace: { environmentId: 'local', path: '/projects/a' } }] } });
  render(<WorkspaceSidebar />);
  expect(await screen.findByText('Research')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Manage Assistants' })).toBeInTheDocument();
  useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'ws-b', workspacePath: '/projects/b' })], activeWorkspaceId: 'ws-b' });
  await waitFor(() => expect(screen.queryByText('Research')).not.toBeInTheDocument());
});

it('does not let an initial settings read overwrite a newer main-process change', async () => {
  const api = window.electronAPI;
  let finish!: (snapshot: AssistantSnapshot) => void;
  let changed!: (snapshot: AssistantSnapshot) => void;
  vi.mocked(api.getAssistants).mockImplementation(() => new Promise((done) => { finish = done; }));
  vi.mocked(api.onAssistantsChanged).mockImplementation((callback) => { changed = callback; return vi.fn(); });
  render(<AssistantsSettings />);
  await act(async () => changed(enabled));
  expect(screen.getByText('Research')).toBeInTheDocument();
  await act(async () => finish({ ...enabled, settings: { enabled: false, pins: [] } }));
  expect(screen.getByText('Research')).toBeInTheDocument();
});

it('closes only the explicitly selected owned terminal without killing on hide or cancel', async () => {
  const api = window.electronAPI;
  const b = createWorkspaceFixture({ id: 'ws-b', workspacePath: '/projects/b', terminals: [{ id: 'owned', pid: 7, workingDir: '/projects/b', harnessId: 'hermes' }] });
  useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, b] }));
  vi.mocked(api.getAssistants).mockResolvedValue({ ...enabled, launches: [{ profileId: 'hermes:research', workspaceId: 'ws-b', terminalId: 'owned', state: 'open' }] });
  const view = render(<AssistantsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close terminal' }));
  await waitFor(() => expect(api.killTerminal).toHaveBeenCalledWith('owned'));
  await waitFor(() => expect(useWorkspaceStore.getState().getWorkspaceById('ws-b')?.terminals.some((terminal) => terminal.id === 'owned')).toBe(false));
  expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-a');
  view.unmount();
  expect(api.killTerminal).toHaveBeenCalledTimes(1);
});

it('rechecks the captured canonical local workspace before an acknowledged launch', async () => {
  const api = window.electronAPI;
  vi.mocked(api.getAssistants).mockResolvedValue(enabled);
  render(<AssistantsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'New task here' }));
  await act(async () => useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null }));
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge and launch' }));
  expect(api.launchAssistant).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent('Launch workspace was closed or replaced');
});

it('rejects malformed manual names rather than repairing them into another native profile', async () => {
  vi.mocked(window.electronAPI.getAssistants).mockResolvedValue(enabled);
  render(<AssistantsSettings />);
  const input = await screen.findByRole('textbox', { name: 'Existing Hermes profile name' });
  fireEvent.change(input, { target: { value: ' research ' } });
  expect(screen.getByRole('button', { name: 'Add existing profile' })).toBeDisabled();
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(window.electronAPI.addAssistantProfile).not.toHaveBeenCalled();
});

it('recovers a settings read error with an explicit probe-free retry', async () => {
  const api = window.electronAPI;
  vi.mocked(api.getAssistants).mockRejectedValueOnce(new Error('Settings unavailable')).mockResolvedValue({ ...enabled, settings: { enabled: false, pins: [] } });
  render(<AssistantsSettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry settings' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Enable Assistants (optional)' })).toBeEnabled());
  expect(api.discoverAssistants).not.toHaveBeenCalled();
});

it('keeps disabled preferences when enabling fails and does not probe profiles', async () => {
  const api = window.electronAPI;
  vi.mocked(api.configureAssistants).mockRejectedValue(new Error('Save failed'));
  render(<AssistantsSettings />);
  const toggle = await screen.findByRole('checkbox', { name: 'Enable Assistants (optional)' });
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
  expect(toggle).not.toBeChecked();
  expect(api.discoverAssistants).not.toHaveBeenCalled();
});

it('keeps profiles recoverable after a failed refresh', async () => {
  vi.mocked(window.electronAPI.getAssistants).mockResolvedValue(enabled);
  vi.mocked(window.electronAPI.discoverAssistants).mockRejectedValue(new Error('Discovery failed'));
  render(<AssistantsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh profiles' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Discovery failed');
  expect(screen.getByText('Research')).toBeInTheDocument();
});

it('reports a launch error without adding a terminal or changing native defaults', async () => {
  const api = window.electronAPI;
  vi.mocked(api.getAssistants).mockResolvedValue(enabled);
  vi.mocked(api.launchAssistant).mockRejectedValue(new Error('Profile was deleted'));
  const before = useWorkspaceStore.getState().getWorkspaceById('ws-a')!.terminals;
  render(<AssistantsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'New task here' }));
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge and launch' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Profile was deleted');
  expect(useWorkspaceStore.getState().getWorkspaceById('ws-a')!.terminals).toEqual(before);
  expect(api.setHarnessDefaults).not.toHaveBeenCalled();
});

it('does not remove an owned terminal when main cannot close it', async () => {
  const api = window.electronAPI;
  useWorkspaceStore.getState().addTerminal({ id: 'owned', pid: 7, workingDir: '/projects/a', harnessId: 'hermes' }, 'ws-a');
  vi.mocked(api.getAssistants).mockResolvedValue({ ...enabled, launches: [{ profileId: 'hermes:research', workspaceId: 'ws-a', terminalId: 'owned', state: 'open' }] });
  vi.mocked(api.killTerminal).mockResolvedValue({ success: false });
  render(<AssistantsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close terminal' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Terminal could not be closed');
  expect(useWorkspaceStore.getState().getWorkspaceById('ws-a')?.terminals.some((terminal) => terminal.id === 'owned')).toBe(true);
});

it('discards stale refresh results after a newer disabled event and unsubscribes on hide', async () => {
  const api = window.electronAPI;
  vi.mocked(api.getAssistants).mockResolvedValue(enabled);
  let changed!: (snapshot: AssistantSnapshot) => void;
  const unsubscribe = vi.fn();
  vi.mocked(api.onAssistantsChanged).mockImplementation((callback) => { changed = callback; return unsubscribe; });
  let finish!: (snapshot: AssistantSnapshot) => void;
  vi.mocked(api.discoverAssistants).mockImplementation(() => new Promise((done) => { finish = done; }));
  const view = render(<AssistantsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh profiles' }));
  await act(async () => changed({ ...enabled, settings: { enabled: false, pins: [] } }));
  await act(async () => finish(enabled));
  expect(screen.getByRole('checkbox', { name: 'Enable Assistants (optional)' })).not.toBeChecked();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(api.killTerminal).not.toHaveBeenCalled();
});
