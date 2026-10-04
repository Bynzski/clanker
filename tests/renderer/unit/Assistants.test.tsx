import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { AssistantSnapshot, HermesBot } from '../../../src/shared/types/assistants';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { useAssistantsStore } from '../../../src/renderer/store/assistantsStore';

const xterms: Array<{ write: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; emitData: (data: string) => void; cols: number; rows: number }> = [];
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24;
    write = vi.fn(); dispose = vi.fn(); focus = vi.fn(); loadAddon = vi.fn();
    private handler: (data: string) => void = () => undefined;
    open = vi.fn((container: HTMLElement) => container.appendChild(document.createElement('div')));
    onData = vi.fn((handler: (data: string) => void) => { this.handler = handler; return { dispose: vi.fn() }; });
    emitData = (data: string) => this.handler(data);
    options = {};
    constructor() { xterms.push(this as never); }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock('../../../src/renderer/components/FileExplorer', () => ({ default: () => <div data-testid="files-section" /> }));
vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({ default: ({ workspaceId }: { workspaceId: string }) => <div data-testid={`layout-${workspaceId}`} /> }));

import AssistantsSettings from '../../../src/renderer/components/settings/AssistantsSettings';
import AssistantsRoster from '../../../src/renderer/components/assistants/AssistantsRoster';
import AssistantSurface from '../../../src/renderer/components/assistants/AssistantSurface';
import WorkspaceSidebar from '../../../src/renderer/components/WorkspaceSidebar';
import WorkspaceHost from '../../../src/renderer/components/WorkspaceHost';
import StatusBar from '../../../src/renderer/components/StatusBar';

const fred: HermesBot = { id: 'hermes:fred', profileName: 'fred', displayName: 'Fred', description: 'General helper', canonicalSessionId: 's1' };
const reviewer: HermesBot = { id: 'hermes:reviewer', profileName: 'reviewer', displayName: 'Reviewer', canonicalSessionId: 's2' };
const snap = (over: Partial<AssistantSnapshot> = {}): AssistantSnapshot => ({
  settings: { enabled: true, autoStart: false }, service: { state: 'connected', ownership: 'external' }, bots: [fred, reviewer], surfaces: [], ...over,
});

let pushSnapshot: (snapshot: AssistantSnapshot) => void = () => undefined;
let pushData: (payload: { botId: string; data: string }) => void = () => undefined;

function mockMain(snapshot: AssistantSnapshot) {
  const api = window.electronAPI;
  vi.mocked(api.getAssistants).mockResolvedValue(snapshot);
  vi.mocked(api.configureAssistants).mockImplementation(async (settings) => ({ ...snapshot, settings }));
  vi.mocked(api.onAssistantsChanged).mockImplementation((callback) => { pushSnapshot = callback; return () => undefined; });
  vi.mocked(api.onAssistantPtyData).mockImplementation((callback) => { pushData = callback; return () => undefined; });
}

beforeEach(() => {
  installElectronApiMock();
  xterms.length = 0;
  useAssistantsStore.getState().reset();
  useAssistantNavStore.setState({ activeBotId: null, openedBotIds: [] });
  useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 280 });
  useWorkspaceStore.setState({
    workspaces: [createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a', environmentId: 'local', browserVisible: true })], activeWorkspaceId: 'ws-a',
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('shows no Assistants section and does nothing when disabled', async () => {
  mockMain(snap({ settings: { enabled: false, autoStart: false }, service: { state: 'disabled', ownership: null }, bots: [] }));
  const { container } = render(<AssistantsRoster />);
  await waitFor(() => expect(window.electronAPI.getAssistants).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  expect(window.electronAPI.refreshAssistants).not.toHaveBeenCalled();
});

it.each([
  ['probing', 'Connecting to Hermes…'], ['starting', 'Starting Hermes service…'], ['offline', 'Hermes service is not running'],
] as const)('shows the %s state without a roster', async (state, text) => {
  mockMain(snap({ service: { state, ownership: null }, bots: [] }));
  render(<AssistantsRoster />);
  expect(await screen.findByText(text)).toBeInTheDocument();
});

it('offers Retry on an auto-start failure and refreshes through main', async () => {
  mockMain(snap({ service: { state: 'error', ownership: null, error: 'Hermes service did not become ready in time' }, bots: [] }));
  vi.mocked(window.electronAPI.refreshAssistants).mockResolvedValue(snap());
  render(<AssistantsRoster />);
  expect(await screen.findByRole('alert')).toHaveTextContent('did not become ready');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Fred' })).toBeInTheDocument();
  expect(window.electronAPI.refreshAssistants).toHaveBeenCalledOnce();
});

it('lists Bots by friendly name as a simple roster with none of the old prototype controls', async () => {
  mockMain(snap());
  render(<AssistantsRoster />);
  expect(await screen.findByRole('button', { name: 'Fred' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reviewer' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).toBeNull();
  for (const label of [/pin/i, /manage/i, /new task/i, /acknowledge/i, /add existing/i, /close terminal/i, /samson|delilah/i]) expect(screen.queryByText(label)).toBeNull();
  expect(screen.queryByRole('button', { name: label => /pin|manage|new task/i.test(label) })).toBeNull();
});

it('clicking a Bot selects its surface without touching the workspace, and Files do not overlay it', async () => {
  mockMain(snap());
  render(<WorkspaceSidebar />);
  expect(await screen.findByTestId('files-section')).toBeInTheDocument();
  const before = useWorkspaceStore.getState().workspaces[0];
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  expect(useAssistantNavStore.getState()).toMatchObject({ activeBotId: 'hermes:fred', openedBotIds: ['hermes:fred'] });
  expect(screen.queryByTestId('files-section')).toBeNull();
  expect(useWorkspaceStore.getState().workspaces[0]).toBe(before);
  expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-a');
});

it('selecting a workspace clears the Assistant selection but keeps the surface opened', async () => {
  mockMain(snap());
  render(<WorkspaceSidebar />);
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  act(() => useWorkspaceStore.getState().selectWorkspace('ws-a'));
  expect(useAssistantNavStore.getState()).toMatchObject({ activeBotId: null, openedBotIds: ['hermes:fred'] });
  expect(await screen.findByTestId('files-section')).toBeInTheDocument();
});

it('keeps both opened surfaces alive across switches, hides workspace Browser views, and restores the workspace', async () => {
  mockMain(snap());
  render(<WorkspaceHost />);
  const surfaceOf = (id: string) => document.querySelector(`[data-assistant-id="${id}"]`);
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  await waitFor(() => expect(surfaceOf('hermes:fred')).not.toBeNull());
  await waitFor(() => expect(window.electronAPI.browserHide).toHaveBeenCalledWith('ws-a'));
  expect(document.querySelector('[data-workspace-id="ws-a"]')).toHaveAttribute('data-workspace-visibility', 'parked');
  fireEvent.click(screen.getByRole('button', { name: 'Reviewer' }));
  await waitFor(() => expect(surfaceOf('hermes:reviewer')).not.toBeNull());
  expect(surfaceOf('hermes:fred')).toHaveClass('parked');
  expect(surfaceOf('hermes:reviewer')).toHaveClass('active');
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(2));
  expect(xterms).toHaveLength(2);
  // Back to Fred: the existing surface is revealed, not recreated or reopened.
  fireEvent.click(screen.getByRole('button', { name: 'Fred' }));
  expect(surfaceOf('hermes:fred')).toHaveClass('active');
  expect(xterms).toHaveLength(2);
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(2);
  expect(window.electronAPI.closeAssistantPty).not.toHaveBeenCalled();
  // Back to the workspace.
  act(() => useWorkspaceStore.getState().selectWorkspace('ws-a'));
  expect(document.querySelector('[data-workspace-id="ws-a"]')).toHaveAttribute('data-workspace-visibility', 'active');
  expect(surfaceOf('hermes:fred')).toHaveClass('parked');
  expect(surfaceOf('hermes:reviewer')).not.toBeNull();
});

it('the status bar names the Assistant instead of showing a workspace path or branch', async () => {
  mockMain(snap());
  useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a', environmentId: 'local', gitIsRepo: true, gitCurrentBranch: 'feature/x' })], activeWorkspaceId: 'ws-a' });
  render(<><WorkspaceSidebar /><StatusBar /></>);
  expect(await screen.findByText('feature/x')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  expect(await screen.findByTestId('status-assistant')).toHaveTextContent('Fred · Hermes Bot Chat');
  expect(screen.queryByText('feature/x')).toBeNull();
});

it('an opened Assistant stays reachable (marked offline) when the service disappears', async () => {
  mockMain(snap());
  render(<WorkspaceSidebar />);
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  act(() => pushSnapshot(snap({ service: { state: 'offline', ownership: null }, bots: [], surfaces: [{ botId: 'hermes:fred', state: 'disconnected' }] })));
  expect(await screen.findByRole('button', { name: 'Fred' })).toHaveClass('offline');
  expect(screen.getByText('Hermes service is not running')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reviewer' })).toBeNull();
});

it('the surface forwards xterm input and Bot output over the narrow Assistant IPC and never exposes a token', async () => {
  mockMain(snap());
  vi.mocked(window.electronAPI.openAssistant).mockResolvedValue({ state: 'open', replay: 'earlier output' });
  render(<AssistantSurface botId="hermes:fred" displayName="Fred" isActive />);
  await waitFor(() => expect(xterms).toHaveLength(1));
  await waitFor(() => expect(xterms[0].write).toHaveBeenCalledWith('earlier output'));
  xterms[0].emitData('hi\r');
  expect(window.electronAPI.writeAssistantPty).toHaveBeenCalledWith('hermes:fred', 'hi\r');
  act(() => pushData({ botId: 'hermes:fred', data: 'hello' }));
  act(() => pushData({ botId: 'hermes:reviewer', data: 'other' }));
  expect(xterms[0].write).toHaveBeenCalledWith('hello');
  expect(xterms[0].write).not.toHaveBeenCalledWith('other');
  expect(window.electronAPI.openAssistant).toHaveBeenCalledWith('hermes:fred');
  expect(JSON.stringify(vi.mocked(window.electronAPI.openAssistant).mock.calls)).not.toMatch(/token|ws:\/\//i);
});

it('an unresolved Bot Chat is explained, offers Retry, and is never replaced by a scratch chat', async () => {
  mockMain(snap({ surfaces: [{ botId: 'hermes:fred', state: 'unavailable' }] }));
  vi.mocked(window.electronAPI.openAssistant).mockResolvedValue({ state: 'unavailable', replay: '' });
  render(<AssistantSurface botId="hermes:fred" displayName="Fred" isActive />);
  expect(await screen.findByText(/Could not open this Assistant's chat/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(2));
});

it('Settings expose only the two options, a status and Retry; autoStart is gated on enablement', async () => {
  mockMain(snap({ settings: { enabled: false, autoStart: false }, service: { state: 'disabled', ownership: null }, bots: [] }));
  render(<AssistantsSettings />);
  const enable = await screen.findByRole('checkbox', { name: 'Enable Hermes Assistants' });
  const auto = screen.getByRole('checkbox', { name: 'Start Hermes service when needed' });
  await waitFor(() => expect(enable).toBeEnabled());
  expect(auto).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  fireEvent.click(enable);
  await waitFor(() => expect(window.electronAPI.configureAssistants).toHaveBeenCalledWith({ enabled: true, autoStart: false }));
});

it('Settings reflect an enabled service and let the user opt into auto-start', async () => {
  mockMain(snap({ service: { state: 'offline', ownership: null } }));
  render(<AssistantsSettings />);
  expect(await screen.findByText('Status: Offline')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Start Hermes service when needed' }));
  await waitFor(() => expect(window.electronAPI.configureAssistants).toHaveBeenCalledWith({ enabled: true, autoStart: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(window.electronAPI.refreshAssistants).toHaveBeenCalled());
});

it('Tabs mode reaches Assistants through a compact strip with the same roster behaviour', async () => {
  mockMain(snap());
  render(<AssistantsRoster variant="strip" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reviewer' }));
  expect(useAssistantNavStore.getState().activeBotId).toBe('hermes:reviewer');
});

it('uses Assistant (not Bot) wording for an empty roster and a service-first Settings explanation', async () => {
  mockMain(snap({ bots: [] }));
  const { unmount } = render(<AssistantsRoster />);
  expect(await screen.findByText('No Hermes Assistants found')).toBeInTheDocument();
  unmount();
  render(<AssistantsSettings />);
  expect(await screen.findByText(/Uses a local Hermes service/)).toBeInTheDocument();
  expect(screen.queryByText(/Bot Mode/)).toBeNull();
});
