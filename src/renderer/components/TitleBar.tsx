import { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import WorkspaceTabs from './WorkspaceTabs';
import './TitleBar.css';

interface TitleBarProps {
  onOpenWorkspace?: () => void;
}

export default function TitleBar({ onOpenWorkspace }: TitleBarProps) {
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
    <div className="titlebar">
      <div className="titlebar-left">
        <div className="titlebar-brand">
          <svg width="18" height="18" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="32" y="28" width="56" height="44" rx="8" fill="currentColor" opacity="0.8"/>
            <rect x="57" y="16" width="6" height="14" rx="3" fill="currentColor" opacity="0.6"/>
            <circle cx="60" cy="16" r="5" fill="#EF4444"/>
          </svg>
          <span className="titlebar-title">Clanker Grid</span>
        </div>
      </div>

      <div className="titlebar-center">
        <WorkspaceTabs onOpenWorkspace={onOpenWorkspace} />
      </div>

      <div className="titlebar-controls">
        <button className="titlebar-control" onClick={handleMinimize} aria-label="Minimize window" title="Minimize window">
          <Minus size={14} strokeWidth={2} />
        </button>
        <button className="titlebar-control" onClick={handleToggleMaximize} aria-label={isMaximized ? 'Restore window' : 'Maximize window'} title={isMaximized ? 'Restore window' : 'Maximize window'}>
          <Square size={12} strokeWidth={2} />
        </button>
        <button className="titlebar-control close" onClick={handleClose} aria-label="Close window" title="Close window">
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
