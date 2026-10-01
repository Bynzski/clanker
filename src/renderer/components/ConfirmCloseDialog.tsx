import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from './ui/AlertDialog';
import { Button } from './ui/Button';
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
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent className="confirm-close-dialog" overlayClassName="confirm-close-overlay" onBackdropCancel={onCancel}>
        <div className="confirm-close-header">
          <AlertDialogTitle asChild><h3>{title}</h3></AlertDialogTitle>
        </div>
        <div className="confirm-close-body">
          <AlertDialogDescription asChild><p>{message}</p></AlertDialogDescription>
        </div>
        <div className="confirm-close-footer">
          {/* Actions own closing (including async saves); do not route them through onCancel. */}
          {options.map((option, index) => (
            <Button
              key={index}
              size="sm"
              variant={option.variant}
              className={`confirm-close-btn-${option.variant}`}
              onClick={option.action}
            >
              {option.label}
            </Button>
          ))}
          <AlertDialogCancel asChild>
            <Button size="sm" variant="secondary">Cancel</Button>
          </AlertDialogCancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
