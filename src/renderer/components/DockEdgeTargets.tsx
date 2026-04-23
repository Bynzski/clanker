import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  getEdgeTerminals,
  type DockEdge,
  type EdgeTerminal,
  type LayoutNode,
} from '../store/workspaceStore';

const EDGES: DockEdge[] = ['left', 'right', 'top', 'bottom'];
const MAX_SEGMENTS = 4;

interface SegmentedDockEdgeTargetsProps {
  layoutRoot: LayoutNode | null;
  activeEdge: DockEdge | null;
  activeSegmentIndex: number | null;
  isDragging: boolean;
}

function SegmentedDockEdgeTargetsImpl({
  layoutRoot,
  activeEdge,
  activeSegmentIndex,
  isDragging,
}: SegmentedDockEdgeTargetsProps) {
  return (
    <div
      className={`dock-edge-overlay ${isDragging ? 'dragging' : ''}`}
      aria-hidden="true"
    >
      {EDGES.map((edge) => (
        <EdgeTargets
          key={edge}
          edge={edge}
          layoutRoot={layoutRoot}
          activeEdge={activeEdge}
          activeSegmentIndex={activeSegmentIndex}
        />
      ))}
    </div>
  );
}

export const SegmentedDockEdgeTargets = memo(SegmentedDockEdgeTargetsImpl);
SegmentedDockEdgeTargets.displayName = 'SegmentedDockEdgeTargets';

function EdgeTargets({
  edge,
  layoutRoot,
  activeEdge,
  activeSegmentIndex,
}: {
  edge: DockEdge;
  layoutRoot: LayoutNode | null;
  activeEdge: DockEdge | null;
  activeSegmentIndex: number | null;
}) {
  const full = useDroppable({
    id: `dock-${edge}-full`,
    data: { edge, kind: 'full' as const },
  });

  const terminals = getEdgeTerminals(layoutRoot, edge);
  const segments = terminals.slice(0, MAX_SEGMENTS);

  const isEdgeActive = activeEdge === edge;
  const isFullActive = isEdgeActive && activeSegmentIndex === null;

  return (
    <>
      <div
        ref={full.setNodeRef}
        className={`dock-edge dock-${edge}${isFullActive ? ' over' : ''}`}
      >
        <span className="dock-edge-label">Dock {edge}</span>
      </div>
      {segments.map((segment, index) => (
        <DockSegment
          key={`${segment.paneId}-${index}`}
          edge={edge}
          index={index}
          segment={segment}
          isActive={isEdgeActive && activeSegmentIndex === index}
        />
      ))}
    </>
  );
}

function DockSegment({
  edge,
  index,
  segment,
  isActive,
}: {
  edge: DockEdge;
  index: number;
  segment: EdgeTerminal;
  isActive: boolean;
}) {
  const droppable = useDroppable({
    id: `dock-${edge}-segment-${index}`,
    data: { edge, segmentIndex: index, targetPaneId: segment.paneId, kind: 'segment' as const },
  });

  const style: React.CSSProperties =
    edge === 'left' || edge === 'right'
      ? {
          top: `calc(${segment.offset * 100}% + 4px)`,
          height: `calc(${segment.span * 100}% - 8px)`,
        }
      : {
          left: `calc(${segment.offset * 100}% + 4px)`,
          width: `calc(${segment.span * 100}% - 8px)`,
        };

  return (
    <div
      ref={droppable.setNodeRef}
      className={`dock-segment dock-segment-${edge}${isActive ? ' over' : ''}`}
      data-edge={edge}
      data-segment-index={index}
      data-target-pane-id={segment.paneId}
      style={style}
    />
  );
}
