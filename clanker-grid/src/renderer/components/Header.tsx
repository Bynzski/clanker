import { useWorkspaceStore } from '../store/workspaceStore';
import { FolderOpen, Plus, Globe, X, Brain, Zap, Pi, Terminal, LayoutGrid } from 'lucide-react';
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
    fitAllPanes,
    harness,
    setHarness,
    canAddPane,
  } = useWorkspaceStore();

  const handleAddTerminal = async () => {
    if (!canAddPane()) {
      console.warn('All panes are locked. Unlock a pane before adding a new terminal.');
      return;
    }

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
        <div className="app-logo">
          <svg width="24" height="24" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="32" y="28" width="56" height="44" rx="8" fill="currentColor" opacity="0.8"/>
            <rect x="57" y="16" width="6" height="14" rx="3" fill="currentColor" opacity="0.6"/>
            <circle cx="60" cy="16" r="5" fill="#EF4444"/>
            <rect x="38" y="36" width="44" height="28" rx="4" fill="#111827"/>
            <rect x="41" y="39" width="38" height="22" rx="3" fill="#10B981" opacity="0.8"/>
            <text x="46" y="55" fill="#fff" fontFamily="monospace" fontSize="11" fontWeight="bold">_</text>
            <rect x="36" y="76" width="48" height="32" rx="6" fill="currentColor" opacity="0.6"/>
            <g opacity="0.7">
              <rect x="44" y="84" width="10" height="6" rx="1.5" fill="#10B981"/>
              <rect x="58" y="84" width="10" height="6" rx="1.5" fill="#F59E0B"/>
              <rect x="44" y="94" width="10" height="6" rx="1.5" fill="#3B82F6"/>
              <rect x="58" y="94" width="10" height="6" rx="1.5" fill="#EF4444"/>
            </g>
          </svg>
        </div>
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
        
        <button className="header-btn header-btn-primary" onClick={handleAddTerminal} disabled={!canAddPane()}>
          <Plus size={15} strokeWidth={2.5} />
          New Terminal
        </button>

        <button className="header-btn" onClick={fitAllPanes} title="Fit all panes into view (Ctrl/Cmd+Shift+F)">
          <LayoutGrid size={15} strokeWidth={2} />
          Fit All Panes
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
