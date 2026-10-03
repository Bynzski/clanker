// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import {
  TERMINAL_DEFAULT_FONT_SIZE,
  TERMINAL_MAX_FONT_SIZE,
  TERMINAL_MIN_FONT_SIZE,
} from '../../../src/shared/terminal';
import TerminalPane from '../../../src/renderer/components/TerminalPane';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useKeybindingStore } from '../../../src/renderer/store/keybindingStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { useThemeStore } from '../../../src/renderer/theme/themeStore';
import { startTerminalThemeSync } from '../../../src/renderer/theme/themeRuntime';
import { getTerminalTheme } from '../../../src/renderer/theme/terminalTheme';
import type { ILinkProvider } from '@xterm/xterm';

let attachedWheelHandler: ((event: WheelEvent) => boolean) | null = null;
let attachedKeyHandler: ((event: KeyboardEvent) => boolean) | null = null;
let attachedDataHandler: ((data: string) => void) | null = null;
let registeredLinkProvider: ILinkProvider | null = null;
let mockBufferLineText = '';
let terminalOptions: import('@xterm/xterm').ITerminalOptions | null = null;
let terminalConstructionCount = 0;
const constructedTerminals: { options: import('@xterm/xterm').ITerminalOptions; dispose: ReturnType<typeof vi.fn> }[] = [];
let stopThemeSync: () => void;
let lastTerminalElement: HTMLDivElement | null = null;
const mockTerminalWrite = vi.fn();
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
        terminalConstructionCount += 1;
        constructedTerminals.push(this);
        this.options = options ?? {};
        terminalOptions = this.options;
        lastTerminalElement = this.element;
      }
      loadAddon = vi.fn();
      open = vi.fn((container: HTMLElement) => container.appendChild(this.element));
      write = mockTerminalWrite;
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
      attachCustomWheelEventHandler = vi.fn((handler: (event: WheelEvent) => boolean) => {
        attachedWheelHandler = handler;
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
  useDragHandle: vi.fn().mockReturnValue({ 'data-drag-activator': 'true' }),
}));

// Import the cache clearing function for test isolation
import {
  cacheTerminalInstance,
  clearTerminalCache,
  finishTerminalDisposal,
  markTerminalDisposed,
  writeCachedTerminalData,
} from '../../../src/renderer/components/TerminalPane';

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
    attachedWheelHandler = null;
    attachedDataHandler = null;
    registeredLinkProvider = null;
    mockBufferLineText = '';
    terminalOptions = null;
    terminalConstructionCount = 0;
    constructedTerminals.length = 0;
    lastTerminalElement = null;
    mockTerminalWrite.mockClear();
    mockHasSelection.mockReturnValue(false);
    mockGetSelection.mockReturnValue('');
    mockFocus.mockClear();
    setupElectronAPIMocks();
    // Clear the xterm instance cache between tests to ensure isolation
    clearTerminalCache();
    useThemeStore.setState({ theme: 'dark', resolved: true });
    stopThemeSync = startTerminalThemeSync();
    useAgentAttentionStore.setState({ byTerminalId: {} });
  });

  afterEach(() => {
    cleanup();
    clearTerminalCache();
    stopThemeSync();
    vi.useRealTimers();
  });

  describe('terminal themes', () => {
    async function settleRuntime() {
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(150);
      });
    }

    it.each(['dark', 'light'] as const)('constructs directly with the current %s palette', async (theme) => {
      useThemeStore.setState({ theme });
      setupStoreWithTerminal('t1', 'p1');
      render(<TerminalPane paneId="p1" />);
      await settleRuntime();
      expect(terminalOptions?.theme).toEqual(getTerminalTheme(theme));
      expect(lastTerminalElement?.style.backgroundColor).toBe(theme === 'dark' ? 'rgb(18, 18, 18)' : 'rgb(243, 244, 246)');
      expect(terminalConstructionCount).toBe(1);
    });

    it('reads the current theme after async imports resolve', async () => {
      setupStoreWithTerminal('t1', 'p1');
      render(<TerminalPane paneId="p1" />);
      expect(terminalConstructionCount).toBe(0);
      // The import continuation has not run yet: a pre-import capture is stale.
      useThemeStore.setState({ theme: 'light' });
      await settleRuntime();
      expect(terminalOptions?.theme).toEqual(getTerminalTheme('light'));
    });

    it('switches all living xterms both ways without session lifecycle work', async () => {
      setupStoreWithTerminal('t1', 'p1');
      useWorkspaceStore.setState({
        terminals: [createTerminal('t1', 1234, '/workspace'), createTerminal('t2', 1235, '/workspace')],
        panes: [createPane('p1', 't1', false), createPane('p2', 't2', false)],
      });
      render(<TerminalPane paneId="p1" />);
      await settleRuntime();
      render(<TerminalPane paneId="p2" />);
      await settleRuntime();
      await waitFor(() => expect(terminalConstructionCount).toBe(2));
      await settleRuntime();
      const originals = [...constructedTerminals];
      writeCachedTerminalData('t1', 'existing scrollback');
      mockHasSelection.mockReturnValue(true);
      const readyCount = vi.mocked(window.electronAPI.terminalReady).mock.calls.length;
      mockTerminalWrite.mockClear();
      mockClearSelection.mockClear();
      mockResizeTerminal.mockClear();
      mockWriteTerminal.mockClear();

      for (const theme of ['light', 'dark'] as const) {
        await act(() => useThemeStore.getState().setTheme(theme));
        expect(constructedTerminals).toEqual(originals);
        expect(terminalConstructionCount).toBe(2);
        for (const terminal of originals) {
          expect(terminal.options.theme).toEqual(getTerminalTheme(theme));
          expect(lastTerminalElement?.style.backgroundColor).toBe(theme === 'dark' ? 'rgb(18, 18, 18)' : 'rgb(243, 244, 246)');
          expect(terminal.dispose).not.toHaveBeenCalled();
        }
      }
      expect(mockTerminalWrite).not.toHaveBeenCalled();
      expect(mockClearSelection).not.toHaveBeenCalled();
      expect(mockKillTerminal).not.toHaveBeenCalled();
      expect(mockWriteTerminal).not.toHaveBeenCalled();
      expect(mockResizeTerminal).not.toHaveBeenCalled();
      expect(window.electronAPI.terminalReady).toHaveBeenCalledTimes(readyCount);
    });

    it('unregisters intentional disposal and cache clearing', async () => {
      setupStoreWithTerminal('t1', 'p1');
      const view = render(<TerminalPane paneId="p1" />);
      await settleRuntime();
      const original = constructedTerminals[0];
      view.unmount();
      markTerminalDisposed('t1');
      await act(() => useThemeStore.getState().setTheme('light'));
      expect(original.dispose).toHaveBeenCalledOnce();
      expect(original.options.theme).toEqual(getTerminalTheme('dark'));
      expect(writeCachedTerminalData('t1', 'after disposal')).toBe(false);
      finishTerminalDisposal('t1');

      const restored = render(<TerminalPane paneId="p1" />);
      await settleRuntime();
      const replacement = constructedTerminals[1];
      restored.unmount();
      clearTerminalCache();
      await act(() => useThemeStore.getState().setTheme('dark'));
      expect(replacement.dispose).toHaveBeenCalledOnce();
      expect(replacement.options.theme).toEqual(getTerminalTheme('light'));
    });

    it('unregisters a replaced cache entry', () => {
      const oldTerminal = { options: {}, dispose: vi.fn() };
      const replacement = { options: {}, dispose: vi.fn() };
      cacheTerminalInstance('same-id', oldTerminal as never, {} as never);
      cacheTerminalInstance('same-id', replacement as never, {} as never);
      useThemeStore.setState({ theme: 'light' });
      expect(oldTerminal.dispose).toHaveBeenCalledOnce();
      expect(oldTerminal.options).toEqual({ theme: getTerminalTheme('dark') });
      expect(replacement.options).toEqual({ theme: getTerminalTheme('light') });
    });
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
    it('hides unknown status when attention was disabled for the launch', () => {
      setupStoreWithTerminal('t1', 'p1');
      useWorkspaceStore.setState({ terminals: [{
        id: 't1', pid: 1234, workingDir: '/workspace', harnessId: 'opencode',
        displayName: 'Samson', attentionEnabled: false,
      }] });

      render(<TerminalPane paneId="p1" />);

      expect(screen.getByText('Samson')).toBeTruthy();
      expect(screen.queryByText('Unknown')).toBeNull();
      expect(document.querySelector('.terminal-agent-state')).toBeNull();
    });

    it('shows harness and color coded attention icons without status words', () => {
      setupStoreWithTerminal('t1', 'p1');
      useWorkspaceStore.setState({ terminals: [{
        id: 't1', pid: 1234, workingDir: '/workspace', harnessId: 'opencode',
        displayName: 'Samson', attentionEnabled: true,
      }] });

      render(<TerminalPane paneId="p1" />);

      expect(screen.getByRole('img', { name: 'OpenCode harness' })).toBeTruthy();
      expect(screen.getByLabelText('Samson: Unknown')).toBeTruthy();
      expect(screen.queryByText('Unknown')).toBeNull();
      act(() => useAgentAttentionStore.getState().applyUpdate({ terminalId: 't1', event: 'turn_started' }, false));
      expect(screen.getByLabelText('Samson: Running')).toHaveClass('state-running');
      act(() => useAgentAttentionStore.getState().applyUpdate({ terminalId: 't1', event: 'input_requested' }, false));
      expect(screen.getByLabelText('Samson: Needs input')).toHaveClass('state-needs_input');
      act(() => useAgentAttentionStore.getState().applyUpdate({ terminalId: 't1', event: 'turn_completed' }, false));
      expect(screen.getByLabelText('Samson: Turn complete')).toHaveClass('state-turn_complete');
    });

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
    const mountTerminal = async () => {
      setupStoreWithTerminal('t1', 'p1');
      const view = render(<TerminalPane paneId="p1" />);
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });
      return view;
    };

    const zoomKey = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      const handled = attachedKeyHandler?.(event);
      return { handled, preventDefault, event };
    };
    const ctrlEqual = { key: '=', code: 'Equal', ctrlKey: true } as const;
    const ctrlMinus = { key: '-', code: 'Minus', ctrlKey: true } as const;

    it('zooms the focused terminal in and owns the event', async () => {
      await mountTerminal();
      mockWriteTerminal.mockClear();

      const { handled, preventDefault } = zoomKey(ctrlEqual);

      expect(handled).toBe(false);
      expect(preventDefault).toHaveBeenCalled();
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE + 1);
      expect(mockWriteTerminal).not.toHaveBeenCalled();
      expect(mockZoomInWindow).not.toHaveBeenCalled();
      expect(mockZoomOutWindow).not.toHaveBeenCalled();
      expect(mockResetZoomWindow).not.toHaveBeenCalled();
    });

    it('marks the event handled so app zoom cannot also run', async () => {
      await mountTerminal();
      const { event } = zoomKey(ctrlEqual);
      expect(event.defaultPrevented).toBe(true);
    });

    it('zooms the focused terminal out', async () => {
      await mountTerminal();
      expect(zoomKey(ctrlMinus).handled).toBe(false);
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE - 1);
    });

    it('resets to the default size with Cmd+0', async () => {
      await mountTerminal();
      constructedTerminals[0].options.fontSize = 20;

      const { handled } = zoomKey({ key: '0', code: 'Digit0', metaKey: true });

      expect(handled).toBe(false);
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE);
    });

    it('owns Cmd++ via the Meta modifier', async () => {
      await mountTerminal();
      const { handled } = zoomKey({ key: '+', code: 'Equal', metaKey: true, shiftKey: true });
      expect(handled).toBe(false);
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE + 1);
    });

    it('clamps at the maximum size but still consumes the shortcut', async () => {
      await mountTerminal();
      constructedTerminals[0].options.fontSize = TERMINAL_MAX_FONT_SIZE;
      mockWriteTerminal.mockClear();

      const { handled, preventDefault } = zoomKey(ctrlEqual);

      expect(handled).toBe(false);
      expect(preventDefault).toHaveBeenCalled();
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_MAX_FONT_SIZE);
      expect(mockWriteTerminal).not.toHaveBeenCalled();
    });

    it('clamps at the minimum size but still consumes the shortcut', async () => {
      await mountTerminal();
      constructedTerminals[0].options.fontSize = TERMINAL_MIN_FONT_SIZE;

      const { handled, preventDefault } = zoomKey(ctrlMinus);

      expect(handled).toBe(false);
      expect(preventDefault).toHaveBeenCalled();
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_MIN_FONT_SIZE);
    });

    it('consumes Ctrl+0 at the default size', async () => {
      await mountTerminal();
      const { handled, preventDefault } = zoomKey({ key: '0', code: 'Digit0', ctrlKey: true });
      expect(handled).toBe(false);
      expect(preventDefault).toHaveBeenCalled();
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE);
    });

    it('refits and resizes the PTY through the existing resize path after zoom', async () => {
      await mountTerminal();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      mockResizeTerminal.mockClear();

      zoomKey(ctrlEqual);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(mockResizeTerminal).toHaveBeenCalledWith('t1', 80, 24);
    });

    describe('registered commands vs. the PTY', () => {
      afterEach(() => {
        useKeybindingStore.setState({ overrides: {} });
      });

      it.each([
        ['Ctrl+S (editor Save)', { key: 's', code: 'KeyS', ctrlKey: true }],
        ['Cmd+S', { key: 's', code: 'KeyS', metaKey: true }],
        ['Ctrl+B (Toggle Explorer)', { key: 'b', code: 'KeyB', ctrlKey: true }],
        ['Ctrl+T', { key: 't', code: 'KeyT', ctrlKey: true }],
        ['Ctrl+W', { key: 'w', code: 'KeyW', ctrlKey: true }],
        ['Ctrl+R', { key: 'r', code: 'KeyR', ctrlKey: true }],
        ['Ctrl+L', { key: 'l', code: 'KeyL', ctrlKey: true }],
        ['Ctrl+, (Settings)', { key: ',', code: 'Comma', ctrlKey: true }],
        ['Ctrl+Alt+F (Fit All)', { key: 'f', code: 'KeyF', ctrlKey: true, altKey: true }],
        ['Ctrl+C', { key: 'c', code: 'KeyC', ctrlKey: true }],
        ['plain letter', { key: 'a', code: 'KeyA' }],
        ['Enter', { key: 'Enter', code: 'Enter' }],
        ['Ctrl+Tab', { key: 'Tab', code: 'Tab', ctrlKey: true }],
      ])('passes %s through to xterm and the PTY unclaimed', async (_name, init) => {
        await mountTerminal();
        const { handled, preventDefault } = zoomKey(init);
        expect(handled).toBe(true);
        expect(preventDefault).not.toHaveBeenCalled();
        expect(mockZoomInWindow).not.toHaveBeenCalled();
      });

      it('does not invoke editor Save for Ctrl+S even when an editor tab is open elsewhere', async () => {
        const saveEditorFile = vi.fn().mockResolvedValue(true);
        useWorkspaceStore.setState({ saveEditorFile, activeEditorTabId: 'tab-1' });
        await mountTerminal();
        const { handled } = zoomKey({ key: 's', code: 'KeyS', ctrlKey: true });
        expect(handled).toBe(true);
        expect(saveEditorFile).not.toHaveBeenCalled();
      });

      it('keeps Ctrl+Shift+C as terminal copy', async () => {
        await mountTerminal();
        const { handled, preventDefault } = zoomKey({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true });
        expect(handled).toBe(false);
        expect(preventDefault).toHaveBeenCalled();
      });

      it('releases the old Ctrl+Shift+F to the PTY', async () => {
        await mountTerminal();
        expect(zoomKey({ key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true }).handled).toBe(true);
      });

      it('consumes a rebound terminal zoom key and releases the old one', async () => {
        useKeybindingStore.setState({
          overrides: { 'zoom.in': { code: 'KeyJ', primary: true, ctrl: false, shift: false, alt: false } },
        });
        await mountTerminal();

        const rebound = zoomKey({ key: 'j', code: 'KeyJ', ctrlKey: true });
        expect(rebound.handled).toBe(false);
        expect(rebound.preventDefault).toHaveBeenCalled();
        expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE + 1);

        const old = zoomKey(ctrlEqual);
        expect(old.handled).toBe(true);
        expect(old.preventDefault).not.toHaveBeenCalled();
      });

      it.each([
        ['NumpadAdd', 1], ['NumpadSubtract', -1], ['Numpad0', 0],
      ] as const)('owns primary+%s numpad zoom', async (code, delta) => {
        await mountTerminal();
        const { handled, preventDefault } = zoomKey({ code, ctrlKey: true });
        expect(handled).toBe(false);
        expect(preventDefault).toHaveBeenCalled();
        expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE + delta);
        expect(mockZoomInWindow).not.toHaveBeenCalled();
      });

      it('releases numpad zoom to the PTY after an explicit zoom.in rebind', async () => {
        useKeybindingStore.setState({
          overrides: { 'zoom.in': { code: 'KeyJ', primary: true, ctrl: false, shift: false, alt: false } },
        });
        await mountTerminal();
        const { handled, preventDefault } = zoomKey({ code: 'NumpadAdd', ctrlKey: true });
        expect(handled).toBe(true);
        expect(preventDefault).not.toHaveBeenCalled();
      });

      it('does not zoom on key-up of a zoom shortcut but still consumes it', async () => {
        await mountTerminal();
        const event = new KeyboardEvent('keyup', { cancelable: true, ...ctrlEqual });
        expect(attachedKeyHandler?.(event)).toBe(false);
        expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE);
      });
    });

    const wheel = (init: WheelEventInit) => {
      const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      const stopPropagation = vi.spyOn(event, 'stopPropagation');
      const handled = attachedWheelHandler?.(event);
      return { handled, preventDefault, stopPropagation };
    };

    it('zooms in on Ctrl+wheel up and owns the event', async () => {
      await mountTerminal();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      mockResizeTerminal.mockClear();
      mockWriteTerminal.mockClear();

      const { handled, preventDefault, stopPropagation } = wheel({ ctrlKey: true, deltaY: -100 });

      expect(handled).toBe(false);
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE + 1);
      expect(preventDefault).toHaveBeenCalled();
      expect(stopPropagation).toHaveBeenCalled();
      expect(mockZoomInWindow).not.toHaveBeenCalled();
      expect(mockZoomOutWindow).not.toHaveBeenCalled();
      expect(mockWriteTerminal).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(mockResizeTerminal).toHaveBeenCalledWith('t1', 80, 24);
    });

    it('zooms out on Ctrl+wheel down', async () => {
      await mountTerminal();
      expect(wheel({ ctrlKey: true, deltaY: 100 }).handled).toBe(false);
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE - 1);
    });

    it('consumes Ctrl+wheel at the bounds without refitting', async () => {
      await mountTerminal();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      mockResizeTerminal.mockClear();

      constructedTerminals[0].options.fontSize = TERMINAL_MAX_FONT_SIZE;
      const up = wheel({ ctrlKey: true, deltaY: -100 });
      expect(up.handled).toBe(false);
      expect(up.preventDefault).toHaveBeenCalled();
      expect(up.stopPropagation).toHaveBeenCalled();
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_MAX_FONT_SIZE);

      constructedTerminals[0].options.fontSize = TERMINAL_MIN_FONT_SIZE;
      const down = wheel({ ctrlKey: true, deltaY: 100 });
      expect(down.handled).toBe(false);
      expect(down.preventDefault).toHaveBeenCalled();
      expect(down.stopPropagation).toHaveBeenCalled();
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_MIN_FONT_SIZE);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(mockResizeTerminal).not.toHaveBeenCalled();
    });

    it('leaves plain wheel to xterm', async () => {
      await mountTerminal();
      const { handled, preventDefault, stopPropagation } = wheel({ deltaY: -100 });
      expect(handled).toBe(true);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(stopPropagation).not.toHaveBeenCalled();
      expect(constructedTerminals[0].options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE);
      expect(mockZoomInWindow).not.toHaveBeenCalled();
    });

    it('keeps the zoomed size when the cached xterm is remounted', async () => {
      const view = await mountTerminal();
      zoomKey(ctrlEqual);
      zoomKey(ctrlEqual);
      const xterm = constructedTerminals[0];
      view.unmount();

      render(<TerminalPane paneId="p1" />);
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(terminalConstructionCount).toBe(1);
      expect(constructedTerminals[0]).toBe(xterm);
      expect(xterm.options.fontSize).toBe(TERMINAL_DEFAULT_FONT_SIZE + 2);
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

    it('keeps receiving output while detached and reuses the same xterm on remount', async () => {
      setupStoreWithTerminal('t1', 'p1');
      const firstRender = render(<TerminalPane paneId="p1" />);

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(terminalConstructionCount).toBe(1);
      const originalElement = lastTerminalElement;
      expect(originalElement?.parentNode).not.toBeNull();

      const originalXterm = constructedTerminals[0];
      firstRender.unmount();
      await act(() => useThemeStore.getState().setTheme('light'));
      expect(originalXterm.options.theme).toEqual(getTerminalTheme('light'));
      expect(originalElement?.parentNode).toBeNull();
      expect(writeCachedTerminalData('t1', 'output while hidden')).toBe(true);
      expect(mockTerminalWrite).toHaveBeenCalledWith('output while hidden');

      render(<TerminalPane paneId="p1" />);
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(terminalConstructionCount).toBe(1);
      expect(originalElement?.parentNode).not.toBeNull();
      expect(constructedTerminals[0]).toBe(originalXterm);
      expect(originalXterm.options.theme).toEqual(getTerminalTheme('light'));
      expect(originalXterm.dispose).not.toHaveBeenCalled();
    });

    it('keeps disposal tombstones until terminal lifecycle cleanup finishes', async () => {
      const firstXterm = { dispose: vi.fn(), write: vi.fn(), options: {} };
      markTerminalDisposed('reused-id');
      cacheTerminalInstance('reused-id', firstXterm as never, {} as never);
      expect(firstXterm.dispose).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(5 * 60_000);

      const prematureXterm = { dispose: vi.fn(), write: vi.fn(), options: {} };
      cacheTerminalInstance('reused-id', prematureXterm as never, {} as never);
      expect(prematureXterm.dispose).toHaveBeenCalledOnce();

      finishTerminalDisposal('reused-id');
      const replacementXterm = { dispose: vi.fn(), write: vi.fn(), options: {} };
      cacheTerminalInstance('reused-id', replacementXterm as never, {} as never);
      expect(writeCachedTerminalData('reused-id', 'ready')).toBe(true);
      expect(replacementXterm.write).toHaveBeenCalledWith('ready');
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
    it('passes drag handle props to a generous header surface', () => {
      setupStoreWithTerminal('t1', 'p1');
      
      render(<TerminalPane paneId="p1" />);
      
      const dragSurface = document.querySelector('.terminal-header .pane-drag-surface');
      expect(dragSurface).toHaveAttribute('data-drag-activator', 'true');
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
