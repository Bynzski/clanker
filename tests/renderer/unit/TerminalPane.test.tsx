// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import TerminalPane from '../../../src/renderer/components/TerminalPane';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { ILinkProvider } from '@xterm/xterm';

let attachedKeyHandler: ((event: KeyboardEvent) => boolean) | null = null;
let attachedDataHandler: ((data: string) => void) | null = null;
let registeredLinkProvider: ILinkProvider | null = null;
let mockBufferLineText = '';
let terminalOptions: import('@xterm/xterm').ITerminalOptions | null = null;
const mockHasSelection = vi.fn().mockReturnValue(false);
const mockGetSelection = vi.fn().mockReturnValue('');
const mockClearSelection = vi.fn();
const mockFocus = vi.fn();

// Mock xterm modules - use actual class-like functions
const mockOnDataDispose = vi.fn();

vi.mock('@xterm/xterm', () => {
  return {
    Terminal: class MockTerminal {
      static defaults = {};
      options: import('@xterm/xterm').ITerminalOptions;
      constructor(options?: import('@xterm/xterm').ITerminalOptions) {
        this.options = options ?? {};
        terminalOptions = this.options;
      }
      loadAddon = vi.fn();
      open = vi.fn();
      write = vi.fn();
      dispose = vi.fn();
      hasSelection = mockHasSelection;
      getSelection = mockGetSelection;
      clearSelection = mockClearSelection;
      focus = mockFocus;
      onData = vi.fn((handler: (data: string) => void) => {
        attachedDataHandler = handler;
        return { dispose: mockOnDataDispose };
      });
      onSelectionChange = vi.fn(() => ({ dispose: mockOnDataDispose }));
      attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
        attachedKeyHandler = handler;
        return true;
      });
      registerLinkProvider = vi.fn((provider: ILinkProvider) => {
        registeredLinkProvider = provider;
        return { dispose: vi.fn() };
      });
      cols = 80;
      buffer = {
        active: {
          getLine: vi.fn(() => ({
            length: mockBufferLineText.length,
            translateToString: () => mockBufferLineText,
            getCell: (column: number) => ({
              getChars: () => mockBufferLineText[column] ?? '',
              getWidth: () => 1,
            }),
          })),
        },
      };
      // Use a real DOM element so appendChild works in jsdom tests
      element = document.createElement('div');
    },
  };
});

vi.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: class MockFitAddon {
      fit = vi.fn();
      proposeDimensions = vi.fn().mockReturnValue({ cols: 80, rows: 24 });
    },
  };
});

vi.mock('@xterm/addon-clipboard', () => ({
  ClipboardAddon: class MockClipboardAddon {
    dispose = vi.fn();
  },
}));

// Mock the drag handle context
vi.mock('../../../src/renderer/components/dragHandleContext', () => ({
  useDragHandle: vi.fn().mockReturnValue({}),
}));

// Import the cache clearing function for test isolation
import { clearTerminalCache } from '../../../src/renderer/components/TerminalPane';

// Mock electron API for terminal operations
const mockKillTerminal = vi.fn().mockResolvedValue({ success: true });
const mockResizeTerminal = vi.fn().mockResolvedValue({ success: true });
const mockWriteTerminal = vi.fn().mockResolvedValue({ success: true });
const mockWriteClipboard = vi.fn().mockResolvedValue({ success: true });
const mockResolveDroppedFilePath = vi.fn().mockReturnValue('');
const mockOnTerminalData = vi.fn().mockReturnValue(vi.fn());
const mockOnTerminalExit = vi.fn().mockReturnValue(vi.fn());
const mockOnTerminalResized = vi.fn().mockReturnValue(vi.fn());
const mockZoomInWindow = vi.fn().mockResolvedValue(undefined);
const mockZoomOutWindow = vi.fn().mockResolvedValue(undefined);
const mockResetZoomWindow = vi.fn().mockResolvedValue(undefined);
const mockBrowserCreateTab = vi.fn().mockResolvedValue({ url: 'https://github.com', title: '' });
const mockBrowserSwitchTab = vi.fn().mockResolvedValue({ url: 'https://github.com', title: '' });
const mockBrowserTabNavigate = vi.fn().mockResolvedValue(true);

// Store state helpers
function createTerminal(id: string, pid: number, workingDir: string) {
  return { id, pid, workingDir };
}

function createPane(id: string, terminalId: string | null, locked = false) {
  return { id, terminalId, locked };
}

function setupStoreWithTerminal(terminalId: string, paneId: string, locked = false, activeTerminalId: string | null = null) {
  const terminals = [createTerminal(terminalId, 1234, '/workspace')];
  const panes = [createPane(paneId, terminalId, locked)];
  
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspaceLifecycle: 'active',
    terminals,
    panes,
    activeTerminalId,
    browserVisible: false,
    browserPane: null,
    removeTerminal: vi.fn(),
    removePane: vi.fn(),
    setActiveTerminal: vi.fn(),
  });
  
  return {
    removeTerminal: useWorkspaceStore.getState().removeTerminal as ReturnType<typeof useWorkspaceStore.getState>['removeTerminal'],
    removePane: useWorkspaceStore.getState().removePane as ReturnType<typeof useWorkspaceStore.getState>['removePane'],
    setActiveTerminal: useWorkspaceStore.getState().setActiveTerminal as ReturnType<typeof useWorkspaceStore.getState>['setActiveTerminal'],
  };
}

function setupEmptyStore() {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspaceLifecycle: 'active',
    terminals: [],
    panes: [],
    activeTerminalId: null,
    browserVisible: false,
    browserPane: null,
    removeTerminal: vi.fn(),
    removePane: vi.fn(),
    setActiveTerminal: vi.fn(),
  });
}

function setupElectronAPIMocks() {
  window.electronAPI = {
    killTerminal: mockKillTerminal,
    resizeTerminal: mockResizeTerminal,
    writeTerminal: mockWriteTerminal,
    terminalReady: vi.fn().mockResolvedValue({ success: true }),
    writeClipboard: mockWriteClipboard,
    resolveDroppedFilePath: mockResolveDroppedFilePath,
    onTerminalData: mockOnTerminalData,
    onTerminalExit: mockOnTerminalExit,
    onTerminalResized: mockOnTerminalResized,
    zoomInWindow: mockZoomInWindow,
    zoomOutWindow: mockZoomOutWindow,
    resetZoomWindow: mockResetZoomWindow,
    browserCreateTab: mockBrowserCreateTab,
    browserSwitchTab: mockBrowserSwitchTab,
    browserTabNavigate: mockBrowserTabNavigate,
  } as unknown as typeof window.electronAPI;
}

describe('TerminalPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    attachedKeyHandler = null;
    attachedDataHandler = null;
    registeredLinkProvider = null;
    mockBufferLineText = '';
    terminalOptions = null;
    mockHasSelection.mockReturnValue(false);
    mockGetSelection.mockReturnValue('');
    mockFocus.mockClear();
    setupElectronAPIMocks();
    // Clear the xterm instance cache between tests to ensure isolation
    clearTerminalCache();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // =========================================================================
  // Empty State
  // =========================================================================
  describe('empty state', () => {
    it('renders empty state when no terminal is found', () => {
      setupEmptyStore();
      
      render(<TerminalPane paneId="p1" />);
      
      expect(screen.getByText('No terminal')).toBeTruthy();
      expect(document.querySelector('.terminal-pane')).toHaveClass('empty');
    });
  });

  // =========================================================================
  // Basic Rendering
  // =========================================================================
  describe('basic rendering', () => {
    it('renders terminal pane with header when terminal exists', () => {
      setupStoreWithTerminal('t1', 'p1');
      
      render(<TerminalPane paneId="p1" />);
      
      expect(document.querySelector('.terminal-pane')).toBeTruthy();
      expect(screen.queryByText('No terminal')).toBeNull();
    });

    it('renders in compact mode without header', () => {
      setupStoreWithTerminal('t1', 'p1');
      
      render(<TerminalPane paneId="p1" compact={true} />);
      
      expect(screen.queryByText('No terminal')).toBeNull();
      expect(document.querySelector('.terminal-pane')).toHaveClass('compact');
      expect(document.querySelector('.terminal-header')).toBeNull();
    });

    it('renders terminal content area', () => {
      setupStoreWithTerminal('t1', 'p1');
      
      render(<TerminalPane paneId="p1" />);
      
      expect(document.querySelector('.terminal-content')).toBeTruthy();
    });

    it('renders header with all action buttons', () => {
      setupStoreWithTerminal('t1', 'p1');
      
      render(<TerminalPane paneId="p1" />);
      
      const closeButton = screen.getByTitle('Close terminal');
      expect(closeButton).toBeTruthy();
    });
  });

  // =========================================================================
  // Action Handlers
  // =========================================================================
  describe('action handlers', () => {
    it('kills terminal, removes terminal and pane when close is clicked', async () => {
      const mocks = setupStoreWithTerminal('t1', 'p1');
      mockKillTerminal.mockResolvedValue(undefined);
      
      render(<TerminalPane paneId="p1" />);
      
      const closeButton = screen.getByTitle('Close terminal');
      fireEvent.click(closeButton);
      
      await waitFor(() => {
        expect(mockKillTerminal).toHaveBeenCalledWith('t1');
      });
      
      await waitFor(() => {
        expect(mocks.removeTerminal).toHaveBeenCalledWith('t1');
      });
      
      await waitFor(() => {
        expect(mocks.removePane).toHaveBeenCalledWith('p1');
      });
    });

    it('does not crash when killTerminal fails', async () => {
      setupStoreWithTerminal('t1', 'p1');
      mockKillTerminal.mockRejectedValue(new Error('Failed to kill'));
      
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      render(<TerminalPane paneId="p1" />);
      
      const closeButton = screen.getByTitle('Close terminal');
      fireEvent.click(closeButton);
      
      await waitFor(() => {
        expect(mockKillTerminal).toHaveBeenCalled();
      });
      
      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // Active State
  // =========================================================================
  describe('active state', () => {
    it('shows active state when terminal is the active terminal', () => {
      setupStoreWithTerminal('t1', 'p1', false, 't1');
      
      render(<TerminalPane paneId="p1" />);
      
      expect(document.querySelector('.terminal-pane')).toHaveClass('active');
      expect(document.querySelector('.terminal-status-indicator')).toHaveAttribute('data-active', 'true');
    });

    it('does not show active state when different terminal is active', () => {
      setupStoreWithTerminal('t1', 'p1', false, 't2');
      
      render(<TerminalPane paneId="p1" />);
      
      expect(document.querySelector('.terminal-pane')).not.toHaveClass('active');
      expect(document.querySelector('.terminal-status-indicator')).toHaveAttribute('data-active', 'false');
    });

    it('does not show active state when no terminal is active', () => {
      setupStoreWithTerminal('t1', 'p1', false, null);
      
      render(<TerminalPane paneId="p1" />);
      
      expect(document.querySelector('.terminal-pane')).not.toHaveClass('active');
    });

    it('focuses xterm when the terminal is active and ready', async () => {
      setupStoreWithTerminal('t1', 'p1', false, 't1');

      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      await waitFor(() => {
        expect(mockFocus).toHaveBeenCalled();
      });
    });

    it('does not focus xterm when a different terminal is active', async () => {
      setupStoreWithTerminal('t1', 'p1', false, 't2');

      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockFocus).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Terminal Initialization (xterm mocking)
  // =========================================================================
  describe('terminal initialization', () => {
    it('registers links that open workspace files in the editor', async () => {
      const openFileInEditor = vi.fn().mockResolvedValue(undefined);
      const workspace = createWorkspaceFixture({
        id: 'ws-1',
        lifecycle: 'active',
        workspacePath: '/workspace',
        terminals: [createTerminal('t1', 1234, '/workspace')],
        panes: [createPane('p1', 't1', false)],
        activeTerminalId: 't1',
      });
      useWorkspaceStore.setState({
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        activeWorkspaceLifecycle: 'active',
        openFileInEditor,
      });
      mockBufferLineText = 'Updated src/renderer/App.tsx:12:4';

      render(<TerminalPane workspaceId="ws-1" paneId="p1" />);
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(registeredLinkProvider).toBeTruthy();
      let links: import('@xterm/xterm').ILink[] | undefined;
      registeredLinkProvider?.provideLinks(1, (provided) => { links = provided; });
      expect(links).toHaveLength(1);
      expect(links?.[0]?.decorations).toEqual({ pointerCursor: true, underline: true });

      links?.[0]?.activate(new MouseEvent('click'), links[0].text);
      expect(openFileInEditor).toHaveBeenCalledWith('/workspace/src/renderer/App.tsx', 'ws-1');
    });

    it('routes OSC 8 hyperlinks into a new in-app browser tab', async () => {
      const workspace = createWorkspaceFixture({
        id: 'ws-1',
        lifecycle: 'active',
        workspacePath: '/workspace',
        terminals: [createTerminal('t1', 1234, '/workspace')],
        panes: [createPane('p1', 't1', false)],
        activeTerminalId: 't1',
        browserVisible: true,
        browserPane: {
          id: 'browser-1',
          position: { x: 0, y: 0, w: 6, h: 6 },
          tabs: [{
            id: 'browser-tab-1',
            url: 'https://github.com',
            title: '',
            canGoBack: false,
            canGoForward: false,
          }],
          activeTabId: 'browser-tab-1',
        },
      });
      useWorkspaceStore.setState({
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        activeWorkspaceLifecycle: 'active',
      });
      render(<TerminalPane workspaceId="ws-1" paneId="p1" />);
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      const linkHandler = terminalOptions?.linkHandler;
      expect(linkHandler).toBeTruthy();
      linkHandler?.activate(
        new MouseEvent('click'),
        'https://example.com/docs',
        { start: { x: 1, y: 1 }, end: { x: 24, y: 1 } },
      );

      await waitFor(() => {
        expect(mockBrowserTabNavigate).toHaveBeenCalledWith(
          'ws-1',
          expect.any(String),
          'https://example.com/docs',
        );
      });
      const tabId = mockBrowserTabNavigate.mock.calls[0]?.[1];
      expect(mockBrowserCreateTab).toHaveBeenCalledWith('ws-1', tabId);
      expect(mockBrowserSwitchTab).toHaveBeenCalledWith('ws-1', tabId);
    });

    it('does not register terminal data listener locally', async () => {
      setupStoreWithTerminal('t1', 'p1');

      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      await waitFor(() => {
        expect(mockOnTerminalData).not.toHaveBeenCalled();
      });
    });

    it('does not register terminal exit listener locally', async () => {
      setupStoreWithTerminal('t1', 'p1');

      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      await waitFor(() => {
        expect(mockOnTerminalExit).not.toHaveBeenCalled();
      });
    });

    it('triggers resize on terminal initialization', async () => {
      setupStoreWithTerminal('t1', 'p1');

      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      await waitFor(() => {
        expect(mockResizeTerminal).toHaveBeenCalled();
      });
    });

    it('sets up terminal resized confirmation listener', async () => {
      setupStoreWithTerminal('t1', 'p1');

      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      await waitFor(() => {
        expect(mockOnTerminalResized).toHaveBeenCalled();
      });
    });
  });

  describe('keyboard shortcuts', () => {
    it('does not own app zoom shortcuts when xterm is focused', async () => {
      setupStoreWithTerminal('t1', 'p1');
      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      const preventDefault = vi.fn();
      const handled = attachedKeyHandler?.({
        key: '=',
        code: 'Equal',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault,
      } as unknown as KeyboardEvent);

      expect(handled).toBe(true);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(mockZoomInWindow).not.toHaveBeenCalled();
    });

    it('keeps copy shortcut behavior when selected text exists', async () => {
      setupStoreWithTerminal('t1', 'p1');
      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      mockHasSelection.mockReturnValue(true);
      mockGetSelection.mockReturnValue('copied text');

      const preventDefault = vi.fn();
      const handled = attachedKeyHandler?.({
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
        preventDefault,
      } as unknown as KeyboardEvent);

      expect(handled).toBe(false);
      expect(preventDefault).toHaveBeenCalled();
      expect(mockWriteClipboard).toHaveBeenCalledWith('copied text');
      expect(mockClearSelection).toHaveBeenCalled();
      expect(mockZoomInWindow).not.toHaveBeenCalled();
    });
  });

  describe('workspace interaction gating', () => {
    it('does not attach terminal input handlers for a parked workspace instance', async () => {
      const parkedWorkspace = createWorkspaceFixture({
        id: 'ws-1',
        lifecycle: 'parked',
        terminals: [createTerminal('t1', 1234, '/workspace')],
        panes: [createPane('p1', 't1', false)],
        activeTerminalId: 't1',
      });
      const activeWorkspace = createWorkspaceFixture({
        id: 'ws-2',
        lifecycle: 'active',
        terminals: [createTerminal('t2', 1234, '/workspace')],
        panes: [createPane('p2', 't2', false)],
        activeTerminalId: 't2',
      });

      useWorkspaceStore.setState({
        workspaces: [parkedWorkspace, activeWorkspace],
        activeWorkspaceId: 'ws-2',
        activeWorkspaceLifecycle: 'active',
      });

      render(<TerminalPane workspaceId="ws-1" paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(attachedDataHandler).toBeNull();
      expect(attachedKeyHandler).toBeNull();
      expect(mockFocus).not.toHaveBeenCalled();
      expect(document.querySelector('.terminal-pane')).toHaveAttribute('data-workspace-interactive', 'false');
      expect(screen.getByTitle('Close terminal')).toBeDisabled();
    });
  });

  // =========================================================================
  // Cleanup
  // =========================================================================
  describe('cleanup on unmount', () => {
    it('cleans up listeners on unmount', async () => {
      setupStoreWithTerminal('t1', 'p1');

      const { unmount } = render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(() => unmount()).not.toThrow();
    });
  });

  // =========================================================================
  // Resize Handling
  // =========================================================================
  describe('resize handling', () => {
    it('resizes terminal when resize is triggered', async () => {
      setupStoreWithTerminal('t1', 'p1');

      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      // Clear previous calls
      mockResizeTerminal.mockClear();

      // Trigger resize timer
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      await waitFor(() => {
        expect(mockResizeTerminal).toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // Drag Handle
  // =========================================================================
  describe('drag handle', () => {
    it('passes drag handle props to header', () => {
      setupStoreWithTerminal('t1', 'p1');
      
      render(<TerminalPane paneId="p1" />);
      
      const header = document.querySelector('.terminal-header');
      expect(header).toBeTruthy();
    });
  });

  // =========================================================================
  // Drag and Drop
  // =========================================================================
  describe('drag and drop', () => {
    it('writes the resolved absolute image path to the terminal', () => {
      setupStoreWithTerminal('t1', 'p1');
      mockResolveDroppedFilePath.mockReturnValue('/workspace/images/photo.png');

      render(<TerminalPane paneId="p1" />);

      const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
      const content = document.querySelector('.terminal-content');
      expect(content).toBeTruthy();

      fireEvent.drop(content!, {
        dataTransfer: {
          files: [file],
          getData: vi.fn().mockReturnValue('file:///workspace/images/photo.png'),
        },
      });

      expect(mockResolveDroppedFilePath).toHaveBeenCalledWith(file, 'file:///workspace/images/photo.png');
      expect(mockWriteTerminal).toHaveBeenCalledWith('t1', "'/workspace/images/photo.png' ");
    });
  });

  // =========================================================================
  // CSS Classes
  // =========================================================================
  describe('CSS classes', () => {
    it('applies compact class when compact prop is true', () => {
      setupStoreWithTerminal('t1', 'p1');
      
      render(<TerminalPane paneId="p1" compact={true} />);
      
      expect(document.querySelector('.terminal-pane')).toHaveClass('compact');
    });

    it('does not apply compact class when compact prop is false', () => {
      setupStoreWithTerminal('t1', 'p1');
      
      render(<TerminalPane paneId="p1" compact={false} />);
      
      expect(document.querySelector('.terminal-pane')).not.toHaveClass('compact');
    });
  });
});
