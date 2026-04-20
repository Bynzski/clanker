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
          <img
            src="./titlebar-icon.png"
            alt="Clanker Grid icon"
            width={18}
            height={18}
          />
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
