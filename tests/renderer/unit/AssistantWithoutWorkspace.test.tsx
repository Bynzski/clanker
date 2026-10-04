// @vitest-environment jsdom
/**
 * Issue #93: an Assistant is a destination of its own, so the app shell must not require a Workspace.
 * These tests use the real stores and the real App/Host/Header/navigation components; only xterm and the
 * heavyweight Workspace layout are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { AssistantSnapshot } from '../../../src/shared/types/assistants';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { useAssistantsStore } from '../../../src/renderer/store/assistantsStore';
import { useAssistantSurfaceStore } from '../../../src/renderer/store/assistantSurfaceStore';
import { assistantBrowserOwnerId } from '../../../src/shared/browserOwner';

const xterms: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
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

import { closeWorkspaceWithCleanup } from '../../../src/renderer/lib/workspaceClose';
import App from '../../../src/renderer/App';
import Header from '../../../src/renderer/components/Header';
import WorkspaceHost from '../../../src/renderer/components/WorkspaceHost';
import WorkspaceTabs from '../../../src/renderer/components/WorkspaceTabs';
import WorkspaceRail from '../../../src/renderer/components/WorkspaceRail';

const FRED = 'hermes:fred';
const FRED_OWNER = assistantBrowserOwnerId(FRED);
const snap = (over: Partial<AssistantSnapshot> = {}): AssistantSnapshot => ({
  available: true, settings: { enabled: true, autoStart: false }, service: { state: 'connected', ownership: 'external' },
  assistants: [{ id: FRED, displayName: 'Fred' }], surfaces: [], ...over,
});
let pushSnapshot: (snapshot: AssistantSnapshot) => void = () => undefined;

const surfaceOf = (id: string) => document.querySelector(`[data-assistant-id="${id}"]`);
const gate = () => document.querySelector('.workspace-gate');
const launchWorkspaceFromGate = async (scope: HTMLElement | Document = document) => {
  const add = await within(scope as HTMLElement).findByRole('button', { name: 'Add plain terminal' });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  const launch = within(scope as HTMLElement).getByRole('button', { name: 'Launch Workspace' });
  await waitFor(() => expect(launch).toBeEnabled());
  fireEvent.click(launch);
};
const openFredFromLauncher = async () => {
  const launcher = await screen.findByRole('region', { name: 'Assistants' });
  fireEvent.click(within(launcher).getByRole('button', { name: /Fred/ }));
  await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
};
const workspaceStateUntouched = () => {
  const state = useWorkspaceStore.getState();
  expect(state.workspaces).toEqual([]);
  expect(state.activeWorkspaceId).toBeNull();
  expect(window.electronAPI.registerOpenWorkspace).not.toHaveBeenCalled();
  expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
};

beforeEach(() => {
  const storage: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
  });
  installElectronApiMock();
  xterms.length = 0;
  const api = window.electronAPI;
  vi.mocked(api.getLastWorkspace).mockResolvedValue('/projects/b');
  vi.mocked(api.getBaseDirectory).mockResolvedValue('/projects/');
  vi.mocked(api.getHarnessOptions).mockResolvedValue({ codex: true, claude: false, opencode: false, pi: false } as never);
  vi.mocked(api.getHarnessDefaults).mockResolvedValue({
    codex: { model: '', favorites: [], flags: '', visible: true },
    claude: { model: '', favorites: [], flags: '', visible: true },
    opencode: { model: '', favorites: [], flags: '', visible: true },
    pi: { model: '', favorites: [], flags: '', visible: true },
  } as never);
  vi.mocked(api.getAssistants).mockResolvedValue(snap());
  vi.mocked(api.onAssistantsChanged).mockImplementation((callback) => { pushSnapshot = callback; return () => undefined; });
  useAssistantsStore.getState().reset();
  useAssistantNavStore.setState({ activeAssistantId: null, openedAssistantIds: [] });
  useAssistantSurfaceStore.setState({ byId: {} });
  useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 280, resolved: true });
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('startup launcher', () => {
  it('Hermes unavailable: the ordinary launcher with no Assistants section', async () => {
    vi.mocked(window.electronAPI.getAssistants).mockResolvedValue(snap({ available: false, assistants: [], service: { state: 'disabled', ownership: null } }));
    render(<App />);
    await waitFor(() => expect(gate()).not.toBeNull());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('region', { name: 'Assistants' })).toBeNull();
  });

  it('Assistants disabled: the ordinary launcher with no Assistants section', async () => {
    vi.mocked(window.electronAPI.getAssistants).mockResolvedValue(snap({ settings: { enabled: false, autoStart: false }, assistants: [], service: { state: 'disabled', ownership: null } }));
    render(<App />);
    await waitFor(() => expect(gate()).not.toBeNull());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('region', { name: 'Assistants' })).toBeNull();
  });

  it.each([
    ['probing', 'Connecting to Hermes…', false],
    ['starting', 'Starting Hermes service…', false],
    ['offline', 'Hermes service is not running', true],
    ['detected-unusable', 'Hermes service found, but Clanker cannot connect to it', true],
    ['error', 'Hermes service could not be started', true],
  ] as const)('%s: shows the status (Retry %s) and no launchable roster', async (state, text, retry) => {
    // A disconnected service reports an empty authoritative roster.
    vi.mocked(window.electronAPI.getAssistants).mockResolvedValue(snap({ service: { state, ownership: null }, assistants: [] }));
    render(<App />);
    const launcher = await screen.findByRole('region', { name: 'Assistants' });
    expect(within(launcher).getByText(text)).toBeInTheDocument();
    expect(within(launcher).queryByRole('button', { name: /Fred/ })).toBeNull();
    expect(Boolean(within(launcher).queryByRole('button', { name: 'Retry' }))).toBe(retry);
  });

  it('does not offer a previously opened Assistant as launchable while the service is offline', async () => {
    useAssistantNavStore.setState({ activeAssistantId: null, openedAssistantIds: [FRED] });
    useAssistantsStore.setState({ knownAssistants: { [FRED]: { id: FRED, displayName: 'Fred' } } });
    vi.mocked(window.electronAPI.getAssistants).mockResolvedValue(snap({ service: { state: 'offline', ownership: null }, assistants: [] }));
    render(<App />);
    const launcher = await screen.findByRole('region', { name: 'Assistants' });
    expect(within(launcher).queryByRole('button', { name: /Fred/ })).toBeNull();
  });

  it.each([1, 3, 7])('connected with %i Assistants: one compact launcher chip each, with no status dot or row styling', async (count) => {
    const assistants = Array.from({ length: count }, (_, i) => ({ id: `hermes:bot${i}`, displayName: i === 0 ? 'A very long assistant display name that must stay bounded' : `Bot ${i}`, description: `desc ${i}` }));
    vi.mocked(window.electronAPI.getAssistants).mockResolvedValue(snap({ assistants }));
    render(<App />);
    const launcher = await screen.findByRole('region', { name: 'Assistants' });
    const buttons = await within(launcher).findAllByRole('button');
    expect(buttons).toHaveLength(count);
    for (const button of buttons) {
      expect(button).toHaveClass('assistant-launcher-button');
      expect(button).not.toHaveClass('assistant-row');
    }
    expect(launcher.querySelector('.assistant-dot')).toBeNull();
    expect(buttons[0]).toHaveAccessibleName(/A very long assistant display name that must stay bounded/);
    expect(buttons[0]).toHaveAttribute('title', expect.stringContaining('desc 0'));
    // Each chip opens its own opaque Assistant ID.
    fireEvent.click(buttons[count - 1]);
    expect(useAssistantNavStore.getState().activeAssistantId).toBe(`hermes:bot${count - 1}`);
  });

  it('the sidebar roster keeps its row presentation and status dot', async () => {
    useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a', environmentId: 'local' })], activeWorkspaceId: 'ws-a' });
    render(<App />);
    const roster = await screen.findByRole('region', { name: 'Assistants' });
    const row = await within(roster).findByRole('button', { name: /Fred/ });
    expect(row).toHaveClass('assistant-row');
    expect(row.querySelector('.assistant-dot.live')).not.toBeNull();
  });

  it('connected with no named profiles shows an empty state', async () => {
    vi.mocked(window.electronAPI.getAssistants).mockResolvedValue(snap({ assistants: [] }));
    render(<App />);
    expect(await screen.findByText('No Hermes Assistants found')).toBeInTheDocument();
  });

  it('connected: lists Fred; clicking Fred enters the normal shell with no Workspace, registration, spawn or checkout context', async () => {
    render(<App />);
    expect(gate()).not.toBeNull();
    await openFredFromLauncher();
    expect(gate()).toBeNull();
    expect(screen.getByRole('button', { name: 'Toggle browser panel' })).toBeInTheDocument(); // Header is mounted: normal shell
    expect(useAssistantNavStore.getState().activeAssistantId).toBe(FRED);
    workspaceStateUntouched();
    await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1));
  });

  it('the normal New Workspace modal does not contain the startup Assistants section', async () => {
    useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a', environmentId: 'local' })], activeWorkspaceId: 'ws-a' });
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open Workspace' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: /New Workspace/ });
    expect(within(dialog).queryByRole('region', { name: 'Assistants' })).toBeNull();
  });

  it('Assistant buttons are disabled while a Workspace launch is in flight', async () => {
    let finish: (value: { success: boolean; error?: string }) => void = () => undefined;
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockImplementation(() => new Promise((resolve) => { finish = resolve as never; }));
    vi.mocked(window.electronAPI.getLastWorkspace).mockResolvedValue('/projects/b');
    render(<App />);
    const launcher = await screen.findByRole('region', { name: 'Assistants' });
    await launchWorkspaceFromGate();
    await waitFor(() => expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalled());
    const fred = within(launcher).getByRole('button', { name: /Fred/ });
    expect(fred).toBeDisabled();
    fireEvent.click(fred);
    expect(useAssistantNavStore.getState().activeAssistantId).toBeNull();
    await act(async () => { finish({ success: false, error: 'nope' }); });
    await waitFor(() => expect(within(launcher).getByRole('button', { name: /Fred/ })).toBeEnabled());
  });
});

describe('zero-workspace Assistant shell', () => {
  const enterFred = async () => {
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<App />);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
  };

  it('with no Assistant, zero workspaces still renders the fullscreen launcher', async () => {
    render(<App />);
    expect(gate()).not.toBeNull();
    expect(screen.queryByTestId('workspace-host')).toBeNull();
  });

  it('WorkspaceHost mounts Fred with an empty workspace list and synthesizes nothing', async () => {
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<WorkspaceHost />);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
    expect(surfaceOf(FRED)).not.toHaveClass('parked');
    await waitFor(() => expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll('.workspace-surface')).toHaveLength(0);
    workspaceStateUntouched();
  });

  it('WorkspaceHost renders no Assistant or workspace surfaces for zero workspaces and no Assistant', () => {
    render(<WorkspaceHost />);
    expect(screen.queryByTestId('workspace-host')).toBeNull();
  });

  it('Header exposes Assistant capabilities only', async () => {
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<><Header /><WorkspaceHost /></>);
    expect(await screen.findByRole('button', { name: 'Toggle browser panel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'New terminal' })).toBeNull();
    for (const name of ['Toggle notes panel', 'Toggle File Explorer', 'Undo layout change', 'Fit all panes', 'Workspace Launch Recipes', 'Chat history', 'Usage']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByTitle(/Git/)).toBeNull();
    expect(screen.queryByRole('button', { name: /isolated agent/i })).toBeNull();
  });

  it('expanded sidebar: empty WORKSPACES with Open Workspace, ASSISTANTS with Fred, and no Files', async () => {
    await enterFred();
    const sidebar = screen.getByTestId('workspace-sidebar');
    expect(within(sidebar).getByRole('button', { name: 'Open Workspace' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('region', { name: 'Assistants' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: /Fred/ })).toBeInTheDocument();
    expect(sidebar.querySelectorAll('.ws-nav-row, [data-workspace-id]')).toHaveLength(0);
    expect(screen.queryByTestId('files-section')).toBeNull();
  });

  it('collapsed rail: Assistant icon and Open Workspace, never Show Files; plus opens the launcher', async () => {
    useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 40 });
    await enterFred();
    const rail = screen.getByRole('navigation', { name: 'Workspaces' });
    expect(within(rail).getByRole('button', { name: /Fred/ })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Show Files' })).toBeNull();
    fireEvent.click(within(rail).getByRole('button', { name: 'Open Workspace' }));
    expect(await screen.findByRole('dialog', { name: /New Workspace/ })).toBeInTheDocument();
    expect(useAssistantNavStore.getState().activeAssistantId).toBe(FRED); // opening the modal alone does not leave Fred
  });

  it('rail with a parked real workspace and active Fred offers no Show Files and mutates nothing', () => {
    const workspace = createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a', environmentId: 'local' });
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: 'ws-a' });
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<WorkspaceRail onExpand={() => undefined} onOpenWorkspace={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Show Files' })).toBeNull();
    expect(useWorkspaceStore.getState().workspaces[0]).toBe(workspace);
  });

  it('rail with an active workspace still offers Show Files', () => {
    useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a', environmentId: 'local' })], activeWorkspaceId: 'ws-a' });
    render(<WorkspaceRail onExpand={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Show Files' })).toBeInTheDocument();
  });

  it('tabs mode: no fake tab, but Open Workspace remains and invokes the callback', () => {
    const onOpenWorkspace = vi.fn();
    render(<WorkspaceTabs onOpenWorkspace={onOpenWorkspace} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it('tabs mode shell: Fred owns the app and the title bar still offers Open Workspace', async () => {
    useWorkspaceNavigationStore.setState({ mode: 'tabs' });
    await enterFred();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Open Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle browser panel' })).toBeInTheDocument();
    workspaceStateUntouched();
  });
});

describe('workspace keyboard commands never reach a parked or missing workspace while Fred is active', () => {
  // Real default bindings: Fit All = Ctrl+Alt+F, Toggle Explorer = Ctrl+B, Save = Ctrl+S (editor context only).
  const fitAll = () => fireEvent.keyDown(window, { key: 'f', code: 'KeyF', ctrlKey: true, altKey: true });
  const toggleExplorer = () => fireEvent.keyDown(window, { key: 'b', code: 'KeyB', ctrlKey: true });
  const save = () => {
    const editor = document.createElement('div');
    editor.setAttribute('data-keybinding-context', 'editor');
    document.body.appendChild(editor);
    fireEvent.keyDown(editor, { key: 's', code: 'KeyS', ctrlKey: true });
    editor.remove();
  };
  // Installed BEFORE App renders: App captures fitAllPanes from the store at render time.
  const spies = () => {
    const fitAllPanes = vi.fn();
    const setExplorerVisible = vi.fn();
    const saveEditorFile = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ fitAllPanes, setExplorerVisible, saveEditorFile } as never);
    return { fitAllPanes, setExplorerVisible, saveEditorFile };
  };
  const parkedWorkspace = () => createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a', environmentId: 'local', activeEditorTabId: 'tab-1' });

  it('control: with a Workspace active the same events invoke the workspace actions (the bindings really resolve)', async () => {
    const mocks = spies();
    useWorkspaceStore.setState({ workspaces: [parkedWorkspace()], activeWorkspaceId: 'ws-a' });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle browser panel' })).toBeInTheDocument());
    fitAll(); toggleExplorer(); save();
    expect(mocks.fitAllPanes).toHaveBeenCalledTimes(1);
    expect(mocks.setExplorerVisible).toHaveBeenCalledTimes(1);
    expect(mocks.saveEditorFile).toHaveBeenCalledWith('tab-1', 'ws-a');
  });

  it('active Fred over a parked Workspace: Fit All, Explorer and Save invoke nothing', async () => {
    const mocks = spies();
    useWorkspaceStore.setState({ workspaces: [parkedWorkspace()], activeWorkspaceId: 'ws-a' });
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<App />);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
    fitAll(); toggleExplorer(); save();
    expect(mocks.fitAllPanes).not.toHaveBeenCalled();
    expect(mocks.setExplorerVisible).not.toHaveBeenCalled();
    expect(mocks.saveEditorFile).not.toHaveBeenCalled();
  });

  it('active Fred with zero workspaces: nothing is invoked and no workspace appears', async () => {
    const mocks = spies();
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<App />);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
    fitAll(); toggleExplorer(); save();
    expect(mocks.fitAllPanes).not.toHaveBeenCalled();
    expect(mocks.setExplorerVisible).not.toHaveBeenCalled();
    expect(mocks.saveEditorFile).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
  });
});

describe('closing the last Workspace', () => {
  const closeLast = async () => { await act(async () => { await closeWorkspaceWithCleanup('ws-a'); }); };
  const oneWorkspace = () => useWorkspaceStore.setState({
    workspaces: [createWorkspaceFixture({ id: 'ws-a', workspacePath: '/projects/a', environmentId: 'local' })], activeWorkspaceId: 'ws-a',
  });

  it('Fred ACTIVE: Fred stays the destination; shell, xterm and Browser state survive untouched', async () => {
    oneWorkspace();
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<App />);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
    await waitFor(() => expect(xterms).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
    await waitFor(() => expect(useAssistantSurfaceStore.getState().byId[FRED]?.tabs).toHaveLength(1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    const browserBefore = structuredClone(useAssistantSurfaceStore.getState().byId[FRED]);
    const surfaceBefore = surfaceOf(FRED);

    await closeLast();

    const workspaces = useWorkspaceStore.getState();
    expect(workspaces.workspaces).toHaveLength(0);
    expect(workspaces.activeWorkspaceId).toBeNull();
    expect(useAssistantNavStore.getState().activeAssistantId).toBe(FRED);
    expect(gate()).toBeNull();
    expect(surfaceOf(FRED)).toBe(surfaceBefore); // same DOM node: no remount
    expect(xterms).toHaveLength(1);
    expect(xterms[0].dispose).not.toHaveBeenCalled();
    expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
    expect(useAssistantSurfaceStore.getState().byId[FRED]).toEqual(browserBefore);
  });

  it('Fred PARKED behind an active Workspace: closing the last Workspace leaves no active destination, so the launcher returns', async () => {
    oneWorkspace();
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<App />);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
    act(() => useWorkspaceStore.getState().selectWorkspace('ws-a'));
    expect(useAssistantNavStore.getState().activeAssistantId).toBeNull(); // selecting a Workspace parks Fred
    await waitFor(() => expect(surfaceOf(FRED)).toHaveClass('parked'));

    await closeLast();

    // No remembered-destination policy exists, so with no active destination the launcher is shown.
    expect(useAssistantNavStore.getState().activeAssistantId).toBeNull();
    expect(useAssistantNavStore.getState().openedAssistantIds).toEqual([FRED]);
    await waitFor(() => expect(gate()).not.toBeNull());
    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
  });
});

describe('Assistant Browser with no Workspace', () => {
  it('opens under the Assistant owner only, preserves its state across close/reopen, and fabricates no workspace owner', async () => {
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<><Header /><WorkspaceHost /></>);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
    const tab = await waitFor(() => {
      const ui = useAssistantSurfaceStore.getState().byId[FRED];
      expect(ui?.tabs).toHaveLength(1);
      return ui!.tabs[0];
    });
    await waitFor(() => expect(window.electronAPI.browserActivate).toHaveBeenCalledWith(FRED_OWNER, tab.id));
    // Every Browser call went to Fred's owner; none to any workspace id.
    const browserCalls = Object.entries(window.electronAPI)
      .filter(([name, fn]) => /^browser(Create|Activate|Switch|Set|Navigate|Show|Hide)/.test(name) && vi.isMockFunction(fn))
      .flatMap(([name, fn]) => (fn as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => ({ name, owner: call[0] })));
    expect(browserCalls.length).toBeGreaterThan(0);
    for (const call of browserCalls) expect(call.owner, call.name).toBe(FRED_OWNER);
    act(() => { useAssistantSurfaceStore.getState().updateTab(FRED, tab.id, { url: 'https://fred.example/' }); });
    fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
    expect(useAssistantSurfaceStore.getState().byId[FRED]?.tabs[0].url).toBe('https://fred.example/');
    expect(useAssistantSurfaceStore.getState().byId[FRED]?.tabs).toHaveLength(1);
    workspaceStateUntouched();
  });
});

describe('transitions while Fred is active', () => {
  const addWorkspace = (id: string) => {
    act(() => useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({ id, workspacePath: `/projects/${id}`, environmentId: 'local' })));
  };

  it('Fred -> successful Workspace -> Fred keeps the same Bot Chat and Browser state', async () => {
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<><Header /><WorkspaceHost /></>);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
    await waitFor(() => expect(xterms).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
    const tab = useAssistantSurfaceStore.getState().byId[FRED]!.tabs[0];
    act(() => { useAssistantSurfaceStore.getState().updateTab(FRED, tab.id, { url: 'https://fred.example/' }); });

    addWorkspace('ws-new');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-new');
    expect(useAssistantNavStore.getState().activeAssistantId).toBeNull();
    expect(useAssistantNavStore.getState().openedAssistantIds).toEqual([FRED]);
    expect(surfaceOf(FRED)).toHaveClass('parked');
    await waitFor(() => expect(window.electronAPI.browserHide).toHaveBeenCalledWith(FRED_OWNER));
    expect(xterms[0].dispose).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: /Fred/ }));
    expect(surfaceOf(FRED)).not.toHaveClass('parked');
    expect(xterms).toHaveLength(1);
    expect(window.electronAPI.openAssistant).toHaveBeenCalledTimes(1);
    expect(useAssistantSurfaceStore.getState().byId[FRED]?.tabs[0].url).toBe('https://fred.example/');
  });

  it('a failed Workspace open leaves Fred active, mounted and untouched', async () => {
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockResolvedValue({ success: false, error: 'denied' } as never);
    vi.mocked(window.electronAPI.getLastWorkspace).mockResolvedValue('/projects/b');
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<App />);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
    await waitFor(() => expect(xterms).toHaveLength(1));
    const clearActive = vi.spyOn(useAssistantNavStore.getState(), 'clearActive');
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Workspace' })[0]);
    const dialog = await screen.findByRole('dialog', { name: /New Workspace/ });
    await launchWorkspaceFromGate(dialog);
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(useAssistantNavStore.getState().activeAssistantId).toBe(FRED);
    expect(clearActive).not.toHaveBeenCalled();
    expect(surfaceOf(FRED)).not.toBeNull();
    expect(xterms).toHaveLength(1);
    expect(xterms[0].dispose).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
  });

  it('a transient offline service keeps Fred in the shell with the surface mounted', async () => {
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<App />);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
    await waitFor(() => expect(xterms).toHaveLength(1));
    act(() => pushSnapshot(snap({ service: { state: 'offline', ownership: null }, assistants: [] })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(gate()).toBeNull();
    expect(surfaceOf(FRED)).not.toBeNull();
    expect(useAssistantNavStore.getState().activeAssistantId).toBe(FRED);
    expect(xterms[0].dispose).not.toHaveBeenCalled();
  });

  it('disabling Assistants with zero workspaces clears Assistant state and returns the launcher', async () => {
    useAssistantNavStore.getState().openAssistantSurface(FRED);
    render(<App />);
    await waitFor(() => expect(surfaceOf(FRED)).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Toggle browser panel' }));
    expect(useAssistantSurfaceStore.getState().byId[FRED]?.browserVisible).toBe(true);
    act(() => pushSnapshot(snap({ settings: { enabled: false, autoStart: false }, service: { state: 'disabled', ownership: null }, assistants: [], surfaces: [] })));
    await waitFor(() => expect(gate()).not.toBeNull());
    expect(useAssistantNavStore.getState()).toMatchObject({ activeAssistantId: null, openedAssistantIds: [] });
    expect(useAssistantSurfaceStore.getState().byId).toEqual({});
    expect(screen.queryByRole('region', { name: 'Assistants' })).toBeNull();
  });
});
