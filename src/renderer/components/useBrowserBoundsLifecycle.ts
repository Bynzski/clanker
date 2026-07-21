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
  workspaceId?: string;
  activeTabId: string | null;
  browserVisible?: boolean;
  browserOverlayCount: number;
  isActiveWorkspace: boolean;
  layoutVersion: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export function useBrowserBoundsLifecycle({
  workspaceId,
  activeTabId,
  browserVisible,
  browserOverlayCount,
  isActiveWorkspace,
  layoutVersion,
  containerRef,
  contentRef,
}: UseBrowserBoundsLifecycleOptions): { scheduleBoundsUpdate: (force?: boolean) => void } {
  const rafRef = useRef<number | null>(null);
  const lastBoundsRef = useRef<BrowserBounds | null>(null);
  const firstBoundsSentRef = useRef(false);

  const callBrowserSetBounds = useCallback((bounds: BrowserBounds) => {
    if (!workspaceId) return;
    if (activeTabId) {
      window.electronAPI.browserSetBounds(workspaceId, bounds, activeTabId);
    } else {
      window.electronAPI.browserSetBounds(workspaceId, bounds);
    }
  }, [activeTabId, workspaceId]);

  const updateBounds = useCallback(() => {
    if (!contentRef.current || !browserVisible || browserOverlayCount > 0 || !workspaceId || !isActiveWorkspace) return;

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
      browserFirstBounds(workspaceId, newBounds.x, newBounds.y, newBounds.width, newBounds.height);
    }
  }, [browserOverlayCount, browserVisible, callBrowserSetBounds, contentRef, isActiveWorkspace, workspaceId]);

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
    if (!browserVisible || browserOverlayCount > 0 || !workspaceId || !isActiveWorkspace) return;
    const healthCheckInterval = setInterval(() => {
      scheduleBoundsUpdate();
    }, 2000);
    return () => clearInterval(healthCheckInterval);
  }, [browserOverlayCount, browserVisible, isActiveWorkspace, scheduleBoundsUpdate, workspaceId]);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      scheduleBoundsUpdate();
    });

    resizeObserver.observe(containerRef.current);
    firstBoundsSentRef.current = false;
    if (workspaceId && isActiveWorkspace) {
      browserMount(workspaceId, lastBoundsRef.current === null);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef, isActiveWorkspace, scheduleBoundsUpdate, workspaceId]);

  useEffect(() => {
    const handleWindowResize = () => {
      scheduleBoundsUpdate();
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [scheduleBoundsUpdate]);

  useEffect(() => {
    if (!browserVisible || !workspaceId) return;

    if (!isActiveWorkspace) {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      window.electronAPI.browserHide(workspaceId);
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
      window.electronAPI.browserHide(workspaceId);
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
    isActiveWorkspace,
    scheduleBoundsUpdate,
    workspaceId,
  ]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      const lb = lastBoundsRef.current;
      lastBoundsRef.current = null;
      firstBoundsSentRef.current = false;
      if (workspaceId) {
        browserUnmount(workspaceId, lb?.x ?? null, lb?.y ?? null, lb?.width ?? null, lb?.height ?? null);
        window.electronAPI.browserHide(workspaceId);
      }
    };
  }, [workspaceId]);

  return { scheduleBoundsUpdate };
}
