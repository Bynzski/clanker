import { Suspense, lazy } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { WorkspaceScopeProvider } from './WorkspaceScope';
import WorkspaceNavigatorSection from './WorkspaceNavigatorSection';
import './WorkspaceSidebar.css';

const FileExplorer = lazy(() => import('./FileExplorer'));

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;

interface WorkspaceSidebarProps {
  onOpenWorkspace?: () => void;
}

/**
 * The single sidebar shell used in sidebar navigation mode: WORKSPACES for all
 * open workspaces, plus the FILES section scoped to the active workspace only.
 * Width follows the active workspace's `explorerSidebarWidth` (Stage 2 compromise).
 */
export default function WorkspaceSidebar({ onOpenWorkspace }: WorkspaceSidebarProps) {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const width = useWorkspaceStore((state) =>
    state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)?.explorerSidebarWidth ?? 280);
  const setExplorerSidebarWidth = useWorkspaceStore((state) => state.setExplorerSidebarWidth);

  const handleResizeStart = (event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const workspaceId = activeWorkspaceId ?? undefined;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent: MouseEvent) => {
      setExplorerSidebarWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + moveEvent.clientX - startX)), workspaceId);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
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
