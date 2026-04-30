import { useEffect } from 'react';
import type { RefObject } from 'react';

export function useBrowserOverlayWhileOpen(
  isOpen: boolean,
  workspaceId: string | null,
  pushBrowserOverlay: (workspaceId: string) => void,
  popBrowserOverlay: (workspaceId: string) => void,
): void {
  useEffect(() => {
    if (!isOpen || !workspaceId) {
      return;
    }

    pushBrowserOverlay(workspaceId);
    return () => popBrowserOverlay(workspaceId);
  }, [isOpen, popBrowserOverlay, pushBrowserOverlay, workspaceId]);
}

export function useCloseOnOutsidePointerAndEscape(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [containerRef, isOpen, onClose]);
}
