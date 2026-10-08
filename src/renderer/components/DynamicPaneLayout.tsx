import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  useDndMonitor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
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
import { DockEdgeTargets } from './DockEdgeTargets';
import { collectLeafPaneIds } from '../store/workspaceLayout';
import { activePage, paneIsPresented } from '../store/workspacePages';
import { PanePresentationControls } from './WorkspacePageControls';
import { useSharedPaneDrag } from './WorkspacePaneDragProvider';
import { currentPaneDrag, pageDropTarget, paneCollisionDetection } from '../lib/workspacePaneDrag';
import { getTerminalReadinessRevision, subscribeTerminalReadiness, terminalNeedsBootstrap } from '../lib/terminalRuntimeCache';
import './DynamicPaneLayout.css';

const TerminalPane = lazy(() => import('./TerminalPane'));

function isLeaf(node: LayoutNode): node is LayoutLeaf {
  return node.type === 'leaf';
}

// Wrapper that makes a pane draggable from its explicit header grip.
function PanelWrapper({ 
  paneId,
  workspaceId,
  pageId,
  children,
  isDragging,
  draggedPaneId,
  dropIntent,
  interactive,
}: { 
  paneId: string;
  workspaceId?: string;
  pageId?: string;
  children: React.ReactNode;
  isDragging: boolean;
  draggedPaneId: string | null;
  dropIntent: PaneDropTarget | null;
  interactive: boolean;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: paneId,
    data: { paneId, workspaceId, pageId },
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
  const isInteractive = useScopedWorkspaceActivity(workspaceId) && (!workspace?.pages || paneIsPresented(workspace, node.paneId));
  const fallbackLayoutRevision = useWorkspaceStore((state) => state.layoutRevision);
  const paneId = node.paneId;
  
  const isDraggingThis = draggedPaneId === paneId;
  const content = workspace?.browserVisible && workspace.browserPane?.id === paneId ? (
    <BrowserPanel
      workspaceId={workspaceId}
      layoutVersion={workspace.layoutRevision ?? fallbackLayoutRevision}
    />
  ) : workspace?.editorPane?.id === paneId ? (
    <Suspense fallback={<div className="layout-pane-loading">Loading editor…</div>}>
      <EditorPane workspaceId={workspaceId} />
    </Suspense>
  ) : workspace?.notesVisible && workspace.notesPane?.id === paneId ? (
    <NotesPane workspaceId={workspaceId} />
  ) : (
    <Suspense fallback={<div className="layout-pane-loading">Loading terminal…</div>}>
      <TerminalPane workspaceId={workspaceId} paneId={paneId} background={!isInteractive} />
    </Suspense>
  );

  return (
    <PanelWrapper
      paneId={paneId}
      workspaceId={workspace?.id}
      pageId={workspace?.activePageId}
      isDragging={isDraggingThis}
      draggedPaneId={draggedPaneId}
      dropIntent={dropIntent}
      interactive={isInteractive && !(workspace && activePage(workspace)?.maximizedPaneId)
        && !workspace?.panes.some((pane) => pane.id === paneId && !pane.terminalId)}
    >
      <ErrorBoundary paneId={paneId}>
        {workspace && workspace.browserPane?.id !== paneId && !workspace.panes.some((pane) => pane.id === paneId) && isInteractive && <div className="utility-presentation-controls"><PanePresentationControls workspace={workspace} paneId={paneId} /></div>}
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
  const workspace = useScopedWorkspace(workspaceId);
  const pageId = workspace?.activePageId;
  const isInteractive = useScopedWorkspaceActivity(workspaceId) && !(workspace && activePage(workspace)?.maximizedPaneId);
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
    if (!isInteractive || (workspaceId && useWorkspaceStore.getState().getWorkspaceById(workspaceId)?.activePageId !== pageId)) return;
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
  }, [node.nodeId, panelAId, panelBId, setSplitRatio, workspaceId, pageId, isInteractive]);
  
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
  if (pageDropTarget(over.data?.current?.intent)) return null;
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

interface PaneDragEvents {
  onDragStart(event: DragStartEvent): void;
  onDragOver(event: DragOverEvent): void;
  onDragEnd(event: DragEndEvent): void;
  onDragCancel(): void;
}
function PaneDragMonitor({ events, children }: { events: PaneDragEvents; children: React.ReactNode }) {
  useDndMonitor(events);
  return <>{children}</>;
}
function PaneDragScope({ events, children }: { events: PaneDragEvents; children: React.ReactNode }) {
  const shared = useSharedPaneDrag();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  // Standalone embeddings/tests retain the original local drag domain; App shares it with the footer.
  return shared ? <PaneDragMonitor events={events}>{children}</PaneDragMonitor>
    : <DndContext sensors={sensors} collisionDetection={paneCollisionDetection} {...events}>{children}</DndContext>;
}

function getPaneLabel(workspace: WorkspaceTab | null, paneId: string): string {
  if (workspace?.browserPane?.id === paneId) return 'Browser';
  if (workspace?.explorerPane?.id === paneId) return 'Explorer';
  if (workspace?.editorPane?.id === paneId) return 'Editor';
  if (workspace?.notesPane?.id === paneId) return 'Notes';
  const paneIndex = workspace?.panes.findIndex((pane) => pane.id === paneId) ?? -1;
  return paneIndex >= 0 ? `Terminal ${paneIndex + 1}` : 'Pane';
}

function BackgroundTerminals({ workspace, visibleIds }: { workspace: WorkspaceTab; visibleIds: Set<string> }) {
  // One subscription per workspace surface, not one mounted view per cached terminal.
  useSyncExternalStore(subscribeTerminalReadiness, getTerminalReadinessRevision);
  return <div className="background-terminal-surfaces" aria-hidden="true" inert>
    {workspace.panes.filter((pane) => pane.terminalId && !visibleIds.has(pane.id) && terminalNeedsBootstrap(pane.terminalId)).map((pane) => <div key={pane.id}>
      <Suspense fallback={null}><TerminalPane workspaceId={workspace.id} paneId={pane.id} background /></Suspense>
    </div>)}
  </div>;
}

export default function DynamicPaneLayout({ workspaceId }: { workspaceId?: string }) {
  const workspace = useScopedWorkspace(workspaceId);
  const maximized = workspace ? activePage(workspace)?.maximizedPaneId : undefined;
  return <WorkspacePageLayout key={`${workspace?.activePageId ?? 'single'}:${maximized ?? ''}`} workspaceId={workspaceId} />;
}

function WorkspacePageLayout({ workspaceId }: { workspaceId?: string }) {
  const workspace = useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);
  const movePane = useWorkspaceStore((state) => state.movePane);
  const moveToPage = useWorkspaceStore((state) => state.movePaneToWorkspacePage);
  const pushBrowserOverlay = useWorkspaceStore((state) => state.pushBrowserOverlay);
  const popBrowserOverlay = useWorkspaceStore((state) => state.popBrowserOverlay);
  const scopedWorkspaceId = workspace?.id;
  const pageId = workspace?.activePageId;
  const maximizedPaneId = workspace ? activePage(workspace)?.maximizedPaneId : undefined;
  const presentationRoot: LayoutNode | null = maximizedPaneId
    ? { type: 'leaf', nodeId: `maximized-${maximizedPaneId}`, paneId: maximizedPaneId } : workspace?.layoutRoot ?? null;
  const visibleIds = new Set(collectLeafPaneIds(presentationRoot));
  const hasVisibleBrowser = workspace?.browserVisible === true;

  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<PaneDropTarget | null>(null);
  const browserOverlayHeldRef = useRef(false);

  const releaseBrowserOverlay = useCallback(() => {
    if (!browserOverlayHeldRef.current || !scopedWorkspaceId) return;
    browserOverlayHeldRef.current = false;
    popBrowserOverlay(scopedWorkspaceId);
  }, [popBrowserOverlay, scopedWorkspaceId]);

  useEffect(() => releaseBrowserOverlay, [releaseBrowserOverlay]);
  const dragPageRef = useRef<string | undefined>(undefined);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (!isInteractive || (event.active.data?.current && (!workspace || !currentPaneDrag(event.active.data.current, workspace)))) return;
    dragPageRef.current = pageId;
    setActivePaneId(event.active.id as string);
    setDropIntent(null);
    if (hasVisibleBrowser && scopedWorkspaceId && !browserOverlayHeldRef.current) {
      browserOverlayHeldRef.current = true;
      pushBrowserOverlay(scopedWorkspaceId);
      void window.electronAPI.browserHide(scopedWorkspaceId);
    }
  }, [hasVisibleBrowser, isInteractive, pushBrowserOverlay, scopedWorkspaceId, pageId, workspace]);

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
    const destination = pageDropTarget(event.over?.data?.current?.intent);
    const intent = getDropIntent(event.over);
    setActivePaneId(null);
    setDropIntent(null);
    releaseBrowserOverlay();
    if (dragPageRef.current !== (scopedWorkspaceId ? useWorkspaceStore.getState().getWorkspaceById(scopedWorkspaceId)?.activePageId : pageId)) return;
    if (destination && scopedWorkspaceId && destination.workspaceId === scopedWorkspaceId && dragPageRef.current) {
      moveToPage(scopedWorkspaceId, activeId, destination.pageId, dragPageRef.current);
    } else if (intent) movePane(activeId, intent, workspaceId);
  }, [isInteractive, movePane, moveToPage, releaseBrowserOverlay, workspaceId, scopedWorkspaceId, pageId]);

  const handleDragCancel = useCallback(() => {
    setActivePaneId(null);
    setDropIntent(null);
    releaseBrowserOverlay();
  }, [releaseBrowserOverlay]);

  if (workspace?.layoutRoot == null) {
    return (
      <div className="dynamic-pane-layout empty">
        {workspace && <BackgroundTerminals workspace={workspace} visibleIds={visibleIds} />}
        <div className="empty-state">
          <span>{workspace?.pages && (workspace.pages.length > 1 || workspace.panes.length > 0) ? 'No panes on this page' : 'No terminals open'}</span>
          <span className="hint">Choose a terminal type in the header</span>
        </div>
      </div>
    );
  }

  return (
    <PaneDragScope events={{ onDragStart: handleDragStart, onDragOver: handleDragOver, onDragEnd: handleDragEnd, onDragCancel: handleDragCancel }}>
      <div className="dynamic-pane-layout" data-workspace-interactive={isInteractive ? 'true' : 'false'}>
        {workspace && <BackgroundTerminals workspace={workspace} visibleIds={visibleIds} />}
        <div className="split-root">
          {renderLayout(workspaceId, presentationRoot, activePaneId, dropIntent)}
        </div>
        <DockEdgeTargets
          scopeId={`${scopedWorkspaceId}:${pageId}`}
          activeIntent={dropIntent}
          isDragging={isInteractive && !maximizedPaneId && activePaneId != null}
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
    </PaneDragScope>
  );
}
