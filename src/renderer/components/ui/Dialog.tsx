import type { ComponentProps } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { BrowserOverlayLease, useDialogFocusRestoration } from './dialogLifecycle';
import './Dialog.css';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;
export const DialogTitle = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;

export type DialogContentProps = Omit<ComponentProps<typeof RadixDialog.Content>, 'asChild'> & {
  workspaceId?: string;
  overlayClassName?: string;
};

export function DialogContent({ workspaceId, overlayClassName = '', className = '', children,
  onOpenAutoFocus, onCloseAutoFocus, ...props }: DialogContentProps) {
  const focus = useDialogFocusRestoration(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={`clanker-dialog-overlay ${overlayClassName}`} />
      <RadixDialog.Content {...props} {...focus} className={`clanker-dialog-content ${className}`}>
        <BrowserOverlayLease workspaceId={workspaceId} />
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
