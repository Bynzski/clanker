import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DragHandleContext } from './dragHandleContext';
import ErrorBoundary from './ErrorBoundary';
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
} from 'react-resizable-panels';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
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
  DockEdge,
  LayoutNode,
  LayoutLeaf,
  LayoutSplit,
  PaneDropTarget,
  WorkspaceTab,
} from '../store/workspaceStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useScopedWorkspace, useScopedWorkspaceActivity } from './WorkspaceScope';
import BrowserPanel from './BrowserPanel';
import EditorPane from './EditorPane';
import NotesPane from './NotesPane';
import FileExplorer from './FileExplorer';
import { DockEdgeTargets } from './DockEdgeTargets';
import './DynamicPaneLayout.css';

const TerminalPane = lazy(() => import('./TerminalPane'));

function isLeaf(node: LayoutNode): node is LayoutLeaf {
  return node.type === 'leaf';
}

// Wrapper that makes a pane draggable from its explicit header grip.
function PanelWrapper({ 
  paneId, 
  children, 
  isDragging,
  draggedPaneId,
  dropIntent,
  interactive,
}: { 
  paneId: string; 
  children: React.ReactNode; 
  isDragging: boolean;
  draggedPaneId: string | null;
  dropIntent: PaneDropTarget | null;
  interactive: boolean;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: paneId,
    data: { paneId },
    disabled: !interactive,
  });

  const mergedHandleProps = interactive ? { ...listeners, ...attributes } : {};
  const previewClass = dropIntent != null && 'targetPaneId' in dropIntent && dropIntent.targetPaneId === paneId
    ? ` preview-${dropIntent.kind === 'pane-center' ? 'center' : dropIntent.edge}`
    : '';

  return (
    <div 
      ref={setNodeRef}
      className={`draggable-droppable-pane${isDragging ? ' dragging' : ''}${previewClass}`}
    >
      {/* Pass drag handle props to child for header */}
      <DragHandleProvider handleProps={mergedHandleProps}>
        <div className="pane-content">
          {children}
        </div>
      </DragHandleProvider>
      <PaneDockTargets
        paneId={paneId}
        draggedPaneId={draggedPaneId}
        activeIntent={dropIntent}
        interactive={interactive}
      />
    </div>
  );
}

const PANE_DROP_ZONES: Array<{ zone: 'center' | DockEdge; label: string }> = [
  { zone: 'left', label: 'Split left' },
  { zone: 'right', label: 'Split right' },
  { zone: 'top', label: 'Split above' },
  { zone: 'bottom', label: 'Split below' },
  { zone: 'center', label: 'Swap panes' },
];

function PaneDockTargets({
  paneId,
  draggedPaneId,
  activeIntent,
  interactive,
}: {
  paneId: string;
  draggedPaneId: string | null;
  activeIntent: PaneDropTarget | null;
  interactive: boolean;
}) {
  const isAvailable = interactive && draggedPaneId != null && draggedPaneId !== paneId;
  return (
    <div className={`pane-dock-overlay${isAvailable ? ' active' : ''}`} aria-hidden="true">
      {PANE_DROP_ZONES.map(({ zone, label }) => (
        <PaneDockZone
          key={zone}
          paneId={paneId}
          zone={zone}
          label={label}
          disabled={!isAvailable}
          isActive={zone === 'center'
            ? activeIntent?.kind === 'pane-center' && activeIntent.targetPaneId === paneId
            : activeIntent?.kind === 'pane-edge'
              && activeIntent.targetPaneId === paneId
              && activeIntent.edge === zone}
        />
      ))}
    </div>
  );
}

function PaneDockZone({
  paneId,
  zone,
  label,
  disabled,
  isActive,
}: {
  paneId: string;
  zone: 'center' | DockEdge;
  label: string;
  disabled: boolean;
  isActive: boolean;
}) {
  const intent: PaneDropTarget = zone === 'center'
    ? { kind: 'pane-center', targetPaneId: paneId }
    : { kind: 'pane-edge', targetPaneId: paneId, edge: zone };
  const droppable = useDroppable({
    id: `pane-drop-${zone}-${paneId}`,
    data: { intent },
    disabled,
  });
  return (
    <div
      ref={droppable.setNodeRef}
      className={`pane-dock-zone zone-${zone}${isActive ? ' over' : ''}`}
      data-zone={zone}
    >
      <span>{label}</span>
    </div>
  );
}

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

function LeafView({
  workspaceId,
  node,
  draggedPaneId,
  dropIntent,
}: {
  workspaceId?: string;
  node: LayoutLeaf;
  draggedPaneId: string | null;
  dropIntent: PaneDropTarget | null;
}) {
  const workspace = useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);
  const fallbackLayoutRevision = useWorkspaceStore((state) => state.layoutRevision);
  const paneId = node.paneId;
  
  const isDraggingThis = draggedPaneId === paneId;
  const content = workspace?.browserVisible && workspace.browserPane?.id === paneId ? (
    <BrowserPanel
      workspaceId={workspaceId}
      layoutVersion={workspace.layoutRevision ?? fallbackLayoutRevision}
    />
  ) : workspace?.explorerVisible && workspace.explorerPane?.id === paneId ? (
    <FileExplorer workspaceId={workspaceId} />
  ) : workspace?.editorPane?.id === paneId ? (
    <Suspense fallback={<div className="layout-pane-loading">Loading editor...</div>}>
      <EditorPane workspaceId={workspaceId} />
    </Suspense>
  ) : workspace?.notesVisible && workspace.notesPane?.id === paneId ? (
    <NotesPane workspaceId={workspaceId} />
  ) : (
    <Suspense fallback={<div className="layout-pane-loading">Loading terminal...</div>}>
      <TerminalPane workspaceId={workspaceId} paneId={paneId} />
    </Suspense>
  );

  return (
    <PanelWrapper
      paneId={paneId}
      isDragging={isDraggingThis}
      draggedPaneId={draggedPaneId}
      dropIntent={dropIntent}
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
  dropIntent,
}: {
  workspaceId?: string;
  node: LayoutSplit;
  draggedPaneId: string | null;
  dropIntent: PaneDropTarget | null;
}) {
  useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);
  const setSplitRatio = useWorkspaceStore((state) => state.setSplitRatio);
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const hasReceivedInitialLayoutRef = useRef(false);
  const isApplyingStoredLayoutRef = useRef(false);
  const splitNodeIdRef = useRef(node.nodeId);

  if (splitNodeIdRef.current !== node.nodeId) {
    splitNodeIdRef.current = node.nodeId;
    hasReceivedInitialLayoutRef.current = false;
    isApplyingStoredLayoutRef.current = false;
  }

  const firstRatio = Math.max(10, Math.min(90, node.ratio * 100));
  const secondRatio = 100 - firstRatio;
  const renderedRatio = firstRatio / 100;
  const renderedRatioRef = useRef(renderedRatio);
  renderedRatioRef.current = renderedRatio;
  
  // Create default layout object with panel IDs as keys
  const panelAId = `${node.nodeId}-a`;
  const panelBId = `${node.nodeId}-b`;
  const defaultLayout: Layout = { [panelAId]: firstRatio, [panelBId]: secondRatio };

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (group == null) {
      return;
    }

    const currentLayout = group.getLayout();
    const currentFirst = currentLayout[panelAId];
    const currentSecond = currentLayout[panelBId];
    if (currentFirst == null || currentSecond == null) {
      return;
    }

    const currentTotal = currentFirst + currentSecond;
    if (currentTotal <= 0 || Math.abs(currentFirst / currentTotal - renderedRatio) < 0.0001) {
      return;
    }

    isApplyingStoredLayoutRef.current = true;
    try {
      group.setLayout({ [panelAId]: firstRatio, [panelBId]: secondRatio });
    } finally {
      isApplyingStoredLayoutRef.current = false;
    }
  }, [firstRatio, panelAId, panelBId, renderedRatio, secondRatio]);
  
  const handleLayoutChange = useCallback((layout: Layout) => {
    const first = layout[panelAId];
    const second = layout[panelBId];
    if (first != null && second != null) {
      const total = first + second;
      if (total > 0) {
        const nextRatio = first / total;

        // The panel library reports its initialized layout on mount. Persisting
        // that callback would create an undo entry without any user action.
        if (!hasReceivedInitialLayoutRef.current) {
          hasReceivedInitialLayoutRef.current = true;
          return;
        }

        // Store-driven changes (for example layout Undo) are applied through
        // the imperative API above and must not be recorded as a new resize.
        if (
          isApplyingStoredLayoutRef.current
          || Math.abs(nextRatio - renderedRatioRef.current) < 0.0001
        ) {
          return;
        }

        if (workspaceId) {
          setSplitRatio(node.nodeId, nextRatio, workspaceId);
        } else {
          setSplitRatio(node.nodeId, nextRatio);
        }
      }
    }
  }, [node.nodeId, panelAId, panelBId, setSplitRatio, workspaceId]);
  
  return (
    <Group
      id={node.nodeId}
      className={`split-group split-${node.orientation}`}
      orientation={node.orientation}
      defaultLayout={defaultLayout}
      groupRef={groupRef}
      resizeTargetMinimumSize={{ coarse: 28, fine: 20 }}
      onLayoutChanged={handleLayoutChange}
    >
      <Panel
        id={panelAId}
        defaultSize={firstRatio}
        minSize={12}
        disabled={!isInteractive}
      >
        <LayoutNodeView workspaceId={workspaceId} node={node.first} draggedPaneId={draggedPaneId} dropIntent={dropIntent} />
      </Panel>
      <Separator className="split-separator" />
      <Panel
        id={panelBId}
        defaultSize={secondRatio}
        minSize={12}
        disabled={!isInteractive}
      >
        <LayoutNodeView workspaceId={workspaceId} node={node.second} draggedPaneId={draggedPaneId} dropIntent={dropIntent} />
      </Panel>
    </Group>
  );
}

function LayoutNodeView({
  workspaceId,
  node,
  draggedPaneId,
  dropIntent,
}: {
  workspaceId?: string;
  node: LayoutNode;
  draggedPaneId: string | null;
  dropIntent: PaneDropTarget | null;
}) {
  if (isLeaf(node)) {
    return <LeafView workspaceId={workspaceId} node={node} draggedPaneId={draggedPaneId} dropIntent={dropIntent} />;
  }

  return <SplitView workspaceId={workspaceId} node={node} draggedPaneId={draggedPaneId} dropIntent={dropIntent} />;
}

function renderLayout(
  workspaceId: string | undefined,
  root: LayoutNode | null,
  draggedPaneId: string | null,
  dropIntent: PaneDropTarget | null,
): React.ReactNode {
  if (root == null) {
    return null;
  }

  return <LayoutNodeView workspaceId={workspaceId} node={root} draggedPaneId={draggedPaneId} dropIntent={dropIntent} />;
}

type ParsedDockTarget =
  | { edge: DockEdge; kind: 'full' }
  | { edge: DockEdge; kind: 'segment'; segmentIndex: number };

function parseDockDropId(overId: string): ParsedDockTarget | null {
  if (!overId.startsWith('dock-')) {
    return null;
  }
  const rest = overId.slice('dock-'.length);
  const dashIndex = rest.indexOf('-');
  if (dashIndex === -1) {
    return null;
  }
  const edgePart = rest.slice(0, dashIndex);
  const typePart = rest.slice(dashIndex + 1);
  if (edgePart !== 'left' && edgePart !== 'right' && edgePart !== 'top' && edgePart !== 'bottom') {
    return null;
  }
  const edge = edgePart as DockEdge;
  if (typePart === 'full') {
    return { edge, kind: 'full' };
  }
  if (typePart.startsWith('segment-')) {
    const segmentIndex = Number.parseInt(typePart.slice('segment-'.length), 10);
    if (Number.isFinite(segmentIndex)) {
      return { edge, kind: 'segment', segmentIndex };
    }
  }
  return null;
}

function getDropIntent(over: DragOverEvent['over'] | DragEndEvent['over']): PaneDropTarget | null {
  if (over == null) return null;
  const intent = over.data?.current?.intent as PaneDropTarget | undefined;
  if (intent) return intent;

  // Backward-compatible parsing keeps older persisted/test target IDs harmless.
  const overId = String(over.id);
  const dock = parseDockDropId(overId);
  if (dock?.kind === 'full') {
    return { kind: 'workspace-edge', edge: dock.edge };
  }
  const targetPaneId = over.data?.current?.targetPaneId as string | undefined;
  if (dock?.kind === 'segment' && targetPaneId) {
    return { kind: 'pane-edge', targetPaneId, edge: dock.edge };
  }
  if (overId.startsWith('drop-')) {
    return { kind: 'pane-center', targetPaneId: overId.slice(5) };
  }
  return overId.startsWith('dock-') || overId.startsWith('workspace-edge-') || overId.startsWith('pane-drop-')
    ? null
    : { kind: 'pane-center', targetPaneId: overId };
}

const edgeFriendlyCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return [...pointerCollisions].sort((a, b) => {
      const aIsWorkspaceEdge = String(a.id).startsWith('workspace-edge-');
      const bIsWorkspaceEdge = String(b.id).startsWith('workspace-edge-');
      if (aIsWorkspaceEdge === bIsWorkspaceEdge) {
        return 0;
      }
      return aIsWorkspaceEdge ? -1 : 1;
    });
  }
  return closestCorners(args);
};

function getPaneLabel(workspace: WorkspaceTab | null, paneId: string): string {
  if (workspace?.browserPane?.id === paneId) return 'Browser';
  if (workspace?.explorerPane?.id === paneId) return 'Explorer';
  if (workspace?.editorPane?.id === paneId) return 'Editor';
  if (workspace?.notesPane?.id === paneId) return 'Notes';
  const paneIndex = workspace?.panes.findIndex((pane) => pane.id === paneId) ?? -1;
  return paneIndex >= 0 ? `Terminal ${paneIndex + 1}` : 'Pane';
}

export default function DynamicPaneLayout({ workspaceId }: { workspaceId?: string }) {
  const workspace = useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);
  const movePane = useWorkspaceStore((state) => state.movePane);
  const pushBrowserOverlay = useWorkspaceStore((state) => state.pushBrowserOverlay);
  const popBrowserOverlay = useWorkspaceStore((state) => state.popBrowserOverlay);
  const scopedWorkspaceId = workspace?.id;
  const hasVisibleBrowser = workspace?.browserVisible === true;

  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<PaneDropTarget | null>(null);
  const browserOverlayHeldRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Require 5px movement before activating drag
      },
    }),
    useSensor(KeyboardSensor),
  );

  const releaseBrowserOverlay = useCallback(() => {
    if (!browserOverlayHeldRef.current || !scopedWorkspaceId) return;
    browserOverlayHeldRef.current = false;
    popBrowserOverlay(scopedWorkspaceId);
  }, [popBrowserOverlay, scopedWorkspaceId]);

  useEffect(() => releaseBrowserOverlay, [releaseBrowserOverlay]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (!isInteractive) {
      return;
    }
    setActivePaneId(event.active.id as string);
    setDropIntent(null);
    if (hasVisibleBrowser && scopedWorkspaceId && !browserOverlayHeldRef.current) {
      browserOverlayHeldRef.current = true;
      pushBrowserOverlay(scopedWorkspaceId);
      void window.electronAPI.browserHide(scopedWorkspaceId);
    }
  }, [hasVisibleBrowser, isInteractive, pushBrowserOverlay, scopedWorkspaceId]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (!isInteractive) {
      return;
    }
    setDropIntent(getDropIntent(event.over));
  }, [isInteractive]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (!isInteractive) {
      setActivePaneId(null);
      setDropIntent(null);
      releaseBrowserOverlay();
      return;
    }
    const activeId = event.active.id as string;
    const intent = getDropIntent(event.over);
    if (intent) {
      movePane(activeId, intent, workspaceId);
    }

    setActivePaneId(null);
    setDropIntent(null);
    releaseBrowserOverlay();
  }, [isInteractive, movePane, releaseBrowserOverlay, workspaceId]);

  const handleDragCancel = useCallback(() => {
    setActivePaneId(null);
    setDropIntent(null);
    releaseBrowserOverlay();
  }, [releaseBrowserOverlay]);

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
          {renderLayout(workspaceId, workspace.layoutRoot, activePaneId, dropIntent)}
        </div>
        <DockEdgeTargets
          activeIntent={dropIntent}
          isDragging={isInteractive && activePaneId != null}
        />
      </div>
      <DragOverlay dropAnimation={null}>
        {activePaneId ? (
          <div className="pane-drag-preview">
            <span className="pane-drag-preview-grip" />
            <span>{getPaneLabel(workspace, activePaneId)}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
