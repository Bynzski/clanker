import { useCallback, useMemo } from 'react';
import { ResponsiveGridLayout, Layout } from 'react-grid-layout';
import { useContainerWidth } from 'react-grid-layout';
import { useWorkspaceStore, PanePosition } from '../store/workspaceStore';
import TerminalPane from './TerminalPane';
import './DynamicPaneLayout.css';
import 'react-grid-layout/css/styles.css';

interface PaneLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function calculateDefaultLayout(panes: { id: string; position?: PanePosition }[]): PaneLayoutItem[] {
  const count = panes.length;
  if (count === 0) return [];

  const itemsPerRow = Math.min(count, 3);
  const rows = Math.ceil(count / itemsPerRow);
  const cellW = Math.floor(12 / itemsPerRow);
  const cellH = Math.floor(12 / rows);

  return panes.map((pane, i) => {
    const col = (i % itemsPerRow) * cellW;
    const row = Math.floor(i / itemsPerRow) * cellH;
    return {
      i: pane.id,
      x: col,
      y: row,
      w: cellW,
      h: cellH,
    };
  });
}

export default function DynamicPaneLayout() {
  const { panes, terminals, updateAllPanePositions } = useWorkspaceStore();
  const { width, containerRef } = useContainerWidth({ measureBeforeMount: false });

  // Build layout from pane positions or calculate defaults
  const layout = useMemo(() => {
    if (panes.length === 0) return [];

    // Use stored positions if available
    const hasPositions = panes.some(p => p.position);
    
    if (hasPositions) {
      return panes.map(pane => ({
        i: pane.id,
        x: pane.position?.x ?? 0,
        y: pane.position?.y ?? 0,
        w: pane.position?.w ?? 6,
        h: pane.position?.h ?? 6,
      }));
    }

    // Fall back to calculated layout
    return calculateDefaultLayout(panes);
  }, [panes]);

  // Handle layout change from drag/resize
  const handleLayoutChange = useCallback((newLayout: Layout[]) => {
    const positions = newLayout.map(item => ({
      id: item.i,
      position: {
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      } as PanePosition,
    }));
    updateAllPanePositions(positions);
  }, [updateAllPanePositions]);

  if (panes.length === 0) {
    return (
      <div className="dynamic-pane-layout empty">
        <div className="empty-state">
          <span>No terminals open</span>
          <span className="hint">Use the + New Terminal button in the header</span>
        </div>
      </div>
    );
  }

  // Wait for width measurement before rendering grid
  if (!width) {
    return (
      <div className="dynamic-pane-layout" ref={containerRef}>
        <div className="dynamic-pane-grid">
          {panes.map((pane) => {
            const terminal = terminals.find(t => t.id === pane.terminalId);
            return (
              <div key={pane.id} className="dynamic-pane-cell">
                <TerminalPane terminal={terminal} paneId={pane.id} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="dynamic-pane-layout" ref={containerRef}>
      <ResponsiveGridLayout
        className="dynamic-pane-grid"
        layouts={{ lg: layout, md: layout, sm: layout, xs: layout, xxs: layout }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 12, xs: 6, xxs: 4 }}
        rowHeight={60}
        margin={[8, 8]}
        containerPadding={[0, 0]}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".terminal-header"
        resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n']}
        useCSSTransforms={true}
        compactType={null}
        preventCollision={true}
        width={width}
      >
        {panes.map((pane) => {
          const terminal = terminals.find(t => t.id === pane.terminalId);
          return (
            <div key={pane.id} className="dynamic-pane-cell">
              <TerminalPane terminal={terminal} paneId={pane.id} />
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}