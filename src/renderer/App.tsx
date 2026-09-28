import { Suspense, lazy, useEffect, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { migrateLegacyFavorites } from './lib/harnessDefaultsMigration';
import Header from './components/Header';
import TitleBar from './components/TitleBar';
import StatusBar from './components/StatusBar';
import { WorkspaceGateFullscreen, WorkspaceGateModal } from './components/WorkspaceGate';
import { Pane, Terminal, useWorkspaceStore, DEFAULT_RUNTIME_STATE } from './store/workspaceStore';
import { getZoomShortcutAction, isSaveShortcut } from './lib/keyboardShortcuts';
import { startEditorFileWatcher } from './lib/editorFileWatcher';
import { startTerminalSessionBridge } from './lib/terminalSessionBridge';
import { persistWorkspaceLayout } from './lib/workspaceLayoutStorage';
import { sameWorkspacePath } from './lib/pathUtils';
import type { WorkspaceRecipe, RecipeLaunchResult } from '../shared/types/recipes';
import { executeWorkspaceRecipe } from './lib/recipeExecution';
import { getWorkspaceNameFromPath } from './lib/workspaceLabels';
import type { GitWorktree } from '../shared/types/git';
import './App.css';

const WorkspaceHost = lazy(() => import('./components/WorkspaceHost'));

function App() {
  const [showWorkspaceGate, setShowWorkspaceGate] = useState(false);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const zoomAction = getZoomShortcutAction(event);
      if (zoomAction != null) {
        event.preventDefault();

        if (zoomAction === 'in') {
          void window.electronAPI.zoomInWindow();
        } else if (zoomAction === 'out') {
          void window.electronAPI.zoomOutWindow();
        } else {
          void window.electronAPI.resetZoomWindow();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        fitAllPanes();
        return;
      }

      if (isSaveShortcut(event)) {
        event.preventDefault();
        const { activeEditorTabId, saveEditorFile } = useWorkspaceStore.getState();
        if (activeEditorTabId) {
          void saveEditorFile(activeEditorTabId);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fitAllPanes]);

  useEffect(() => {
    return window.electronAPI.onFitAllPanes(() => {
      fitAllPanes();
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

  const handleWorkspaceSelect = async (path: string, terminalCount: number, harness: string, model?: string, closeGate = true) => {
    const workspaceId = crypto.randomUUID();
    const registration = await window.electronAPI.registerOpenWorkspace(workspaceId, path)
      .catch((error: unknown) => ({ success: false, error: String(error) }));
    if (!registration.success) {
      console.error('Could not open workspace:', registration.error);
      return false;
    }
    const terminals: Terminal[] = [];
    const panes: Pane[] = [];
    try {
      const worktreeLookup = typeof window.electronAPI.gitListWorktrees === 'function'
        ? window.electronAPI.gitListWorktrees(path).catch(() => null)
        : Promise.resolve(null);

      for (let i = 0; i < terminalCount; i++) {
        try {
          const info = await window.electronAPI.spawnTerminal(path, harness, model);
          terminals.push({
            id: info.id,
            pid: info.pid,
            workingDir: path,
            harnessId: info.harnessId ?? harness ?? null,
            attentionEnabled: info.attentionEnabled === true,
          });
          panes.push({ id: crypto.randomUUID(), terminalId: info.id });
        } catch (err) {
          console.error('Failed to spawn terminal:', err);
        }
      }

      const worktreeList = await worktreeLookup;
      const linkedWorktree = worktreeList?.success
        ? worktreeList.worktrees.find((entry: GitWorktree) => !entry.isMain && sameWorkspacePath(entry.path, path))
        : null;
      const projectName = linkedWorktree
        ? getWorkspaceNameFromPath(worktreeList?.worktrees.find((entry: GitWorktree) => entry.isMain)?.path ?? path)
        : getWorkspaceNameFromPath(path);

      addWorkspace({
        id: workspaceId,
        name: projectName,
        workspacePath: path,
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
  const handleLaunchRecipe = async (recipe: WorkspaceRecipe): Promise<RecipeLaunchResult> => {
    let targetWorkspaceId: string | null = null;
    const currentWorkspaces = useWorkspaceStore.getState().workspaces;
    if (currentWorkspaces.length === 0) {
      setShowWorkspaceGate(true);
    }

    const existing = currentWorkspaces.find((w) => sameWorkspacePath(w.workspacePath, recipe.workspacePath));
    if (existing) {
      targetWorkspaceId = existing.id;
      useWorkspaceStore.getState().selectWorkspace(existing.id);
    } else {
      const opened = await handleWorkspaceSelect(recipe.workspacePath, 0, '', undefined, false);
      if (!opened) {
        return {
          recipeId: recipe.id,
          success: false,
          steps: [{ id: 'open-workspace', type: 'command', status: 'failed', error: 'Failed to open workspace directory' }],
        };
      }
      const newlyOpened = useWorkspaceStore.getState().workspaces.find((w) => sameWorkspacePath(w.workspacePath, recipe.workspacePath));
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
      onTerminalSpawned: (_wsId, term) => {
        useWorkspaceStore.getState().addTerminal(term);
      },
      openBrowserPreview: async (wsId, url) => {
        const store = useWorkspaceStore.getState();
        const ws = store.workspaces.find((w) => w.id === wsId);
        if (ws && !ws.browserVisible) {
          store.toggleBrowser();
        }
        if (typeof window.electronAPI?.browserNavigate === 'function') {
          return window.electronAPI.browserNavigate(wsId, url);
        }
        return true;
      },
    });
    if (recipe.launches.length === 0) {
      const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === targetWorkspaceId);
      const terminalCount = Math.max(1, recipe.terminalCount ?? 1);
      const setupSteps: RecipeLaunchResult['steps'] = [];
      const existingCount = workspace?.terminals.length ?? 0;
      for (let index = existingCount; index < terminalCount; index++) {
        try {
          const info = await window.electronAPI.spawnTerminal(recipe.workspacePath);
          useWorkspaceStore.getState().addTerminal({
            id: info.id,
            pid: info.pid,
            workingDir: recipe.workspacePath,
            harnessId: null,
            attentionEnabled: false,
          });
          setupSteps.push({ id: `terminal-${index + 1}`, type: 'command', status: 'success', terminalId: info.id });
        } catch (error) {
          setupSteps.push({
            id: `terminal-${index + 1}`,
            type: 'command',
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      result.steps.push(...setupSteps);
      result.success = result.steps.every((step) => step.status === 'success');
    }

    if (result.success) {
      setShowWorkspaceGate(false);
    }
    return result;
  };

  const handleCloseGate = () => {
    setShowWorkspaceGate(false);
  };

  if (workspaces.length === 0) {
    return (
      <WorkspaceGateFullscreen onWorkspaceSelect={handleWorkspaceSelect} onLaunchRecipe={handleLaunchRecipe} />
    );
  }

  return (
    <div className="app">
      <TitleBar onOpenWorkspace={() => setShowWorkspaceGate(true)} />
      <Header />
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
          <Suspense fallback={<div className="main-content-loading">Loading workspace layout...</div>}>
            <WorkspaceHost />
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
