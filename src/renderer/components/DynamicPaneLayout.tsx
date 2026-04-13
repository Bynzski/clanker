import { Suspense, lazy, useCallback, useRef, useState, createContext, useContext } from 'react';
import ErrorBoundary from './ErrorBoundary';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type {
  LayoutNode,
  LayoutLeaf,
  LayoutSplit,
  WorkspaceTab,
} from '../store/workspaceStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useScopedWorkspace, useScopedWorkspaceActivity } from './WorkspaceScope';
import BrowserPanel from './BrowserPanel';
import EditorPane from './EditorPane';
import './DynamicPaneLayout.css';

type DockEdge = 'left' | 'right' | 'top' | 'bottom';

const TerminalPane = lazy(() => import('./TerminalPane'));

function isLeaf(node: LayoutNode): node is LayoutLeaf {
  return node.type === 'leaf';
}

function isLeafLocked(
  paneId: string,
  workspace: Pick<WorkspaceTab, 'panes' | 'browserPane' | 'browserVisible' | 'editorPane' | 'editorVisible'>
) {
  const { panes, browserPane, browserVisible, editorPane, editorVisible } = workspace;
  if (browserVisible && browserPane?.id === paneId) {
    return browserPane.locked;
  }
  if (editorVisible && editorPane?.id === paneId) {
    return editorPane.locked;
  }
  return panes.find((pane: typeof panes[0]) => pane.id === paneId)?.locked ?? false;
}

function isSubtreeLocked(
  node: LayoutNode,
  workspace: Pick<WorkspaceTab, 'panes' | 'browserPane' | 'browserVisible' | 'editorPane' | 'editorVisible'>
): boolean {
  if (isLeaf(node)) {
    return isLeafLocked(node.paneId, workspace);
  }

  return isSubtreeLocked(node.first, workspace) && isSubtreeLocked(node.second, workspace);
}

// Wrapper that makes the pane draggable
// The drag handle props are passed to the child component's header
function PanelWrapper({ 
  paneId, 
  children, 
  isDragging,
  isOver,
  dragHandleProps,
  interactive,
}: { 
  paneId: string; 
  children: React.ReactNode; 
  isDragging: boolean;
  isOver: boolean;
  dragHandleProps?: Record<string, unknown>;
  interactive: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: paneId,
    data: { paneId },
    disabled: !interactive,
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id: `drop-${paneId}`,
    data: { paneId },
    disabled: !interactive,
  });

  // Combine refs
  const setRefs = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    setDropRef(node);
  }, [setNodeRef, setDropRef]);

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: isDragging ? 1000 : undefined,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  // Merge drag handle props
  const mergedHandleProps = interactive && dragHandleProps
    ? { ...dragHandleProps, ...listeners, ...attributes }
    : interactive
      ? { ...listeners, ...attributes }
      : {};

  return (
    <div 
      ref={setRefs}
      className={`draggable-droppable-pane ${isDragging ? 'dragging' : ''} ${isOver ? 'drop-target' : ''}`}
      style={style}
    >
      {/* Pass drag handle props to child for header */}
      <DragHandleProvider handleProps={mergedHandleProps}>
        <div className="pane-content">
          {children}
        </div>
      </DragHandleProvider>
    </div>
  );
}

// Context to pass drag handle props to header
const DragHandleContext = createContext<Record<string, unknown> | null>(null);

function DragHandleProvider({ 
  handleProps, 
  children 
}: { 
  handleProps: Record<string, unknown>; 
  children: React.ReactNode; 
}) {
  return (
    <DragHandleContext.Provider value={handleProps}>
      {children}
    </DragHandleContext.Provider>
  );
}

export function useDragHandle() {
  return useContext(DragHandleContext);
}

function LeafView({
  workspaceId,
  node,
  draggedPaneId,
  overPaneId,
}: {
  workspaceId?: string;
  node: LayoutLeaf;
  draggedPaneId: string | null;
  overPaneId: string | null;
}) {
  const workspace = useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);
  const { setBrowserUrl, layoutRevision } = useWorkspaceStore();
  const paneId = node.paneId;
  
  const isDraggingThis = draggedPaneId === paneId;
  const isOverThis = overPaneId === paneId && draggedPaneId !== paneId;

  const content = workspace?.browserVisible && workspace.browserPane?.id === paneId ? (
    <BrowserPanel
      workspaceId={workspaceId}
      url={workspace.browserUrl}
      onUrlChange={(url) => {
        if (workspaceId) {
          setBrowserUrl(url, workspaceId);
        } else {
          setBrowserUrl(url);
        }
      }}
      layoutVersion={layoutRevision}
    />
  ) : workspace?.editorVisible && workspace.editorPane?.id === paneId ? (
    <Suspense fallback={<div className="layout-pane-loading">Loading editor...</div>}>
      <EditorPane workspaceId={workspaceId} />
    </Suspense>
  ) : (
    <Suspense fallback={<div className="layout-pane-loading">Loading terminal...</div>}>
      <TerminalPane workspaceId={workspaceId} paneId={paneId} />
    </Suspense>
  );

  // Always wrap with PanelWrapper to show drag handle
  // Wrap content in ErrorBoundary to isolate pane crashes
  return (
    <PanelWrapper
      paneId={paneId}
      isDragging={isDraggingThis}
      isOver={isOverThis}
      interactive={isInteractive}
    >
      <ErrorBoundary paneId={paneId}>
        {content}
      </ErrorBoundary>
    </PanelWrapper>
  );
}

function SplitView({
  workspaceId,
  node,
  draggedPaneId,
  overPaneId,
}: {
  workspaceId?: string;
  node: LayoutSplit;
  draggedPaneId: string | null;
  overPaneId: string | null;
}) {
  const workspace = useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);
  const { setSplitRatio } = useWorkspaceStore();
  
  // Use local state to track layout during drag, avoiding feedback loop
  const [localLayout, setLocalLayout] = useState<Layout | null>(null);
  const pendingUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const firstRatio = Math.max(10, Math.min(90, Math.round(node.ratio * 100)));
  const secondRatio = 100 - firstRatio;
  
  // Create default layout object with panel IDs as keys
  const panelAId = `${node.nodeId}-a`;
  const panelBId = `${node.nodeId}-b`;
  const defaultLayout: Layout = { [panelAId]: firstRatio, [panelBId]: secondRatio };
  
  const handleLayoutChange = useCallback((layout: Layout) => {
    // Always update local state immediately for smooth dragging
    setLocalLayout(layout);
    
    // Debounce the store update to avoid feedback loop
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current);
    }
    pendingUpdateRef.current = setTimeout(() => {
      // Extract values from layout object (format: { "panel-id": percentage })
      const values = Object.values(layout);
      if (values.length === 2) {
        const [first, second] = values;
        const total = first + second;
        if (total > 0) {
        if (workspaceId) {
          setSplitRatio(node.nodeId, first / total, workspaceId);
        } else {
          setSplitRatio(node.nodeId, first / total);
        }
        }
      }
    }, 100);
  }, [node.nodeId, setSplitRatio, workspaceId]);
  
  // Reset local layout when node ratio changes (e.g., from other store updates)
  if (localLayout !== null) {
    const localFirstRatio = localLayout[panelAId] ?? firstRatio;
    if (Math.abs(localFirstRatio - firstRatio) > 5) {
      setLocalLayout(null);
    }
  }
  
  return (
    <Group
      id={node.nodeId}
      className={`split-group split-${node.orientation}`}
      orientation={node.orientation}
      defaultLayout={localLayout ?? defaultLayout}
      resizeTargetMinimumSize={{ coarse: 28, fine: 20 }}
      onLayoutChanged={handleLayoutChange}
    >
      <Panel
        id={panelAId}
        defaultSize={firstRatio}
        minSize={12}
        disabled={!isInteractive || (workspace ? isSubtreeLocked(node.first, workspace) : false)}
      >
        <LayoutNodeView workspaceId={workspaceId} node={node.first} draggedPaneId={draggedPaneId} overPaneId={overPaneId} />
      </Panel>
      <Separator className="split-separator" />
      <Panel
        id={panelBId}
        defaultSize={secondRatio}
        minSize={12}
        disabled={!isInteractive || (workspace ? isSubtreeLocked(node.second, workspace) : false)}
      >
        <LayoutNodeView workspaceId={workspaceId} node={node.second} draggedPaneId={draggedPaneId} overPaneId={overPaneId} />
      </Panel>
    </Group>
  );
}

function LayoutNodeView({
  workspaceId,
  node,
  draggedPaneId,
  overPaneId,
}: {
  workspaceId?: string;
  node: LayoutNode;
  draggedPaneId: string | null;
  overPaneId: string | null;
}) {
  if (isLeaf(node)) {
    return <LeafView workspaceId={workspaceId} node={node} draggedPaneId={draggedPaneId} overPaneId={overPaneId} />;
  }

  return <SplitView workspaceId={workspaceId} node={node} draggedPaneId={draggedPaneId} overPaneId={overPaneId} />;
}

function renderLayout(
  workspaceId: string | undefined,
  root: LayoutNode | null,
  draggedPaneId: string | null,
  overPaneId: string | null,
): React.ReactNode {
  if (root == null) {
    return null;
  }

  return <LayoutNodeView workspaceId={workspaceId} node={root} draggedPaneId={draggedPaneId} overPaneId={overPaneId} />;
}

function DockEdgeTargets({ activeEdge, isDragging }: { activeEdge: DockEdge | null; isDragging: boolean }) {
  const left = useDroppable({ id: 'dock-left', data: { edge: 'left' as DockEdge } });
  const right = useDroppable({ id: 'dock-right', data: { edge: 'right' as DockEdge } });
  const top = useDroppable({ id: 'dock-top', data: { edge: 'top' as DockEdge } });
  const bottom = useDroppable({ id: 'dock-bottom', data: { edge: 'bottom' as DockEdge } });

  return (
    <div className={`dock-edge-overlay ${isDragging ? 'dragging' : ''}`} aria-hidden="true">
      <div ref={left.setNodeRef} className={`dock-edge dock-left ${activeEdge === 'left' ? 'over' : ''}`}>
        <span className="dock-edge-label">Dock left</span>
      </div>
      <div ref={right.setNodeRef} className={`dock-edge dock-right ${activeEdge === 'right' ? 'over' : ''}`}>
        <span className="dock-edge-label">Dock right</span>
      </div>
      <div ref={top.setNodeRef} className={`dock-edge dock-top ${activeEdge === 'top' ? 'over' : ''}`}>
        <span className="dock-edge-label">Dock top</span>
      </div>
      <div ref={bottom.setNodeRef} className={`dock-edge dock-bottom ${activeEdge === 'bottom' ? 'over' : ''}`}>
        <span className="dock-edge-label">Dock bottom</span>
      </div>
    </div>
  );
}

const edgeFriendlyCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

export default function DynamicPaneLayout({ workspaceId }: { workspaceId?: string }) {
  const workspace = useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);
  const { swapPanes, dockPaneToEdge } = useWorkspaceStore();
  
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [overPaneId, setOverPaneId] = useState<string | null>(null);
  const [overDockEdge, setOverDockEdge] = useState<DockEdge | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Require 5px movement before activating drag
      },
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (!isInteractive) {
      return;
    }
    setActivePaneId(event.active.id as string);
    setOverPaneId(null);
    setOverDockEdge(null);
  }, [isInteractive]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (!isInteractive) {
      return;
    }
    const { over } = event;
    if (over) {
      const overId = over.id as string;
      if (overId.startsWith('dock-')) {
        setOverDockEdge(overId.slice(5) as DockEdge);
        setOverPaneId(null);
        return;
      }

      // Extract paneId from droppable id (may have "drop-" prefix)
      const paneId = overId.startsWith('drop-') ? overId.slice(5) : overId;
      setOverPaneId(paneId);
      setOverDockEdge(null);
    } else {
      setOverPaneId(null);
      setOverDockEdge(null);
    }
  }, [isInteractive]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (!isInteractive) {
      setActivePaneId(null);
      setOverPaneId(null);
      setOverDockEdge(null);
      return;
    }
    const { active, over } = event;
    const activeId = active.id as string;
    
    if (over) {
      const overId = over.id as string;

      if (overId.startsWith('dock-')) {
        if (workspaceId) {
          dockPaneToEdge(activeId, overId.slice(5) as DockEdge, workspaceId);
        } else {
          dockPaneToEdge(activeId, overId.slice(5) as DockEdge);
        }
      } else if (activeId !== overId) {
        // Extract paneId from droppable id
        const targetPaneId = overId.startsWith('drop-') ? overId.slice(5) : overId;
        
        // Swap the panes
        if (workspaceId) {
          swapPanes(activeId, targetPaneId, workspaceId);
        } else {
          swapPanes(activeId, targetPaneId);
        }
      }
    }
    
    setActivePaneId(null);
    setOverPaneId(null);
    setOverDockEdge(null);
  }, [dockPaneToEdge, isInteractive, swapPanes, workspaceId]);

  const handleDragCancel = useCallback(() => {
    setActivePaneId(null);
    setOverPaneId(null);
    setOverDockEdge(null);
  }, []);

  if (workspace?.layoutRoot == null) {
    return (
      <div className="dynamic-pane-layout empty">
        <div className="empty-state">
          <span>No terminals open</span>
          <span className="hint">Use the + New Terminal button in the header</span>
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={edgeFriendlyCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="dynamic-pane-layout" data-workspace-interactive={isInteractive ? 'true' : 'false'}>
        <div className="split-root">
          {renderLayout(workspaceId, workspace.layoutRoot, activePaneId, overPaneId)}
        </div>
        <DockEdgeTargets activeEdge={overDockEdge} isDragging={isInteractive && activePaneId != null} />
      </div>
      <DragOverlay>
        {/* We could add a drag preview here if needed */}
      </DragOverlay>
    </DndContext>
  );
}
