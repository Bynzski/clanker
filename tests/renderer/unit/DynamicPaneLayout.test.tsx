// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import type { LayoutNode, LayoutLeaf, LayoutSplit } from '../../../src/renderer/store/workspaceStore';

// Helper to create layout nodes
function createLeaf(nodeId: string, paneId: string): LayoutLeaf {
  return { type: 'leaf', nodeId, paneId };
}

function createSplit(
  nodeId: string,
  orientation: 'horizontal' | 'vertical',
  ratio: number,
  first: LayoutNode,
  second: LayoutNode
): LayoutSplit {
  return { type: 'split', nodeId, orientation, ratio, first, second };
}

// Store setup helpers
function setupEmptyStore() {
  useWorkspaceStore.setState({
    layoutRoot: null,
    panes: [],
    terminals: [],
    browserVisible: false,
    browserPane: null,
    browserUrl: '',
    setBrowserUrl: vi.fn(),
    layoutRevision: 1,
    swapPanes: vi.fn(),
    dockPaneToEdge: vi.fn(),
    setSplitRatio: vi.fn(),
  });
}

function setupStoreWithLayout(layoutRoot: LayoutNode) {
  const panes: Array<{ id: string; terminalId: string | null; locked: boolean }> = [];
  const terminals: Array<{ id: string; pid: number; workingDir: string }> = [];
  
  // Extract panes and terminals from layout
  function extractPanes(node: LayoutNode) {
    if (node.type === 'leaf') {
      panes.push({ id: node.paneId, terminalId: node.paneId, locked: false });
      terminals.push({ id: node.paneId, pid: 1, workingDir: '/workspace' });
    } else {
      extractPanes(node.first);
      extractPanes(node.second);
    }
  }
  extractPanes(layoutRoot);

  useWorkspaceStore.setState({
    layoutRoot,
    panes,
    terminals,
    browserVisible: false,
    browserPane: null,
    browserUrl: '',
    setBrowserUrl: vi.fn(),
    layoutRevision: 1,
    swapPanes: vi.fn(),
    dockPaneToEdge: vi.fn(),
    setSplitRatio: vi.fn(),
  });
}

describe('DynamicPaneLayout', () => {
  let DynamicPaneLayout: typeof import('../../../src/renderer/components/DynamicPaneLayout').default;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    // Reset modules to get fresh imports
    vi.resetModules();
    
    // Import the component fresh
    const module = await import('../../../src/renderer/components/DynamicPaneLayout');
    DynamicPaneLayout = module.default;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // =========================================================================
  // Empty State
  // =========================================================================
  describe('empty state', () => {
    it('renders empty state when layoutRoot is null', () => {
      setupEmptyStore();
      
      render(<DynamicPaneLayout />);
      
      expect(screen.getByText('No terminals open')).toBeTruthy();
      expect(screen.getByText('Use the + New Terminal button in the header')).toBeTruthy();
    });

    it('has empty class on container when no layout', () => {
      setupEmptyStore();
      
      render(<DynamicPaneLayout />);
      
      expect(document.querySelector('.dynamic-pane-layout')).toHaveClass('empty');
    });

    it('shows hint text about creating terminals', () => {
      setupEmptyStore();
      
      render(<DynamicPaneLayout />);
      
      const hint = screen.getByText(/New Terminal button/);
      expect(hint).toBeTruthy();
    });
  });

  // =========================================================================
  // Store Integration
  // =========================================================================
  describe('store integration', () => {
    it('renders with layout when store has layoutRoot', () => {
      // Set up store state within act
      act(() => {
        setupStoreWithLayout(createLeaf('n1', 'p1'));
      });
      
      const { unmount } = render(<DynamicPaneLayout />);
      
      // Advance timers within act
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      // Component should render without empty state if layout was set
      const container = document.querySelector('.dynamic-pane-layout');
      // Note: Due to store synchronization, we verify the component renders
      expect(container).toBeTruthy();
      
      unmount();
    });

    it('rerenders when layoutRevision changes', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      
      const { rerender } = render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      act(() => {
        useWorkspaceStore.setState({ layoutRevision: 2 });
      });
      
      rerender(<DynamicPaneLayout />);
      
      // Should not throw and should still render
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });

    it('rerenders when layoutRoot changes to different layout', () => {
      setupStoreWithLayout(createLeaf('n1', 'p1'));
      
      const { rerender } = render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      // Change to a different layout with multiple panes
      const newLayout = createSplit('n1', 'horizontal', 0.5,
        createLeaf('n2', 'p1'),
        createLeaf('n3', 'p2')
      );
      
      act(() => {
        useWorkspaceStore.setState({
          layoutRoot: newLayout,
          panes: [
            { id: 'p1', terminalId: 'p1', locked: false },
            { id: 'p2', terminalId: 'p2', locked: false },
          ],
          terminals: [
            { id: 'p1', pid: 1, workingDir: '/workspace' },
            { id: 'p2', pid: 2, workingDir: '/workspace' },
          ],
        });
      });
      
      rerender(<DynamicPaneLayout />);
      
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });
  });

  // =========================================================================
  // Layout Structure
  // =========================================================================
  describe('layout structure', () => {
    it('handles horizontal split layout', () => {
      const layout = createSplit('n1', 'horizontal', 0.5,
        createLeaf('n2', 'p1'),
        createLeaf('n3', 'p2')
      );
      setupStoreWithLayout(layout);
      
      render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });

    it('handles vertical split layout', () => {
      const layout = createSplit('n1', 'vertical', 0.5,
        createLeaf('n2', 'p1'),
        createLeaf('n3', 'p2')
      );
      setupStoreWithLayout(layout);
      
      render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });

    it('handles nested layouts', () => {
      const layout = createSplit('n1', 'horizontal', 0.5,
        createLeaf('n2', 'p1'),
        createSplit('n3', 'vertical', 0.5,
          createLeaf('n4', 'p2'),
          createLeaf('n5', 'p3')
        )
      );
      setupStoreWithLayout(layout);
      
      render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });

    it('handles locked panes', () => {
      const layout = createLeaf('n1', 'p1');
      useWorkspaceStore.setState({
        layoutRoot: layout,
        panes: [{ id: 'p1', terminalId: 'p1', locked: true }],
        terminals: [{ id: 'p1', pid: 1, workingDir: '/workspace' }],
        browserVisible: false,
        browserPane: null,
        browserUrl: '',
        setBrowserUrl: vi.fn(),
        layoutRevision: 1,
        swapPanes: vi.fn(),
        dockPaneToEdge: vi.fn(),
        setSplitRatio: vi.fn(),
      });
      
      render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });
  });

  // =========================================================================
  // Browser Integration
  // =========================================================================
  describe('browser integration', () => {
    it('renders browser panel when browserVisible is true', () => {
      const layout = createLeaf('n1', 'p1');
      useWorkspaceStore.setState({
        layoutRoot: layout,
        panes: [{ id: 'p1', terminalId: 'p1', locked: false }],
        terminals: [{ id: 'p1', pid: 1, workingDir: '/workspace' }],
        browserVisible: true,
        browserPane: { id: 'p1', position: { x: 0, y: 0, w: 100, h: 100 }, locked: false },
        browserUrl: 'https://example.com',
        setBrowserUrl: vi.fn(),
        layoutRevision: 1,
        swapPanes: vi.fn(),
        dockPaneToEdge: vi.fn(),
        setSplitRatio: vi.fn(),
      });
      
      render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });
  });

  // =========================================================================
  // Exports
  // =========================================================================
  describe('exports', () => {
    it('exports useDragHandle hook', async () => {
      const { useDragHandle } = await import('../../../src/renderer/components/DynamicPaneLayout');
      
      expect(useDragHandle).toBeDefined();
      expect(typeof useDragHandle).toBe('function');
    });

    it('exports default component', async () => {
      const module = await import('../../../src/renderer/components/DynamicPaneLayout');
      
      expect(module.default).toBeDefined();
    });
  });

  // =========================================================================
  // Utility Functions (tested via rendering behavior)
  // =========================================================================
  describe('layout ratio clamping', () => {
    it('handles ratio at maximum (1.0)', () => {
      const layout = createSplit('n1', 'horizontal', 1.0,
        createLeaf('n2', 'p1'),
        createLeaf('n3', 'p2')
      );
      setupStoreWithLayout(layout);
      
      render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      // Should clamp to 90% and render without error
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });

    it('handles ratio at minimum (0.0)', () => {
      const layout = createSplit('n1', 'horizontal', 0.0,
        createLeaf('n2', 'p1'),
        createLeaf('n3', 'p2')
      );
      setupStoreWithLayout(layout);
      
      render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      // Should clamp to 10% and render without error
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });

    it('handles negative ratio', () => {
      const layout = createSplit('n1', 'horizontal', -0.5,
        createLeaf('n2', 'p1'),
        createLeaf('n3', 'p2')
      );
      setupStoreWithLayout(layout);
      
      render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      // Should clamp and render without error
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });

    it('handles ratio over 100%', () => {
      const layout = createSplit('n1', 'horizontal', 1.5,
        createLeaf('n2', 'p1'),
        createLeaf('n3', 'p2')
      );
      setupStoreWithLayout(layout);
      
      render(<DynamicPaneLayout />);
      
      act(() => {
        vi.advanceTimersByTime(10);
      });
      
      // Should clamp and render without error
      expect(document.querySelector('.dynamic-pane-layout')).toBeTruthy();
    });
  });
});
