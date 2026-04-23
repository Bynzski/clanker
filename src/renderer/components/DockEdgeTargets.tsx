import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  getEdgeGaps,
  getEdgeTerminals,
  type DockEdge,
  type EdgeGap,
  type LayoutNode,
} from '../store/workspaceStore';

const EDGES: DockEdge[] = ['left', 'right', 'top', 'bottom'];
const MAX_SEGMENTS = 4;

interface SegmentedDockEdgeTargetsProps {
  layoutRoot: LayoutNode | null;
  activeEdge: DockEdge | null;
  activeGapIndex: number | null;
  isDragging: boolean;
}

function SegmentedDockEdgeTargetsImpl({
  layoutRoot,
  activeEdge,
  activeGapIndex,
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
          activeGapIndex={activeGapIndex}
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
  activeGapIndex,
}: {
  edge: DockEdge;
  layoutRoot: LayoutNode | null;
  activeEdge: DockEdge | null;
  activeGapIndex: number | null;
}) {
  const full = useDroppable({
    id: `dock-${edge}-full`,
    data: { edge, kind: 'full' as const },
  });

  const terminals = getEdgeTerminals(layoutRoot, edge);
  const gaps = getEdgeGaps(terminals, MAX_SEGMENTS);

  const isEdgeActive = activeEdge === edge;
  const isFullActive = isEdgeActive && activeGapIndex === null;

  return (
    <>
      <div
        ref={full.setNodeRef}
        className={`dock-edge dock-${edge}${isFullActive ? ' over' : ''}`}
      >
        <span className="dock-edge-label">Dock {edge}</span>
      </div>
      {gaps.map((gap) => (
        <DockGap
          key={gap.index}
          edge={edge}
          gap={gap}
          isActive={isEdgeActive && activeGapIndex === gap.index}
        />
      ))}
    </>
  );
}

function DockGap({
  edge,
  gap,
  isActive,
}: {
  edge: DockEdge;
  gap: EdgeGap;
  isActive: boolean;
}) {
  const droppable = useDroppable({
    id: `dock-${edge}-gap-${gap.index}`,
    data: { edge, gapIndex: gap.index, kind: 'gap' as const },
  });

  const midpoint = (gap.start + gap.end) / 2;
  const style: React.CSSProperties =
    edge === 'left' || edge === 'right'
      ? { top: `${midpoint * 100}%` }
      : { left: `${midpoint * 100}%` };

  return (
    <div
      ref={droppable.setNodeRef}
      className={`dock-gap dock-gap-${edge}${isActive ? ' over' : ''}`}
      data-edge={edge}
      data-gap-index={gap.index}
      style={style}
    />
  );
}
