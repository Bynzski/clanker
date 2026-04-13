import { Suspense, lazy, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { WorkspaceScopeProvider } from './WorkspaceScope';
import BrowserLifecycleCoordinator from './BrowserLifecycleCoordinator';

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
  const surfaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    if (isActive) {
      surface.removeAttribute('inert');
      return;
    }

    surface.setAttribute('inert', '');
  }, [isActive]);

  return (
    <section
      ref={surfaceRef}
      className={`workspace-surface ${isActive ? 'active' : 'parked'}`}
      data-workspace-id={workspaceId}
      data-workspace-visibility={isActive ? 'active' : 'parked'}
      aria-hidden={!isActive}
      hidden={!isActive}
      tabIndex={isActive ? undefined : -1}
    >
      {mountContents ? (
        <WorkspaceScopeProvider workspaceId={workspaceId}>
          <div className="workspace-layout-row">
            <FileExplorer workspaceId={workspaceId} />
            <DynamicPaneLayout workspaceId={workspaceId} />
          </div>
        </WorkspaceScopeProvider>
      ) : null}
    </section>
  );
}

export default function WorkspaceHost() {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);

  if (workspaces.length === 0) {
    return null;
  }

  const lifecycleActiveWorkspace = workspaces.find((workspace) => workspace.lifecycle === 'active') ?? null;
  const resolvedActiveWorkspaceId = activeWorkspaceId ?? lifecycleActiveWorkspace?.id ?? workspaces[0]?.id ?? null;
  const parkedWorkspaceIds = workspaces
    .map((workspace) => workspace.id)
    .filter((workspaceId) => workspaceId !== resolvedActiveWorkspaceId);
  return (
    <Suspense fallback={<div className="main-content-loading">Loading workspace layout...</div>}>
      <div
        className="workspace-host"
        data-testid="workspace-host"
        data-active-workspace-id={resolvedActiveWorkspaceId ?? ''}
      >
        <BrowserLifecycleCoordinator activeWorkspaceId={resolvedActiveWorkspaceId} />
        <div className="workspace-active-viewport">
          {resolvedActiveWorkspaceId ? (
            <WorkspaceSurface workspaceId={resolvedActiveWorkspaceId} isActive />
          ) : null}
        </div>
        <div className="workspace-parked-container" aria-hidden="true">
          {parkedWorkspaceIds.map((workspaceId) => (
            <WorkspaceSurface
              key={workspaceId}
              workspaceId={workspaceId}
              isActive={false}
            />
          ))}
        </div>
      </div>
    </Suspense>
  );
}
