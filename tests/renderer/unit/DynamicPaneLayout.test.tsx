// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import type { LayoutNode, LayoutLeaf, LayoutSplit } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

// ---------------------------------------------------------------------------
// Hoisted mutable references shared with mock factories.
// vi.hoisted() runs before vi.mock() factories so the references are available.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const noop = (...args: unknown[]): unknown => {
    void args;
    return undefined;
  };

  return {
    dndCallbacks: {
      onDragStart: noop,
      onDragOver: noop,
      onDragEnd: noop,
      onDragCancel: noop,
      collisionDetection: noop as (...args: unknown[]) => unknown,
    },
    panelGroupOnLayoutChanged: { current: null as ((layout: Record<string, number>) => void) | null },
    draggableReturn: {
      attributes: { role: 'button' as const, tabIndex: 0 },
      listeners: { onPointerDown: vi.fn() },
      setNodeRef: vi.fn(),
      transform: null as { x: number; y: number; scaleX: number; scaleY: number } | null,
    },
    droppableReturn: {
      setNodeRef: vi.fn(),
      isOver: false,
      over: null as unknown,
    },
    pointerWithin: vi.fn((): { id: string }[] => []),
    closestCorners: vi.fn((): { id: string }[] => []),
  };
});

// ---------------------------------------------------------------------------
// Mock: @dnd-kit/core
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
vi.mock('@dnd-kit/core', () => {
  const R = require('react');
  return {
    DndContext: ({ children, onDragStart, onDragOver, onDragEnd, onDragCancel, collisionDetection }: any) => {
      mocks.dndCallbacks.onDragStart = onDragStart;
      mocks.dndCallbacks.onDragOver = onDragOver;
      mocks.dndCallbacks.onDragEnd = onDragEnd;
      mocks.dndCallbacks.onDragCancel = onDragCancel;
      mocks.dndCallbacks.collisionDetection = collisionDetection;
      return R.createElement('div', { 'data-testid': 'dnd-context' }, children);
    },
    DragOverlay: ({ children }: any) =>
      R.createElement('div', { 'data-testid': 'drag-overlay' }, children),
    PointerSensor: class PointerSensor {},
    closestCorners: mocks.closestCorners,
    pointerWithin: mocks.pointerWithin,
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn((...args: any[]) => [...args]),
    useDraggable: vi.fn(() => mocks.draggableReturn),
    useDroppable: vi.fn(() => mocks.droppableReturn),
  };
});
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Mock: react-resizable-panels
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
vi.mock('react-resizable-panels', () => {
  const R = require('react');
  return {
    Group: ({ children, onLayoutChanged, id, className, orientation }: any) => {
      if (onLayoutChanged) {
        mocks.panelGroupOnLayoutChanged.current = onLayoutChanged;
      }
      return R.createElement(
        'div',
        { 'data-testid': 'panel-group', 'data-orientation': orientation, 'data-id': id, className },
        children,
      );
    },
    Panel: ({ children, id, disabled }: any) =>
      R.createElement('div', {
        'data-testid': 'panel',
        'data-panel-id': id,
        'data-disabled': disabled ? 'true' : undefined,
      }, children),
    Separator: ({ className: cls }: any) =>
      R.createElement('div', { 'data-testid': 'separator', className: cls }),
  };
});
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Mock: child components (avoid complex rendering / lazy-loading issues)
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
vi.mock('../../../src/renderer/components/BrowserPanel', () => ({
  default: ({ url }: { url: string }) =>
    require('react').createElement('div', { 'data-testid': 'browser-panel' }, `Browser: ${url}`),
}));
vi.mock('../../../src/renderer/components/EditorPane', () => ({
  default: () => require('react').createElement('div', { 'data-testid': 'editor-pane' }, 'Editor'),
}));
vi.mock('../../../src/renderer/components/NotesPane', () => ({
  default: () => require('react').createElement('div', { 'data-testid': 'notes-pane' }, 'Notes'),
}));
vi.mock('../../../src/renderer/components/TerminalPane', () => ({
  default: ({ paneId }: { paneId: string }) =>
    require('react').createElement('div', { 'data-testid': 'terminal-pane' }, `Terminal: ${paneId}`),
}));
vi.mock('../../../src/renderer/components/ErrorBoundary', () => ({
  default: ({ children, paneId }: { children: any; paneId?: string }) =>
    require('react').createElement(
      'div',
      { 'data-testid': 'error-boundary', 'data-pane-id': paneId ?? '' },
      children,
    ),
}));
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Import SUT — after mocks are registered
// ---------------------------------------------------------------------------
import DynamicPaneLayout from '../../../src/renderer/components/DynamicPaneLayout';
import { useDragHandle } from '../../../src/renderer/components/dragHandleContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createLeaf(nodeId: string, paneId: string): LayoutLeaf {
  return { type: 'leaf', nodeId, paneId };
}

function createSplit(
  nodeId: string,
  orientation: 'horizontal' | 'vertical',
  ratio: number,
  first: LayoutNode,
  second: LayoutNode,
): LayoutSplit {
  return { type: 'split', nodeId, orientation, ratio, first, second };
}

function setupStore(overrides: Record<string, unknown> = {}) {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspaceLifecycle: null,
    layoutRoot: null,
    panes: [],
    terminals: [],
    browserVisible: false,
    browserPane: null,
    editorVisible: false,
    editorPane: null,
    notesVisible: false,
    notesPane: null,
    browserUrl: '',
    setBrowserUrl: vi.fn(),
    layoutRevision: 1,
    swapPanes: vi.fn(),
    dockPaneToEdge: vi.fn(),
    insertPaneAtEdgeGap: vi.fn(),
    insertPaneAtEdgeSegment: vi.fn(),
    setSplitRatio: vi.fn(),
    ...overrides,
  });
}

function setupStoreWithLayout(layoutRoot: LayoutNode, overrides: Record<string, unknown> = {}) {
  const panes: Array<{ id: string; terminalId: string | null }> = [];
  const terminals: Array<{ id: string; pid: number; workingDir: string }> = [];

  function extract(node: LayoutNode) {
    if (node.type === 'leaf') {
      panes.push({ id: node.paneId, terminalId: node.paneId });
      terminals.push({ id: node.paneId, pid: 1, workingDir: '/workspace' });
    } else {
      extract(node.first);
      extract(node.second);
    }
  }
  extract(layoutRoot);

  setupStore({ layoutRoot, panes, terminals, ...overrides });
}

// Module-level noop for resetting callbacks in beforeEach
const resetNoop = (...args: unknown[]): unknown => { void args; return undefined; };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('DynamicPaneLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronApiMock();
    // Reset mock state
    mocks.dndCallbacks.onDragStart = resetNoop;
    mocks.dndCallbacks.onDragOver = resetNoop;
    mocks.dndCallbacks.onDragEnd = resetNoop;
    mocks.dndCallbacks.onDragCancel = resetNoop;
    mocks.dndCallbacks.collisionDetection = resetNoop as (...args: unknown[]) => unknown;
    mocks.panelGroupOnLayoutChanged.current = null;
    mocks.draggableReturn.transform = null;
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // Empty state
  // =========================================================================
  describe('empty state', () => {
    it('renders empty message when layoutRoot is null', () => {
      setupStore();
      render(<DynamicPaneLayout />);
      expect(screen.getByText('No terminals open')).toBeTruthy();
    });

    it('shows hint text', () => {
      setupStore();
      render(<DynamicPaneLayout />);
      expect(screen.getByText(/New Terminal button/)).toBeTruthy();
    });

    it('applies empty class to container', () => {
      setupStore();
      render(<DynamicPaneLayout />);
      expect(document.querySelector('.dynamic-pane-layout')).toHaveClass('empty');
    });
  });

  // =========================================================================
  // LeafView — content selection
  // =========================================================================
  describe('LeafView content', () => {
    it('renders layout from the requested workspace instead of the active mirrored snapshot', async () => {
      const parkedWorkspace = createWorkspaceFixture({
        id: 'ws-1',
        lifecycle: 'parked',
        panes: [{ id: 'ws-1-pane', terminalId: 'ws-1-terminal' }],
        terminals: [{ id: 'ws-1-terminal', pid: 1, workingDir: '/workspace-a' }],
        layoutRoot: createLeaf('ws-1-node', 'ws-1-pane'),
      });
      const activeWorkspace = createWorkspaceFixture({
        id: 'ws-2',
        lifecycle: 'active',
        panes: [{ id: 'ws-2-pane', terminalId: 'ws-2-terminal' }],
        terminals: [{ id: 'ws-2-terminal', pid: 1, workingDir: '/workspace-b' }],
        layoutRoot: createLeaf('ws-2-node', 'ws-2-pane'),
      });

      useWorkspaceStore.setState({
        workspaces: [parkedWorkspace, activeWorkspace],
        activeWorkspaceId: 'ws-2',
        layoutRoot: activeWorkspace.layoutRoot,
        panes: activeWorkspace.panes,
        terminals: activeWorkspace.terminals,
      });

      render(<DynamicPaneLayout workspaceId="ws-1" />);

      await waitFor(() => {
        expect(screen.getByText('Terminal: ws-1-pane')).toBeTruthy();
      });
      expect(screen.queryByText('Terminal: ws-2-pane')).toBeNull();
    });

    it('marks parked workspace layouts as non-interactive', async () => {
      const parkedWorkspace = createWorkspaceFixture({
        id: 'ws-1',
        lifecycle: 'parked',
        panes: [{ id: 'ws-1-pane', terminalId: 'ws-1-terminal' }],
        terminals: [{ id: 'ws-1-terminal', pid: 1, workingDir: '/workspace-a' }],
        layoutRoot: createLeaf('ws-1-node', 'ws-1-pane'),
      });
      const activeWorkspace = createWorkspaceFixture({
        id: 'ws-2',
        lifecycle: 'active',
        panes: [{ id: 'ws-2-pane', terminalId: 'ws-2-terminal' }],
        terminals: [{ id: 'ws-2-terminal', pid: 1, workingDir: '/workspace-b' }],
        layoutRoot: createLeaf('ws-2-node', 'ws-2-pane'),
      });
      const swapPanes = vi.fn();

      useWorkspaceStore.setState({
        workspaces: [parkedWorkspace, activeWorkspace],
        activeWorkspaceId: 'ws-2',
        activeWorkspaceLifecycle: 'active',
        layoutRoot: activeWorkspace.layoutRoot,
        panes: activeWorkspace.panes,
        terminals: activeWorkspace.terminals,
        swapPanes,
      });

      render(<DynamicPaneLayout workspaceId="ws-1" />);

      await waitFor(() => {
        expect(screen.getByText('Terminal: ws-1-pane')).toBeTruthy();
      });

      expect(document.querySelector('.dynamic-pane-layout')).toHaveAttribute('data-workspace-interactive', 'false');

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'ws-1-pane' } });
        mocks.dndCallbacks.onDragEnd({ active: { id: 'ws-1-pane' }, over: { id: 'drop-ws-1-pane' } });
      });

      expect(swapPanes).not.toHaveBeenCalled();
    });

    it('renders BrowserPanel when browserVisible and paneId matches', async () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'), {
        browserVisible: true,
        browserPane: { id: 'p1', position: { x: 0, y: 0, w: 100, h: 100 }, tabs: [{ id: 'bt-1', url: 'https://github.com', title: '', canGoBack: false, canGoForward: false }], activeTabId: 'bt-1' },
        browserUrl: 'https://example.com',
      });

      render(<DynamicPaneLayout />);
      // BrowserPanel is imported directly (not lazy) so it renders synchronously
      await waitFor(() => {
        expect(screen.getByTestId('browser-panel')).toBeTruthy();
      });
    });

    it('renders EditorPane when editorVisible and paneId matches', async () => {
      setupStoreWithLayout(createLeaf('n1', 'editor-1'), {
        editorVisible: true,
        editorPane: { id: 'editor-1' },
      });

      render(<DynamicPaneLayout />);
      // EditorPane is imported directly (not lazy)
      await waitFor(() => {
        expect(screen.getByTestId('editor-pane')).toBeTruthy();
      });
    });

    it('renders NotesPane when notesVisible and paneId matches', async () => {
      setupStoreWithLayout(createLeaf('n1', 'notes-1'), {
        notesVisible: true,
        notesPane: { id: 'notes-1' },
      });

      render(<DynamicPaneLayout />);

      await waitFor(() => {
        expect(screen.getByTestId('notes-pane')).toBeTruthy();
      });
    });

    it('renders TerminalPane by default', async () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      // TerminalPane is lazy-loaded, so we wait for the Suspense to resolve
      await waitFor(() => {
        expect(screen.getByTestId('terminal-pane')).toBeTruthy();
      });
    });

    it('browser takes priority over editor when both match', async () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'), {
        browserVisible: true,
        browserPane: { id: 'p1', position: { x: 0, y: 0, w: 100, h: 100 }, tabs: [{ id: 'bt-1', url: 'https://github.com', title: '', canGoBack: false, canGoForward: false }], activeTabId: 'bt-1' },
        browserUrl: 'https://example.com',
        editorVisible: true,
        editorPane: { id: 'p1' },
      });

      render(<DynamicPaneLayout />);

      await waitFor(() => {
        expect(screen.getByTestId('browser-panel')).toBeTruthy();
      });
      expect(screen.queryByTestId('editor-pane')).toBeNull();
    });

    it('does not render BrowserPanel when paneId does not match', async () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'), {
        browserVisible: true,
        browserPane: { id: 'other', position: { x: 0, y: 0, w: 100, h: 100 }, tabs: [{ id: 'bt-1', url: 'https://github.com', title: '', canGoBack: false, canGoForward: false }], activeTabId: 'bt-1' },
        browserUrl: 'https://example.com',
      });

      render(<DynamicPaneLayout />);

      // Falls through to terminal
      await waitFor(() => {
        expect(screen.getByTestId('terminal-pane')).toBeTruthy();
      });
      expect(screen.queryByTestId('browser-panel')).toBeNull();
    });
  });

  // =========================================================================
  // LeafView — ErrorBoundary wrapping
  // =========================================================================
  describe('LeafView error boundary', () => {
    it('wraps content in ErrorBoundary with paneId', async () => {
      setupStoreWithLayout(createLeaf('n1', 'my-pane'));
      render(<DynamicPaneLayout />);

      await waitFor(() => {
        const boundary = screen.getByTestId('error-boundary');
        expect(boundary.getAttribute('data-pane-id')).toBe('my-pane');
      });
    });
  });

  // =========================================================================
  // LeafView — drag/over states via PanelWrapper
  // =========================================================================
  describe('PanelWrapper drag/over classes', () => {
    it('applies dragging class when pane is the dragged pane', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });

      expect(document.querySelector('.draggable-droppable-pane.dragging')).toBeTruthy();
    });

    it('applies drop-target class when another pane is dragged over', () => {
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'drop-p2' } });
      });

      expect(document.querySelector('.draggable-droppable-pane.drop-target')).toBeTruthy();
    });

    it('applies transform style when useDraggable returns transform', async () => {
      mocks.draggableReturn.transform = { x: 10, y: 20, scaleX: 1, scaleY: 1 };
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      await waitFor(() => {
        const pane = document.querySelector('.draggable-droppable-pane');
        expect(pane).toBeTruthy();
        const style = (pane as HTMLElement).style;
        expect(style.transform).toContain('translate3d');
      });
    });

    it('renders pane-content child', async () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      await waitFor(() => {
        expect(document.querySelector('.pane-content')).toBeTruthy();
      });
    });
  });

  // =========================================================================
  // SplitView
  // =========================================================================
  describe('SplitView', () => {
    it('renders Group with correct orientation', () => {
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      const group = screen.getByTestId('panel-group');
      expect(group.getAttribute('data-orientation')).toBe('horizontal');
      expect(group.getAttribute('data-id')).toBe('s1');
    });

    it('renders vertical orientation', () => {
      const layout = createSplit('s1', 'vertical', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      expect(screen.getByTestId('panel-group').getAttribute('data-orientation')).toBe('vertical');
    });

    it('creates panel IDs from nodeId with -a and -b suffixes', () => {
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      const panels = screen.getAllByTestId('panel');
      const ids = panels.map(p => p.getAttribute('data-panel-id'));
      expect(ids).toContain('s1-a');
      expect(ids).toContain('s1-b');
    });

    it('renders separator with split-separator class', () => {
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      const sep = screen.getByTestId('separator');
      expect(sep.className).toContain('split-separator');
    });




    it('does not disable panels when nothing is locked', () => {
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      const panels = screen.getAllByTestId('panel');
      panels.forEach(p => {
        expect(p.getAttribute('data-disabled')).toBeFalsy();
      });
    });

    it('clamps ratio at 10-90 for extreme values', () => {
      const layout = createSplit('s1', 'horizontal', 1.0,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      // Should render without error (ratio clamped internally)
      expect(screen.getByTestId('panel-group')).toBeTruthy();
    });

    it('handles nested splits', () => {
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createSplit('s2', 'vertical', 0.5,
          createLeaf('n3', 'p2'),
          createLeaf('n4', 'p3'),
        ),
      );
      setupStoreWithLayout(layout, {
        panes: [
          { id: 'p1', terminalId: 'p1' },
          { id: 'p2', terminalId: 'p2' },
          { id: 'p3', terminalId: 'p3' },
        ],
        terminals: [
          { id: 'p1', pid: 1, workingDir: '/workspace' },
          { id: 'p2', pid: 2, workingDir: '/workspace' },
          { id: 'p3', pid: 3, workingDir: '/workspace' },
        ],
      });
      render(<DynamicPaneLayout />);

      const groups = screen.getAllByTestId('panel-group');
      expect(groups.length).toBe(2);
    });

    it('debounces setSplitRatio call after layout change', () => {
      vi.useFakeTimers();

      const mockSetSplitRatio = vi.fn();
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout, { setSplitRatio: mockSetSplitRatio });
      render(<DynamicPaneLayout />);

      // Fire layout change
      act(() => {
        mocks.panelGroupOnLayoutChanged.current?.({ 's1-a': 60, 's1-b': 40 });
      });

      // Not called yet (debounced 100ms)
      expect(mockSetSplitRatio).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(mockSetSplitRatio).toHaveBeenCalledWith('s1', 0.6);

      vi.useRealTimers();
    });

    it('does not call setSplitRatio when total is 0', () => {
      vi.useFakeTimers();

      const mockSetSplitRatio = vi.fn();
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout, { setSplitRatio: mockSetSplitRatio });
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.panelGroupOnLayoutChanged.current?.({ 's1-a': 0, 's1-b': 0 });
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(mockSetSplitRatio).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // DockEdgeTargets
  // =========================================================================
  describe('DockEdgeTargets', () => {
    it('renders four dock edges', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      expect(screen.getByText('Dock left')).toBeTruthy();
      expect(screen.getByText('Dock right')).toBeTruthy();
      expect(screen.getByText('Dock top')).toBeTruthy();
      expect(screen.getByText('Dock bottom')).toBeTruthy();
    });

    it('overlay does not have dragging class initially', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      expect(document.querySelector('.dock-edge-overlay')?.classList.contains('dragging')).toBe(false);
    });

    it('overlay gets dragging class when drag starts', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });

      expect(document.querySelector('.dock-edge-overlay')?.classList.contains('dragging')).toBe(true);
    });

    it('shows over class on left edge', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-left-full' } });
      });

      expect(document.querySelector('.dock-left')?.classList.contains('over')).toBe(true);
      expect(document.querySelector('.dock-right')?.classList.contains('over')).toBe(false);
    });

    it('shows over class on right edge', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-right-full' } });
      });

      expect(document.querySelector('.dock-right')?.classList.contains('over')).toBe(true);
      expect(document.querySelector('.dock-left')?.classList.contains('over')).toBe(false);
    });

    it('shows over class on top edge', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-top-full' } });
      });

      expect(document.querySelector('.dock-top')?.classList.contains('over')).toBe(true);
    });

    it('shows over class on bottom edge', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-bottom-full' } });
      });

      expect(document.querySelector('.dock-bottom')?.classList.contains('over')).toBe(true);
    });

    it('renders one segmented target per edge pane (single-leaf layout)', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      const segments = document.querySelectorAll('.dock-segment');
      expect(segments.length).toBe(4);

      for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
        const perEdge = document.querySelectorAll(`.dock-segment-${edge}`);
        expect(perEdge.length).toBe(1);
      }
    });

    it('renders segment targets with correct edge, segment, and target pane attributes', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      const leftSegment = document.querySelector('.dock-segment-left');
      expect(leftSegment?.getAttribute('data-edge')).toBe('left');
      expect(leftSegment?.getAttribute('data-segment-index')).toBe('0');
      expect(leftSegment?.getAttribute('data-target-pane-id')).toBe('p1');
    });

    it('segment targets carry inline span styles (top/height for left-right, left/width for top-bottom)', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      const leftSegment = document.querySelector('.dock-segment-left') as HTMLElement | null;
      expect(leftSegment).toBeTruthy();
      expect(leftSegment!.style.top).not.toBe('');
      expect(leftSegment!.style.height).not.toBe('');

      const topSegment = document.querySelector('.dock-segment-top') as HTMLElement | null;
      expect(topSegment).toBeTruthy();
      expect(topSegment!.style.left).not.toBe('');
      expect(topSegment!.style.width).not.toBe('');
    });

    it('renders one segment target for each edge terminal', () => {
      // Layout: vertical(p1, vertical(p2, p3)) → left edge has 3 terminals.
      const layout = createSplit(
        's1',
        'vertical',
        0.5,
        createLeaf('n1', 'p1'),
        createSplit('s2', 'vertical', 0.5, createLeaf('n2', 'p2'), createLeaf('n3', 'p3')),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      const leftSegments = document.querySelectorAll('.dock-segment-left');
      expect(leftSegments.length).toBe(3);
    });

    it('caps segment count per edge at MAX_SEGMENTS (4)', () => {
      // Layout with 5 terminals stacked on left: vertical(A, vertical(B, vertical(C, vertical(D, E))))
      // Left edge: 5 terminals, capped at 4 rendered segment targets.
      const deepLeft = createSplit(
        's1',
        'vertical',
        0.5,
        createLeaf('n1', 'p1'),
        createSplit(
          's2',
          'vertical',
          0.5,
          createLeaf('n2', 'p2'),
          createSplit(
            's3',
            'vertical',
            0.5,
            createLeaf('n3', 'p3'),
            createSplit(
              's4',
              'vertical',
              0.5,
              createLeaf('n4', 'p4'),
              createLeaf('n5', 'p5'),
            ),
          ),
        ),
      );
      setupStoreWithLayout(deepLeft);
      render(<DynamicPaneLayout />);

      const leftSegments = document.querySelectorAll('.dock-segment-left');
      expect(leftSegments.length).toBe(4);
    });

    it('full-edge zone lights up on full drop target; segment targets stay unlit', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-left-full' } });
      });

      expect(document.querySelector('.dock-left')?.classList.contains('over')).toBe(true);
      expect(document.querySelectorAll('.dock-segment.over').length).toBe(0);
    });
  });

  // =========================================================================
  // DnD: handleDragStart
  // =========================================================================
  describe('handleDragStart', () => {
    it('activates dragging state', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      expect(document.querySelector('.dock-edge-overlay.dragging')).toBeNull();

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });

      expect(document.querySelector('.dock-edge-overlay.dragging')).toBeTruthy();
    });
  });

  // =========================================================================
  // DnD: handleDragOver
  // =========================================================================
  describe('handleDragOver', () => {
    it('sets overDockEdge for dock- prefixed target', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-right-full' } });
      });

      expect(document.querySelector('.dock-right.over')).toBeTruthy();
    });

    it('sets overPaneId for drop- prefixed target', () => {
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'drop-p2' } });
      });

      expect(document.querySelector('.drop-target')).toBeTruthy();
    });

    it('sets overPaneId for target without drop- prefix', () => {
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'p2' } });
      });

      expect(document.querySelector('.drop-target')).toBeTruthy();
    });

    it('clears over state when over is null', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-left-full' } });
      });
      expect(document.querySelector('.dock-left.over')).toBeTruthy();

      act(() => {
        mocks.dndCallbacks.onDragOver({ over: null });
      });
      expect(document.querySelector('.dock-edge.over')).toBeNull();
    });

    it('highlights the matching segment target and not the full edge for dock-{edge}-segment-{index}', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-left-segment-0' } });
      });

      const activeSegment = document.querySelector('.dock-segment-left[data-segment-index="0"]');
      expect(activeSegment?.classList.contains('over')).toBe(true);
      expect(document.querySelector('.dock-left')?.classList.contains('over')).toBe(false);
    });

    it('switches highlight from one segment to another on subsequent drag-over events', () => {
      const layout = createSplit(
        's1',
        'vertical',
        0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-left-segment-0' } });
      });
      expect(
        document.querySelector('.dock-segment-left[data-segment-index="0"]')?.classList.contains('over'),
      ).toBe(true);

      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-left-segment-1' } });
      });
      expect(
        document.querySelector('.dock-segment-left[data-segment-index="0"]')?.classList.contains('over'),
      ).toBe(false);
      expect(
        document.querySelector('.dock-segment-left[data-segment-index="1"]')?.classList.contains('over'),
      ).toBe(true);
    });

    it('clears segment highlight and falls back to full highlight when switching to a full target', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-left-segment-0' } });
      });
      expect(document.querySelectorAll('.dock-segment.over').length).toBe(1);

      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-left-full' } });
      });
      expect(document.querySelectorAll('.dock-segment.over').length).toBe(0);
      expect(document.querySelector('.dock-left')?.classList.contains('over')).toBe(true);
    });

    it('ignores a malformed dock- id and routes as a pane target', () => {
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      // No matching edge part in parser → treated as pane id fallthrough
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-sideways-full' } });
      });
      // Pane id fallback: takes id as-is (no drop- prefix) — this is just a sanity
      // check that the parser rejects unknown edges without throwing.
      expect(document.querySelector('.dock-edge.over')).toBeNull();
    });
  });

  // =========================================================================
  // DnD: handleDragEnd
  // =========================================================================
  describe('handleDragEnd', () => {
    it('calls dockPaneToEdge when dropped on dock-{edge}-full zone', () => {
      const mockDock = vi.fn();
      setupStoreWithLayout(createLeaf('n1', 'p1'), { dockPaneToEdge: mockDock });
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragEnd({ active: { id: 'p1' }, over: { id: 'dock-left-full' } });
      });

      expect(mockDock).toHaveBeenCalledWith('p1', 'left');
    });

    it('calls insertPaneAtEdgeSegment with parsed edge and target pane when dropped on a segment target', () => {
      const mockInsert = vi.fn();
      const mockDock = vi.fn();
      setupStoreWithLayout(createLeaf('n1', 'p1'), {
        insertPaneAtEdgeSegment: mockInsert,
        dockPaneToEdge: mockDock,
      });
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragEnd({
          active: { id: 'p1' },
          over: { id: 'dock-right-segment-0', data: { current: { targetPaneId: 'p2' } } },
        });
      });

      expect(mockInsert).toHaveBeenCalledWith('p1', 'right', 'p2');
      expect(mockDock).not.toHaveBeenCalled();
    });

    it('passes workspaceId through to insertPaneAtEdgeSegment when scoped', () => {
      const mockInsert = vi.fn();
      setupStoreWithLayout(createLeaf('n1', 'p1'), { insertPaneAtEdgeSegment: mockInsert });
      render(<DynamicPaneLayout workspaceId="ws-42" />);

      act(() => {
        mocks.dndCallbacks.onDragEnd({
          active: { id: 'p1' },
          over: { id: 'dock-top-segment-0', data: { current: { targetPaneId: 'p2' } } },
        });
      });

      expect(mockInsert).toHaveBeenCalledWith('p1', 'top', 'p2', 'ws-42');
    });

    it('does not call insertPaneAtEdgeSegment without target pane data', () => {
      const mockInsert = vi.fn();
      setupStoreWithLayout(createLeaf('n1', 'p1'), { insertPaneAtEdgeSegment: mockInsert });
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragEnd({
          active: { id: 'p1' },
          over: { id: 'dock-top-segment-0', data: { current: {} } },
        });
      });

      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('clears overSegmentIndex state after drag end', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-left-segment-0' } });
      });
      expect(document.querySelectorAll('.dock-segment.over').length).toBe(1);

      act(() => {
        mocks.dndCallbacks.onDragEnd({
          active: { id: 'p1' },
          over: { id: 'dock-left-segment-0', data: { current: { targetPaneId: 'p1' } } },
        });
      });
      expect(document.querySelectorAll('.dock-segment.over').length).toBe(0);
    });

    it('calls swapPanes when dropped on a different pane (drop- prefix)', () => {
      const mockSwap = vi.fn();
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout, { swapPanes: mockSwap });
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragEnd({ active: { id: 'p1' }, over: { id: 'drop-p2' } });
      });

      expect(mockSwap).toHaveBeenCalledWith('p1', 'p2');
    });

    it('calls swapPanes with paneId extracted from over.id without prefix', () => {
      const mockSwap = vi.fn();
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout, { swapPanes: mockSwap });
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragEnd({ active: { id: 'p1' }, over: { id: 'p2' } });
      });

      expect(mockSwap).toHaveBeenCalledWith('p1', 'p2');
    });

    it('does not swap when dropped on same pane', () => {
      const mockSwap = vi.fn();
      setupStoreWithLayout(createLeaf('n1', 'p1'), { swapPanes: mockSwap });
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragEnd({ active: { id: 'p1' }, over: { id: 'p1' } });
      });

      expect(mockSwap).not.toHaveBeenCalled();
    });

    it('does nothing when over is null', () => {
      const mockSwap = vi.fn();
      const mockDock = vi.fn();
      setupStoreWithLayout(createLeaf('n1', 'p1'), { swapPanes: mockSwap, dockPaneToEdge: mockDock });
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragEnd({ active: { id: 'p1' }, over: null });
      });

      expect(mockSwap).not.toHaveBeenCalled();
      expect(mockDock).not.toHaveBeenCalled();
    });

    it('clears all drag state after end', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      expect(document.querySelector('.dock-edge-overlay.dragging')).toBeTruthy();

      act(() => {
        mocks.dndCallbacks.onDragEnd({ active: { id: 'p1' }, over: null });
      });
      expect(document.querySelector('.dock-edge-overlay.dragging')).toBeNull();
      expect(document.querySelector('.dock-edge.over')).toBeNull();
    });
  });

  // =========================================================================
  // DnD: handleDragCancel
  // =========================================================================
  describe('handleDragCancel', () => {
    it('clears all drag state', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      expect(document.querySelector('.dock-edge-overlay.dragging')).toBeTruthy();

      act(() => {
        mocks.dndCallbacks.onDragCancel();
      });
      expect(document.querySelector('.dock-edge-overlay.dragging')).toBeNull();
      expect(document.querySelector('.dock-edge.over')).toBeNull();
    });

    it('clears overSegmentIndex highlight on cancel', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      act(() => {
        mocks.dndCallbacks.onDragStart({ active: { id: 'p1' } });
      });
      act(() => {
        mocks.dndCallbacks.onDragOver({ over: { id: 'dock-top-segment-0' } });
      });
      expect(document.querySelectorAll('.dock-segment.over').length).toBe(1);

      act(() => {
        mocks.dndCallbacks.onDragCancel();
      });
      expect(document.querySelectorAll('.dock-segment.over').length).toBe(0);
    });
  });

  // =========================================================================
  // useDragHandle
  // =========================================================================
  describe('useDragHandle', () => {
    it('returns null outside DragHandleProvider', () => {
      function Test() {
        const h = useDragHandle();
        return <div data-testid="result">{h === null ? 'null' : 'value'}</div>;
      }
      render(<Test />);
      expect(screen.getByTestId('result').textContent).toBe('null');
    });

    it('is exported as a function', () => {
      expect(typeof useDragHandle).toBe('function');
    });
  });

  // =========================================================================
  // edgeFriendlyCollisionDetection
  // =========================================================================
  describe('edgeFriendlyCollisionDetection', () => {
    it('is passed to DndContext', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      const fn = mocks.dndCallbacks.collisionDetection;
      expect(fn).toBeDefined();
      expect(typeof fn).toBe('function');
    });

    it('prefers pointerWithin results when available', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      const fn = mocks.dndCallbacks.collisionDetection;
      mocks.pointerWithin.mockReturnValueOnce([{ id: 'a' }]);
      mocks.closestCorners.mockReturnValueOnce([{ id: 'b' }]);

      const result = (fn as (...args: unknown[]) => unknown)({});
      expect(result).toEqual([{ id: 'a' }]);
      expect(mocks.pointerWithin).toHaveBeenCalled();
      expect(mocks.closestCorners).not.toHaveBeenCalled();
    });

    it('prioritizes segment collisions over full-edge collisions', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      const fn = mocks.dndCallbacks.collisionDetection;
      mocks.pointerWithin.mockReturnValueOnce([
        { id: 'dock-left-full' },
        { id: 'dock-left-segment-0' },
      ]);

      const result = (fn as (...args: unknown[]) => unknown)({});
      expect(result).toEqual([
        { id: 'dock-left-segment-0' },
        { id: 'dock-left-full' },
      ]);
    });

    it('falls back to closestCorners when pointerWithin is empty', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      const fn = mocks.dndCallbacks.collisionDetection;
      mocks.pointerWithin.mockReturnValueOnce([]);
      mocks.closestCorners.mockReturnValueOnce([{ id: 'b' }]);

      const result = (fn as (...args: unknown[]) => unknown)({});
      expect(result).toEqual([{ id: 'b' }]);
      expect(mocks.closestCorners).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // renderLayout / LayoutNodeView
  // =========================================================================
  describe('renderLayout', () => {
    it('returns null when layoutRoot is null — no panel-group rendered', () => {
      setupStore();
      render(<DynamicPaneLayout />);

      expect(screen.queryByTestId('panel-group')).toBeNull();
    });

    it('renders a leaf layout', async () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);

      await waitFor(() => {
        expect(screen.getByTestId('terminal-pane')).toBeTruthy();
      });
    });

    it('renders a split layout', () => {
      const layout = createSplit('s1', 'horizontal', 0.5,
        createLeaf('n1', 'p1'),
        createLeaf('n2', 'p2'),
      );
      setupStoreWithLayout(layout);
      render(<DynamicPaneLayout />);

      expect(screen.getByTestId('panel-group')).toBeTruthy();
    });
  });

  // =========================================================================
  // Main component structure
  // =========================================================================
  describe('component structure', () => {
    it('renders DndContext when layout exists', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);
      expect(screen.getByTestId('dnd-context')).toBeTruthy();
    });

    it('renders DragOverlay when layout exists', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);
      expect(screen.getByTestId('drag-overlay')).toBeTruthy();
    });

    it('renders split-root container', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      render(<DynamicPaneLayout />);
      expect(document.querySelector('.split-root')).toBeTruthy();
    });

    it('does not render DndContext when layoutRoot is null', () => {
      setupStore();
      render(<DynamicPaneLayout />);
      expect(screen.queryByTestId('dnd-context')).toBeNull();
    });

    it('does not render DragOverlay when layoutRoot is null', () => {
      setupStore();
      render(<DynamicPaneLayout />);
      expect(screen.queryByTestId('drag-overlay')).toBeNull();
    });
  });

  // =========================================================================
  // isLeafLocked (tested indirectly via disabled prop on Panel)
  // =========================================================================

  // =========================================================================
  // isSubtreeLocked (tested indirectly via disabled prop on Panel)
  // =========================================================================

  // =========================================================================
  // Store reactivity
  // =========================================================================
  describe('store reactivity', () => {
    it('updates when layoutRevision changes', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      const { rerender } = render(<DynamicPaneLayout />);

      act(() => {
        useWorkspaceStore.setState({ layoutRevision: 2 });
      });

      rerender(<DynamicPaneLayout />);
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });

    it('updates when layoutRoot changes to split', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      const { rerender } = render(<DynamicPaneLayout />);

      act(() => {
        const newLayout = createSplit('s1', 'horizontal', 0.5,
          createLeaf('n2', 'p1'),
          createLeaf('n3', 'p2'),
        );
        useWorkspaceStore.setState({
          layoutRoot: newLayout,
          panes: [
            { id: 'p1', terminalId: 'p1' },
            { id: 'p2', terminalId: 'p2' },
          ],
          terminals: [
            { id: 'p1', pid: 1, workingDir: '/workspace' },
            { id: 'p2', pid: 2, workingDir: '/workspace' },
          ],
        });
      });

      rerender(<DynamicPaneLayout />);
      expect(screen.getByTestId('panel-group')).toBeTruthy();
    });

    it('transitions to empty state when layoutRoot set to null', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      const { rerender } = render(<DynamicPaneLayout />);

      act(() => {
        useWorkspaceStore.setState({ layoutRoot: null });
      });

      rerender(<DynamicPaneLayout />);
      expect(screen.getByText('No terminals open')).toBeTruthy();
    });
  });
});
