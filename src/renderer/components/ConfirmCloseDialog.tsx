import { useEffect } from 'react';
import './ConfirmCloseDialog.css';

export interface ConfirmCloseDialogOption {
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  action: () => void;
}

export interface ConfirmCloseDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  options: ConfirmCloseDialogOption[];
  onCancel: () => void;
}

export default function ConfirmCloseDialog({
  isOpen,
  title,
  message,
  options,
  onCancel,
}: ConfirmCloseDialogProps) {
  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCancel]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="confirm-close-overlay" onClick={handleOverlayClick}>
      <div className="confirm-close-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-close-title">
        <div className="confirm-close-header">
          <h3 id="confirm-close-title">{title}</h3>
        </div>
        <div className="confirm-close-body">
          <p>{message}</p>
        </div>
        <div className="confirm-close-footer">
          {options.map((option, index) => (
            <button
              key={index}
              type="button"
              className={`confirm-close-btn confirm-close-btn-${option.variant}`}
              onClick={option.action}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className="confirm-close-btn confirm-close-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
