import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { FolderOpen, Plus, Globe, X, Brain, Zap, Pi, Terminal, LayoutGrid, Sparkles } from 'lucide-react';
import GitButton from './GitButton';
import './Header.css';

export const HARNESS_OPTIONS = [
  { id: '', label: 'Terminal', Icon: Terminal },
  { id: 'codex', label: 'Codex', Icon: Brain },
  { id: 'claude', label: 'Claude', Icon: Sparkles },
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
  const [availableHarnessIds, setAvailableHarnessIds] = useState<string[]>(['']);

  useEffect(() => {
    let cancelled = false;

    const loadHarnessOptions = async () => {
      try {
        const options = await window.electronAPI.getHarnessOptions();
        if (cancelled) return;

        const availableIds = HARNESS_OPTIONS
          .map((option) => option.id)
          .filter((id) => id === '' || Boolean(options[id]));

        setAvailableHarnessIds(availableIds);
      } catch {
        if (!cancelled) {
          setAvailableHarnessIds(['']);
        }
      }
    };

    loadHarnessOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (harness && !availableHarnessIds.includes(harness)) {
      setHarness('');
    }
  }, [harness, availableHarnessIds, setHarness]);

  const handleAddTerminal = async () => {
    if (!canAddPane()) {
      console.warn('All panes are locked. Unlock a pane before adding a new terminal.');
      return;
    }

    try {
      const activeHarness = availableHarnessIds.includes(harness) ? harness : '';
      const info = await window.electronAPI.spawnTerminal(workspacePath || '/', activeHarness || undefined);
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
      <div className="header-center">
        <button className="header-btn" onClick={onOpenWorkspace}>
          <FolderOpen size={15} strokeWidth={2} />
          Open Workspace
        </button>
        
        <div className="harness-pills">
          {HARNESS_OPTIONS.filter((opt) => availableHarnessIds.includes(opt.id)).map(opt => (
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
        
        {workspacePath && (
          <GitButton workspacePath={workspacePath} />
        )}
      </div>
    </header>
  );
}
