import { useCallback, useEffect, useRef } from 'react';
import {
  browserMount,
  browserUnmount,
  browserFirstBounds,
} from '../lib/workspaceSwitchDebug';

interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function browserBoundsFromDomRect(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  scrollX: number,
  scrollY: number,
  zoomFactor: number,
): BrowserBounds {
  const scale = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  return {
    x: Math.round((rect.left + scrollX) * scale),
    y: Math.round((rect.top + scrollY) * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  };
}

interface UseBrowserBoundsLifecycleOptions {
  /** Opaque Browser owner: a workspace id or an Assistant browser scope. */
  ownerId?: string;
  activeTabId: string | null;
  browserVisible?: boolean;
  browserOverlayCount: number;
  isActiveOwner: boolean;
  layoutVersion: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export function useBrowserBoundsLifecycle({
  ownerId,
  activeTabId,
  browserVisible,
  browserOverlayCount,
  isActiveOwner,
  layoutVersion,
  containerRef,
  contentRef,
}: UseBrowserBoundsLifecycleOptions): { scheduleBoundsUpdate: (force?: boolean) => void } {
  const rafRef = useRef<number | null>(null);
  const lastBoundsRef = useRef<BrowserBounds | null>(null);
  const firstBoundsSentRef = useRef(false);

  useEffect(() => {
    if (!ownerId || !isActiveOwner || !browserVisible || browserOverlayCount > 0) return;
    // Reconcile selection separately from geometry; late bounds cannot select a tab.
    void window.electronAPI.browserActivate(ownerId, activeTabId ?? undefined);
  }, [ownerId, activeTabId, isActiveOwner, browserVisible, browserOverlayCount]);

  const callBrowserSetBounds = useCallback((bounds: BrowserBounds) => {
    if (!ownerId) return;
    if (activeTabId) {
      window.electronAPI.browserSetBounds(ownerId, bounds, activeTabId);
    } else {
      window.electronAPI.browserSetBounds(ownerId, bounds);
    }
  }, [activeTabId, ownerId]);

  const updateBounds = useCallback(() => {
    if (!contentRef.current || !browserVisible || browserOverlayCount > 0 || !ownerId || !isActiveOwner) return;

    const rect = contentRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // DOMRect is expressed in zoomed renderer CSS pixels. WebContentsView uses
    // window DIPs, so apply renderer zoom only. devicePixelRatio also contains
    // monitor scale and would incorrectly double-scale on HiDPI displays.
    const newBounds = browserBoundsFromDomRect(
      rect,
      window.scrollX,
      window.scrollY,
      window.electronAPI.getWindowZoomFactor(),
    );

    if (lastBoundsRef.current !== null) {
      const { x, y, width, height } = lastBoundsRef.current;
      if (
        Math.abs(newBounds.x - x) <= 1 &&
        Math.abs(newBounds.y - y) <= 1 &&
        Math.abs(newBounds.width - width) <= 1 &&
        Math.abs(newBounds.height - height) <= 1
      ) {
        return;
      }
    }

    lastBoundsRef.current = newBounds;
    callBrowserSetBounds(newBounds);

    if (!firstBoundsSentRef.current) {
      firstBoundsSentRef.current = true;
      browserFirstBounds(ownerId, newBounds.x, newBounds.y, newBounds.width, newBounds.height);
    }
  }, [browserOverlayCount, browserVisible, callBrowserSetBounds, contentRef, isActiveOwner, ownerId]);

  const scheduleBoundsUpdate = useCallback((force = false) => {
    if (force) {
      lastBoundsRef.current = null;
    }
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateBounds();
    });
  }, [updateBounds]);

  useEffect(() => {
    scheduleBoundsUpdate();
  }, [layoutVersion, scheduleBoundsUpdate]);

  useEffect(() => {
    if (!browserVisible || browserOverlayCount > 0 || !ownerId || !isActiveOwner) return;
    const healthCheckInterval = setInterval(() => {
      scheduleBoundsUpdate();
    }, 2000);
    return () => clearInterval(healthCheckInterval);
  }, [browserOverlayCount, browserVisible, isActiveOwner, scheduleBoundsUpdate, ownerId]);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      scheduleBoundsUpdate();
    });

    resizeObserver.observe(containerRef.current);
    firstBoundsSentRef.current = false;
    if (ownerId && isActiveOwner) {
      browserMount(ownerId, lastBoundsRef.current === null);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef, isActiveOwner, scheduleBoundsUpdate, ownerId]);

  useEffect(() => {
    const handleWindowResize = () => {
      scheduleBoundsUpdate();
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [scheduleBoundsUpdate]);

  useEffect(() => {
    if (!ownerId) return;

    if (!isActiveOwner || !browserVisible) {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      window.electronAPI.browserHide(ownerId);
      return;
    }

    if (lastBoundsRef.current !== null) {
      callBrowserSetBounds(lastBoundsRef.current);
    }

    if (browserOverlayCount > 0) {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastBoundsRef.current = null;
      window.electronAPI.browserHide(ownerId);
      return;
    }

    scheduleBoundsUpdate();
    const followUpFrame = window.requestAnimationFrame(() => {
      scheduleBoundsUpdate();
    });

    return () => {
      window.cancelAnimationFrame(followUpFrame);
    };
  }, [
    browserOverlayCount,
    browserVisible,
    callBrowserSetBounds,
    isActiveOwner,
    scheduleBoundsUpdate,
    ownerId,
  ]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      const lb = lastBoundsRef.current;
      lastBoundsRef.current = null;
      firstBoundsSentRef.current = false;
      if (ownerId) {
        browserUnmount(ownerId, lb?.x ?? null, lb?.y ?? null, lb?.width ?? null, lb?.height ?? null);
        window.electronAPI.browserHide(ownerId);
      }
    };
  }, [ownerId]);

  return { scheduleBoundsUpdate };
}
