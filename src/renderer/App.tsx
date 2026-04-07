import { useEffect, useState } from 'react';
import Header from './components/Header';
import TitleBar from './components/TitleBar';
import DynamicPaneLayout from './components/DynamicPaneLayout';
import StatusBar from './components/StatusBar';
import { WorkspaceGateFullscreen, WorkspaceGateModal } from './components/WorkspaceGate';
import { Pane, Terminal, useWorkspaceStore } from './store/workspaceStore';
import './App.css';

function App() {
  const [showWorkspaceGate, setShowWorkspaceGate] = useState(false);
  const { 
    workspaces,
    addWorkspace,
    fitAllPanes,
  } = useWorkspaceStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        fitAllPanes();
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
      browserUrl: 'https://github.com',
      activeTerminalId: terminals.length > 0 ? terminals[terminals.length - 1].id : null,
      browserPane: null,
      layoutRoot: null,
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
      <TitleBar />
      <Header onOpenWorkspace={() => setShowWorkspaceGate(true)} />
      <div className="main-content">
        <DynamicPaneLayout />
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
