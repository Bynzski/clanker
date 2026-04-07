import { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import WorkspaceGateContent, { WorkspaceFormData } from './WorkspaceGateContent';
import './WorkspaceGate.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onWorkspaceSelect: (path: string, terminalCount: number, harness: string, model?: string) => void;
}

export function WorkspaceGateModal({ isOpen, onClose, onWorkspaceSelect }: Props) {
  const pushBrowserOverlay = useWorkspaceStore((state) => state.pushBrowserOverlay);
  const popBrowserOverlay = useWorkspaceStore((state) => state.popBrowserOverlay);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    pushBrowserOverlay();
    return () => popBrowserOverlay();
  }, [isOpen, pushBrowserOverlay, popBrowserOverlay]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (data: WorkspaceFormData) => {
    onWorkspaceSelect(data.path, data.terminalCount, data.harness, data.model);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} title="Close (Esc)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        <WorkspaceGateContent
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}

// Fullscreen gate version for initial launch
interface FullscreenGateProps {
  onWorkspaceSelect: (path: string, terminalCount: number, harness: string, model?: string) => void;
}

function GateTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.electronAPI.isMaximizedWindow()
      .then(setIsMaximized)
      .catch(() => setIsMaximized(false));
  }, []);

  const handleMinimize = () => {
    window.electronAPI.minimizeWindow();
  };

  const handleToggleMaximize = async () => {
    await window.electronAPI.toggleMaximizeWindow();
    setIsMaximized((value) => !value);
  };

  const handleClose = () => {
    window.electronAPI.closeWindow();
  };

  return (
    <div className="workspace-gate-titlebar">
      <div className="workspace-gate-brand">
        <svg width="18" height="18" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="32" y="28" width="56" height="44" rx="8" fill="currentColor" opacity="0.8"/>
          <rect x="57" y="16" width="6" height="14" rx="3" fill="currentColor" opacity="0.6"/>
          <circle cx="60" cy="16" r="5" fill="#EF4444"/>
        </svg>
        <span className="workspace-gate-title">Clanker Grid</span>
      </div>

      <div className="workspace-gate-window-controls">
        <button className="workspace-gate-window-btn" onClick={handleMinimize} aria-label="Minimize window" title="Minimize window">
          <Minus size={14} strokeWidth={2} />
        </button>
        <button className="workspace-gate-window-btn" onClick={handleToggleMaximize} aria-label={isMaximized ? 'Restore window' : 'Maximize window'} title={isMaximized ? 'Restore window' : 'Maximize window'}>
          <Square size={12} strokeWidth={2} />
        </button>
        <button className="workspace-gate-window-btn close" onClick={handleClose} aria-label="Close window" title="Close window">
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

export function WorkspaceGateFullscreen({ onWorkspaceSelect }: FullscreenGateProps) {
  const handleSubmit = (data: WorkspaceFormData) => {
    onWorkspaceSelect(data.path, data.terminalCount, data.harness, data.model);
  };

  return (
    <div className="workspace-gate">
      <GateTitleBar />
      <div className="workspace-gate-shell">
        <WorkspaceGateContent onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
