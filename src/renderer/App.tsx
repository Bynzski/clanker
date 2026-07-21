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
      if (previous?.layoutRoot !== workspace.layoutRoot) {
        persistWorkspaceLayout(workspace);
      }
    }
  }), []);

  const handleWorkspaceSelect = async (path: string, terminalCount: number, harness: string, model?: string) => {
    const terminals: Terminal[] = [];
    const panes: Pane[] = [];

    for (let i = 0; i < terminalCount; i++) {
      try {
        const info = await window.electronAPI.spawnTerminal(path, harness, model);
        terminals.push({
          id: info.id,
          pid: info.pid,
          workingDir: path,
        });
        panes.push({ id: crypto.randomUUID(), terminalId: info.id });
      } catch (err) {
        console.error('Failed to spawn terminal:', err);
      }
    }

    addWorkspace({
      name: '',
      workspacePath: path,
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
      gitCurrentBranch: null,
      gitIsRepo: false,
      gitIsDetached: false,
      runtimeState: { ...DEFAULT_RUNTIME_STATE },
    });
    setShowWorkspaceGate(false);
  };

  const handleCloseGate = () => {
    setShowWorkspaceGate(false);
  };

  if (workspaces.length === 0) {
    return (
      <WorkspaceGateFullscreen onWorkspaceSelect={handleWorkspaceSelect} />
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
      />
    </div>
  );
}

export default App;
