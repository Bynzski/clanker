import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { DockEdge, PaneDropTarget } from '../store/workspaceStore';

const EDGES: DockEdge[] = ['left', 'right', 'top', 'bottom'];

interface DockEdgeTargetsProps {
  activeIntent: PaneDropTarget | null;
  isDragging: boolean;
  scopeId?: string;
}

function DockEdgeTargetsImpl({ activeIntent, isDragging, scopeId }: DockEdgeTargetsProps) {
  return (
    <div className={`dock-edge-overlay${isDragging ? ' dragging' : ''}`} aria-hidden="true">
      {EDGES.map((edge) => (
        <WorkspaceEdgeTarget
          key={edge}
          edge={edge}
          scopeId={scopeId}
          disabled={!isDragging}
          isActive={activeIntent?.kind === 'workspace-edge' && activeIntent.edge === edge}
        />
      ))}
    </div>
  );
}

export const DockEdgeTargets = memo(DockEdgeTargetsImpl);
DockEdgeTargets.displayName = 'DockEdgeTargets';

function WorkspaceEdgeTarget({ edge, isActive, scopeId, disabled }: { edge: DockEdge; isActive: boolean; scopeId?: string; disabled: boolean }) {
  const intent: PaneDropTarget = { kind: 'workspace-edge', edge };
  const droppable = useDroppable({
    id: `workspace-edge-${scopeId ? `${scopeId}-` : ''}${edge}`,
    data: { intent },
    disabled,
  });

  return (
    <div
      ref={droppable.setNodeRef}
      className={`dock-edge dock-${edge}${isActive ? ' over' : ''}`}
      data-edge={edge}
    >
      <span className="dock-edge-label">Dock {edge}</span>
    </div>
  );
}
