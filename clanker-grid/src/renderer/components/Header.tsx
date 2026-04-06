import { useWorkspaceStore } from '../store/workspaceStore';
import { FolderOpen, Plus, Globe, X, Brain, Zap, Pi, Terminal } from 'lucide-react';
import './Header.css';

export const HARNESS_OPTIONS = [
  { id: '', label: 'Terminal', Icon: Terminal },
  { id: 'codex', label: 'Codex', Icon: Brain },
  { id: 'opencode', label: 'OpenCode', Icon: Zap },
  { id: 'pi', label: 'Pi', Icon: Pi },
];

interface HeaderProps {
  onOpenWorkspace: () => void;
}

export default function Header({ onOpenWorkspace }: HeaderProps) {
  const { 
    workspacePath, 
    activeWorkspaceId,
    workspaces,
    browserVisible,
    toggleBrowser,
    addTerminal,
    closeWorkspace,
    harness,
    setHarness,
  } = useWorkspaceStore();

  const handleAddTerminal = async () => {
    try {
      const info = await window.electronAPI.spawnTerminal(workspacePath || '/', harness);
      addTerminal({
        id: info.id,
        pid: info.pid,
        workingDir: workspacePath,
      });
    } catch (err) {
      console.error('Failed to spawn terminal:', err);
    }
  };

  const handleToggleBrowser = () => {
    toggleBrowser();
  };

  const handleCloseWorkspace = async () => {
    if (activeWorkspaceId == null) {
      return;
    }

    const workspace = workspaces.find((entry) => entry.id === activeWorkspaceId);
    if (workspace == null) {
      return;
    }

    for (const terminal of workspace.terminals) {
      try {
        await window.electronAPI.killTerminal(terminal.id);
      } catch (err) {
        console.error('Failed to kill terminal:', err);
      }
    }

    closeWorkspace(activeWorkspaceId);
  };

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="app-title">Clanker Grid</h1>
      </div>
      
      <div className="header-center">
        <button className="header-btn" onClick={onOpenWorkspace}>
          <FolderOpen size={15} strokeWidth={2} />
          Open Workspace
        </button>
        
        <div className="harness-pills">
          {HARNESS_OPTIONS.map(opt => (
            <button
              key={opt.id}
              className={`harness-pill ${harness === opt.id ? 'active' : ''}`}
              onClick={() => setHarness(opt.id)}
              title={opt.label}
            >
              <opt.Icon size={14} strokeWidth={2.5} />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
        
        <button className="header-btn header-btn-primary" onClick={handleAddTerminal}>
          <Plus size={15} strokeWidth={2.5} />
          New Terminal
        </button>
        
        <button className="header-btn" onClick={handleToggleBrowser}>
          <Globe size={15} strokeWidth={2} />
          {browserVisible ? 'Hide' : 'Show'} Browser
        </button>
        
        <button className="header-btn header-btn-danger" onClick={handleCloseWorkspace}>
          <X size={15} strokeWidth={2} />
          Close Workspace
        </button>
      </div>
    </header>
  );
}
