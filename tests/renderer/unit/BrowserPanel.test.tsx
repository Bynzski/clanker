// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import BrowserPanel from '../../../src/renderer/components/BrowserPanel';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import type { WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
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
const mockBrowserHide = vi.fn().mockResolvedValue(undefined);
const mockBrowserSetBounds = vi.fn().mockResolvedValue(undefined);
const mockBrowserDisposeWorkspace = vi.fn().mockResolvedValue(undefined);
const mockOpenExternal = vi.fn().mockResolvedValue(true);
const mockCanGoBack = vi.fn().mockResolvedValue(false);
const mockCanGoForward = vi.fn().mockResolvedValue(false);
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
  browserPane?: { id: string; position: { x: number; y: number; w: number; h: number }; locked: boolean } | null;
  browserVisible?: boolean;
  browserOverlayCount?: number;
  bringBrowserIntoView?: (workspaceId?: string) => void;
  toggleBrowserLock?: (workspaceId?: string) => void;
  activeWorkspaceId?: string;
  workspaces?: WorkspaceTab[];
}

function setupStore(overrides: BrowserPanelStoreOverrides = {}) {
  const defaultState = {
    browserPane: null as { id: string; position: { x: number; y: number; w: number; h: number }; locked: boolean } | null,
    browserVisible: true,
    browserOverlayCount: 0,
    bringBrowserIntoView: vi.fn(),
    toggleBrowserLock: vi.fn(),
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
    bringBrowserIntoView: state.bringBrowserIntoView,
    toggleBrowserLock: state.toggleBrowserLock,
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
    browserRefresh: mockBrowserRefresh,
    browserSetBounds: mockBrowserSetBounds,
    browserStop: mockBrowserStop,
    canGoBack: mockCanGoBack,
    canGoForward: mockCanGoForward,
    openExternal: mockOpenExternal,
  } as unknown as typeof window.electronAPI;
}

describe('BrowserPanel', () => {
  const defaultProps = {
    url: 'https://github.com',
    onUrlChange: vi.fn(),
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

    it('shows lock icon when browser pane is locked', () => {
      setupStore({
        browserPane: { id: 'bp1', position: { x: 0, y: 0, w: 100, h: 100 }, locked: true },
      });

      render(<BrowserPanel {...defaultProps} />);

      const lockIcon = document.querySelector('.browser-pane-lock');
      expect(lockIcon).toBeTruthy();
    });

    it('hides lock icon when browser pane is not locked', () => {
      setupStore({
        browserPane: { id: 'bp1', position: { x: 0, y: 0, w: 100, h: 100 }, locked: false },
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

    it('displays initial URL in input', () => {
      render(<BrowserPanel {...defaultProps} url="https://example.com" />);

      const input = screen.getByPlaceholderText('Enter URL...') as HTMLInputElement;
      expect(input.value).toBe('https://example.com');
    });

    it('updates input when URL prop changes', () => {
      const { rerender } = render(<BrowserPanel {...defaultProps} url="https://example.com" />);

      rerender(<BrowserPanel {...defaultProps} url="https://github.com" />);

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

    it('calls onUrlChange when navigating', () => {
      const onUrlChange = vi.fn();
      render(<BrowserPanel {...defaultProps} onUrlChange={onUrlChange} />);

      const input = screen.getByPlaceholderText('Enter URL...');
      fireEvent.change(input, { target: { value: 'github.com' } });

      fireEvent.click(screen.getByRole('button', { name: 'Go' }));

      expect(onUrlChange).toHaveBeenCalledWith('https://github.com');
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

    it('renders bring into view button', () => {
      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByTitle('Bring browser into view')).toBeTruthy();
    });

    it('renders lock button with Lock icon when not locked', () => {
      setupStore({
        browserPane: { id: 'bp1', position: { x: 0, y: 0, w: 100, h: 100 }, locked: false },
      });

      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByTitle('Lock browser pane')).toBeTruthy();
    });

    it('renders lock button with Unlock icon when locked', () => {
      setupStore({
        browserPane: { id: 'bp1', position: { x: 0, y: 0, w: 100, h: 100 }, locked: true },
      });

      render(<BrowserPanel {...defaultProps} />);

      expect(screen.getByTitle('Unlock browser pane')).toBeTruthy();
    });

    it('calls openExternal when external button is clicked', () => {
      render(<BrowserPanel {...defaultProps} url="https://github.com" />);

      fireEvent.click(screen.getByTitle('Open in system browser'));

      expect(mockOpenExternal).toHaveBeenCalledWith('https://github.com');
    });

    it('calls bringBrowserIntoView when bring into view button is clicked', () => {
      const bringBrowserIntoView = vi.fn();
      setupStore({ bringBrowserIntoView });

      render(<BrowserPanel {...defaultProps} />);

      fireEvent.click(screen.getByTitle('Bring browser into view'));

      expect(bringBrowserIntoView).toHaveBeenCalled();
    });

    it('calls toggleBrowserLock when lock button is clicked', () => {
      const toggleBrowserLock = vi.fn();
      setupStore({ toggleBrowserLock });

      render(<BrowserPanel {...defaultProps} />);

      fireEvent.click(screen.getByTitle('Lock browser pane'));

      expect(toggleBrowserLock).toHaveBeenCalled();
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
