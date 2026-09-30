import { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import './WindowControls.css';

interface WindowControlsProps {
  className?: string;
  buttonClassName?: string;
  closeClassName?: string;
}

/** Shared Electron controls; surrounding titlebars keep their own layout. */
export default function WindowControls({ className = '', buttonClassName = '', closeClassName = '' }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.isMaximizedWindow()
      .then((maximized) => { if (!cancelled) setIsMaximized(maximized); })
      .catch(() => { if (!cancelled) setIsMaximized(false); });
    return () => { cancelled = true; };
  }, []);

  const handleMinimize = async () => {
    try {
      await window.electronAPI.minimizeWindow();
    } catch (error) {
      console.error('Failed to minimize window:', error);
    }
  };
  const handleToggleMaximize = async () => {
    try {
      // IPC returns void, so preserve the current local toggle after success.
      await window.electronAPI.toggleMaximizeWindow();
      setIsMaximized((value) => !value);
    } catch (error) {
      console.error('Failed to toggle window maximization:', error);
    }
  };
  const handleClose = async () => {
    try {
      await window.electronAPI.closeWindow();
    } catch (error) {
      console.error('Failed to close window:', error);
    }
  };

  const maximizeLabel = isMaximized ? 'Restore window' : 'Maximize window';
  const buttonClass = `window-controls-button ${buttonClassName}`;
  return (
    <div className={`window-controls ${className}`}>
      <button type="button" className={buttonClass} onClick={() => void handleMinimize()}
        aria-label="Minimize window" title="Minimize window">
        <Minus size={14} strokeWidth={2} />
      </button>
      <button type="button" className={buttonClass} onClick={() => void handleToggleMaximize()}
        aria-label={maximizeLabel} title={maximizeLabel}>
        <Square size={12} strokeWidth={2} />
      </button>
      <button type="button" className={`${buttonClass} window-controls-close ${closeClassName}`} onClick={() => void handleClose()}
        aria-label="Close window" title="Close window">
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
