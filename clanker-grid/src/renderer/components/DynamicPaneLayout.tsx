import { useCallback, useRef, useState, createContext, useContext } from 'react';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type {
  LayoutNode,
  LayoutLeaf,
  LayoutSplit,
} from '../store/workspaceStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import TerminalPane from './TerminalPane';
import BrowserPanel from './BrowserPanel';
import './DynamicPaneLayout.css';

function isLeaf(node: LayoutNode): node is LayoutLeaf {
  return node.type === 'leaf';
}

function isLeafLocked(
  paneId: string,
  state: ReturnType<typeof useWorkspaceStore.getState>
) {
  const { panes, browserPane, browserVisible } = state;
  if (browserVisible && browserPane?.id === paneId) {
    return browserPane.locked;
  }
  return panes.find((pane: typeof panes[0]) => pane.id === paneId)?.locked ?? false;
}

function isSubtreeLocked(
  node: LayoutNode,
  state: ReturnType<typeof useWorkspaceStore.getState>
): boolean {
  if (isLeaf(node)) {
    return isLeafLocked(node.paneId, state);
  }

  return isSubtreeLocked(node.first, state) && isSubtreeLocked(node.second, state);
}

// Wrapper that makes the pane draggable
// The drag handle props are passed to the child component's header
function PanelWrapper({ 
  paneId, 
  children, 
  isDragging,
  isOver,
  dragHandleProps
}: { 
  paneId: string; 
  children: React.ReactNode; 
  isDragging: boolean;
  isOver: boolean;
  dragHandleProps?: Record<string, unknown>;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: paneId,
    data: { paneId },
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id: `drop-${paneId}`,
    data: { paneId },
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
  const mergedHandleProps = dragHandleProps 
    ? { ...dragHandleProps, ...listeners, ...attributes }
    : { ...listeners, ...attributes };

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

function LeafView({ node, draggedPaneId, overPaneId }: { node: LayoutLeaf; draggedPaneId: string | null; overPaneId: string | null }) {
  const state = useWorkspaceStore();
  const { browserPane, browserVisible, browserUrl, setBrowserUrl, layoutRevision } = state;
  const paneId = node.paneId;
  
  const isDraggingThis = draggedPaneId === paneId;
  const isOverThis = overPaneId === paneId && draggedPaneId !== paneId;

  const content = browserVisible && browserPane?.id === paneId ? (
    <BrowserPanel
      url={browserUrl}
      onUrlChange={setBrowserUrl}
      layoutVersion={layoutRevision}
    />
  ) : (
    <TerminalPane paneId={paneId} />
  );

  // Always wrap with PanelWrapper to show drag handle
  return (
    <PanelWrapper
      paneId={paneId}
      isDragging={isDraggingThis}
      isOver={isOverThis}
    >
      {content}
    </PanelWrapper>
  );
}

function SplitView({ node, draggedPaneId, overPaneId }: { node: LayoutSplit; draggedPaneId: string | null; overPaneId: string | null }) {
  const state = useWorkspaceStore();
  const { setSplitRatio } = state;
  
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
          setSplitRatio(node.nodeId, first / total);
        }
      }
    }, 100);
  }, [node.nodeId, setSplitRatio]);
  
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
        disabled={isSubtreeLocked(node.first, state)}
      >
        <LayoutNodeView node={node.first} draggedPaneId={draggedPaneId} overPaneId={overPaneId} />
      </Panel>
      <Separator className="split-separator" />
      <Panel
        id={panelBId}
        defaultSize={secondRatio}
        minSize={12}
        disabled={isSubtreeLocked(node.second, state)}
      >
        <LayoutNodeView node={node.second} draggedPaneId={draggedPaneId} overPaneId={overPaneId} />
      </Panel>
    </Group>
  );
}

function LayoutNodeView({ node, draggedPaneId, overPaneId }: { node: LayoutNode; draggedPaneId: string | null; overPaneId: string | null }) {
  if (isLeaf(node)) {
    return <LeafView node={node} draggedPaneId={draggedPaneId} overPaneId={overPaneId} />;
  }

  return <SplitView node={node} draggedPaneId={draggedPaneId} overPaneId={overPaneId} />;
}

function renderLayout(root: LayoutNode | null, draggedPaneId: string | null, overPaneId: string | null): React.ReactNode {
  if (root == null) {
    return null;
  }

  return <LayoutNodeView node={root} draggedPaneId={draggedPaneId} overPaneId={overPaneId} />;
}

export default function DynamicPaneLayout() {
  const { layoutRoot, swapPanes } = useWorkspaceStore();
  
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [overPaneId, setOverPaneId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Require 5px movement before activating drag
      },
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActivePaneId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (over) {
      // Extract paneId from droppable id (may have "drop-" prefix)
      const overId = over.id as string;
      const paneId = overId.startsWith('drop-') ? overId.slice(5) : overId;
      setOverPaneId(paneId);
    } else {
      setOverPaneId(null);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      // Extract paneId from droppable id
      const overId = over.id as string;
      const targetPaneId = overId.startsWith('drop-') ? overId.slice(5) : overId;
      
      // Swap the panes
      swapPanes(active.id as string, targetPaneId);
    }
    
    setActivePaneId(null);
    setOverPaneId(null);
  }, [swapPanes]);

  const handleDragCancel = useCallback(() => {
    setActivePaneId(null);
    setOverPaneId(null);
  }, []);

  if (layoutRoot == null) {
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
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="dynamic-pane-layout">
        <div className="split-root">
          {renderLayout(layoutRoot, activePaneId, overPaneId)}
        </div>
      </div>
      <DragOverlay>
        {/* We could add a drag preview here if needed */}
      </DragOverlay>
    </DndContext>
  );
}
