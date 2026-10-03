import { Suspense, lazy } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspaceNavigationStore } from '../store/workspaceNavigationStore';
import { WorkspaceScopeProvider } from './WorkspaceScope';
import WorkspaceNavigatorSection from './WorkspaceNavigatorSection';
import './WorkspaceSidebar.css';

const FileExplorer = lazy(() => import('./FileExplorer'));

interface WorkspaceSidebarProps {
  onOpenWorkspace?: () => void;
}

/**
 * The single sidebar shell used in sidebar navigation mode: WORKSPACES for all
 * open workspaces, plus the FILES section scoped to the active workspace only.
 * Width is application-global (`workspaceNavigationStore.sidebarWidth`); tabs-mode
 * Explorer docks keep their per-workspace `explorerSidebarWidth`.
 */
export default function WorkspaceSidebar({ onOpenWorkspace }: WorkspaceSidebarProps) {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const width = useWorkspaceNavigationStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkspaceNavigationStore((state) => state.setSidebarWidth);
  const persistSidebarWidth = useWorkspaceNavigationStore((state) => state.persistSidebarWidth);

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
      void persistSidebarWidth();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <aside className="workspace-sidebar" data-testid="workspace-sidebar" style={{ width }} aria-label="Explorer">
      <WorkspaceNavigatorSection onOpenWorkspace={onOpenWorkspace} />
      {activeWorkspaceId && (
        <Suspense fallback={null}>
          <WorkspaceScopeProvider workspaceId={activeWorkspaceId}>
            <FileExplorer key={activeWorkspaceId} workspaceId={activeWorkspaceId} variant="section" />
          </WorkspaceScopeProvider>
        </Suspense>
      )}
      <div className="explorer-resize-handle" onMouseDown={handleResizeStart} />
    </aside>
  );
}
