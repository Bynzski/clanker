import { useState } from 'react';
import Header from './components/Header';
import DynamicPaneLayout from './components/DynamicPaneLayout';
import StatusBar from './components/StatusBar';
import BrowserPanel from './components/BrowserPanel';
import WorkspaceTabs from './components/WorkspaceTabs';
import { WorkspaceGateFullscreen, WorkspaceGateModal } from './components/WorkspaceGate';
import { Pane, Terminal, useWorkspaceStore } from './store/workspaceStore';
import './App.css';

function App() {
  const [showWorkspaceGate, setShowWorkspaceGate] = useState(false);
  const { 
    workspaces,
    browserVisible,
    browserUrl,
    setBrowserUrl,
    addWorkspace,
  } = useWorkspaceStore();

  const handleWorkspaceSelect = async (path: string, terminalCount: number, harness: string) => {
    const terminals: Terminal[] = [];
    const panes: Pane[] = [];

    for (let i = 0; i < terminalCount; i++) {
      try {
        const info = await window.electronAPI.spawnTerminal(path, harness);
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
      workspacePath: path,
      harness,
      terminals,
      panes,
      browserVisible: false,
      browserUrl: 'https://github.com',
      activeTerminalId: terminals.length > 0 ? terminals[terminals.length - 1].id : null,
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
      <Header onOpenWorkspace={() => setShowWorkspaceGate(true)} />
      <WorkspaceTabs />
      <div className="main-content">
        <div className={`workspace-area ${browserVisible ? 'with-browser' : 'terminal-only'}`}>
          <div className="workspace-terminal">
            <DynamicPaneLayout />
          </div>
          {browserVisible && (
            <div className="workspace-browser">
              <BrowserPanel url={browserUrl} onUrlChange={setBrowserUrl} />
            </div>
          )}
        </div>
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
