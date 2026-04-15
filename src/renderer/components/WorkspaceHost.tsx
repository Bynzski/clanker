import { Suspense, lazy, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { WorkspaceScopeProvider } from './WorkspaceScope';
import BrowserLifecycleCoordinator from './BrowserLifecycleCoordinator';
import {
  startSwitch,
  surfaceMount,
  surfaceUnmount,
  surfaceReactMount,
  surfaceReactUnmount,
} from '../lib/workspaceSwitchDebug';

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
  // Track prior isActive state to detect transitions
  const prevIsActiveRef = useRef<boolean | null>(null);
  // Track mount count to detect actual React mount/unmount
  const mountCountRef = useRef(0);

  // Instrument actual React mount/unmount (runs on component mount/unmount only)
  useEffect(() => {
    mountCountRef.current += 1;
    surfaceReactMount(workspaceId);
    return () => {
      mountCountRef.current -= 1;
      surfaceReactUnmount(workspaceId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps = mount/unmount only

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

  // Instrument surface lifecycle transitions (park/unpark)
  useEffect(() => {
    const prev = prevIsActiveRef.current;
    if (prev !== isActive) {
      if (isActive) {
        surfaceMount(workspaceId, true, prev === false && prev !== null);
      } else if (prev === true) {
        surfaceUnmount(workspaceId);
      }
      prevIsActiveRef.current = isActive;
    }
  }, [isActive, workspaceId]);

  return (
    <section
      ref={surfaceRef}
      className={`workspace-surface ${isActive ? 'active' : 'parked'}`}
      data-workspace-id={workspaceId}
      data-workspace-visibility={isActive ? 'active' : 'parked'}
      aria-hidden={!isActive}
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
  // Track prior active ID to detect switches
  const prevActiveWorkspaceIdRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevActiveWorkspaceIdRef.current;
    const next = activeWorkspaceId ?? null;
    if (prev !== next && next !== null) {
      startSwitch(prev, next);
    }
    prevActiveWorkspaceIdRef.current = next;
  }, [activeWorkspaceId]);

  if (workspaces.length === 0) {
    return null;
  }

  const lifecycleActiveWorkspace = workspaces.find((workspace) => workspace.lifecycle === 'active') ?? null;
  const resolvedActiveWorkspaceId = activeWorkspaceId ?? lifecycleActiveWorkspace?.id ?? workspaces[0]?.id ?? null;
  return (
    <Suspense fallback={<div className="main-content-loading">Loading workspace layout...</div>}>
      <div
        className="workspace-host"
        data-testid="workspace-host"
        data-active-workspace-id={resolvedActiveWorkspaceId ?? ''}
      >
        <BrowserLifecycleCoordinator activeWorkspaceId={resolvedActiveWorkspaceId} />
        <div className="workspace-surfaces-container">
          {workspaces.map((workspace) => (
            <WorkspaceSurface
              key={workspace.id}
              workspaceId={workspace.id}
              isActive={workspace.id === resolvedActiveWorkspaceId}
            />
          ))}
        </div>
      </div>
    </Suspense>
  );
}
