import type { ComponentProps } from 'react';
import * as RadixAlertDialog from '@radix-ui/react-alert-dialog';
import { BrowserOverlayLease, useDialogFocusRestoration } from './dialogLifecycle';
import './Dialog.css';

export const AlertDialog = RadixAlertDialog.Root;
export const AlertDialogTrigger = RadixAlertDialog.Trigger;
export const AlertDialogAction = RadixAlertDialog.Action;
export const AlertDialogCancel = RadixAlertDialog.Cancel;
export const AlertDialogTitle = RadixAlertDialog.Title;
export const AlertDialogDescription = RadixAlertDialog.Description;

export type AlertDialogContentProps = Omit<ComponentProps<typeof RadixAlertDialog.Content>, 'asChild'> & {
  workspaceId?: string;
  overlayClassName?: string;
  /** Opt in only for existing confirmations whose backdrop already cancels. */
  onBackdropCancel?: () => void;
};

export function AlertDialogContent({ workspaceId, overlayClassName = '', className = '', children,
  onBackdropCancel, onOpenAutoFocus, onCloseAutoFocus, ...props }: AlertDialogContentProps) {
  const focus = useDialogFocusRestoration(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <RadixAlertDialog.Portal>
      <RadixAlertDialog.Overlay className={`clanker-dialog-overlay ${overlayClassName}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) onBackdropCancel?.();
        }} />
      <RadixAlertDialog.Content {...props} {...focus} className={`clanker-dialog-content ${className}`}>
        <BrowserOverlayLease workspaceId={workspaceId} />
        {children}
      </RadixAlertDialog.Content>
    </RadixAlertDialog.Portal>
  );
}
