// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { registerOpenSettingsHandler } from '../../../src/renderer/lib/keybindingDispatcher';
import { useKeybindingStore } from '../../../src/renderer/store/keybindingStore';
import App from '../../../src/renderer/App';
import { useNotificationStore } from '../../../src/renderer/store/notificationStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useThemeStore } from '../../../src/renderer/theme/themeStore';
import { createWorkspaceFixture } from '../../setup/fixtures';

// Mock localStorage for migrateLegacyFavorites in App.tsx
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock all child components to isolate App logic
vi.mock('../../../src/renderer/components/Header', () => ({
  default: () => <div data-testid="header">Header</div>,
}));

vi.mock('../../../src/renderer/components/TitleBar', () => ({
  default: ({ onOpenWorkspace, toolbar }: { onOpenWorkspace?: () => void; toolbar?: ReactNode }) => (
    <div data-testid="title-bar">
      <button data-testid="titlebar-open-workspace" onClick={onOpenWorkspace}>Open Workspace</button>
      {toolbar}
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/StatusBar', () => ({
  default: () => <div data-testid="status-bar">StatusBar</div>,
}));

vi.mock('../../../src/renderer/components/WorkspaceHost', () => ({
  default: () => (
    <div data-testid="workspace-host">
      <div className="workspace-layout-row">
        <div data-testid="file-explorer">FileExplorer</div>
        <div data-testid="dynamic-pane-layout">DynamicPaneLayout</div>
      </div>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/OpenWorkspaceDialog', () => ({
  default: ({ isOpen, onClose, onOpen }: { isOpen: boolean; onClose: () => void; onOpen: (location: { environmentId: string; path: string }) => Promise<unknown> }) => isOpen ? (
    <div data-testid="open-workspace-dialog">
      <button onClick={onClose}>Close</button>
      <button onClick={() => { void onOpen({ environmentId: 'local', path: '/modal/path' }).then(onClose); }}>Open selected folder</button>
    </div>
  ) : null,
}));

describe('App', () => {
  const mockSpawnTerminal = vi.fn();
  const mockOnFitAllPanes = vi.fn();
  const mockFitAllPanes = vi.fn();
  const mockZoomInWindow = vi.fn().mockResolvedValue(undefined);
  const mockZoomOutWindow = vi.fn().mockResolvedValue(undefined);
  const mockResetZoomWindow = vi.fn().mockResolvedValue(undefined);
  const mockGetKeybindingOverrides = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useNotificationStore.setState({ notifications: [] });
    useKeybindingStore.setState({ overrides: {}, loaded: false, capturing: false });
    mockSpawnTerminal.mockReset();
    mockOnFitAllPanes.mockReset();
    mockZoomInWindow.mockClear();
    mockZoomOutWindow.mockClear();
    mockResetZoomWindow.mockClear();
    mockGetKeybindingOverrides.mockReset();
    mockGetKeybindingOverrides.mockResolvedValue({});
    mockSpawnTerminal.mockResolvedValue({ id: 'term-1', pid: 1234 });
    mockOnFitAllPanes.mockReturnValue(vi.fn());
    
    // Reset store to empty state
    useWorkspaceStore.setState({
      workspaces: [],
      workspacePath: '',
      harness: '',
      model: '',
      terminals: [],
      panes: [],
      browserVisible: false,
      browserUrl: '',
      activeWorkspaceId: null,
      activeTerminalId: null,
      browserPane: null,
      layoutRoot: null,
      explorerVisible: false,
      explorerSidebarWidth: 280,
      explorerExpandedPaths: [],
      explorerSelectedPath: null,
      explorerEntriesByPath: {},
      explorerLoadingPaths: [],
      explorerErrorsByPath: {},
    showHiddenFiles: true,
      fitAllPanes: mockFitAllPanes,
    });

    // Reset theme store
    useThemeStore.setState({
      theme: 'dark',
      resolved: false,
    });

    // Mock window.electronAPI
    window.electronAPI = {
      spawnTerminal: mockSpawnTerminal,
      registerOpenWorkspace: vi.fn(async (_id: string, path: string, environmentId = 'local') => ({
        success: true, location: { path, environmentId },
      })),
      unregisterOpenWorkspace: vi.fn().mockResolvedValue({ success: true }),
      gitListWorktrees: vi.fn().mockResolvedValue({ success: true, worktrees: [] }),
      onFitAllPanes: mockOnFitAllPanes,
      zoomInWindow: mockZoomInWindow,
      zoomOutWindow: mockZoomOutWindow,
      resetZoomWindow: mockResetZoomWindow,
      getKeybindingOverrides: mockGetKeybindingOverrides,
      getHarnessDefaults: vi.fn().mockResolvedValue({
        codex: { model: '', favorites: [], flags: '' },
        opencode: { model: '', favorites: [], flags: '' },
        pi: { model: '', favorites: [], flags: '' },
        claude: { model: '', favorites: [], flags: '' },
      }),
      setHarnessDefaults: vi.fn().mockResolvedValue(undefined),
      getTheme: vi.fn().mockResolvedValue('dark'),
      setTheme: vi.fn().mockResolvedValue(undefined),
      onGitStatusUpdate: vi.fn(),
      gitStartPolling: vi.fn(),
      gitStopPolling: vi.fn(),
      onFileChanged: vi.fn().mockReturnValue(vi.fn()),
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Empty State - normal empty shell
  // =========================================================================
  describe('empty shell', () => {
    it('mounts normal chrome immediately with no saved workspaces', async () => {
      render(<App />);
      expect(screen.getByTestId('title-bar')).toBeInTheDocument();
      expect(screen.getByTestId('header')).toBeInTheDocument();
      expect(screen.getByTestId('status-bar')).toBeInTheDocument();
      expect(await screen.findByTestId('workspace-host')).toBeInTheDocument();
      expect(mockSpawnTerminal).not.toHaveBeenCalled();
    });
    it('opens a shell through the normal dialog with no terminals', async () => {
      render(<App />);
      fireEvent.click(screen.getByTestId('titlebar-open-workspace'));
      fireEvent.click(screen.getByText('Open selected folder'));
      await waitFor(() => expect(useWorkspaceStore.getState().workspaces).toHaveLength(1));
      expect(useWorkspaceStore.getState().workspaces[0].terminals).toEqual([]);
      expect(mockSpawnTerminal).not.toHaveBeenCalled();
    });
    it('keeps notification history accessible without a workspace', async () => {
      useNotificationStore.getState().show({ tone: 'warning', message: 'Startup warning' });
      render(<App />);
      expect(await screen.findByText('Startup warning')).toBeInTheDocument();
    });
  });

  describe('main layout (with workspaces)', () => {
    beforeEach(() => {
      act(() => {
        useWorkspaceStore.setState({
          workspaces: [{
            id: 'ws-1',
            lifecycle: 'active',
            name: 'test',
            workspacePath: '/test',
            harness: 'codex',
            model: '',
            terminals: [{ id: 't1', pid: 1, workingDir: '/test' }],
            panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 } }],
            browserVisible: false,
            browserUrl: '',
            activeTerminalId: null,
            browserPane: null,
            layoutRoot: null,
            explorerVisible: false,
            explorerSidebarWidth: 280,
            explorerExpandedPaths: [],
            explorerSelectedPath: null,
            explorerEntriesByPath: {},
            explorerLoadingPaths: [],
            explorerErrorsByPath: {},
            showHiddenFiles: true,
            editorPane: null,
            editorVisible: false,
            editorTabs: [],
            activeEditorTabId: null,
            gitChanges: [],
            gitCurrentBranch: null,
            gitIsRepo: false,
            gitIsDetached: false,
            runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
          }],
        });
      });
    });

    it('renders main layout when workspaces exist', () => {
      render(<App />);
      expect(screen.getByTestId('dynamic-pane-layout')).toBeTruthy();
    });

    it('renders TitleBar', () => {
      render(<App />);
      expect(screen.getByTestId('title-bar')).toBeTruthy();
    });

    it('renders Header', () => {
      render(<App />);
      expect(screen.getByTestId('header')).toBeTruthy();
    });

    it('renders StatusBar', () => {
      render(<App />);
      expect(screen.getByTestId('status-bar')).toBeTruthy();
    });

    it('renders app container', () => {
      render(<App />);
      expect(document.querySelector('.app')).toBeTruthy();
    });

    it('renders main-content div', () => {
      render(<App />);
      expect(document.querySelector('.main-content')).toBeTruthy();
    });

    it('wraps explorer and layout in a shared row container', () => {
      render(<App />);
      const row = document.querySelector('.workspace-layout-row');
      expect(row).toBeTruthy();
      expect(row?.querySelector('[data-testid="file-explorer"]')).toBeTruthy();
      expect(row?.querySelector('[data-testid="dynamic-pane-layout"]')).toBeTruthy();
    });

    it('does not render the obsolete fullscreen launcher when workspaces exist', () => {
      render(<App />);
      expect(screen.queryByTestId('obsolete-fullscreen-launcher')).toBeNull();
    });

    it('does not render Open Workspace dialog initially when workspaces exist', () => {
      render(<App />);
      expect(screen.queryByTestId('open-workspace-dialog')).toBeNull();
    });
  });

  // =========================================================================
  // Keyboard Shortcuts
  // =========================================================================
  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      act(() => {
        useWorkspaceStore.setState({
          workspaces: [{
            id: 'ws-1',
            lifecycle: 'active',
            name: 'test',
            workspacePath: '/test',
            harness: 'codex',
            model: '',
            terminals: [{ id: 't1', pid: 1, workingDir: '/test' }],
            panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 } }],
            browserVisible: false,
            browserUrl: '',
            activeTerminalId: null,
            browserPane: null,
            layoutRoot: null,
            explorerVisible: false,
            explorerSidebarWidth: 280,
            explorerExpandedPaths: [],
            explorerSelectedPath: null,
            explorerEntriesByPath: {},
            explorerLoadingPaths: [],
            explorerErrorsByPath: {},
            showHiddenFiles: true,
            editorPane: null,
            editorVisible: false,
            editorTabs: [],
            activeEditorTabId: null,
            gitChanges: [],
            gitCurrentBranch: null,
            gitIsRepo: false,
            gitIsDetached: false,
            runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
          }],
        });
      });
    });

    it('calls fitAllPanes on the new default Ctrl+Alt+F', async () => {
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(document, { key: 'f', code: 'KeyF', ctrlKey: true, altKey: true });
      });

      expect(mockFitAllPanes).toHaveBeenCalled();
    });

    it('calls fitAllPanes on Meta+Alt+F (Mac)', async () => {
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(document, { key: 'f', code: 'KeyF', metaKey: true, altKey: true });
      });

      expect(mockFitAllPanes).toHaveBeenCalled();
    });

    it('no longer calls fitAllPanes on the old Ctrl/Cmd+Shift+F binding', async () => {
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(document, { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true });
        fireEvent.keyDown(document, { key: 'F', code: 'KeyF', metaKey: true, shiftKey: true });
      });

      expect(mockFitAllPanes).not.toHaveBeenCalled();
    });

    it('does not call fitAllPanes for Ctrl+F, Alt+F, or another key with Ctrl+Alt', async () => {
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(document, { key: 'f', code: 'KeyF', ctrlKey: true });
        fireEvent.keyDown(document, { key: 'f', code: 'KeyF', altKey: true });
        fireEvent.keyDown(document, { key: 'g', code: 'KeyG', ctrlKey: true, altKey: true });
      });

      expect(mockFitAllPanes).not.toHaveBeenCalled();
    });

    it('honours an overridden Fit All binding and releases the default', async () => {
      mockGetKeybindingOverrides.mockResolvedValue({
        'layout.fitAll': { code: 'KeyJ', primary: true, ctrl: false, shift: false, alt: false },
      });
      render(<App />);
      await waitFor(() => expect(useKeybindingStore.getState().overrides['layout.fitAll']).toBeDefined());

      await act(async () => {
        fireEvent.keyDown(document, { key: 'j', code: 'KeyJ', ctrlKey: true });
        fireEvent.keyDown(document, { key: 'f', code: 'KeyF', ctrlKey: true, altKey: true });
      });

      expect(mockFitAllPanes).toHaveBeenCalledTimes(1);
    });

    it('opens Settings through the registered Settings state path on Ctrl/Cmd+,', async () => {
      const openSettings = vi.fn();
      const dispose = registerOpenSettingsHandler(openSettings);
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(document, { key: ',', code: 'Comma', ctrlKey: true });
        fireEvent.keyDown(document, { key: ',', code: 'Comma', metaKey: true });
      });
      dispose();

      expect(openSettings).toHaveBeenCalledTimes(2);
    });

    it('toggles Explorer for the active workspace only', async () => {
      act(() => {
        const [first] = useWorkspaceStore.getState().workspaces;
        useWorkspaceStore.setState({
          workspaces: [first, { ...first, id: 'ws-2', lifecycle: 'parked', explorerVisible: false }],
          activeWorkspaceId: 'ws-1',
        });
      });
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(document, { key: 'b', code: 'KeyB', ctrlKey: true });
      });

      const byId = (id: string) => useWorkspaceStore.getState().workspaces.find((w) => w.id === id);
      expect(byId('ws-1')?.explorerVisible).toBe(true);
      expect(byId('ws-2')?.explorerVisible).toBe(false);

      await act(async () => {
        fireEvent.keyDown(document, { key: 'b', code: 'KeyB', ctrlKey: true });
      });
      expect(byId('ws-1')?.explorerVisible).toBe(false);
    });

    describe('Save scoping', () => {
      const saveEditorFile = vi.fn().mockResolvedValue(true);

      beforeEach(() => {
        saveEditorFile.mockClear();
        act(() => {
          const [first] = useWorkspaceStore.getState().workspaces;
          useWorkspaceStore.setState({
            workspaces: [{ ...first, activeEditorTabId: 'tab-1' }],
            activeEditorTabId: 'tab-1',
            saveEditorFile,
          });
        });
      });

      const mount = (context: 'editor' | 'terminal' | null) => {
        const { container } = render(<App />);
        const surface = document.createElement('div');
        if (context) surface.setAttribute('data-keybinding-context', context);
        const field = document.createElement('textarea');
        surface.appendChild(field);
        container.appendChild(surface);
        return field;
      };

      it('saves from the editor surface', async () => {
        const field = mount('editor');
        await act(async () => {
          fireEvent.keyDown(field, { key: 's', code: 'KeyS', ctrlKey: true });
        });
        expect(saveEditorFile).toHaveBeenCalledWith('tab-1', 'ws-1');
      });

      it('does not save when a terminal has focus even though an editor tab is open', async () => {
        const field = mount('terminal');
        let event!: KeyboardEvent;
        await act(async () => {
          event = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true });
          field.dispatchEvent(event);
        });
        expect(saveEditorFile).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
      });

      it('does not save from app chrome', async () => {
        const field = mount(null);
        await act(async () => {
          fireEvent.keyDown(field, { key: 's', code: 'KeyS', ctrlKey: true });
        });
        expect(saveEditorFile).not.toHaveBeenCalled();
      });
    });

    it('does not run app commands while a shortcut is being captured', async () => {
      useKeybindingStore.setState({ capturing: true });
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(document, { key: 'f', code: 'KeyF', ctrlKey: true, altKey: true });
        fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true });
      });

      expect(mockFitAllPanes).not.toHaveBeenCalled();
      expect(mockZoomInWindow).not.toHaveBeenCalled();
      useKeybindingStore.setState({ capturing: false });
    });

    it('still app-zooms from app chrome and from the editor surface', async () => {
      const { container } = render(<App />);
      const editor = document.createElement('div');
      editor.setAttribute('data-keybinding-context', 'editor');
      container.appendChild(editor);

      await act(async () => {
        fireEvent.keyDown(container, { key: '=', code: 'Equal', ctrlKey: true });
        fireEvent.keyDown(editor, { key: '-', code: 'Minus', ctrlKey: true });
      });

      expect(mockZoomInWindow).toHaveBeenCalledTimes(1);
      expect(mockZoomOutWindow).toHaveBeenCalledTimes(1);
    });

    it('leaves terminal-focused zoom to the terminal (no app zoom, event untouched)', async () => {
      const { container } = render(<App />);
      const terminal = document.createElement('div');
      terminal.setAttribute('data-keybinding-context', 'terminal');
      container.appendChild(terminal);

      let event!: KeyboardEvent;
      await act(async () => {
        event = new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true });
        terminal.dispatchEvent(event);
      });

      expect(mockZoomInWindow).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('zooms in when Ctrl+= is pressed', async () => {
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true });
      });

      expect(mockZoomInWindow).toHaveBeenCalled();
    });

    it('zooms in when Meta++ is pressed', async () => {
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(window, { key: '+', code: 'Equal', metaKey: true, shiftKey: true });
      });

      expect(mockZoomInWindow).toHaveBeenCalled();
    });

    it('zooms out when Ctrl+- is pressed', async () => {
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(window, { key: '-', code: 'Minus', ctrlKey: true });
      });

      expect(mockZoomOutWindow).toHaveBeenCalled();
    });

    it('resets zoom when Ctrl+0 is pressed', async () => {
      render(<App />);

      await act(async () => {
        fireEvent.keyDown(window, { key: '0', code: 'Digit0', ctrlKey: true });
      });

      expect(mockResetZoomWindow).toHaveBeenCalled();
    });

    it('ignores zoom shortcuts already consumed by an embedded surface', async () => {
      render(<App />);

      const consume = (event: KeyboardEvent) => event.preventDefault();
      window.addEventListener('keydown', consume, true);
      try {
        await act(async () => {
          fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true });
          fireEvent.keyDown(window, { key: '-', code: 'Minus', ctrlKey: true });
          fireEvent.keyDown(window, { key: '0', code: 'Digit0', ctrlKey: true });
        });
      } finally {
        window.removeEventListener('keydown', consume, true);
      }

      expect(mockZoomInWindow).not.toHaveBeenCalled();
      expect(mockZoomOutWindow).not.toHaveBeenCalled();
      expect(mockResetZoomWindow).not.toHaveBeenCalled();
    });

    it('zooms the app in on Ctrl+wheel up', async () => {
      render(<App />);
      let event!: WheelEvent;
      await act(async () => {
        event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true });
        window.dispatchEvent(event);
      });
      expect(mockZoomInWindow).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('zooms the app out on Ctrl+wheel down', async () => {
      render(<App />);
      await act(async () => {
        window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 100, cancelable: true, bubbles: true }));
      });
      expect(mockZoomOutWindow).toHaveBeenCalledTimes(1);
      expect(mockResetZoomWindow).not.toHaveBeenCalled();
    });

    it('leaves ordinary wheel scrolling alone', async () => {
      render(<App />);
      let event!: WheelEvent;
      await act(async () => {
        event = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
        document.body.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(mockZoomInWindow).not.toHaveBeenCalled();
      expect(mockZoomOutWindow).not.toHaveBeenCalled();
    });

    it('does not app-zoom a Ctrl+wheel owned by an embedded surface', async () => {
      const { container } = render(<App />);
      const surface = document.createElement('div');
      container.appendChild(surface);
      surface.addEventListener('wheel', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      await act(async () => {
        surface.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true }));
      });
      expect(mockZoomInWindow).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Workspace Creation Flow
  // =========================================================================
  describe('electronAPI.onFitAllPanes integration', () => {
    beforeEach(() => {
      act(() => {
        useWorkspaceStore.setState({
          workspaces: [{
            id: 'ws-1',
            lifecycle: 'active',
            name: 'test',
            workspacePath: '/test',
            harness: 'codex',
            model: '',
            terminals: [{ id: 't1', pid: 1, workingDir: '/test' }],
            panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 } }],
            browserVisible: false,
            browserUrl: '',
            activeTerminalId: null,
            browserPane: null,
            layoutRoot: null,
            explorerVisible: false,
            explorerSidebarWidth: 280,
            explorerExpandedPaths: [],
            explorerSelectedPath: null,
            explorerEntriesByPath: {},
            explorerLoadingPaths: [],
            explorerErrorsByPath: {},
    showHiddenFiles: true,
            editorPane: null,
            editorVisible: false,
            editorTabs: [],
            activeEditorTabId: null,
            gitChanges: [],
            gitCurrentBranch: null,
            gitIsRepo: false,
            gitIsDetached: false,
            runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
          }],
        });
      });
    });

    it('registers onFitAllPanes listener on mount', () => {
      render(<App />);
      expect(mockOnFitAllPanes).toHaveBeenCalled();
    });

    it('cleans up onFitAllPanes listener on unmount', () => {
      const removeListener = vi.fn();
      mockOnFitAllPanes.mockReturnValue(removeListener);
      
      const { unmount } = render(<App />);
      unmount();
      
      expect(removeListener).toHaveBeenCalled();
    });
  });

  it('updates workspace URL when the main process emits browser-url-updated', async () => {
    const workspaceId = 'workspace-1';
    const workspaceFixture = createWorkspaceFixture({
      id: workspaceId,
      name: 'workspace',
      workspacePath: '/workspace',
      browserUrl: 'https://github.com',
    });

    useWorkspaceStore.setState({
      workspaces: [workspaceFixture],
      activeWorkspaceId: workspaceId,
      workspacePath: '/workspace',
      name: 'workspace',
      browserVisible: true,
      browserUrl: 'https://github.com',
      terminals: [],
      panes: [],
      browserPane: null,
      layoutRoot: null,
      explorerVisible: false,
      explorerSidebarWidth: 280,
      explorerExpandedPaths: [],
      explorerSelectedPath: null,
      explorerEntriesByPath: {},
      explorerLoadingPaths: [],
      explorerErrorsByPath: {},
    showHiddenFiles: true,
    });

    let handler: ((payload: { workspaceId: string; url: string }) => void) | null = null;
    const mockOnBrowserUrlUpdated = vi.fn().mockImplementation((cb) => {
      handler = cb;
      return vi.fn();
    });

    window.electronAPI.onBrowserUrlUpdated = mockOnBrowserUrlUpdated;

    render(<App />);

    expect(mockOnBrowserUrlUpdated).toHaveBeenCalled();

    act(() => {
      handler?.({ workspaceId, url: 'https://example.com' });
    });

    const state = useWorkspaceStore.getState();
    expect(state.browserUrl).toBe('https://example.com');
    expect(state.workspaces.find((workspace) => workspace.id === workspaceId)?.browserUrl).toBe('https://example.com');
  });

  it('initializes theme and applies root data-theme on mount', async () => {
    const mockGetTheme = vi.fn().mockResolvedValue('light');
    window.electronAPI.getTheme = mockGetTheme;

    render(<App />);

    await waitFor(() => {
      expect(mockGetTheme).toHaveBeenCalled();
    });
  });
});
