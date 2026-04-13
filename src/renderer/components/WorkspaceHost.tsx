import { Suspense, lazy } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';

const DynamicPaneLayout = lazy(() => import('./DynamicPaneLayout'));
const FileExplorer = lazy(() => import('./FileExplorer'));

function WorkspaceSurface({
  workspaceId,
  isActive,
  mountContents = true,
}: {
  workspaceId: string;
  isActive: boolean;
  mountContents?: boolean;
}) {
  return (
    <section
      className={`workspace-surface ${isActive ? 'active' : 'parked'}`}
      data-workspace-id={workspaceId}
      data-workspace-visibility={isActive ? 'active' : 'parked'}
      aria-hidden={!isActive}
      hidden={!isActive}
    >
      {mountContents ? (
        <div className="workspace-layout-row">
          <FileExplorer />
          <DynamicPaneLayout />
        </div>
      ) : null}
    </section>
  );
}

export default function WorkspaceHost() {
  const { workspaces, activeWorkspaceId, getActiveWorkspace } = useWorkspaceStore();

  if (workspaces.length === 0) {
    return null;
  }

  const activeWorkspace = getActiveWorkspace();
  const resolvedActiveWorkspaceId = activeWorkspaceId ?? activeWorkspace?.id ?? workspaces[0]?.id ?? null;
  return (
    <Suspense fallback={<div className="main-content-loading">Loading workspace layout...</div>}>
      <div
        className="workspace-host"
        data-testid="workspace-host"
        data-active-workspace-id={resolvedActiveWorkspaceId ?? ''}
      >
        <div className="workspace-active-viewport">
          {resolvedActiveWorkspaceId ? (
            <WorkspaceSurface workspaceId={resolvedActiveWorkspaceId} isActive />
          ) : null}
        </div>
      </div>
    </Suspense>
  );
}
