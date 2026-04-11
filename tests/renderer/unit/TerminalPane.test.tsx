// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import TerminalPane from '../../../src/renderer/components/TerminalPane';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';

let attachedKeyHandler: ((event: KeyboardEvent) => boolean) | null = null;
const mockHasSelection = vi.fn().mockReturnValue(false);
const mockGetSelection = vi.fn().mockReturnValue('');
const mockClearSelection = vi.fn();

// Mock xterm modules - use actual class-like functions
const mockOnDataDispose = vi.fn();

vi.mock('@xterm/xterm', () => {
  return {
    Terminal: class MockTerminal {
      static defaults = {};
      loadAddon = vi.fn();
      open = vi.fn();
      write = vi.fn();
      dispose = vi.fn();
      hasSelection = mockHasSelection;
      getSelection = mockGetSelection;
      clearSelection = mockClearSelection;
      onData = vi.fn(() => ({ dispose: mockOnDataDispose }));
      onSelectionChange = vi.fn(() => ({ dispose: mockOnDataDispose }));
      attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
        attachedKeyHandler = handler;
        return true;
      });
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

// Mock the drag handle context
vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({
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
    terminals,
    panes,
    activeTerminalId,
    browserVisible: false,
    browserPane: null,
    bringPaneIntoView: vi.fn(),
    togglePaneLock: vi.fn(),
    removeTerminal: vi.fn(),
    removePane: vi.fn(),
    setActiveTerminal: vi.fn(),
  });
  
  return {
    bringPaneIntoView: useWorkspaceStore.getState().bringPaneIntoView as ReturnType<typeof useWorkspaceStore.getState>['bringPaneIntoView'],
    togglePaneLock: useWorkspaceStore.getState().togglePaneLock as ReturnType<typeof useWorkspaceStore.getState>['togglePaneLock'],
    removeTerminal: useWorkspaceStore.getState().removeTerminal as ReturnType<typeof useWorkspaceStore.getState>['removeTerminal'],
    removePane: useWorkspaceStore.getState().removePane as ReturnType<typeof useWorkspaceStore.getState>['removePane'],
    setActiveTerminal: useWorkspaceStore.getState().setActiveTerminal as ReturnType<typeof useWorkspaceStore.getState>['setActiveTerminal'],
  };
}

function setupEmptyStore() {
  useWorkspaceStore.setState({
    terminals: [],
    panes: [],
    activeTerminalId: null,
    browserVisible: false,
    browserPane: null,
    bringPaneIntoView: vi.fn(),
    togglePaneLock: vi.fn(),
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
  } as unknown as typeof window.electronAPI;
}

describe('TerminalPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    attachedKeyHandler = null;
    mockHasSelection.mockReturnValue(false);
    mockGetSelection.mockReturnValue('');
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
      
      // Should have bring into view, lock, and close buttons
      const bringButton = screen.getByTitle('Bring into view');
      const lockButton = screen.getByTitle('Lock pane');
      const closeButton = screen.getByTitle('Close terminal');
      
      expect(bringButton).toBeTruthy();
      expect(lockButton).toBeTruthy();
      expect(closeButton).toBeTruthy();
    });
  });

  // =========================================================================
  // Lock State
  // =========================================================================
  describe('lock state', () => {
    it('shows lock icon when pane is locked', () => {
      setupStoreWithTerminal('t1', 'p1', true);
      
      render(<TerminalPane paneId="p1" />);
      
      const lockButton = screen.getByTitle('Unlock pane');
      expect(lockButton).toBeTruthy();
    });

    it('shows unlock icon when pane is unlocked', () => {
      setupStoreWithTerminal('t1', 'p1', false);
      
      render(<TerminalPane paneId="p1" />);
      
      const lockButton = screen.getByTitle('Lock pane');
      expect(lockButton).toBeTruthy();
    });
  });

  // =========================================================================
  // Action Handlers
  // =========================================================================
  describe('action handlers', () => {
    it('calls bringPaneIntoView when bring into view button is clicked', async () => {
      const mocks = setupStoreWithTerminal('t1', 'p1');
      
      render(<TerminalPane paneId="p1" />);
      
      const bringButton = screen.getByTitle('Bring into view');
      fireEvent.click(bringButton);
      
      await waitFor(() => {
        expect(mocks.bringPaneIntoView).toHaveBeenCalledWith('p1');
      });
    });

    it('calls togglePaneLock when lock button is clicked', async () => {
      const mocks = setupStoreWithTerminal('t1', 'p1', false);
      
      render(<TerminalPane paneId="p1" />);
      
      const lockButton = screen.getByTitle('Lock pane');
      fireEvent.click(lockButton);
      
      await waitFor(() => {
        expect(mocks.togglePaneLock).toHaveBeenCalledWith('p1');
      });
    });

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
  });

  // =========================================================================
  // Terminal Initialization (xterm mocking)
  // =========================================================================
  describe('terminal initialization', () => {
    it('sets up terminal data listener', async () => {
      setupStoreWithTerminal('t1', 'p1');

      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      await waitFor(() => {
        expect(mockOnTerminalData).toHaveBeenCalled();
      });
    });

    it('sets up terminal exit listener', async () => {
      setupStoreWithTerminal('t1', 'p1');

      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      await waitFor(() => {
        expect(mockOnTerminalExit).toHaveBeenCalled();
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
    it('forwards zoom in shortcut through electron API when xterm is focused', async () => {
      setupStoreWithTerminal('t1', 'p1');
      render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      const preventDefault = vi.fn();
      const handled = attachedKeyHandler?.({
        key: '=',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault,
      } as unknown as KeyboardEvent);

      expect(handled).toBe(false);
      expect(preventDefault).toHaveBeenCalled();
      expect(mockZoomInWindow).toHaveBeenCalled();
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

      // Access the dispose function that was registered
      const dataDispose = mockOnTerminalData.mock.results[0]?.value;

      unmount();

      // Data dispose function should have been accessed (for cleanup)
      expect(dataDispose).toBeDefined();
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
