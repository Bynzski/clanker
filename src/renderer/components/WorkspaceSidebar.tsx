import { Suspense, lazy } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspaceNavigationStore } from '../store/workspaceNavigationStore';
import { isWorkspaceSidebarCollapsed } from '../../shared/types/workspaceNavigation';
import { WorkspaceScopeProvider } from './WorkspaceScope';
import WorkspaceNavigatorSection from './WorkspaceNavigatorSection';
import WorkspaceRail from './WorkspaceRail';
import AssistantsRoster from './assistants/AssistantsRoster';
import { useAssistantNavStore } from '../store/assistantNavStore';
import './EdgeResizeHandle.css';
import './WorkspaceSidebar.css';

const FileExplorer = lazy(() => import('./FileExplorer'));

interface WorkspaceSidebarProps {
  onOpenWorkspace?: () => void;
}

/**
 * The single sidebar shell used in sidebar navigation mode: WORKSPACES for all
 * open workspaces, plus the FILES section scoped to the active workspace only.
 * Width is application-global (`workspaceNavigationStore.sidebarWidth`); tabs-mode
 * Explorer docks keep their per-workspace `explorerSidebarWidth`. Dragging the
 * edge below the collapse threshold snaps the shell to the icon rail, and
 * dragging the rail's edge outward opens it again.
 */
export default function WorkspaceSidebar({ onOpenWorkspace }: WorkspaceSidebarProps) {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const width = useWorkspaceNavigationStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkspaceNavigationStore((state) => state.setSidebarWidth);
  const persistSidebarWidth = useWorkspaceNavigationStore((state) => state.persistSidebarWidth);
  const rememberExpandedWidth = useWorkspaceNavigationStore((state) => state.rememberExpandedWidth);
  const collapseSidebar = useWorkspaceNavigationStore((state) => state.collapseSidebar);
  const expandSidebar = useWorkspaceNavigationStore((state) => state.expandSidebar);
  const collapsed = isWorkspaceSidebarCollapsed(width);
  const assistantActive = useAssistantNavStore((state) => state.activeBotId !== null);

  const handleResizeStart = (event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent: MouseEvent) => {
      setSidebarWidth(startWidth + moveEvent.clientX - startX);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Collapsing by drag restores the width the gesture started from.
      const finalWidth = useWorkspaceNavigationStore.getState().sidebarWidth;
      rememberExpandedWidth(isWorkspaceSidebarCollapsed(finalWidth) ? startWidth : finalWidth);
      void persistSidebarWidth();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <aside
      className={`workspace-sidebar${collapsed ? ' collapsed' : ''}`}
      data-testid="workspace-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      style={{ width }}
      aria-label="Explorer"
    >
      {collapsed && <WorkspaceRail onOpenWorkspace={onOpenWorkspace} onExpand={expandSidebar} />}
      {/* The navigator stays mounted while collapsed so per-workspace expansion survives the rail. */}
      <div className="workspace-sidebar-sections" hidden={collapsed}>
        <WorkspaceNavigatorSection onOpenWorkspace={onOpenWorkspace} onCollapseSidebar={collapseSidebar} />
        <AssistantsRoster />
        {activeWorkspaceId && !collapsed && !assistantActive && (
          <Suspense fallback={null}>
            <WorkspaceScopeProvider workspaceId={activeWorkspaceId}>
              <FileExplorer key={activeWorkspaceId} workspaceId={activeWorkspaceId} variant="section" />
            </WorkspaceScopeProvider>
          </Suspense>
        )}
      </div>
      <div
        className="edge-resize-handle explorer-resize-handle"
        onMouseDown={handleResizeStart}
        title={collapsed ? 'Drag to expand sidebar' : 'Drag to resize; drag narrow to collapse'}
      />
    </aside>
  );
}
