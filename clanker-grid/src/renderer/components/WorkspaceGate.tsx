import { useEffect } from 'react';
import WorkspaceGateContent, { WorkspaceFormData } from './WorkspaceGateContent';
import './WorkspaceGate.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onWorkspaceSelect: (path: string, terminalCount: number, harness: string) => void;
}

export function WorkspaceGateModal({ isOpen, onClose, onWorkspaceSelect }: Props) {
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
    onWorkspaceSelect(data.path, data.terminalCount, data.harness);
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
  onWorkspaceSelect: (path: string, terminalCount: number, harness: string) => void;
}

export function WorkspaceGateFullscreen({ onWorkspaceSelect }: FullscreenGateProps) {
  const handleSubmit = (data: WorkspaceFormData) => {
    onWorkspaceSelect(data.path, data.terminalCount, data.harness);
  };

  return (
    <div className="workspace-gate">
      <WorkspaceGateContent onSubmit={handleSubmit} />
    </div>
  );
}
