import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { AssistantSnapshot } from '../../../src/shared/types/assistants';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { useAssistantsStore } from '../../../src/renderer/store/assistantsStore';
import { DEFAULT_SIDECAR_PRIMARY_RATIO, useAssistantSurfaceStore } from '../../../src/renderer/store/assistantSurfaceStore';
import { resolveDestinationCapabilities, resolveActiveBrowserOwner } from '../../../src/renderer/lib/activeDestination';
import { assistantBrowserOwnerId } from '../../../src/shared/browserOwner';

const xterms: Array<{ write: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24;
    write = vi.fn(); dispose = vi.fn(); focus = vi.fn(); loadAddon = vi.fn();
    open = vi.fn((container: HTMLElement) => container.appendChild(document.createElement('div')));
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    options = {};
    constructor() { xterms.push(this as never); }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock('../../../src/renderer/components/FileExplorer', () => ({ default: () => <div data-testid="files-section" /> }));
vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({ default: ({ workspaceId }: { workspaceId: string }) => <div data-testid={`layout-${workspaceId}`} /> }));

import Header from '../../../src/renderer/components/Header';
import WorkspaceHost from '../../../src/renderer/components/WorkspaceHost';

const FRED = 'hermes:fred';
const FRED_OWNER = assistantBrowserOwnerId(FRED);
const snap = (over: Partial<AssistantSnapshot> = {}): AssistantSnapshot => ({
  available: true, settings: { enabled: true, autoStart: false }, service: { state: 'connected', ownership: 'external' },
  assistants: [{ id: FRED, displayName: 'Fred' }], surfaces: [], ...over,
});
let pushSnapshot: (snapshot: AssistantSnapshot) => void = () => undefined;
let pushData: (payload: { assistantId: string; data: string }) => void = () => undefined;

beforeEach(() => {
  installElectronApiMock();
  xterms.length = 0;
  const api = window.electronAPI;
  vi.mocked(api.getAssistants).mockResolvedValue(snap());
  vi.mocked(api.onAssistantsChanged).mockImplementation((callback) => { pushSnapshot = callback; return () => undefined; });
  vi.mocked(api.onAssistantPtyData).mockImplementation((callback) => { pushData = callback; return () => undefined; });
  useAssistantsStore.getState().reset();
  useAssistantNavStore.setState({ activeAssistantId: null, openedAssistantIds: [] });
  useAssistantSurfaceStore.setState({ byId: {} });
  useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 280 });
  useWorkspaceStore.setState({
    workspaces: [createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a', environmentId: 'local', browserVisible: true, gitIsRepo: true })], activeWorkspaceId: 'ws-a',
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const surfaceOf = (id: string) => document.querySelector(`[data-assistant-id="${id}"]`);
const selectFred = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Fred' }));
  await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
};
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); };

it('resolves the capability matrix and the single Browser owner per destination', () => {
  const workspace = resolveDestinationCapabilities({ kind: 'workspace', workspaceId: 'ws-a' });
  expect(workspace.recipes).toBe(false);
  expect(Object.entries(workspace).filter(([key]) => key !== 'recipes').every(([, enabled]) => enabled)).toBe(true);
  const assistant = resolveDestinationCapabilities({ kind: 'assistant', assistantId: FRED });
  expect(assistant).toEqual({
    browser: true, explorer: false, notes: false, recipes: false, terminalLaunch: false, isolatedAgent: false,
    git: false, layout: false, sessionHistory: false, usage: true,
  });
  expect(resolveActiveBrowserOwner({ kind: 'assistant', assistantId: FRED })).toBe(FRED_OWNER);
  expect(resolveActiveBrowserOwner({ kind: 'workspace', workspaceId: 'ws-a' })).toBe('ws-a');
  expect(resolveActiveBrowserOwner({ kind: 'none' })).toBeNull();
});

it('Workspace mode keeps the full toolbar', async () => {
  render(<Header />);
  expect(await screen.findByRole('group', { name: 'New terminal' })).toBeInTheDocument();
  for (const name of ['Toggle browser panel', 'Toggle notes panel', 'Undo layout change', 'Fit all panes', 'Chat history', 'Settings']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }
  expect(screen.getByTitle(/Git/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Workspace Launch Recipes' })).not.toBeInTheDocument();
});

it('Assistant mode keeps only Browser and Settings; no workspace control remains to target the parked workspace', async () => {
  render(<><Header /><WorkspaceHost /></>);
  await selectFred();
  expect(screen.getByRole('button', { name: 'Toggle browser panel' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'New terminal' })).toBeNull();
  for (const name of ['Toggle notes panel', 'Toggle File Explorer', 'Undo layout change', 'Fit all panes', 'Workspace Launch Recipes', 'Chat history']) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
  expect(screen.queryByTitle(/Git/)).toBeNull();
  expect(screen.queryByTestId('files-section')).toBeNull();
  // Back to a workspace: everything returns.
  act(() => useWorkspaceStore.getState().selectWorkspace('ws-a'));
  expect(await screen.findByRole('group', { name: 'New terminal' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Toggle notes panel' })).toBeInTheDocument();
});

it('the Browser button targets the Assistant, reflects its own visibility, and never mutates the parked workspace', async () => {
  render(<><Header /><WorkspaceHost /></>);
  await selectFred();
  const workspaceBefore = useWorkspaceStore.getState().workspaces[0];
  const toggle = screen.getByRole('button', { name: 'Toggle browser panel' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false'); // the workspace's own Browser is visible, Fred's is not
  fireEvent.click(toggle);
  expect(useAssistantSurfaceStore.getState().byId[FRED]?.browserVisible).toBe(true);
  expect(screen.getByRole('button', { name: 'Toggle browser panel' })).toHaveAttribute('aria-pressed', 'true');
  expect(useWorkspaceStore.getState().workspaces[0]).toBe(workspaceBefore);
  fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
  expect(useAssistantSurfaceStore.getState().byId[FRED]?.browserVisible).toBe(false);
  expect(useWorkspaceStore.getState().workspaces[0]).toBe(workspaceBefore);
});

it('the Assistant shell shows only the Hermes primary until the Browser sidecar opens; the terminal never remounts', async () => {
  render(<><Header /><WorkspaceHost /></>);
  await selectFred();
  await waitFor(() => expect(xterms).toHaveLength(1));
  const surface = surfaceOf(FRED)!;
  expect(surface.querySelector('.browser-panel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
  await waitFor(() => expect(surface.querySelector('.browser-panel')).not.toBeNull());
  expect(surface.querySelector('.assistant-terminal')).not.toBeNull();
  expect(xterms).toHaveLength(1);
  expect(xterms[0].dispose).not.toHaveBeenCalled();
  // Assistant PTY output keeps flowing while the sidecar is open.
  act(() => pushData({ assistantId: FRED, data: 'while-browser-open' }));
  expect(xterms[0].write).toHaveBeenCalledWith('while-browser-open');
  // Closing the Browser hides the sidecar, keeps its state, and does not touch the terminal.
  fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
  await waitFor(() => expect(surface.querySelector('.browser-panel')).toBeNull());
  expect(useAssistantSurfaceStore.getState().byId[FRED]?.tabs).toHaveLength(1);
  expect(xterms).toHaveLength(1);
  expect(xterms[0].dispose).not.toHaveBeenCalled();
  expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
});

it('Browser ownership never crosses destinations: state is preserved and only the active owner may show a native view', async () => {
  render(<><Header /><WorkspaceHost /></>);
  await selectFred();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
  await waitFor(() => expect(window.electronAPI.browserActivate).toHaveBeenCalledWith(FRED_OWNER, expect.any(String)));
  // The workspace's visible Browser is hidden while Fred owns the window.
  await waitFor(() => expect(window.electronAPI.browserHide).toHaveBeenCalledWith('ws-a'));
  const tabId = useAssistantSurfaceStore.getState().byId[FRED]!.activeTabId!;
  act(() => { useAssistantSurfaceStore.getState().updateTab(FRED, tabId, { url: 'https://fred.example/page' }); });
  const browserState = () => { const w = useWorkspaceStore.getState().workspaces[0]; return { visible: w.browserVisible, url: w.browserUrl, terminalIds: w.terminals.map((terminal) => terminal.id), overlay: w.browserOverlayCount }; };
  const workspaceBefore = browserState();
  // Back to the workspace: Fred's native view is hidden, Fred's state and the workspace's are intact.
  vi.mocked(window.electronAPI.browserHide).mockClear();
  act(() => useWorkspaceStore.getState().selectWorkspace('ws-a'));
  await waitFor(() => expect(window.electronAPI.browserHide).toHaveBeenCalledWith(FRED_OWNER));
  expect(browserState()).toEqual(workspaceBefore);
  expect(useAssistantSurfaceStore.getState().byId[FRED]?.tabs[0].url).toBe('https://fred.example/page');
  expect(surfaceOf(FRED)).toHaveClass('parked');
  // Back to Fred: the same URL/state, and Fred's view is reactivated.
  vi.mocked(window.electronAPI.browserActivate).mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Fred' }));
  await waitFor(() => expect(window.electronAPI.browserActivate).toHaveBeenCalledWith(FRED_OWNER, tabId));
  expect(useAssistantSurfaceStore.getState().byId[FRED]?.tabs[0].url).toBe('https://fred.example/page');
  expect(xterms).toHaveLength(1);
});

it('keeps the sidecar split in memory across Fred -> workspace -> Fred and rejects absurd ratios', async () => {
  render(<><Header /><WorkspaceHost /></>);
  await selectFred();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
  expect(useAssistantSurfaceStore.getState().byId[FRED]?.sidecarRatio).toBe(DEFAULT_SIDECAR_PRIMARY_RATIO);
  act(() => useAssistantSurfaceStore.getState().setRatio(FRED, 55));
  act(() => useAssistantSurfaceStore.getState().setRatio(FRED, 2));
  act(() => useAssistantSurfaceStore.getState().setRatio(FRED, Number.NaN));
  act(() => useWorkspaceStore.getState().selectWorkspace('ws-a'));
  fireEvent.click(screen.getByRole('button', { name: 'Fred' }));
  expect(useAssistantSurfaceStore.getState().byId[FRED]).toMatchObject({ browserVisible: true, sidecarRatio: 55 });
  expect(surfaceOf(FRED)!.querySelector('.browser-panel')).not.toBeNull();
});

it('disabling Assistants clears every Assistant Browser UI state and leaves workspace state untouched', async () => {
  render(<><Header /><WorkspaceHost /></>);
  await selectFred();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
  expect(useAssistantSurfaceStore.getState().byId[FRED]?.browserVisible).toBe(true);
  const workspaceBefore = useWorkspaceStore.getState().workspaces[0];
  act(() => pushSnapshot(snap({ settings: { enabled: false, autoStart: false }, service: { state: 'disabled', ownership: null }, assistants: [], surfaces: [] })));
  await waitFor(() => expect(surfaceOf(FRED)).toBeNull());
  expect(useAssistantSurfaceStore.getState().byId).toEqual({});
  await flush();
  expect(useWorkspaceStore.getState().workspaces[0]).toBe(workspaceBefore);
  expect(screen.getByRole('group', { name: 'New terminal' })).toBeInTheDocument();
});

it('an open popover or dialog hides the active Assistant native Browser view like it does for a workspace', async () => {
  render(<><Header /><WorkspaceHost /></>);
  await selectFred();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
  expect(useAssistantSurfaceStore.getState().byId[FRED]?.browserOverlayCount).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await waitFor(() => expect(useAssistantSurfaceStore.getState().byId[FRED]?.browserOverlayCount).toBeGreaterThan(0));
  expect(within(document.body).getByRole('dialog', { name: 'Settings' })).toBeTruthy();
});
