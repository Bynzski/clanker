// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import BrowserPanel from '../../../src/renderer/components/BrowserPanel';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import type { BrowserPaneState, WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
import { createWorkspaceFixture } from '../../setup/fixtures';

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  callback: ResizeObserverCallback;
  observedElement: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observedElement = element;
  }

  unobserve() {
    this.observedElement = null;
  }

  disconnect() {
    this.observedElement = null;
  }

  triggerResize() {
    if (!this.observedElement) {
      return;
    }

    const entry: ResizeObserverEntry = {
      target: this.observedElement,
      contentRect: new DOMRectReadOnly(0, 0, 800, 600),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    };
    this.callback([entry], this as unknown as ResizeObserver);
  }

  static reset() {
    MockResizeObserver.instances = [];
  }
}

// Mock the drag handle context
vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({
  useDragHandle: vi.fn().mockReturnValue({}),
}));

// Mock electron API for browser operations
const mockBrowserBack = vi.fn().mockResolvedValue(undefined);
const mockBrowserForward = vi.fn().mockResolvedValue(undefined);
const mockBrowserRefresh = vi.fn().mockResolvedValue(undefined);
const mockBrowserStop = vi.fn().mockResolvedValue(undefined);
const mockBrowserNavigate = vi.fn().mockResolvedValue(true);
const mockBrowserCreateTab = vi.fn().mockResolvedValue({ url: 'https://github.com', title: '' });
const mockBrowserCloseTab = vi.fn().mockResolvedValue(true);
const mockBrowserSwitchTab = vi.fn().mockResolvedValue({ url: 'https://github.com', title: '' });
const mockBrowserTabNavigate = vi.fn().mockResolvedValue(true);
const mockBrowserHistoryGet = vi.fn().mockResolvedValue([]);
const mockBrowserHistoryAdd = vi.fn().mockResolvedValue(true);
const mockBrowserHistoryClear = vi.fn().mockResolvedValue(true);
const mockBrowserHide = vi.fn().mockResolvedValue(undefined);
const mockBrowserSetBounds = vi.fn().mockResolvedValue(undefined);
const mockBrowserDisposeWorkspace = vi.fn().mockResolvedValue(undefined);
const mockOpenExternal = vi.fn().mockResolvedValue(true);
const mockCanGoBack = vi.fn().mockResolvedValue(false);
const mockCanGoForward = vi.fn().mockResolvedValue(false);
const mockAnnotationEnable = vi.fn().mockResolvedValue({ success: true });
const mockAnnotationDisable = vi.fn().mockResolvedValue({ success: true });
const mockAnnotationGetState = vi.fn().mockResolvedValue({ enabled: false, initialized: false, workspaceId: null });
const mockAnnotationCapture = vi.fn().mockResolvedValue({ success: false, error: 'No annotation pending' });
const mockAnnotationExport = vi.fn().mockResolvedValue({ success: true });
const mockAnnotationCheckEscaped = vi.fn().mockResolvedValue(false);
const mockOnAnnotationEscape = vi.fn(() => () => undefined);
const originalResizeObserver = global.ResizeObserver;
const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;

let rafId = 0;
let rafQueue = new Map<number, FrameRequestCallback>();

function flushAnimationFrame(id?: number) {
  const entries = id == null ? Array.from(rafQueue.entries()) : Array.from(rafQueue.entries()).filter(([entryId]) => entryId === id);

  for (const [entryId, callback] of entries) {
    rafQueue.delete(entryId);
    callback(performance.now());
  }
}

// Store state helpers
interface BrowserPanelStoreOverrides {
  browserPane?: BrowserPaneState | null;
  browserVisible?: boolean;
  browserOverlayCount?: number;
  activeWorkspaceId?: string;
  workspaces?: WorkspaceTab[];
}

function setupStore(overrides: BrowserPanelStoreOverrides = {}) {
  const defaultState = {
    browserPane: null as BrowserPaneState | null,
    browserVisible: true,
    browserOverlayCount: 0,
    activeWorkspaceId: 'workspace-1',
  };

  const state = { ...defaultState, ...overrides };
  const workspace = createWorkspaceFixture({
    id: state.activeWorkspaceId,
    lifecycle: 'active',
    browserPane: state.browserPane,
    browserVisible: state.browserVisible,
    browserOverlayCount: state.browserOverlayCount,
    browserUrl: 'https://github.com',
  });
  const workspaces = state.workspaces ?? [workspace];

  useWorkspaceStore.setState({
    browserPane: state.browserPane,
    browserVisible: state.browserVisible,
    browserOverlayCount: state.browserOverlayCount,
    workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    activeWorkspaceLifecycle: 'active',
  });

  return state;
}

function setActiveWorkspaceOverlayCount(browserOverlayCount: number) {
  useWorkspaceStore.setState((state) => ({
    browserOverlayCount,
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, browserOverlayCount }
        : workspace
    )),
  }));
}

function setupElectronAPIMocks() {
  window.electronAPI = {
    browserBack: mockBrowserBack,
    browserDisposeWorkspace: mockBrowserDisposeWorkspace,
    browserForward: mockBrowserForward,
    browserHide: mockBrowserHide,
    browserNavigate: mockBrowserNavigate,
    browserCreateTab: mockBrowserCreateTab,
    browserCloseTab: mockBrowserCloseTab,
    browserSwitchTab: mockBrowserSwitchTab,
    browserTabNavigate: mockBrowserTabNavigate,
    browserHistoryGet: mockBrowserHistoryGet,
    browserHistoryAdd: mockBrowserHistoryAdd,
    browserHistoryClear: mockBrowserHistoryClear,
    browserRefresh: mockBrowserRefresh,
    browserSetBounds: mockBrowserSetBounds,
    browserStop: mockBrowserStop,
    canGoBack: mockCanGoBack,
    canGoForward: mockCanGoForward,
    openExternal: mockOpenExternal,
    annotationEnable: mockAnnotationEnable,
    annotationDisable: mockAnnotationDisable,
    annotationGetState: mockAnnotationGetState,
    annotationCapture: mockAnnotationCapture,
    annotationExport: mockAnnotationExport,
    annotationCheckEscaped: mockAnnotationCheckEscaped,
    onAnnotationEscape: mockOnAnnotationEscape,
  } as unknown as typeof window.electronAPI;
}

describe('BrowserPanel', () => {
  const defaultProps = {
    layoutVersion: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupElectronAPIMocks();
    MockResizeObserver.reset();
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    rafId = 0;
    rafQueue = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = ++rafId;
      rafQueue.set(id, callback);
      return id;
    });
    window.cancelAnimationFrame = vi.fn((id: number) => {
      rafQueue.delete(id);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    global.ResizeObserver = originalResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  // =========================================================================
  // Header
  // =========================================================================
  describe('header', () => {
    it('renders browser panel header', () => {
      setupStore();

      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByText('Browser')).toBeTruthy();
    });

    it('renders drag handle', () => {
      setupStore();

      render(<BrowserPanel {...defaultProps} />);

      const dragHandle = document.querySelector('.browser-pane-drag-handle');
      expect(dragHandle).toBeTruthy();
    });


    it('hides lock icon when browser pane is not locked', () => {
      setupStore({
        browserPane: { id: 'bp1', position: { x: 0, y: 0, w: 100, h: 100 }, tabs: [{ id: 'bt-1', url: 'https://github.com', title: '', canGoBack: false, canGoForward: false }], activeTabId: 'bt-1' },
      });

      render(<BrowserPanel {...defaultProps} />);

      const lockIcon = document.querySelector('.browser-pane-lock');
      expect(lockIcon).toBeNull();
    });

    it('hides lock icon when browser pane is null', () => {
      setupStore({ browserPane: null });

      render(<BrowserPanel {...defaultProps} />);

      const lockIcon = document.querySelector('.browser-pane-lock');
      expect(lockIcon).toBeNull();
    });
  });

  // =========================================================================
  // Toolbar - Navigation Buttons
  // =========================================================================
  describe('toolbar navigation buttons', () => {
    beforeEach(() => {
      setupStore();
    });

    it('renders back button', () => {
      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByTitle('Back')).toBeTruthy();
    });

    it('renders forward button', () => {
      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByTitle('Forward')).toBeTruthy();
    });

    it('renders refresh button', () => {
      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByTitle('Refresh')).toBeTruthy();
    });

    it('renders stop button', () => {
      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByTitle('Stop')).toBeTruthy();
    });

    it('disables back button when canGoBack is false', async () => {
      mockCanGoBack.mockResolvedValue(false);

      render(<BrowserPanel {...defaultProps} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600); // Wait for polling
      });

      const backButton = screen.getByTitle('Back');
      expect(backButton).toBeDisabled();
    });

    it('enables back button when canGoBack is true', async () => {
      mockCanGoBack.mockResolvedValue(true);

      render(<BrowserPanel {...defaultProps} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      const backButton = screen.getByTitle('Back');
      expect(backButton).not.toBeDisabled();
    });

    it('disables forward button when canGoForward is false', async () => {
      mockCanGoForward.mockResolvedValue(false);

      render(<BrowserPanel {...defaultProps} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      const forwardButton = screen.getByTitle('Forward');
      expect(forwardButton).toBeDisabled();
    });

    it('enables forward button when canGoForward is true', async () => {
      mockCanGoForward.mockResolvedValue(true);

      render(<BrowserPanel {...defaultProps} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      const forwardButton = screen.getByTitle('Forward');
      expect(forwardButton).not.toBeDisabled();
    });

    it('calls browserBack when back button is clicked', async () => {
      render(<BrowserPanel {...defaultProps} />);

      // Advance timers to let effects run
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      fireEvent.click(screen.getByTitle('Back'));
      expect(mockBrowserBack).toHaveBeenCalled();
    });

    it('calls browserForward when forward button is clicked', async () => {
      render(<BrowserPanel {...defaultProps} />);

      // Advance timers to let effects run
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      fireEvent.click(screen.getByTitle('Forward'));
      expect(mockBrowserForward).toHaveBeenCalled();
    });

    it('calls browserRefresh when refresh button is clicked', () => {
      render(<BrowserPanel {...defaultProps} />);

      fireEvent.click(screen.getByTitle('Refresh'));
      expect(mockBrowserRefresh).toHaveBeenCalled();
    });

    it('calls browserStop when stop button is clicked', () => {
      render(<BrowserPanel {...defaultProps} />);

      fireEvent.click(screen.getByTitle('Stop'));
      expect(mockBrowserStop).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Toolbar - URL Input
  // =========================================================================
  describe('URL input', () => {
    beforeEach(() => {
      setupStore();
    });

    it('renders URL input with placeholder', () => {
      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByPlaceholderText('Enter URL...')).toBeTruthy();
    });

    it('displays initial URL in input from active browser tab', () => {
      setupStore({
        browserPane: {
          id: 'bp1',
          position: { x: 0, y: 0, w: 100, h: 100 },
          activeTabId: 'tab-1',
          tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', canGoBack: false, canGoForward: false }],
        },
      });

      render(<BrowserPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter URL...') as HTMLInputElement;
      expect(input.value).toBe('https://example.com');
    });

    it('updates input when active tab URL changes', () => {
      setupStore({
        browserPane: {
          id: 'bp1',
          position: { x: 0, y: 0, w: 100, h: 100 },
          activeTabId: 'tab-1',
          tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', canGoBack: false, canGoForward: false }],
        },
      });

      const { rerender } = render(<BrowserPanel {...defaultProps} />);

      setupStore({
        browserPane: {
          id: 'bp1',
          position: { x: 0, y: 0, w: 100, h: 100 },
          activeTabId: 'tab-1',
          tabs: [{ id: 'tab-1', url: 'https://github.com', title: 'GitHub', canGoBack: false, canGoForward: false }],
        },
      });
      rerender(<BrowserPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter URL...') as HTMLInputElement;
      expect(input.value).toBe('https://github.com');
    });

    it('calls browserNavigate with https URL when Go is clicked', () => {
      render(<BrowserPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter URL...');
      fireEvent.change(input, { target: { value: 'github.com' } });

      fireEvent.click(screen.getByRole('button', { name: 'Go' }));

      expect(mockBrowserNavigate).toHaveBeenCalledWith('workspace-1', 'https://github.com');
    });

    it('does not navigate when input is empty', () => {
      render(<BrowserPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter URL...');
      fireEvent.change(input, { target: { value: '' } });

      fireEvent.click(screen.getByRole('button', { name: 'Go' }));

      expect(mockBrowserNavigate).not.toHaveBeenCalled();
    });

    it('trims whitespace from URL', () => {
      render(<BrowserPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter URL...');
      fireEvent.change(input, { target: { value: '  github.com  ' } });

      fireEvent.click(screen.getByRole('button', { name: 'Go' }));

      expect(mockBrowserNavigate).toHaveBeenCalledWith('workspace-1', 'https://github.com');
    });

    it('navigation updates the store browser URL for the active tab', async () => {
      setupStore({
        browserPane: {
          id: 'bp1',
          position: { x: 0, y: 0, w: 100, h: 100 },
          activeTabId: 'tab-1',
          tabs: [{ id: 'tab-1', url: 'https://github.com', title: 'GitHub', canGoBack: false, canGoForward: false }],
        },
      });
      render(<BrowserPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter URL...');
      fireEvent.change(input, { target: { value: 'example.com' } });

      fireEvent.click(screen.getByRole('button', { name: 'Go' }));

      await waitFor(() => {
        const workspace = useWorkspaceStore.getState().getWorkspaceById('workspace-1');
        const activeTab = workspace?.browserPane?.tabs.find(t => t.id === workspace.browserPane?.activeTabId);
        expect(activeTab?.url).toBe('https://example.com');
      });
    });

    it('calls browserNavigate on Enter key press', () => {
      render(<BrowserPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter URL...');
      fireEvent.change(input, { target: { value: 'example.com' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockBrowserNavigate).toHaveBeenCalledWith('workspace-1', 'https://example.com');
    });

    it('preserves http protocol if already specified', () => {
      render(<BrowserPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter URL...');
      fireEvent.change(input, { target: { value: 'http://example.com' } });

      fireEvent.click(screen.getByRole('button', { name: 'Go' }));

      expect(mockBrowserNavigate).toHaveBeenCalledWith('workspace-1', 'http://example.com');
    });
  });

  // =========================================================================
  // Toolbar - Action Buttons
  // =========================================================================
  describe('toolbar action buttons', () => {
    beforeEach(() => {
      setupStore();
    });

    it('renders external link button', () => {
      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByTitle('Open in system browser')).toBeTruthy();
    });


    it('calls openExternal with the active tab URL', () => {
      setupStore({
        browserPane: {
          id: 'bp1',
          position: { x: 0, y: 0, w: 100, h: 100 },
          activeTabId: 'tab-1',
          tabs: [{ id: 'tab-1', url: 'https://github.com', title: 'GitHub', canGoBack: false, canGoForward: false }],
        },
      });
      render(<BrowserPanel {...defaultProps} />);

      fireEvent.click(screen.getByTitle('Open in system browser'));

      expect(mockOpenExternal).toHaveBeenCalledWith('https://github.com');
    });
  });

  // =========================================================================
  // Content Area
  // =========================================================================
  describe('content area', () => {
    beforeEach(() => {
      setupStore();
    });

    it('renders content shell', () => {
      render(<BrowserPanel {...defaultProps} />);

      expect(document.querySelector('.browser-content-shell')).toBeTruthy();
    });

    it('renders content div', () => {
      render(<BrowserPanel {...defaultProps} />);

      expect(document.querySelector('.browser-content')).toBeTruthy();
    });
  });

  // =========================================================================
  // Browser Hide/Show Behavior
  // =========================================================================
  describe('browser hide/show behavior', () => {
    it('does not call browserHide when browserVisible is true', () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      render(<BrowserPanel {...defaultProps} />);

      // browserHide should not be called initially when visible
      expect(mockBrowserHide).not.toHaveBeenCalled();
    });

    it('hides browser when browserOverlayCount increases', async () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      render(<BrowserPanel {...defaultProps} />);

      setActiveWorkspaceOverlayCount(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      expect(mockBrowserHide).toHaveBeenCalled();
    });

    it('calls browserHide on unmount', () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      const { unmount } = render(<BrowserPanel {...defaultProps} />);

      unmount();

      expect(mockBrowserHide).toHaveBeenCalled();
    });

    it('re-sends bounds after an overlay closes even when the measured rect is unchanged', () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      render(<BrowserPanel {...defaultProps} />);

      const contentEl = document.querySelector('.browser-content') as HTMLElement;
      Object.defineProperty(contentEl, 'getBoundingClientRect', {
        value: () => ({ left: 100, top: 100, width: 800, height: 600 }),
        writable: true,
      });

      act(() => {
        flushAnimationFrame();
      });
      expect(mockBrowserSetBounds).toHaveBeenCalledTimes(1);

      act(() => {
        setActiveWorkspaceOverlayCount(1);
      });
      expect(mockBrowserHide).toHaveBeenCalledTimes(1);

      mockBrowserSetBounds.mockClear();
      act(() => {
        setActiveWorkspaceOverlayCount(0);
      });

      act(() => {
        flushAnimationFrame();
        flushAnimationFrame();
      });

      expect(mockBrowserSetBounds).toHaveBeenCalledTimes(1);
    });

    it('hides parked workspace browser views immediately and does not resume them', async () => {
      const parkedWorkspace = createWorkspaceFixture({
        id: 'workspace-1',
        lifecycle: 'parked',
        browserVisible: true,
        browserUrl: 'https://parked.example',
      });
      const activeWorkspace = createWorkspaceFixture({
        id: 'workspace-2',
        lifecycle: 'active',
        browserVisible: false,
      });

      setupStore({
        activeWorkspaceId: 'workspace-2',
        browserVisible: false,
        workspaces: [parkedWorkspace, activeWorkspace],
      });

      render(<BrowserPanel {...defaultProps} workspaceId="workspace-1" />);

      act(() => {
        flushAnimationFrame();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(mockBrowserHide).toHaveBeenCalledWith('workspace-1');
      expect(mockBrowserSetBounds).not.toHaveBeenCalled();
      expect(mockCanGoBack).not.toHaveBeenCalled();
      expect(mockCanGoForward).not.toHaveBeenCalled();
    });

    it('preserves lastBoundsRef and forces one reactivation bounds call on workspace switch-back', async () => {
      // When switching back to a workspace, the browser must become visible again.
      // Simply restoring the last bounds is sufficient — the IPC both repositions
      // the view and (via updateBrowserView → setVisible(true)) makes it visible.
      // scheduleBoundsUpdate() alone cannot be relied upon because it early-returns
      // when lastBoundsRef is non-null and within the 1px jitter threshold.
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      const { rerender } = render(<BrowserPanel {...defaultProps} workspaceId="workspace-1" />);

      const contentEl = document.querySelector('.browser-content') as HTMLElement;
      Object.defineProperty(contentEl, 'getBoundingClientRect', {
        value: () => ({ left: 100, top: 100, width: 800, height: 600 }),
        writable: true,
      });

      // Establish initial bounds
      act(() => {
        flushAnimationFrame();
      });
      expect(mockBrowserSetBounds).toHaveBeenCalled();
      const preservedBounds = mockBrowserSetBounds.mock.calls[mockBrowserSetBounds.mock.calls.length - 1]?.[1];

      // Switch away: browser is hidden but lastBoundsRef is preserved
      useWorkspaceStore.setState({ activeWorkspaceId: 'workspace-2' });

      act(() => {
        rerender(<BrowserPanel {...defaultProps} workspaceId="workspace-1" />);
        flushAnimationFrame();
      });

      expect(mockBrowserHide).toHaveBeenCalledWith('workspace-1');

      // Switch back: browser must be re-shown via a bounds IPC with preserved bounds
      mockBrowserSetBounds.mockClear();
      useWorkspaceStore.setState({ activeWorkspaceId: 'workspace-1' });

      act(() => {
        rerender(<BrowserPanel {...defaultProps} workspaceId="workspace-1" />);
        flushAnimationFrame();
      });

      // One explicit bounds IPC restores visibility (not suppressed by threshold)
      expect(mockBrowserSetBounds).toHaveBeenCalledTimes(1);
      expect(mockBrowserSetBounds).toHaveBeenCalledWith('workspace-1', preservedBounds);
    });

    it('clears lastBoundsRef only on true component unmount', () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      const { unmount } = render(<BrowserPanel {...defaultProps} />);

      const contentEl = document.querySelector('.browser-content') as HTMLElement;
      Object.defineProperty(contentEl, 'getBoundingClientRect', {
        value: () => ({ left: 100, top: 100, width: 800, height: 600 }),
        writable: true,
      });

      act(() => {
        flushAnimationFrame();
      });

      // Now unmount the component — this is the only path where lastBoundsRef
      // should be cleared under the shared-container design.
      mockBrowserSetBounds.mockClear();
      unmount();

      // browserHide should have been called (unmount cleanup path)
      expect(mockBrowserHide).toHaveBeenCalled();
      // No bounds IPC should have been sent during cleanup (bounds were already sent)
      expect(mockBrowserSetBounds).not.toHaveBeenCalled();
    });

  });

  // =========================================================================
  // Bounds Update
  // =========================================================================
  describe('bounds update', () => {
    it('observes the outer panel while measuring bounds from the content element', () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      render(<BrowserPanel {...defaultProps} />);

      const panelEl = document.querySelector('.browser-panel');
      const contentEl = document.querySelector('.browser-content');
      expect(MockResizeObserver.instances).toHaveLength(1);
      expect(MockResizeObserver.instances[0]?.observedElement).toBe(panelEl);
      expect(contentEl).toBeTruthy();
    });

    it('renders and handles bounds update scheduling without errors', async () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      render(<BrowserPanel {...defaultProps} />);

      // Advance timers to let effects execute
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      // browserSetBounds may not be called if getBoundingClientRect returns 0
      // but we verify the component rendered without errors
      expect(document.querySelector('.browser-panel')).toBeTruthy();
    });

    it('schedules through RAF from ResizeObserver and collapses repeated resize callbacks into one bounds update', () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      render(<BrowserPanel {...defaultProps} />);

      const contentEl = document.querySelector('.browser-content') as HTMLElement;
      Object.defineProperty(contentEl, 'getBoundingClientRect', {
        value: () => ({ left: 100, top: 100, width: 800, height: 600 }),
        writable: true,
      });

      mockBrowserSetBounds.mockClear();
      const observer = MockResizeObserver.instances[0];
      expect(observer).toBeTruthy();

      observer?.triggerResize();
      observer?.triggerResize();
      observer?.triggerResize();

      expect(window.requestAnimationFrame).toHaveBeenCalled();
      expect(mockBrowserSetBounds).not.toHaveBeenCalled();

      act(() => {
        flushAnimationFrame();
      });

      expect(mockBrowserSetBounds).toHaveBeenCalledTimes(1);
    });

    it('retries one frame later when the initial visible-state measurement is zero-sized', () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      render(<BrowserPanel {...defaultProps} />);

      const contentEl = document.querySelector('.browser-content') as HTMLElement;
      const getBoundingClientRect = vi
        .fn()
        .mockReturnValueOnce({ left: 100, top: 100, width: 0, height: 0 })
        .mockReturnValueOnce({ left: 100, top: 100, width: 800, height: 600 });

      Object.defineProperty(contentEl, 'getBoundingClientRect', {
        value: getBoundingClientRect,
        writable: true,
      });

      mockBrowserSetBounds.mockClear();

      act(() => {
        flushAnimationFrame();
      });
      expect(mockBrowserSetBounds).not.toHaveBeenCalled();

      act(() => {
        flushAnimationFrame();
      });
      expect(mockBrowserSetBounds).toHaveBeenCalledTimes(1);
    });

    it('updates scheduleBoundsUpdate when layoutVersion changes', async () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      const { rerender } = render(<BrowserPanel {...defaultProps} layoutVersion={1} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      // Rerender with new layoutVersion
      rerender(<BrowserPanel {...defaultProps} layoutVersion={2} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      // Verify component still renders correctly after layout change
      expect(document.querySelector('.browser-panel')).toBeTruthy();
    });

    it('does not update bounds when browser is not visible', async () => {
      setupStore({ browserVisible: false, browserOverlayCount: 0 });

      render(<BrowserPanel {...defaultProps} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockBrowserSetBounds).not.toHaveBeenCalled();
    });

    it('does not update bounds when overlay is showing', async () => {
      setupStore({ browserVisible: true, browserOverlayCount: 1 });

      render(<BrowserPanel {...defaultProps} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockBrowserSetBounds).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Bounds Diff Threshold
  // =========================================================================
  describe('bounds diff threshold', () => {
    it('sends initial bounds update when no previous bounds exist', async () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      render(<BrowserPanel {...defaultProps} />);

      // Mock getBoundingClientRect to return valid dimensions (jsdom returns 0 otherwise)
      const contentEl = document.querySelector('.browser-content') as HTMLElement;
      Object.defineProperty(contentEl, 'getBoundingClientRect', {
        value: () => ({ left: 100, top: 100, width: 800, height: 600 }),
        writable: true,
      });

      await act(async () => {
        flushAnimationFrame();
        await vi.advanceTimersByTimeAsync(100);
      });

      // First update should be sent even though lastBoundsRef is null
      expect(mockBrowserSetBounds).toHaveBeenCalled();
    });

    it('suppresses bounds update when bounds have not changed', async () => {
      setupStore({ browserVisible: true, browserOverlayCount: 0 });

      render(<BrowserPanel {...defaultProps} />);

      // Mock getBoundingClientRect to return valid dimensions
      const contentEl = document.querySelector('.browser-content') as HTMLElement;
      Object.defineProperty(contentEl, 'getBoundingClientRect', {
        value: () => ({ left: 100, top: 100, width: 800, height: 600 }),
        writable: true,
      });

      await act(async () => {
        flushAnimationFrame();
        await vi.advanceTimersByTimeAsync(200);
      });

      // First bounds update should have been sent
      expect(mockBrowserSetBounds).toHaveBeenCalled();

      // Multiple rapid layoutVersion changes should not cause excessive calls
      // due to the threshold suppressing micro-jitter
      mockBrowserSetBounds.mockClear();

      // Simulate rapid layoutVersion changes
      const { rerender } = render(<BrowserPanel {...defaultProps} layoutVersion={1} />);
      await act(async () => {
        flushAnimationFrame();
        await vi.advanceTimersByTimeAsync(50);
      });
      rerender(<BrowserPanel {...defaultProps} layoutVersion={2} />);
      await act(async () => {
        flushAnimationFrame();
        await vi.advanceTimersByTimeAsync(50);
      });

      // With the threshold, repeated layoutVersion changes should not flood IPC calls
      expect(mockBrowserSetBounds.mock.calls.length).toBeLessThanOrEqual(3);
    });
  });

  // =========================================================================
  // Navigation State Polling
  // =========================================================================
  describe('navigation state polling', () => {
    it('polls navigation state periodically', async () => {
      setupStore();
      mockCanGoBack.mockResolvedValue(false);
      mockCanGoForward.mockResolvedValue(false);

      render(<BrowserPanel {...defaultProps} />);

      // Initial poll + one more interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(mockCanGoBack).toHaveBeenCalled();
      expect(mockCanGoForward).toHaveBeenCalled();

      // Should poll again
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      // At least 2 calls (initial + periodic)
      expect(mockCanGoBack.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('updates canGoBack state from API', async () => {
      setupStore();
      mockCanGoBack.mockResolvedValue(true);
      mockCanGoForward.mockResolvedValue(false);

      render(<BrowserPanel {...defaultProps} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      const backButton = screen.getByTitle('Back');
      expect(backButton).not.toBeDisabled();
    });

    it('updates canGoForward state from API', async () => {
      setupStore();
      mockCanGoBack.mockResolvedValue(false);
      mockCanGoForward.mockResolvedValue(true);

      render(<BrowserPanel {...defaultProps} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      const forwardButton = screen.getByTitle('Forward');
      expect(forwardButton).not.toBeDisabled();
    });

    it('does not poll navigation state for a parked workspace instance', async () => {
      const parkedWorkspace = createWorkspaceFixture({
        id: 'workspace-1',
        lifecycle: 'parked',
        browserVisible: true,
      });
      const activeWorkspace = createWorkspaceFixture({
        id: 'workspace-2',
        lifecycle: 'active',
        browserVisible: false,
      });

      setupStore({
        activeWorkspaceId: 'workspace-2',
        browserVisible: false,
        workspaces: [parkedWorkspace, activeWorkspace],
      });

      render(<BrowserPanel {...defaultProps} workspaceId="workspace-1" />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(mockCanGoBack).not.toHaveBeenCalled();
      expect(mockCanGoForward).not.toHaveBeenCalled();
      expect(screen.getByTitle('Back')).toBeDisabled();
      expect(screen.getByTitle('Forward')).toBeDisabled();
    });
  });

  // =========================================================================
  // Cleanup
  // =========================================================================
  describe('cleanup', () => {
    it('cleans up interval on unmount', () => {
      setupStore();

      const { unmount } = render(<BrowserPanel {...defaultProps} />);

      // Advance time to ensure interval is set up
      act(() => {
        vi.advanceTimersByTime(600);
      });

      unmount();

      // Verify cleanup happened (no errors from timers)
      expect(mockBrowserHide).toHaveBeenCalled();
    });

    it('cleans up resize observer on unmount', () => {
      setupStore();

      const { unmount } = render(<BrowserPanel {...defaultProps} />);

      unmount();

      expect(mockBrowserHide).toHaveBeenCalled();
    });

    it('cleans up animation frame on unmount', () => {
      setupStore();

      const { unmount } = render(<BrowserPanel {...defaultProps} />);

      act(() => {
        vi.advanceTimersByTime(100);
      });

      unmount();

      expect(mockBrowserHide).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Browser Tabs
  // =========================================================================
  describe('browser tabs', () => {
    const createTabbedPane = (): BrowserPaneState => ({
      id: 'bp1',
      position: { x: 0, y: 0, w: 100, h: 100 },
      activeTabId: 'tab-a',
      tabs: [
        { id: 'tab-a', url: 'https://github.com', title: 'GitHub', canGoBack: false, canGoForward: false },
        { id: 'tab-b', url: 'https://example.com/docs', title: '', canGoBack: true, canGoForward: false },
      ],
    });

    it('renders tab count and opens the dropdown', () => {
      setupStore({ browserPane: createTabbedPane() });
      render(<BrowserPanel layoutVersion={1} />);

      expect(screen.getByTitle('Browser tabs').textContent).toContain('2');
      fireEvent.click(screen.getByTitle('Browser tabs'));

      expect(screen.getByRole('menu', { name: 'Browser tabs' })).toBeTruthy();
      expect(screen.getAllByText('GitHub').length).toBeGreaterThan(0);
      expect(screen.getByText('example.com/docs')).toBeTruthy();
    });

    it('hides the native browser while the tab dropdown is open', async () => {
      setupStore({ browserPane: createTabbedPane() });
      render(<BrowserPanel layoutVersion={1} />);

      fireEvent.click(screen.getByTitle('Browser tabs'));
      await waitFor(() => {
        expect(useWorkspaceStore.getState().getWorkspaceById('workspace-1')?.browserOverlayCount).toBe(1);
      });

      fireEvent.click(screen.getByTitle('Browser tabs'));
      await waitFor(() => {
        expect(useWorkspaceStore.getState().getWorkspaceById('workspace-1')?.browserOverlayCount).toBe(0);
      });
    });

    it('plus creates a store tab and calls IPC with the same tab ID', async () => {
      setupStore({ browserPane: createTabbedPane() });
      render(<BrowserPanel layoutVersion={1} />);

      fireEvent.click(screen.getByTitle('Browser tabs'));
      fireEvent.click(screen.getByTitle('New tab'));

      await waitFor(() => {
        expect(mockBrowserCreateTab).toHaveBeenCalled();
      });

      const workspace = useWorkspaceStore.getState().getWorkspaceById('workspace-1');
      const activeTabId = workspace?.browserPane?.activeTabId;
      expect(activeTabId).toBeTruthy();
      expect(activeTabId).not.toBe('tab-a');
      expect(activeTabId).not.toBe('tab-b');
      expect(mockBrowserCreateTab).toHaveBeenCalledWith('workspace-1', activeTabId);
      expect(mockBrowserSwitchTab).toHaveBeenCalledWith('workspace-1', activeTabId);
    });

    it('switching tabs calls store and IPC and syncs the URL input', async () => {
      setupStore({ browserPane: createTabbedPane() });
      render(<BrowserPanel layoutVersion={1} />);

      fireEvent.click(screen.getByTitle('Browser tabs'));
      fireEvent.click(screen.getByText('example.com/docs'));

      await waitFor(() => {
        expect(mockBrowserSwitchTab).toHaveBeenCalledWith('workspace-1', 'tab-b');
      });
      expect(useWorkspaceStore.getState().getWorkspaceById('workspace-1')?.browserPane?.activeTabId).toBe('tab-b');
      expect((screen.getByPlaceholderText('Enter URL...') as HTMLInputElement).value).toBe('https://example.com/docs');
    });

    it('close button does not propagate to row switch and closing active selects adjacent tab', async () => {
      setupStore({ browserPane: createTabbedPane() });
      render(<BrowserPanel layoutVersion={1} />);

      fireEvent.click(screen.getByTitle('Browser tabs'));
      fireEvent.click(screen.getAllByTitle('Close tab')[0]);

      await waitFor(() => {
        expect(mockBrowserCloseTab).toHaveBeenCalledWith('workspace-1', 'tab-a');
      });
      expect(mockBrowserSwitchTab).toHaveBeenCalledWith('workspace-1', 'tab-b');
      expect(mockBrowserSwitchTab).not.toHaveBeenCalledWith('workspace-1', 'tab-a');
      expect(useWorkspaceStore.getState().getWorkspaceById('workspace-1')?.browserPane?.activeTabId).toBe('tab-b');
    });

    it('last tab cannot be closed', () => {
      setupStore({
        browserPane: {
          id: 'bp1',
          position: { x: 0, y: 0, w: 100, h: 100 },
          activeTabId: 'tab-a',
          tabs: [{ id: 'tab-a', url: 'https://github.com', title: 'GitHub', canGoBack: false, canGoForward: false }],
        },
      });
      render(<BrowserPanel layoutVersion={1} />);

      fireEvent.click(screen.getByTitle('Browser tabs'));
      const closeButton = screen.getByTitle('Cannot close the last tab') as HTMLButtonElement;
      expect(closeButton.disabled).toBe(true);
      fireEvent.click(closeButton);

      expect(mockBrowserCloseTab).not.toHaveBeenCalled();
    });

    it('bounds are resent on tab switch', async () => {
      setupStore({ browserPane: createTabbedPane() });
      render(<BrowserPanel layoutVersion={1} />);

      const content = document.querySelector('.browser-content') as HTMLElement;
      Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 10, top: 20, width: 500, height: 400, right: 510, bottom: 420, x: 10, y: 20, toJSON: () => ({}) }),
      });

      act(() => {
        flushAnimationFrame();
      });
      mockBrowserSetBounds.mockClear();

      fireEvent.click(screen.getByTitle('Browser tabs'));
      fireEvent.click(screen.getByText('example.com/docs'));
      act(() => {
        flushAnimationFrame();
      });

      await waitFor(() => {
        expect(mockBrowserSetBounds).toHaveBeenCalledWith('workspace-1', { x: 10, y: 20, width: 500, height: 400 }, 'tab-b');
      });
    });

    it('open external uses the active tab URL', () => {
      setupStore({ browserPane: createTabbedPane() });
      render(<BrowserPanel layoutVersion={1} />);

      fireEvent.click(screen.getByTitle('Open in system browser'));

      expect(mockOpenExternal).toHaveBeenCalledWith('https://github.com');
    });

    it('manual navigation uses browserTabNavigate for the active tab', async () => {
      setupStore({ browserPane: createTabbedPane() });
      render(<BrowserPanel layoutVersion={1} />);

      const input = screen.getByPlaceholderText('Enter URL...');
      fireEvent.change(input, { target: { value: 'localhost:3000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Go' }));

      await waitFor(() => {
        expect(mockBrowserTabNavigate).toHaveBeenCalledWith('workspace-1', 'tab-a', 'https://localhost:3000');
      });
    });
  });

  // =========================================================================
  // URL Autocomplete
  // =========================================================================
  describe('URL autocomplete', () => {
    const createTabbedPane = (): BrowserPaneState => ({
      id: 'bp1',
      position: { x: 0, y: 0, w: 100, h: 100 },
      activeTabId: 'tab-a',
      tabs: [
        { id: 'tab-a', url: 'https://github.com', title: 'GitHub', canGoBack: false, canGoForward: false },
        { id: 'tab-b', url: 'https://example.com/docs', title: 'Docs', canGoBack: false, canGoForward: false },
      ],
    });

    beforeEach(() => {
      mockBrowserHistoryGet.mockResolvedValue([
        { url: 'http://localhost:3000/', title: 'Local App', lastVisited: 300 },
        { url: 'https://github.com/clanker-grid', title: 'Clanker Grid', lastVisited: 200 },
      ]);
      setupStore({ browserPane: createTabbedPane() });
    });

    it('debounces history queries by 300ms', async () => {
      render(<BrowserPanel layoutVersion={1} />);
      const input = screen.getByPlaceholderText('Enter URL...');

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'lo' } });
      fireEvent.change(input, { target: { value: 'local' } });

      expect(mockBrowserHistoryGet).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      await waitFor(() => {
        expect(mockBrowserHistoryGet).toHaveBeenCalledTimes(1);
        expect(mockBrowserHistoryGet).toHaveBeenCalledWith('local');
      });
    });

    it('does not query for fewer than 2 characters', async () => {
      render(<BrowserPanel layoutVersion={1} />);
      const input = screen.getByPlaceholderText('Enter URL...');

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'g' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });

      expect(mockBrowserHistoryGet).not.toHaveBeenCalled();
    });

    it('renders suggestions returned by IPC', async () => {
      render(<BrowserPanel layoutVersion={1} />);
      const input = screen.getByPlaceholderText('Enter URL...');

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'local' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(await screen.findByRole('listbox', { name: 'URL history suggestions' })).toBeTruthy();
      expect(screen.getByText('http://localhost:3000/')).toBeTruthy();
      expect(screen.getByText('Local App')).toBeTruthy();
    });

    it('hides the native browser while URL suggestions are visible', async () => {
      render(<BrowserPanel layoutVersion={1} />);
      const input = screen.getByPlaceholderText('Enter URL...');

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'local' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      await screen.findByRole('listbox', { name: 'URL history suggestions' });
      expect(useWorkspaceStore.getState().getWorkspaceById('workspace-1')?.browserOverlayCount).toBe(1);

      fireEvent.keyDown(input, { key: 'Escape' });
      await waitFor(() => {
        expect(useWorkspaceStore.getState().getWorkspaceById('workspace-1')?.browserOverlayCount).toBe(0);
      });
    });

    it('clicking a suggestion navigates the active tab', async () => {
      render(<BrowserPanel layoutVersion={1} />);
      const input = screen.getByPlaceholderText('Enter URL...');

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'local' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      fireEvent.click(await screen.findByText('http://localhost:3000/'));

      await waitFor(() => {
        expect(mockBrowserTabNavigate).toHaveBeenCalledWith('workspace-1', 'tab-a', 'http://localhost:3000/');
      });
    });

    it('keyboard selection uses highlighted suggestion on Enter', async () => {
      render(<BrowserPanel layoutVersion={1} />);
      const input = screen.getByPlaceholderText('Enter URL...');

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'git' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      await screen.findByText('http://localhost:3000/');

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(mockBrowserTabNavigate).toHaveBeenCalledWith('workspace-1', 'tab-a', 'https://github.com/clanker-grid');
      });
    });

    it('Escape closes suggestions', async () => {
      render(<BrowserPanel layoutVersion={1} />);
      const input = screen.getByPlaceholderText('Enter URL...');

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'local' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(await screen.findByRole('listbox', { name: 'URL history suggestions' })).toBeTruthy();

      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByRole('listbox', { name: 'URL history suggestions' })).toBeNull();
    });

    it('switching tabs clears stale suggestions and syncs input', async () => {
      render(<BrowserPanel layoutVersion={1} />);
      const input = screen.getByPlaceholderText('Enter URL...') as HTMLInputElement;

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'local' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(await screen.findByRole('listbox', { name: 'URL history suggestions' })).toBeTruthy();

      fireEvent.click(screen.getByTitle('Browser tabs'));
      fireEvent.click(screen.getByText('Docs'));

      await waitFor(() => {
        expect(screen.queryByRole('listbox', { name: 'URL history suggestions' })).toBeNull();
      });
      expect(input.value).toBe('https://example.com/docs');
    });
  });

  // =========================================================================
  // Go Button
  // =========================================================================
  describe('Go button', () => {
    beforeEach(() => {
      setupStore();
    });

    it('renders Go button', () => {
      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Go' })).toBeTruthy();
    });

    it('is enabled when URL is entered', () => {
      render(<BrowserPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter URL...');
      fireEvent.change(input, { target: { value: 'test.com' } });

      const goButton = screen.getByRole('button', { name: 'Go' });
      expect(goButton).not.toBeDisabled();
    });

    it('is enabled even with empty URL (allows navigation with other means)', () => {
      render(<BrowserPanel {...defaultProps} />);

      // The component doesn't disable the button based on URL content
      // it just doesn't navigate when URL is empty
      const goButton = screen.getByRole('button', { name: 'Go' });
      expect(goButton).toBeTruthy();
    });
  });
});
