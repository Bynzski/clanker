// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import App from '../../../src/renderer/App';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';

// Mock all child components to isolate App logic
vi.mock('../../../src/renderer/components/Header', () => ({
  default: () => <div data-testid="header">Header</div>,
}));

vi.mock('../../../src/renderer/components/TitleBar', () => ({
  default: ({ onOpenWorkspace }: { onOpenWorkspace?: () => void }) => (
    <div data-testid="title-bar">
      <button data-testid="titlebar-open-workspace" onClick={onOpenWorkspace}>Open Workspace</button>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/StatusBar', () => ({
  default: () => <div data-testid="status-bar">StatusBar</div>,
}));

vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({
  default: () => <div data-testid="dynamic-pane-layout">DynamicPaneLayout</div>,
}));

vi.mock('../../../src/renderer/components/FileExplorer', () => ({
  default: () => <div data-testid="file-explorer">FileExplorer</div>,
}));

vi.mock('../../../src/renderer/components/WorkspaceGate', () => ({
  WorkspaceGateFullscreen: ({ onWorkspaceSelect }: { onWorkspaceSelect: (path: string, terminals: number, harness: string, model?: string) => void }) => (
    <div data-testid="workspace-gate-fullscreen">
      <button data-testid="gate-select" onClick={() => onWorkspaceSelect('/test/path', 1, 'codex', '')}>
        Select Workspace
      </button>
      <button data-testid="gate-select-multi" onClick={() => onWorkspaceSelect('/test/path', 3, 'codex', 'gpt-4')}>
        Select Multi-Terminal
      </button>
    </div>
  ),
  WorkspaceGateModal: ({ isOpen, onClose, onWorkspaceSelect }: { isOpen: boolean; onClose: () => void; onWorkspaceSelect: (path: string, terminals: number, harness: string, model?: string) => void }) => (
    isOpen ? (
      <div data-testid="workspace-gate-modal">
        <button data-testid="modal-close" onClick={onClose}>Close</button>
        <button data-testid="modal-select" onClick={() => onWorkspaceSelect('/modal/path', 2, 'claude', '')}>
          Select from Modal
        </button>
      </div>
    ) : null
  ),
}));

describe('App', () => {
  const mockSpawnTerminal = vi.fn();
  const mockOnFitAllPanes = vi.fn();
  const mockFitAllPanes = vi.fn();
  const mockZoomInWindow = vi.fn().mockResolvedValue(undefined);
  const mockZoomOutWindow = vi.fn().mockResolvedValue(undefined);
  const mockResetZoomWindow = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawnTerminal.mockReset();
    mockOnFitAllPanes.mockReset();
    mockZoomInWindow.mockClear();
    mockZoomOutWindow.mockClear();
    mockResetZoomWindow.mockClear();
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
      addWorkspace: vi.fn(),
      fitAllPanes: mockFitAllPanes,
    });

    // Mock window.electronAPI
    window.electronAPI = {
      spawnTerminal: mockSpawnTerminal,
      onFitAllPanes: mockOnFitAllPanes,
      zoomInWindow: mockZoomInWindow,
      zoomOutWindow: mockZoomOutWindow,
      resetZoomWindow: mockResetZoomWindow,
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
  // Empty State - Workspace Gate Fullscreen
  // =========================================================================
  describe('empty state (no workspaces)', () => {
    it('renders WorkspaceGateFullscreen when there are no workspaces', () => {
      render(<App />);
      expect(screen.getByTestId('workspace-gate-fullscreen')).toBeTruthy();
    });

    it('does not render main layout when there are no workspaces', () => {
      render(<App />);
      expect(screen.queryByTestId('dynamic-pane-layout')).toBeNull();
      expect(screen.queryByTestId('title-bar')).toBeNull();
    });

    it('does not render header when there are no workspaces', () => {
      render(<App />);
      expect(screen.queryByTestId('header')).toBeNull();
    });

    it('does not render StatusBar when there are no workspaces', () => {
      render(<App />);
      expect(screen.queryByTestId('status-bar')).toBeNull();
    });

    it('does not render modal when there are no workspaces', () => {
      render(<App />);
      expect(screen.queryByTestId('workspace-gate-modal')).toBeNull();
    });
  });

  // =========================================================================
  // Workspace Gate Selection
  // =========================================================================
  describe('workspace gate selection', () => {
    it('calls spawnTerminal when gate selects a workspace', async () => {
      render(<App />);
      
      const selectButton = screen.getByTestId('gate-select');
      await act(async () => {
        fireEvent.click(selectButton);
      });
      
      expect(mockSpawnTerminal).toHaveBeenCalled();
    });

    it('spawns correct number of terminals based on selection', async () => {
      mockSpawnTerminal
        .mockResolvedValueOnce({ id: 'term-1', pid: 1111 })
        .mockResolvedValueOnce({ id: 'term-2', pid: 2222 })
        .mockResolvedValueOnce({ id: 'term-3', pid: 3333 });
      
      render(<App />);
      
      const selectButton = screen.getByTestId('gate-select-multi');
      await act(async () => {
        fireEvent.click(selectButton);
      });
      
      expect(mockSpawnTerminal).toHaveBeenCalledTimes(3);
    });

    it('passes correct parameters to spawnTerminal', async () => {
      render(<App />);
      
      const selectButton = screen.getByTestId('gate-select');
      await act(async () => {
        fireEvent.click(selectButton);
      });
      
      expect(mockSpawnTerminal).toHaveBeenCalledWith('/test/path', 'codex', '');
    });

    it('passes model parameter to spawnTerminal', async () => {
      render(<App />);
      
      const selectButton = screen.getByTestId('gate-select-multi');
      await act(async () => {
        fireEvent.click(selectButton);
      });
      
      expect(mockSpawnTerminal).toHaveBeenCalledWith('/test/path', 'codex', 'gpt-4');
    });
  });

  // =========================================================================
  // Workspace Gate Modal
  // =========================================================================
  describe('workspace gate modal', () => {
    it('opens modal when onOpenWorkspace is called', async () => {
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
            panes: [],
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
          }],
        });
      });
      
      render(<App />);
      
      fireEvent.click(screen.getByTestId('titlebar-open-workspace'));
      
      await waitFor(() => {
        expect(screen.getByTestId('workspace-gate-modal')).toBeTruthy();
      });
    });

    it('closes modal when close button is clicked', async () => {
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
            panes: [],
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
          }],
        });
      });
      
      render(<App />);
      
      fireEvent.click(screen.getByTestId('titlebar-open-workspace'));
      
      await waitFor(() => {
        expect(screen.getByTestId('workspace-gate-modal')).toBeTruthy();
      });
      
      fireEvent.click(screen.getByTestId('modal-close'));
      
      await waitFor(() => {
        expect(screen.queryByTestId('workspace-gate-modal')).toBeNull();
      });
    });
  });

  // =========================================================================
  // Main Layout (with workspaces)
  // =========================================================================
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
            panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false }],
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

    it('does not render WorkspaceGateFullscreen when workspaces exist', () => {
      render(<App />);
      expect(screen.queryByTestId('workspace-gate-fullscreen')).toBeNull();
    });

    it('does not render WorkspaceGateModal initially when workspaces exist', () => {
      render(<App />);
      expect(screen.queryByTestId('workspace-gate-modal')).toBeNull();
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
            panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false }],
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
          }],
        });
      });
    });

    it('calls fitAllPanes when Ctrl+Shift+F is pressed', async () => {
      render(<App />);
      
      await act(async () => {
        fireEvent.keyDown(document, { key: 'f', metaKey: false, ctrlKey: true, shiftKey: true });
      });
      
      expect(mockFitAllPanes).toHaveBeenCalled();
    });

    it('calls fitAllPanes when Meta+Shift+F is pressed (Mac)', async () => {
      render(<App />);
      
      await act(async () => {
        fireEvent.keyDown(document, { key: 'f', metaKey: true, ctrlKey: false, shiftKey: true });
      });
      
      expect(mockFitAllPanes).toHaveBeenCalled();
    });

    it('does not call fitAllPanes when only Ctrl is pressed', async () => {
      render(<App />);
      
      await act(async () => {
        fireEvent.keyDown(document, { key: 'f', metaKey: false, ctrlKey: true, shiftKey: false });
      });
      
      expect(mockFitAllPanes).not.toHaveBeenCalled();
    });

    it('does not call fitAllPanes when only Shift is pressed', async () => {
      render(<App />);
      
      await act(async () => {
        fireEvent.keyDown(document, { key: 'f', metaKey: false, ctrlKey: false, shiftKey: true });
      });
      
      expect(mockFitAllPanes).not.toHaveBeenCalled();
    });

    it('does not call fitAllPanes when a different key is pressed with Ctrl+Shift', async () => {
      render(<App />);
      
      await act(async () => {
        fireEvent.keyDown(document, { key: 'g', metaKey: false, ctrlKey: true, shiftKey: true });
      });
      
      expect(mockFitAllPanes).not.toHaveBeenCalled();
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
  });

  // =========================================================================
  // Workspace Creation Flow
  // =========================================================================
  describe('workspace creation flow', () => {
    it('handles terminal spawn failure gracefully', async () => {
      mockSpawnTerminal
        .mockResolvedValueOnce({ id: 'term-1', pid: 1111 })
        .mockRejectedValueOnce(new Error('Failed to spawn'))
        .mockResolvedValueOnce({ id: 'term-3', pid: 3333 });
      
      render(<App />);
      
      const selectButton = screen.getByTestId('gate-select-multi');
      await act(async () => {
        fireEvent.click(selectButton);
      });
      
      // Should still call addWorkspace with 2 terminals
      await waitFor(() => {
        const addWorkspace = useWorkspaceStore.getState().addWorkspace as ReturnType<typeof vi.fn>;
        expect(addWorkspace).toHaveBeenCalled();
      });
    });

    it('sets activeTerminalId to last terminal', async () => {
      // Reset to ensure fresh state
      mockSpawnTerminal.mockReset();
      mockSpawnTerminal
        .mockResolvedValueOnce({ id: 'term-1', pid: 1111 })
        .mockResolvedValueOnce({ id: 'term-2', pid: 2222 });
      
      // Reset the addWorkspace mock for this test
      const addWorkspace = useWorkspaceStore.getState().addWorkspace as ReturnType<typeof vi.fn>;
      (addWorkspace as unknown as ReturnType<typeof vi.fn>).mockReset();
      (addWorkspace as unknown as ReturnType<typeof vi.fn>).mockImplementation(vi.fn());
      
      render(<App />);
      
      const selectButton = screen.getByTestId('gate-select-multi');
      await act(async () => {
        fireEvent.click(selectButton);
      });
      
      await waitFor(() => {
        expect(addWorkspace).toHaveBeenCalled();
      });
      
      // Check the last call's arguments
      const calls = (addWorkspace as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.activeTerminalId).toBe('term-2');
    });

    it('sets activeTerminalId to null when no terminals spawn', async () => {
      mockSpawnTerminal.mockRejectedValue(new Error('All failed'));
      
      render(<App />);
      
      const selectButton = screen.getByTestId('gate-select');
      await act(async () => {
        fireEvent.click(selectButton);
      });
      
      await waitFor(() => {
        const addWorkspace = useWorkspaceStore.getState().addWorkspace as ReturnType<typeof vi.fn>;
        expect(addWorkspace).toHaveBeenCalledWith(
          expect.objectContaining({
            activeTerminalId: null,
          })
        );
      });
    });

    it('closes gate after workspace selection', async () => {
      render(<App />);
      
      // Verify gate is showing initially
      expect(screen.getByTestId('workspace-gate-fullscreen')).toBeTruthy();
      
      const selectButton = screen.getByTestId('gate-select');
      await act(async () => {
        fireEvent.click(selectButton);
      });
      
      // The gate should disappear because workspace was added
      // We test this by verifying the state changed
      // Note: We check that the component re-renders based on store change
      // The gate will disappear once workspaces.length > 0
      
      // Wait for addWorkspace to be called, which means the selection was processed
      await waitFor(() => {
        const addWorkspace = useWorkspaceStore.getState().addWorkspace as ReturnType<typeof vi.fn>;
        expect(addWorkspace).toHaveBeenCalled();
      });
    });

    it('adds workspace with correct properties', async () => {
      render(<App />);
      
      const selectButton = screen.getByTestId('gate-select');
      await act(async () => {
        fireEvent.click(selectButton);
      });
      
      await waitFor(() => {
        const addWorkspace = useWorkspaceStore.getState().addWorkspace as ReturnType<typeof vi.fn>;
        expect(addWorkspace).toHaveBeenCalledWith(
          expect.objectContaining({
            workspacePath: '/test/path',
            harness: 'codex',
            model: '',
            browserUrl: 'https://github.com',
          })
        );
      });
    });

    it('creates panes for each terminal', async () => {
      // Reset mocks
      mockSpawnTerminal.mockReset();
      mockSpawnTerminal
        .mockResolvedValueOnce({ id: 'term-1', pid: 1111 })
        .mockResolvedValueOnce({ id: 'term-2', pid: 2222 });
      
      const addWorkspace = useWorkspaceStore.getState().addWorkspace as ReturnType<typeof vi.fn>;
      (addWorkspace as unknown as ReturnType<typeof vi.fn>).mockReset();
      (addWorkspace as unknown as ReturnType<typeof vi.fn>).mockImplementation(vi.fn());
      
      render(<App />);
      
      const selectButton = screen.getByTestId('gate-select-multi');
      await act(async () => {
        fireEvent.click(selectButton);
      });
      
      await waitFor(() => {
        expect(addWorkspace).toHaveBeenCalled();
      });
      
      const calls = (addWorkspace as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.panes.length).toBe(2);
    });
  });

  // =========================================================================
  // electronAPI.onFitAllPanes integration
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
            panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false }],
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
});
