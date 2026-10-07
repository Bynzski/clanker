import { Button } from './ui/Button';
import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { WorkspaceScopeProvider } from './WorkspaceScope';
import BrowserLifecycleCoordinator from './BrowserLifecycleCoordinator';
import WorkspaceSidebar from './WorkspaceSidebar';
import { useWorkspaceNavigationStore } from '../store/workspaceNavigationStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { useAssistantsStore } from '../store/assistantsStore';
import { useAssistantSurfaceStore } from '../store/assistantSurfaceStore';
import { assistantBrowserOwnerId } from '../../shared/browserOwner';
import AssistantSurface from './assistants/AssistantSurface';
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
  const activeAssistantId = useAssistantNavStore((state) => state.activeAssistantId);
  const openedAssistantIds = useAssistantNavStore((state) => state.openedAssistantIds);
  const knownAssistants = useAssistantsStore((state) => state.knownAssistants);
  const assistantActive = activeAssistantId !== null;
  const clearAssistantSurfaceUi = useAssistantSurfaceStore((state) => state.clearAll);
  const clearAllAssistants = useAssistantNavStore((state) => state.clearAllAssistants);
  const ensureAssistantsSubscribed = useAssistantsStore((state) => state.ensureSubscribed);
  // Authoritative disabled/unavailable snapshot = deliberate teardown. A transient offline/probing/starting
  // service is NOT: those keep their parked surfaces so they can re-attach.
  const assistantsOff = useAssistantsStore((state) => state.snapshot !== null && (!state.snapshot.available || !state.snapshot.settings.enabled));
  useEffect(() => { ensureAssistantsSubscribed(); }, [ensureAssistantsSubscribed]);
  useEffect(() => {
    if (!assistantsOff) return;
    clearAllAssistants();
    clearAssistantSurfaceUi(); // main disposes the Assistant-owned native Browser views on the same transition
  }, [assistantsOff, clearAllAssistants, clearAssistantSurfaceUi]);
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
  // One active Browser owner at most: the active Assistant's scope, else the active workspace.
  const activeBrowserOwnerId = activeAssistantId ? assistantBrowserOwnerId(activeAssistantId) : resolvedActiveWorkspaceId;
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

  return (
    <>
    <ExplorerLifecycleCoordinator />
    <Suspense fallback={<div className="main-content-loading">Loading workspace layout…</div>}>
      <div
        className={`workspace-host${sidebarMode ? ' with-sidebar' : ''}`}
        data-testid="workspace-host"
        data-active-workspace-id={resolvedActiveWorkspaceId ?? ''}
        data-navigation-mode={navigationMode}
      >
        {/* While an Assistant is on screen no workspace is focused, so native Browser views are hidden. */}
        <BrowserLifecycleCoordinator activeOwnerId={activeBrowserOwnerId} />
        {sidebarMode && <WorkspaceSidebar onOpenWorkspace={onOpenWorkspace} />}
        <div className="workspace-surfaces-container">
          {workspaces.length === 0 && !assistantActive && <div className="empty-workspace-state">
            <p>No workspace open</p>
            <Button type="button" onClick={onOpenWorkspace}>Open Workspace</Button>
          </div>}
          {workspaces.map((workspace) => (
            <WorkspaceSurface
              key={workspace.id}
              workspaceId={workspace.id}
              isActive={!assistantActive && workspace.id === resolvedActiveWorkspaceId}
              mountContents={warmWorkspaceIdSet.has(workspace.id)}
              showExplorerDock={!sidebarMode}
            />
          ))}
          {openedAssistantIds.map((assistantId) => (
            <AssistantSurface key={assistantId} assistantId={assistantId} displayName={knownAssistants[assistantId]?.displayName ?? assistantId.replace(/^hermes:/, '')} isActive={assistantId === activeAssistantId} />
          ))}
        </div>
      </div>
    </Suspense>
    </>
  );
}
