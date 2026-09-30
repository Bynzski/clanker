import { useRef } from 'react';
import { useBrowserOverlaySuppression } from '../../lib/useBrowserOverlaySuppression';

export function BrowserOverlayLease({ workspaceId }: { workspaceId?: string }) {
  useBrowserOverlaySuppression(true, workspaceId);
  return null;
}

/** Also restore focus for controlled dialogs opened without a Radix Trigger. */
export function useDialogFocusRestoration(
  onOpenAutoFocus?: (event: Event) => void,
  onCloseAutoFocus?: (event: Event) => void,
) {
  const origin = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      if (!event.defaultPrevented && origin.current?.isConnected && origin.current !== document.body) {
        event.preventDefault();
        origin.current.focus();
      }
    },
  };
}
