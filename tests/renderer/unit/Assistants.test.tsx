import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { AssistantSnapshot, HermesAssistant } from '../../../src/shared/types/assistants';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { useAssistantsStore } from '../../../src/renderer/store/assistantsStore';

const xterms: Array<{
  write: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; emitData: (data: string) => void;
  paste: ReturnType<typeof vi.fn>; cols: number; rows: number; selection: string;
  emitSelection: () => void; emitKey: (event: KeyboardEvent) => boolean;
  selectionDispose: ReturnType<typeof vi.fn>; loadAddon: ReturnType<typeof vi.fn>;
}> = [];
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24;
    write = vi.fn(); dispose = vi.fn(); focus = vi.fn(); loadAddon = vi.fn();
    private handler: (data: string) => void = () => undefined;
    private selectionHandler = () => undefined as void;
    private keyHandler: (event: KeyboardEvent) => boolean = () => true;
    selection = '';
    selectionDispose = vi.fn();
    hasSelection = () => this.selection.length > 0;
    getSelection = () => this.selection;
    clearSelection = () => { this.selection = ''; };
    onSelectionChange = (handler: () => void) => { this.selectionHandler = handler; return { dispose: this.selectionDispose }; };
    attachCustomKeyEventHandler = (handler: (event: KeyboardEvent) => boolean) => { this.keyHandler = handler; };
    emitSelection = () => this.selectionHandler();
    emitKey = (event: KeyboardEvent) => this.keyHandler(event);
    open = vi.fn((container: HTMLElement) => container.appendChild(document.createElement('div')));
    onData = vi.fn((handler: (data: string) => void) => { this.handler = handler; return { dispose: vi.fn() }; });
    emitData = (data: string) => this.handler(data);
    paste = vi.fn((data: string) => this.handler(`\x1b[200~${data}\x1b[201~`));
    options = {};
    constructor() { xterms.push(this as never); }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock('@xterm/addon-clipboard', () => ({ ClipboardAddon: class { readonly clipboard = true; } }));
vi.mock('../../../src/renderer/components/FileExplorer', () => ({ default: () => <div data-testid="files-section" /> }));
vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({ default: ({ workspaceId }: { workspaceId: string }) => <div data-testid={`layout-${workspaceId}`} /> }));

import AssistantsSettings from '../../../src/renderer/components/settings/AssistantsSettings';
import AssistantsRoster from '../../../src/renderer/components/assistants/AssistantsRoster';
import AssistantSurface from '../../../src/renderer/components/assistants/AssistantSurface';
import WorkspaceSidebar from '../../../src/renderer/components/WorkspaceSidebar';
import WorkspaceHost from '../../../src/renderer/components/WorkspaceHost';
import StatusBar from '../../../src/renderer/components/StatusBar';

const fred: HermesAssistant = { id: 'hermes:fred', displayName: 'Fred', description: 'General helper' };
const reviewer: HermesAssistant = { id: 'hermes:reviewer', displayName: 'Reviewer' };
const snap = (over: Partial<AssistantSnapshot> = {}): AssistantSnapshot => ({
  available: true, settings: { enabled: true, autoStart: false }, service: { state: 'connected', ownership: 'external' }, assistants: [fred, reviewer], surfaces: [], ...over,
});

let pushSnapshot: (snapshot: AssistantSnapshot) => void = () => undefined;
let pushData: (payload: { assistantId: string; data: string }) => void = () => undefined;

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
  useAssistantNavStore.setState({ activeAssistantId: null, openedAssistantIds: [] });
  useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 280 });
  useWorkspaceStore.setState({
    workspaces: [createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a', environmentId: 'local', browserVisible: true })], activeWorkspaceId: 'ws-a',
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('shows no Assistants section and does nothing when disabled', async () => {
  mockMain(snap({ settings: { enabled: false, autoStart: false }, service: { state: 'disabled', ownership: null }, assistants: [] }));
  const { container } = render(<AssistantsRoster />);
  await waitFor(() => expect(window.electronAPI.getAssistants).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  expect(window.electronAPI.refreshAssistants).not.toHaveBeenCalled();
});

it.each([
  ['probing', 'Connecting to Hermes…'], ['starting', 'Starting Hermes service…'], ['offline', 'Hermes service is not running'],
] as const)('shows the %s state without a roster', async (state, text) => {
  mockMain(snap({ service: { state, ownership: null }, assistants: [] }));
  render(<AssistantsRoster />);
  expect(await screen.findByText(text)).toBeInTheDocument();
});

it('offers Retry on an auto-start failure and refreshes through main', async () => {
  mockMain(snap({ service: { state: 'error', ownership: null, error: 'Hermes service did not become ready in time' }, assistants: [] }));
  vi.mocked(window.electronAPI.refreshAssistants).mockResolvedValue(snap());
  render(<AssistantsRoster />);
  expect(await screen.findByRole('alert')).toHaveTextContent('did not become ready');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Fred' })).toBeInTheDocument();
  expect(window.electronAPI.refreshAssistants).toHaveBeenCalledOnce();
});

it('lists Assistants by friendly name as a simple roster with none of the old prototype controls', async () => {
  mockMain(snap());
  render(<AssistantsRoster />);
  expect(await screen.findByRole('button', { name: 'Fred' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reviewer' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).toBeNull();
  for (const label of [/pin/i, /manage/i, /new task/i, /acknowledge/i, /add existing/i, /close terminal/i, /samson|delilah/i]) expect(screen.queryByText(label)).toBeNull();
  expect(screen.queryByRole('button', { name: label => /pin|manage|new task/i.test(label) })).toBeNull();
});

it('clicking a Assistant selects its surface without touching the workspace, and Files do not overlay it', async () => {
  mockMain(snap());
  render(<WorkspaceSidebar />);
  expect(await screen.findByTestId('files-section')).toBeInTheDocument();
  const before = useWorkspaceStore.getState().workspaces[0];
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  expect(useAssistantNavStore.getState()).toMatchObject({ activeAssistantId: 'hermes:fred', openedAssistantIds: ['hermes:fred'] });
  expect(screen.queryByTestId('files-section')).toBeNull();
  expect(useWorkspaceStore.getState().workspaces[0]).toBe(before);
  expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-a');
});

it('selecting a workspace clears the Assistant selection but keeps the surface opened', async () => {
  mockMain(snap());
  render(<WorkspaceSidebar />);
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  act(() => useWorkspaceStore.getState().selectWorkspace('ws-a'));
  expect(useAssistantNavStore.getState()).toMatchObject({ activeAssistantId: null, openedAssistantIds: ['hermes:fred'] });
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
  act(() => pushSnapshot(snap({ service: { state: 'offline', ownership: null }, assistants: [], surfaces: [{ assistantId: 'hermes:fred', state: 'disconnected' }] })));
  expect(await screen.findByRole('button', { name: 'Fred' })).toHaveClass('offline');
  expect(screen.getByText('Hermes service is not running')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reviewer' })).toBeNull();
});

it('the surface forwards xterm input and Assistant output over the narrow Assistant IPC and never exposes a token', async () => {
  mockMain(snap({ surfaces: [{ assistantId: 'hermes:fred', state: 'open' }] }));
  vi.mocked(window.electronAPI.openAssistant).mockResolvedValue({ state: 'open', replay: 'earlier output' });
  render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
  await waitFor(() => expect(xterms).toHaveLength(1));
  await waitFor(() => expect(xterms[0].write).toHaveBeenCalledWith('earlier output'));
  xterms[0].emitData('hi\r');
  expect(window.electronAPI.writeAssistantPty).toHaveBeenCalledWith('hermes:fred', 'hi\r');
  act(() => pushData({ assistantId: 'hermes:fred', data: 'hello' }));
  act(() => pushData({ assistantId: 'hermes:reviewer', data: 'other' }));
  expect(xterms[0].write).toHaveBeenCalledWith('hello');
  expect(xterms[0].write).not.toHaveBeenCalledWith('other');
  expect(window.electronAPI.openAssistant).toHaveBeenCalledWith('hermes:fred');
  expect(JSON.stringify(vi.mocked(window.electronAPI.openAssistant).mock.calls)).not.toMatch(/token|ws:\/\//i);
});

it('does not install a late resize observer after a pending Assistant open is unmounted', async () => {
  mockMain(snap());
  let finishOpen!: (value: { state: 'open'; replay: string }) => void;
  vi.mocked(window.electronAPI.openAssistant).mockReturnValue(new Promise((resolve) => { finishOpen = resolve; }));
  const observe = vi.fn();
  const previousObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe = observe; unobserve = vi.fn(); disconnect = vi.fn(); };
  try {
    const { unmount } = render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
    await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledWith('hermes:fred'));
    const term = xterms[0];
    unmount();
    observe.mockClear(); // Ignore the surface shell's own observers before teardown.
    await act(async () => { finishOpen({ state: 'open', replay: 'late replay' }); });
    expect(observe).not.toHaveBeenCalled();
    expect(term.write).not.toHaveBeenCalledWith('late replay');
    expect(term.selectionDispose).toHaveBeenCalledOnce();
    expect(term.dispose).toHaveBeenCalledOnce();
  } finally { globalThis.ResizeObserver = previousObserver; }
});

it('copies Assistant selections and consumes Ctrl+Shift+C without replacing Ctrl+C interrupt', async () => {
  mockMain(snap({ surfaces: [{ assistantId: 'hermes:fred', state: 'open' }] }));
  const { unmount } = render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
  await waitFor(() => expect(xterms).toHaveLength(1));
  await waitFor(() => expect(useAssistantsStore.getState().snapshot?.surfaces[0]?.state).toBe('open'));
  const term = xterms[0];
  expect(term.loadAddon).toHaveBeenCalledWith(expect.objectContaining({ clipboard: true }));
  term.selection = 'answer to copy';
  term.emitSelection();
  expect(window.electronAPI.writeClipboard).toHaveBeenCalledWith('answer to copy');
  vi.mocked(window.electronAPI.writeClipboard).mockClear();
  const copy = new KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true, cancelable: true });
  expect(term.emitKey(copy)).toBe(false);
  expect(copy.defaultPrevented).toBe(true);
  expect(window.electronAPI.writeClipboard).toHaveBeenCalledExactlyOnceWith('answer to copy');
  expect(term.selection).toBe('');
  term.emitKey(new KeyboardEvent('keyup', { key: 'C', ctrlKey: true, shiftKey: true }));
  expect(window.electronAPI.writeClipboard).toHaveBeenCalledTimes(1);
  expect(term.emitKey(copy)).toBe(false); // Empty selection still consumes the shortcut.
  expect(window.electronAPI.writeAssistantPty).not.toHaveBeenCalled();
  expect(term.emitKey(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))).toBe(true);
  term.emitData('\x03');
  expect(window.electronAPI.writeAssistantPty).toHaveBeenCalledWith('hermes:fred', '\x03');
  unmount();
  expect(term.selectionDispose).toHaveBeenCalledOnce();
  expect(term.dispose).toHaveBeenCalledOnce();
});

it('gates clipboard and keyboard handling when parked or disconnected without blocking terminal query replies', async () => {
  mockMain(snap({ surfaces: [{ assistantId: 'hermes:fred', state: 'open' }] }));
  const { rerender } = render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
  await waitFor(() => expect(xterms).toHaveLength(1));
  await waitFor(() => expect(useAssistantsStore.getState().snapshot?.surfaces[0]?.state).toBe('open'));
  const term = xterms[0];
  const select = () => { term.selection = 'selected'; term.emitSelection(); };
  select();
  expect(window.electronAPI.writeClipboard).toHaveBeenCalledTimes(1);
  vi.mocked(window.electronAPI.writeClipboard).mockClear();
  rerender(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive={false} />);
  select();
  expect(term.emitKey(new KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true }))).toBe(false);
  expect(window.electronAPI.writeClipboard).not.toHaveBeenCalled();
  expect(window.electronAPI.writeAssistantPty).not.toHaveBeenCalled();
  rerender(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
  act(() => pushSnapshot(snap({ surfaces: [{ assistantId: 'hermes:fred', state: 'disconnected' }] })));
  select();
  expect(window.electronAPI.writeClipboard).not.toHaveBeenCalled();
  expect(window.electronAPI.writeAssistantPty).not.toHaveBeenCalled();
  act(() => pushSnapshot(snap({ surfaces: [{ assistantId: 'hermes:fred', state: 'open' }] })));
  select();
  expect(window.electronAPI.writeClipboard).toHaveBeenCalledWith('selected');
  rerender(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive={false} />);
  term.emitData('\x1b[?1;2c');
  expect(window.electronAPI.writeAssistantPty).toHaveBeenCalledWith('hermes:fred', '\x1b[?1;2c');
  expect(xterms).toHaveLength(1);
});

it('pastes local image drops through the Assistant PTY with xterm paste framing', async () => {
  mockMain(snap({ surfaces: [{ assistantId: 'hermes:fred', state: 'open' }] }));
  vi.mocked(window.electronAPI.resolveDroppedFilePath).mockReturnValue('/images/photo.png');
  const { container } = render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
  await waitFor(() => expect(xterms).toHaveLength(1));
  await waitFor(() => expect(useAssistantsStore.getState().snapshot?.surfaces[0]?.state).toBe('open'));
  fireEvent.drop(container.querySelector('.assistant-surface-terminal')!, {
    dataTransfer: { files: [new File(['image'], 'photo.png', { type: 'image/png' })], getData: () => '' },
  });
  expect(xterms[0].paste).toHaveBeenCalledWith("'/images/photo.png' ");
  expect(window.electronAPI.writeAssistantPty).toHaveBeenCalledWith('hermes:fred', "\x1b[200~'/images/photo.png' \x1b[201~");
  expect(window.electronAPI.writeTerminal).not.toHaveBeenCalled();
});

it.each([
  { isActive: false, state: 'open' as const },
  { isActive: true, state: 'disconnected' as const },
])('does not paste image drops into an inactive or disconnected Assistant: $state, active=$isActive', async ({ isActive, state }) => {
  mockMain(snap({ surfaces: [{ assistantId: 'hermes:fred', state }] }));
  const { container } = render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive={isActive} />);
  await waitFor(() => expect(xterms).toHaveLength(1));
  await waitFor(() => expect(useAssistantsStore.getState().snapshot?.surfaces[0]?.state).toBe(state));
  expect(fireEvent.drop(container.querySelector('.assistant-terminal')!, {
    dataTransfer: { files: [new File(['image'], 'photo.png', { type: 'image/png' })], getData: () => '' },
  })).toBe(false);
  expect(xterms[0].paste).not.toHaveBeenCalled();
  expect(window.electronAPI.writeAssistantPty).not.toHaveBeenCalled();
});

it('an unresolved Bot Chat is explained, offers Retry, and is never replaced by a scratch chat', async () => {
  mockMain(snap({ surfaces: [{ assistantId: 'hermes:fred', state: 'unavailable' }] }));
  vi.mocked(window.electronAPI.openAssistant).mockResolvedValue({ state: 'unavailable', replay: '' });
  render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
  expect(await screen.findByText(/Could not open this Assistant's chat/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(2));
});

it('Settings expose only the two options, a status and Retry; autoStart is gated on enablement', async () => {
  mockMain(snap({ settings: { enabled: false, autoStart: false }, service: { state: 'disabled', ownership: null }, assistants: [] }));
  render(<AssistantsSettings />);
  const enable = await screen.findByRole('checkbox', { name: 'Enable Hermes Assistants' });
  const auto = screen.getByRole('checkbox', { name: 'Start Hermes service when needed' });
  await waitFor(() => expect(enable).toBeEnabled());
  expect(auto).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  fireEvent.click(enable);
  await waitFor(() => expect(window.electronAPI.configureAssistants).toHaveBeenCalledWith({ enabled: true, autoStart: false }));
});

it('Tabs mode reaches Assistants through a compact strip with the same roster behaviour', async () => {
  mockMain(snap());
  render(<AssistantsRoster variant="strip" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reviewer' }));
  expect(useAssistantNavStore.getState().activeAssistantId).toBe('hermes:reviewer');
});

it('uses "Assistants" (not "Bots") wording for an empty roster', async () => {
  mockMain(snap({ assistants: [] }));
  render(<AssistantsRoster />);
  expect(await screen.findByText('No Hermes Assistants found')).toBeInTheDocument();
});

// ── Settings presentation ────────────────────────────────────────────────────

it('Settings, connected: shows service ownership and toggles without a Retry action', async () => {
  mockMain(snap({ service: { state: 'connected', ownership: 'clanker' } }));
  render(<AssistantsSettings />);
  const info = await screen.findByRole('button', { name: 'Hermes Assistants information' });
  expect(info).toHaveAttribute('title', expect.stringContaining('Uses a local Hermes service (hermes serve)'));
  expect(info.getAttribute('title')).toContain('Ordinary Hermes harness usage is independent');
  expect(info.getAttribute('title')).toContain('Status: Connected · Clanker-managed.');
  expect(screen.getByRole('checkbox', { name: 'Enable Hermes Assistants' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Start Hermes service when needed' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.getByText(/Status: Connected · Clanker-managed/)).toBeVisible();
  expect(screen.getByText(/Uses a local Hermes service/)).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('Settings reports an external service in the info text without exposing ports or tokens', async () => {
  mockMain(snap({ service: { state: 'connected', ownership: 'external' } }));
  render(<AssistantsSettings />);
  const title = (await screen.findByRole('button', { name: 'Hermes Assistants information' })).getAttribute('title') ?? '';
  expect(title).toContain('Connected · External');
  expect(title).not.toMatch(/9119|token|http|ws:/i);
});

it.each([['probing', 'Connecting…'], ['starting', 'Starting Hermes service…']] as const)('Settings, %s: a compact transition line and no Retry', async (state, text) => {
  mockMain(snap({ service: { state, ownership: null } }));
  render(<AssistantsSettings />);
  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

it.each([
  ['offline', undefined, 'Hermes service is not running'],
  ['error', undefined, 'Could not connect to Hermes'],
  ['error', 'Hermes service did not become ready in time', 'Hermes service did not become ready in time'],
  ['detected-unusable', undefined, 'Hermes service found, but Clanker cannot connect to it'],
] as const)('Settings, %s: one compact problem row with Retry', async (state, error, text) => {
  mockMain(snap({ service: { state, ownership: null, ...(error ? { error } : {}) } }));
  vi.mocked(window.electronAPI.refreshAssistants).mockResolvedValue(snap());
  render(<AssistantsSettings />);
  expect(await screen.findAllByText(text)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(window.electronAPI.refreshAssistants).toHaveBeenCalled());
});

it('Settings offers cleanup Retry even while Assistants are disabled, without claiming the retained process is Off', async () => {
  const error = 'Hermes service cleanup could not be confirmed. Retry cleanup.';
  mockMain(snap({ settings: { enabled: false, autoStart: true }, assistants: [],
    service: { state: 'error', ownership: 'clanker', cleanupIncomplete: true, error } }));
  vi.mocked(window.electronAPI.refreshAssistants).mockResolvedValue(snap({ settings: { enabled: false, autoStart: true },
    service: { state: 'disabled', ownership: null }, assistants: [] }));
  render(<AssistantsSettings />);
  expect(await screen.findByText(error)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Hermes Assistants information' })).toHaveAttribute('title', expect.stringContaining('Cleanup incomplete'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(window.electronAPI.refreshAssistants).toHaveBeenCalled());
  expect(window.electronAPI.configureAssistants).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
  expect(screen.getByRole('checkbox', { name: 'Enable Hermes Assistants' })).not.toBeChecked();
});

it('Settings, disabled: autoStart stays visible but subordinate, and toggling Assistants off keeps the autoStart preference', async () => {
  mockMain(snap({ settings: { enabled: true, autoStart: true } }));
  render(<AssistantsSettings />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Enable Hermes Assistants' }));
  await waitFor(() => expect(window.electronAPI.configureAssistants).toHaveBeenCalledWith({ enabled: false, autoStart: true }));
});

// ── Hermes CLI availability ──────────────────────────────────────────────────

it('without the Hermes CLI no surface of the feature exists: Settings, sidebar, rail and tabs roster', async () => {
  mockMain(snap({ available: false, settings: { enabled: true, autoStart: true }, service: { state: 'disabled', ownership: null }, assistants: [] }));
  useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 280 });
  const sidebar = render(<WorkspaceSidebar />);
  await waitFor(() => expect(window.electronAPI.getAssistants).toHaveBeenCalled());
  expect(screen.queryByRole('region', { name: 'Assistants' })).toBeNull();
  expect(screen.queryByText('Assistants')).toBeNull();
  sidebar.unmount();
  const strip = render(<AssistantsRoster variant="strip" />);
  await waitFor(() => expect(strip.container).toBeEmptyDOMElement());
  strip.unmount();
  const settings = render(<AssistantsSettings />);
  await waitFor(() => expect(window.electronAPI.getAssistants).toHaveBeenCalled());
  expect(settings.container).toBeEmptyDOMElement();
  expect(screen.queryByText('Hermes Assistants')).toBeNull();
  settings.unmount();
  useWorkspaceNavigationStore.setState({ sidebarWidth: 44 });
  render(<WorkspaceSidebar />);
  expect(screen.queryByRole('button', { name: /Hermes Assistant$/ })).toBeNull();
});

it('with the Hermes CLI installed the Settings section is visible', async () => {
  mockMain(snap({ settings: { enabled: false, autoStart: false }, service: { state: 'disabled', ownership: null }, assistants: [] }));
  render(<AssistantsSettings />);
  expect(await screen.findByRole('checkbox', { name: 'Enable Hermes Assistants' })).toBeInTheDocument();
});

// ── Navigation layout and identity ──────────────────────────────────────────

it('ASSISTANTS sits directly after WORKSPACES in one upper stack, with FILES after it', async () => {
  mockMain(snap());
  render(<WorkspaceSidebar />);
  await screen.findByRole('button', { name: 'Fred' });
  const upper = screen.getByTestId('workspace-sidebar-upper');
  const children = [...upper.children];
  expect(children).toHaveLength(2);
  expect(children[0]).toHaveClass('ws-nav');
  expect(children[1]).toHaveAttribute('aria-label', 'Assistants');
  expect(upper.nextElementSibling).toBe(screen.getByTestId('files-section'));
  // Layout contract: the upper stack owns the flexible area; the workspace list no longer greedily fills it.
  const css = readFileSync(join(process.cwd(), 'src/renderer/components/assistants/AssistantsRoster.css'), 'utf8');
  expect(css).toMatch(/\.workspace-sidebar-upper \{[^}]*flex: 1 1 auto[^}]*overflow-y: auto/);
  expect(css).toMatch(/\.workspace-sidebar-upper \.ws-nav \{ flex: 0 0 auto; \}/);
  expect(screen.getAllByRole('button', { name: 'Fred' })).toHaveLength(1);
});

it('an Assistant without native art uses a neutral profile fallback', async () => {
  mockMain(snap());
  useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 280 });
  render(<AssistantsRoster />);
  const row = await screen.findByRole('button', { name: 'Fred' });
  expect(row.querySelector('.lucide-user-round')).not.toBeNull();
  expect(row.querySelector('img')).toBeNull();
  expect(row.innerHTML).not.toMatch(/lucide-assistant/);
});

it('the collapsed rail and tabs strip retain Assistants labelled "<name> · Hermes Assistant"', async () => {
  mockMain(snap());
  useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 44 });
  render(<WorkspaceSidebar />);
  const fredIcon = await screen.findByRole('button', { name: 'Fred · Hermes Assistant' });
  expect(screen.getByRole('button', { name: 'Reviewer · Hermes Assistant' })).toBeInTheDocument();
  expect(fredIcon.innerHTML).not.toMatch(/lucide-assistant/);
  expect(fredIcon.querySelector('.lucide-user-round')).not.toBeNull();
  fireEvent.click(fredIcon);
  expect(useAssistantNavStore.getState().activeAssistantId).toBe('hermes:fred');
});

it('the active Assistant row uses the normal navigation active treatment', async () => {
  mockMain(snap());
  render(<AssistantsRoster />);
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  expect(screen.getByRole('button', { name: 'Fred' })).toHaveAttribute('aria-current', 'true');
  const css = readFileSync(join(process.cwd(), 'src/renderer/components/assistants/AssistantsRoster.css'), 'utf8');
  expect(css).toMatch(/\.assistant-row\.active \{[^}]*border-left-color: var\(--accent-interactive\)/);
});

// ── deliberate disable vs transient disconnect ───────────────────────────────

const surfaceOf = (id: string) => document.querySelector(`[data-assistant-id="${id}"]`);

it('disabling Assistants tears down every renderer Assistant surface and returns to the workspace; re-enabling mounts a fresh surface', async () => {
  mockMain(snap());
  render(<WorkspaceHost />);
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  await waitFor(() => expect(surfaceOf('hermes:fred')).not.toBeNull());
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
  const firstTerminal = xterms[0];
  act(() => pushSnapshot(snap({ settings: { enabled: false, autoStart: false }, service: { state: 'disabled', ownership: null }, assistants: [], surfaces: [] })));
  await waitFor(() => expect(surfaceOf('hermes:fred')).toBeNull());
  expect(useAssistantNavStore.getState()).toMatchObject({ activeAssistantId: null, openedAssistantIds: [] });
  expect(firstTerminal.dispose).toHaveBeenCalled();
  expect(document.querySelector('[data-workspace-id="ws-a"]')).toHaveAttribute('data-workspace-visibility', 'active');
  expect(screen.queryByRole('button', { name: 'Fred' })).toBeNull();
  // Re-enable: roster returns, and a click mounts a brand-new surface that re-opens through main.
  act(() => pushSnapshot(snap()));
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  await waitFor(() => expect(surfaceOf('hermes:fred')).not.toBeNull());
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(2));
  expect(document.querySelectorAll('[data-assistant-id="hermes:fred"]')).toHaveLength(1);
  expect(xterms).toHaveLength(2);
});

it('an unavailable Hermes CLI also clears Assistant navigation', async () => {
  mockMain(snap());
  render(<WorkspaceHost />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reviewer' }));
  await waitFor(() => expect(surfaceOf('hermes:reviewer')).not.toBeNull());
  act(() => pushSnapshot(snap({ available: false, service: { state: 'disabled', ownership: null }, assistants: [] })));
  await waitFor(() => expect(surfaceOf('hermes:reviewer')).toBeNull());
  expect(useAssistantNavStore.getState().openedAssistantIds).toEqual([]);
});

it.each(['offline', 'probing', 'starting'] as const)('a transient %s service keeps opened surfaces parked for re-attachment', async (state) => {
  mockMain(snap());
  render(<WorkspaceHost />);
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  await waitFor(() => expect(surfaceOf('hermes:fred')).not.toBeNull());
  act(() => pushSnapshot(snap({ service: { state, ownership: null }, assistants: [], surfaces: [{ assistantId: 'hermes:fred', state: 'disconnected' }] })));
  await flushUi();
  expect(surfaceOf('hermes:fred')).not.toBeNull();
  expect(useAssistantNavStore.getState()).toMatchObject({ activeAssistantId: 'hermes:fred', openedAssistantIds: ['hermes:fred'] });
  expect(xterms).toHaveLength(1);
  // Back online: the existing surface re-attaches to the same chat without being recreated.
  act(() => pushSnapshot(snap({ surfaces: [{ assistantId: 'hermes:fred', state: 'disconnected' }] })));
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(2));
  expect(xterms).toHaveLength(1);
});

async function flushUi() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }

// ── PTY recovery is bounded ──────────────────────────────────────────────────

const withFredSurface = (state: 'open' | 'disconnected', service: AssistantSnapshot['service'] = { state: 'connected', ownership: 'external' }) =>
  snap({ service, assistants: service.state === 'connected' ? [fred, reviewer] : [], surfaces: [{ assistantId: 'hermes:fred', state }] });

it('refreshes a healthy Assistant explicitly, blocking duplicate clicks and keeping its terminal and workspace intact', async () => {
  mockMain(withFredSurface('open'));
  let finish!: (value: { state: 'connecting'; replay: string }) => void;
  vi.mocked(window.electronAPI.refreshAssistantSession).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const workspace = useWorkspaceStore.getState().workspaces[0];
  render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }));
  expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refreshing…' }));
  expect(window.electronAPI.refreshAssistantSession).toHaveBeenCalledExactlyOnceWith('hermes:fred');
  await act(async () => { finish({ state: 'connecting', replay: 'do not append twice' }); });
  act(() => pushData({ assistantId: 'hermes:fred', data: 'native redraw' }));
  expect(xterms).toHaveLength(1);
  expect(xterms[0].dispose).not.toHaveBeenCalled();
  expect(xterms[0].write).toHaveBeenCalledWith('native redraw');
  expect(xterms[0].write).not.toHaveBeenCalledWith('do not append twice');
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
  expect(window.electronAPI.refreshAssistants).not.toHaveBeenCalled();
  expect(useWorkspaceStore.getState().workspaces[0]).toBe(workspace);
});

it('allows refresh during a stuck connection and offline, and shows a safe, retryable failure', async () => {
  mockMain(snap({ surfaces: [{ assistantId: 'hermes:fred', state: 'connecting' }] }));
  render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Refresh session' })).toBeEnabled();
  act(() => pushSnapshot(withFredSurface('disconnected', { state: 'offline', ownership: null })));
  vi.mocked(window.electronAPI.refreshAssistantSession).mockRejectedValueOnce(new Error('private backend details'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh Bot Chat. Try again.');
  expect(screen.queryByText(/private backend/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(window.electronAPI.refreshAssistantSession).toHaveBeenCalledTimes(2);
});

it('a PTY-only disconnect while the service stays connected never auto-reopens; Reconnect is a single user-initiated attempt', async () => {
  mockMain(withFredSurface('open'));
  render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1));
  expect(xterms).toHaveLength(1);
  act(() => pushSnapshot(withFredSurface('disconnected')));
  await flushUi();
  expect(screen.getByText('Disconnected from the Hermes Assistant terminal.')).toBeInTheDocument();
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
  // Repeated disconnected snapshots do not loop.
  act(() => pushSnapshot(withFredSurface('disconnected')));
  act(() => pushSnapshot(withFredSurface('disconnected')));
  await flushUi();
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
  expect(window.electronAPI.refreshAssistants).not.toHaveBeenCalled();
  // Reconnect: exactly one additional attempt.
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(2));
  // It fails again (still disconnected): no third automatic attempt.
  act(() => pushSnapshot(withFredSurface('disconnected')));
  await flushUi();
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(2);
  expect(xterms).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
});

it('a real control-service recovery re-attaches a disconnected surface exactly once and reuses the terminal', async () => {
  mockMain(withFredSurface('open'));
  render(<AssistantSurface assistantId="hermes:fred" displayName="Fred" isActive />);
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1));
  const offline: AssistantSnapshot['service'] = { state: 'offline', ownership: null };
  act(() => pushSnapshot(withFredSurface('disconnected', offline)));
  act(() => pushSnapshot(withFredSurface('disconnected', { state: 'probing', ownership: null })));
  act(() => pushSnapshot(withFredSurface('disconnected', { state: 'starting', ownership: null })));
  await flushUi();
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
  act(() => pushSnapshot(withFredSurface('disconnected')));
  await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(2));
  // If that single attempt fails, further disconnected snapshots do not retry.
  act(() => pushSnapshot(withFredSurface('disconnected')));
  act(() => pushSnapshot(withFredSurface('disconnected')));
  await flushUi();
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(2);
  expect(xterms).toHaveLength(1);
  expect(xterms[0].dispose).not.toHaveBeenCalled();
});

// ── Opening a workspace while an Assistant is active ─────────────────────────

const workspaceB = () => createWorkspaceFixture({ id: 'ws-b', workspacePath: '/projects/b', environmentId: 'local', name: 'b' });

it('adding a workspace parks the active Assistant (kept warm) and makes the new workspace visible; selecting the Assistant reveals the same surface', async () => {
  mockMain(snap());
  render(<WorkspaceHost />);
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  await waitFor(() => expect(surfaceOf('hermes:fred')).not.toBeNull());
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
  act(() => useWorkspaceStore.getState().addWorkspace(workspaceB()));
  const state = useWorkspaceStore.getState();
  expect(state.activeWorkspaceId).toBe('ws-b');
  expect(state.workspaces.find((workspace) => workspace.id === 'ws-b')?.lifecycle).toBe('active');
  expect(useAssistantNavStore.getState()).toMatchObject({ activeAssistantId: null, openedAssistantIds: ['hermes:fred'] });
  await waitFor(() => expect(document.querySelector('[data-workspace-id="ws-b"]')).toHaveAttribute('data-workspace-visibility', 'active'));
  expect(surfaceOf('hermes:fred')).toHaveClass('parked');
  expect(screen.getByTestId('files-section')).toBeInTheDocument();
  expect(xterms[0].dispose).not.toHaveBeenCalled();
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
  // Back to Fred: the same surface is revealed, not recreated.
  fireEvent.click(screen.getByRole('button', { name: 'Fred' }));
  expect(surfaceOf('hermes:fred')).toHaveClass('active');
  expect(xterms).toHaveLength(1);
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
});
