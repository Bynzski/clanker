import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { WorkspaceScopeProvider } from './WorkspaceScope';
import BrowserLifecycleCoordinator from './BrowserLifecycleCoordinator';
import WorkspaceSidebar from './WorkspaceSidebar';
import { useWorkspaceNavigationStore } from '../store/workspaceNavigationStore';
import ExplorerLifecycleCoordinator from './ExplorerLifecycleCoordinator';
import { withWorkspaceResidency } from '../store/workspaceStoreHelpers';
import {
  recordWorkspaceActivation,
  selectWarmWorkspaceIds,
} from '../lib/workspaceWarmth';
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
  showExplorerDock = true,
}: {
  workspaceId: string;
  isActive: boolean;
  mountContents?: boolean;
  /** Tabs mode renders a per-surface Explorer dock; sidebar mode uses the single shared sidebar. */
  showExplorerDock?: boolean;
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
      data-workspace-residency={mountContents ? 'warm' : 'cold'}
      aria-hidden={!isActive}
      tabIndex={isActive ? undefined : -1}
    >
      {mountContents ? (
        <WorkspaceScopeProvider workspaceId={workspaceId}>
          <div className="workspace-layout-row">
            {showExplorerDock && <FileExplorer workspaceId={workspaceId} />}
            <DynamicPaneLayout workspaceId={workspaceId} />
          </div>
        </WorkspaceScopeProvider>
      ) : null}
    </section>
  );
}

interface WorkspaceHostProps {
  onOpenWorkspace?: () => void;
}

export default function WorkspaceHost({ onOpenWorkspace }: WorkspaceHostProps = {}) {
  const navigationMode = useWorkspaceNavigationStore((state) => state.mode);
  const sidebarMode = navigationMode === 'sidebar';
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  // Track prior active ID to detect switches
  const prevActiveWorkspaceIdRef = useRef<string | null>(null);
  const recentWorkspaceIdsRef = useRef<string[]>([]);

  const workspaceIds = useMemo(
    () => workspaces.map((workspace) => workspace.id),
    [workspaces],
  );

  useEffect(() => {
    const prev = prevActiveWorkspaceIdRef.current;
    const next = activeWorkspaceId ?? null;
    if (prev !== next && next !== null) {
      startSwitch(prev, next);
    }
    prevActiveWorkspaceIdRef.current = next;
  }, [activeWorkspaceId]);

  const lifecycleActiveWorkspace = workspaces.find((workspace) => workspace.lifecycle === 'active') ?? null;
  const resolvedActiveWorkspaceId = activeWorkspaceId ?? lifecycleActiveWorkspace?.id ?? workspaces[0]?.id ?? null;
  const warmWorkspaceIds = useMemo(
    () => selectWarmWorkspaceIds(
      workspaceIds,
      resolvedActiveWorkspaceId,
      recentWorkspaceIdsRef.current,
    ),
    [resolvedActiveWorkspaceId, workspaceIds],
  );
  const warmWorkspaceIdSet = useMemo(() => new Set(warmWorkspaceIds), [warmWorkspaceIds]);

  useEffect(() => {
    recentWorkspaceIdsRef.current = recordWorkspaceActivation(
      recentWorkspaceIdsRef.current,
      resolvedActiveWorkspaceId,
      workspaceIds,
    );
  }, [resolvedActiveWorkspaceId, workspaceIds]);

  useEffect(() => {
    useWorkspaceStore.setState((state) => {
      let changed = false;
      const nextWorkspaces = state.workspaces.map((workspace) => {
        const residencyState = warmWorkspaceIdSet.has(workspace.id) ? 'warm' : 'cold';
        if (workspace.runtimeState.residencyState === residencyState) {
          return workspace;
        }
        changed = true;
        return withWorkspaceResidency(workspace, residencyState);
      });
      return changed ? { ...state, workspaces: nextWorkspaces } : state;
    });
  }, [warmWorkspaceIdSet]);

  // The Explorer watcher owner lives outside the lazy/Suspense presentation subtree.
  if (workspaces.length === 0) {
    return <ExplorerLifecycleCoordinator />;
  }

  return (
    <>
    <ExplorerLifecycleCoordinator />
    <Suspense fallback={<div className="main-content-loading">Loading workspace layout...</div>}>
      <div
        className={`workspace-host${sidebarMode ? ' with-sidebar' : ''}`}
        data-testid="workspace-host"
        data-active-workspace-id={resolvedActiveWorkspaceId ?? ''}
        data-navigation-mode={navigationMode}
      >
        <BrowserLifecycleCoordinator activeWorkspaceId={resolvedActiveWorkspaceId} />
        {sidebarMode && <WorkspaceSidebar onOpenWorkspace={onOpenWorkspace} />}
        <div className="workspace-surfaces-container">
          {workspaces.map((workspace) => (
            <WorkspaceSurface
              key={workspace.id}
              workspaceId={workspace.id}
              isActive={workspace.id === resolvedActiveWorkspaceId}
              mountContents={warmWorkspaceIdSet.has(workspace.id)}
              showExplorerDock={!sidebarMode}
            />
          ))}
        </div>
      </div>
    </Suspense>
    </>
  );
}
