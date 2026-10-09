import { Suspense, lazy, useEffect, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { migrateLegacyFavorites } from './lib/harnessDefaultsMigration';
import Header from './components/Header';
import TitleBar from './components/TitleBar';
import StatusBar from './components/StatusBar';
import WorkspacePaneDragProvider from './components/WorkspacePaneDragProvider';
import { ToastViewport } from './components/NotificationCenter';
import { useAssistantNavStore } from './store/assistantNavStore';

const workspaceDestinationActive = () => useAssistantNavStore.getState().activeAssistantId === null
  && useWorkspaceStore.getState().activeWorkspaceId !== null;
import AssistantsRoster from './components/assistants/AssistantsRoster';
import OpenWorkspaceDialog from './components/OpenWorkspaceDialog';
import { openWorkspace } from './lib/openWorkspace';
import { startWorkspaceRestoration } from './lib/workspaceStartup';
import { useWorkspaceStore } from './store/workspaceStore';
import { getWheelZoomAction } from './lib/keyboardShortcuts';
import { dispatchAppKeybinding, openSettings, type AppCommandActions } from './lib/keybindingDispatcher';
import { useKeybindingStore } from './store/keybindingStore';
import { selectFocusedWorkspace } from './store/workspaceStoreHelpers';
import { startEditorFileWatcher } from './lib/editorFileWatcher';
import { toggleFocusedWorkspaceExplorer } from './lib/explorerToggle';
import { startWorkspaceServiceBridge } from './store/workspaceServiceStore';
import { startTerminalSessionBridge } from './lib/terminalSessionBridge';
import { startRemoteFileWatcher } from './lib/remoteFileWatcher';
import './App.css';
import { useThemeStore } from './theme/themeStore';
import { useWorkspaceNavigationStore } from './store/workspaceNavigationStore';
import { useCheckoutReconciliation } from './lib/checkoutReconciliation';

const WorkspaceHost = lazy(() => import('./components/WorkspaceHost'));

function App() {
  const [showOpenWorkspace, setShowOpenWorkspace] = useState(false);
  const sidebarMode = useWorkspaceNavigationStore((state) => state.mode === 'sidebar');
  const { 
    fitAllPanes,
    updateWorkspaceBrowserUrl,
  } = useWorkspaceStore();
  // Worktree checkouts follow Git: agents and shells can finish a worktree without Clanker.
  useCheckoutReconciliation();

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
  useEffect(() => startWorkspaceServiceBridge(), []);

  useEffect(() => {
    const unsubscribe = startTerminalSessionBridge();
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const restoration = startWorkspaceRestoration();
    void restoration.done.catch((error: unknown) => console.error('Workspace restoration failed:', error));
    return restoration.dispose;
  }, []);

  return (
    <WorkspacePaneDragProvider><div className="app">
      <TitleBar
        onOpenWorkspace={() => setShowOpenWorkspace(true)}
        toolbar={sidebarMode ? <Header placement="titlebar" /> : undefined}
      />
      {!sidebarMode && <Header />}
      {!sidebarMode && <AssistantsRoster variant="strip" />}
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
            <WorkspaceHost onOpenWorkspace={() => setShowOpenWorkspace(true)} />
          </Suspense>
        </ErrorBoundary>
      </div>
      <ToastViewport />
      <StatusBar />
      
      <OpenWorkspaceDialog isOpen={showOpenWorkspace} onClose={() => setShowOpenWorkspace(false)}
        onOpen={openWorkspace} />
    </div></WorkspacePaneDragProvider>
  );
}

export default App;
