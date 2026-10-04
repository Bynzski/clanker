import { Button } from './components/ui/Button';
import type { WorkspaceTerminalLaunch } from './lib/workspaceLaunchPlan';
import { Suspense, lazy, useEffect, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { migrateLegacyFavorites } from './lib/harnessDefaultsMigration';
import Header from './components/Header';
import TitleBar from './components/TitleBar';
import StatusBar from './components/StatusBar';
import { useAssistantNavStore } from './store/assistantNavStore';

const workspaceDestinationActive = () => useAssistantNavStore.getState().activeAssistantId === null;
import AssistantsRoster from './components/assistants/AssistantsRoster';
import { WorkspaceGateFullscreen, WorkspaceGateModal } from './components/WorkspaceGate';
import { Pane, Terminal, useWorkspaceStore, DEFAULT_RUNTIME_STATE } from './store/workspaceStore';
import { getWheelZoomAction } from './lib/keyboardShortcuts';
import { dispatchAppKeybinding, openSettings, type AppCommandActions } from './lib/keybindingDispatcher';
import { useKeybindingStore } from './store/keybindingStore';
import { selectFocusedWorkspace } from './store/workspaceStoreHelpers';
import { startEditorFileWatcher } from './lib/editorFileWatcher';
import { toggleFocusedWorkspaceExplorer } from './lib/explorerToggle';
import { startTerminalSessionBridge } from './lib/terminalSessionBridge';
import { persistWorkspaceLayout } from './lib/workspaceLayoutStorage';
import { startRemoteFileWatcher } from './lib/remoteFileWatcher';
import { sameWorkspacePath } from './lib/pathUtils';
import { isSameWorkspaceIdentity, normalizeWorkspacePath } from '../shared/workspaceIdentity';
import { createMainCheckoutContext, mainCheckoutContextId } from '../shared/checkoutContext';
import type { CheckoutContext } from '../shared/types/checkoutContext';
import type { WorkspaceRecipe, RecipeLaunchResult } from '../shared/types/recipes';
import { executeWorkspaceRecipe } from './lib/recipeExecution';
import { getWorkspaceNameFromPath } from './lib/workspaceLabels';
import type { GitWorktree } from '../shared/types/git';
import './App.css';
import { useThemeStore } from './theme/themeStore';
import { useWorkspaceNavigationStore } from './store/workspaceNavigationStore';

const WorkspaceHost = lazy(() => import('./components/WorkspaceHost'));

function App() {
  const [showWorkspaceGate, setShowWorkspaceGate] = useState(false);
  const [recipeFailure, setRecipeFailure] = useState<RecipeLaunchResult | null>(null);
  const sidebarMode = useWorkspaceNavigationStore((state) => state.mode === 'sidebar');
  // An Assistant is a destination in its own right: it is enough to own the shell with no Workspace open.
  const assistantDestinationActive = useAssistantNavStore((state) => state.activeAssistantId !== null);
  const { 
    workspaces,
    addWorkspace,
    fitAllPanes,
    updateWorkspaceBrowserUrl,
  } = useWorkspaceStore();

  // One-time migration: localStorage favorites → electron-store
  useEffect(() => {
    void migrateLegacyFavorites();
  }, []);
  // Ensure theme is initialized if App is mounted directly (e.g. in test environments)
  useEffect(() => {
    if (!useThemeStore.getState().resolved) {
      void useThemeStore.getState().initializeTheme();
    }
  }, []);


  useEffect(() => {
    if (!useWorkspaceNavigationStore.getState().resolved) {
      void useWorkspaceNavigationStore.getState().initialize();
    }
  }, []);

  useEffect(() => {
    void useKeybindingStore.getState().load();
  }, []);

  // Application commands (app/editor contexts). Terminals and the native browser
  // view own their own input; see keybindingDispatcher for the boundary.
  useEffect(() => {
    const actions: AppCommandActions = {
      openSettings,
      // Workspace-scoped commands never act on a parked workspace while an Assistant is the active destination.
      fitAllPanes: () => { if (workspaceDestinationActive()) fitAllPanes(); },
      toggleExplorer: () => { if (workspaceDestinationActive()) toggleFocusedWorkspaceExplorer(); },
      saveActiveEditorFile: () => {
        if (!workspaceDestinationActive()) return;
        const state = useWorkspaceStore.getState();
        const workspace = selectFocusedWorkspace(state);
        if (workspace?.activeEditorTabId) void state.saveEditorFile(workspace.activeEditorTabId, workspace.id);
      },
      zoomApp: (action) => {
        if (action === 'in') void window.electronAPI.zoomInWindow();
        else if (action === 'out') void window.electronAPI.zoomOutWindow();
        else void window.electronAPI.resetZoomWindow();
      },
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      dispatchAppKeybinding(event, actions);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fitAllPanes]);

  // Whole-app Ctrl+wheel zoom is the fallback owner: surfaces like xterm claim
  // their own wheel events (preventDefault + stopPropagation) before this runs.
  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      const wheelAction = getWheelZoomAction(event);
      if (wheelAction == null || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      if (wheelAction === 'in') {
        void window.electronAPI.zoomInWindow();
      } else {
        void window.electronAPI.zoomOutWindow();
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    return window.electronAPI.onFitAllPanes(() => {
      if (workspaceDestinationActive()) fitAllPanes();
    });
  }, [fitAllPanes]);

  useEffect(() => {
    if (typeof window.electronAPI?.onBrowserUrlUpdated !== 'function') {
      return undefined;
    }

    const dispose = window.electronAPI.onBrowserUrlUpdated(({ workspaceId, tabId, url, title }) => {
      updateWorkspaceBrowserUrl(workspaceId, tabId ?? null, url, title);
    });

    return () => {
      dispose();
    };
  }, [updateWorkspaceBrowserUrl]);

  useEffect(() => {
    const unsubscribe = startEditorFileWatcher();
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => startRemoteFileWatcher(), []);

  useEffect(() => {
    const unsubscribe = startTerminalSessionBridge();
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => useWorkspaceStore.subscribe((state, previousState) => {
    for (const workspace of state.workspaces) {
      const previous = previousState.workspaces.find((entry) => entry.id === workspace.id);
      if (previous?.layoutRoot !== workspace.layoutRoot || previous?.explorerVisible !== workspace.explorerVisible) {
        persistWorkspaceLayout(workspace);
      }
    }
  }), []);

  const handleWorkspaceSelect = async (
    path: string,
    terminalCount: number,
    harness: string,
    model?: string,
    closeGate = true,
    environmentId?: string,
    environmentLabel?: string,
    terminalLaunches?: WorkspaceTerminalLaunch[]
  ) => {
    const effectiveEnvironmentId = environmentId || 'local';
    const effectiveEnvironmentLabel = environmentLabel || (effectiveEnvironmentId !== 'local' ? effectiveEnvironmentId : 'Local');
    const isRemote = effectiveEnvironmentId !== 'local';
    const workspaceId = crypto.randomUUID();
    const registration = isRemote
      ? await window.electronAPI.registerOpenWorkspace(workspaceId, path, effectiveEnvironmentId).catch((error: unknown) => ({ success: false, error: String(error), location: undefined, checkoutContext: undefined }))
      : await window.electronAPI.registerOpenWorkspace(workspaceId, path).catch((error: unknown) => ({ success: false, error: String(error), location: undefined, checkoutContext: undefined }));
    if (!registration.success) {
      console.error('Could not open workspace:', registration.error);
      return false;
    }
    const canonicalPath = registration.location?.environmentId === effectiveEnvironmentId
      ? registration.location.path
      : undefined;
    if (!canonicalPath) {
      await window.electronAPI.unregisterOpenWorkspace(workspaceId);
      console.error('Could not open workspace: registration did not return a canonical path');
      return false;
    }
    const terminals: Terminal[] = [];
    const panes: Pane[] = [];
    try {
      const worktreeLookup = (typeof window.electronAPI.gitListWorktrees === 'function')
        ? (isRemote ? window.electronAPI.gitListWorktrees(canonicalPath, workspaceId) : window.electronAPI.gitListWorktrees(canonicalPath)).catch(() => null)
        : Promise.resolve(null);

      for (let i = 0; i < (terminalLaunches?.length ?? terminalCount); i++) {
        try {
          const launchHarness = terminalLaunches?.[i].harness ?? harness;
          const launchModel = terminalLaunches ? terminalLaunches[i].model : model;
          const info = isRemote
            ? await window.electronAPI.spawnTerminal(canonicalPath, launchHarness, launchModel, undefined, undefined, workspaceId, effectiveEnvironmentId)
            : await window.electronAPI.spawnTerminal(canonicalPath, launchHarness, launchModel);
          terminals.push({
            id: info.id,
            pid: info.pid,
            workingDir: canonicalPath,
            workspaceId,
            checkoutContextId: info.checkoutContextId ?? mainCheckoutContextId(workspaceId),
            environmentId: effectiveEnvironmentId,
            harnessId: info.harnessId ?? launchHarness ?? null,
            attentionEnabled: info.attentionEnabled === true,
          });
          panes.push({ id: crypto.randomUUID(), terminalId: info.id });
        } catch (err) {
          console.error('Failed to spawn terminal:', err);
        }
      }

      const worktreeList = await worktreeLookup;
      const linkedWorktree = worktreeList?.success
        ? worktreeList.worktrees.find((entry: GitWorktree) => !entry.isMain && (isRemote
          ? isSameWorkspaceIdentity({ environmentId: effectiveEnvironmentId, path: entry.path }, { environmentId: effectiveEnvironmentId, path: canonicalPath })
          : sameWorkspacePath(entry.path, canonicalPath)))
        : null;
      const projectName = linkedWorktree
        ? getWorkspaceNameFromPath(worktreeList?.worktrees.find((entry: GitWorktree) => entry.isMain)?.path ?? canonicalPath)
        : getWorkspaceNameFromPath(canonicalPath);
      // Main returned the registered context; the root it validated is the workspace root. A
      // linked-worktree workspace is its own root, so annotate it as a worktree context while it
      // is still presented as a workspace (descriptive only; the path is not changed).
      const registeredContext: CheckoutContext = registration.checkoutContext
        ?? createMainCheckoutContext({ workspaceId, environmentId: effectiveEnvironmentId, path: canonicalPath });
      const mainCheckoutPath = worktreeList?.success
        ? worktreeList.worktrees.find((entry: GitWorktree) => entry.isMain)?.path
        : undefined;
      const checkoutContext: CheckoutContext = linkedWorktree
        ? {
          ...registeredContext,
          kind: 'worktree',
          branch: linkedWorktree.branch ?? null,
          ...(mainCheckoutPath ? { mainCheckoutPath: normalizeWorkspacePath(mainCheckoutPath) } : {}),
        }
        : registeredContext;
      addWorkspace({
        id: workspaceId,
        environmentId: effectiveEnvironmentId,
        environmentLabel: effectiveEnvironmentLabel,
        name: projectName,
        workspacePath: canonicalPath,
        checkoutContexts: [checkoutContext],
        isLinkedWorktree: !!linkedWorktree,
        projectName,
        harness,
        model: model ?? '',
        terminals,
        panes,
        browserVisible: false,
        browserOverlayCount: 0,
        browserUrl: 'https://github.com',
        activeTerminalId: terminals.length > 0 ? terminals[terminals.length - 1].id : null,
        browserPane: null,
        layoutRoot: null,
        explorerVisible: false,
        explorerSidebarWidth: 280,
        explorerExpandedPaths: [],
        explorerSelectedPath: null,
        explorerEntriesByPath: {},
        explorerLoadingPaths: [],
        explorerErrorsByPath: {},
        showHiddenFiles: true,
        editorPane: null,
        editorVisible: false,
        editorTabs: [],
        activeEditorTabId: null,
        gitChanges: [],
        gitCurrentBranch: linkedWorktree?.branch ?? null,
        gitIsRepo: false,
        gitIsDetached: false,
        runtimeState: { ...DEFAULT_RUNTIME_STATE },
      });
      if (closeGate) setShowWorkspaceGate(false);
      return true;
    } catch (error) {
      console.error('Could not open workspace:', error);
      await Promise.allSettled(terminals.map((terminal) => window.electronAPI.killTerminal(terminal.id)));
      await window.electronAPI.unregisterOpenWorkspace(workspaceId).catch(() => undefined);
      return false;
    }
  };
  const unsupportedRemoteRecipe = (recipe: WorkspaceRecipe): RecipeLaunchResult => ({
    recipeId: recipe.id,
    success: false,
    steps: [{ id: 'remote-recipe', type: 'command', status: 'failed',
      error: 'Launch recipes are not supported for SSH workspaces in this version.' }],
  });

  const handleLaunchRecipe = async (recipe: WorkspaceRecipe, keepGateOpen = true): Promise<RecipeLaunchResult> => {
    if (recipe.environmentId && recipe.environmentId !== 'local') {
      const result = unsupportedRemoteRecipe(recipe);
      setRecipeFailure(result);
      return result;
    }

    let targetWorkspaceId: string | null = null;
    const currentWorkspaces = useWorkspaceStore.getState().workspaces;
    if (currentWorkspaces.length === 0 && keepGateOpen) {
      setShowWorkspaceGate(true);
    }

    const recipeEnvId = recipe.environmentId || 'local';
    const existing = currentWorkspaces.find((w) =>
      isSameWorkspaceIdentity(
        { environmentId: w.environmentId || 'local', path: w.workspacePath },
        { environmentId: recipeEnvId, path: recipe.workspacePath }
      )
    );
    if (existing) {
      targetWorkspaceId = existing.id;
      useWorkspaceStore.getState().selectWorkspace(existing.id);
    } else {
      const opened = await handleWorkspaceSelect(recipe.workspacePath, 0, '', undefined, false, recipeEnvId);
      if (!opened) {
        return {
          recipeId: recipe.id,
          success: false,
          steps: [{ id: 'open-workspace', type: 'command', status: 'failed', error: 'Failed to open workspace directory' }],
        };
      }
      const newlyOpened = useWorkspaceStore.getState().workspaces.find((w) =>
        isSameWorkspaceIdentity(
          { environmentId: w.environmentId || 'local', path: w.workspacePath },
          { environmentId: recipeEnvId, path: recipe.workspacePath }
        )
      );
      targetWorkspaceId = newlyOpened ? newlyOpened.id : null;
    }

    if (!targetWorkspaceId) {
      return {
        recipeId: recipe.id,
        success: false,
        steps: [{ id: 'target-workspace', type: 'command', status: 'failed', error: 'Workspace ID not found' }],
      };
    }

    const result = await executeWorkspaceRecipe(recipe, {
      ensureWorkspaceOpen: async () => targetWorkspaceId,
      spawnTerminal: window.electronAPI.spawnTerminal,
      waitRecipeCommand: window.electronAPI.waitRecipeCommand,
      probePreview: window.electronAPI.probeRecipePreview,
      onTerminalSpawned: (_wsId, term) => {
        useWorkspaceStore.getState().addTerminal(term);
      },
      openBrowserPreview: async (wsId, url) => {
        const store = useWorkspaceStore.getState();
        const ws = store.workspaces.find((w) => w.id === wsId);
        if (ws && !ws.browserVisible) {
          store.setBrowserVisible(true, wsId);
        }
        if (typeof window.electronAPI?.browserNavigate === 'function') {
          return window.electronAPI.browserNavigate(wsId, url, undefined, true);
        }
        return false;
      },
      restoreLayout: (wsId, layout) => {
        useWorkspaceStore.getState().applyPersistedLayout(layout, wsId);
      },
      getExistingTerminalCount: (wsId) => {
        return useWorkspaceStore.getState().workspaces.find((w) => w.id === wsId)?.terminals.length ?? 0;
      },
    });
    setRecipeFailure(result.success ? null : result);
    setShowWorkspaceGate(false);
    return result;
  };

  const handleCloseGate = () => {
    setShowWorkspaceGate(false);
  };

  if (workspaces.length === 0 && !assistantDestinationActive) {
    return (
      <WorkspaceGateFullscreen onWorkspaceSelect={handleWorkspaceSelect} onLaunchRecipe={(recipe) => handleLaunchRecipe(recipe, false)} />
    );
  }

  return (
    <div className="app">
      <TitleBar
        onOpenWorkspace={() => setShowWorkspaceGate(true)}
        toolbar={sidebarMode ? <Header placement="titlebar" /> : undefined}
      />
      {!sidebarMode && <Header />}
      {!sidebarMode && <AssistantsRoster variant="strip" />}
      {recipeFailure && (
        <div className="recipe-workspace-error" role="alert">
          <div>
            <strong>Recipe launch was incomplete.</strong>
            <ul>{recipeFailure.steps.filter((step) => step.status === 'failed').map((step) => (
              <li key={step.id}>{step.error ?? `${step.type} failed`}</li>
            ))}</ul>
          </div>
          <Button type="button" onClick={() => setRecipeFailure(null)} aria-label="Dismiss recipe error">Dismiss</Button>
        </div>
      )}
      <div className="main-content">
        <ErrorBoundary
          paneId="workspace-layout"
          style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}
          fallback={(error, _info, reset) => (
            <div className="workspace-error-fallback">
              <p>Workspace failed to render</p>
              <p className="error-detail">{error.message}</p>
              <button onClick={reset}>Reload</button>
            </div>
          )}
        >
          <Suspense fallback={<div className="main-content-loading">Loading workspace layout…</div>}>
            <WorkspaceHost onOpenWorkspace={() => setShowWorkspaceGate(true)} />
          </Suspense>
        </ErrorBoundary>
      </div>
      <StatusBar />
      
      <WorkspaceGateModal
        isOpen={showWorkspaceGate}
        onClose={handleCloseGate}
        onWorkspaceSelect={handleWorkspaceSelect}
        onLaunchRecipe={handleLaunchRecipe}
      />
    </div>
  );
}

export default App;
