import { useCallback, useEffect, useRef } from 'react';
import { currentBrowserPresentation, useBrowserPresentation } from '../lib/browserPresentation';
import { browserMount, browserUnmount, browserFirstBounds } from '../lib/workspaceSwitchDebug';
interface BrowserBounds { x: number; y: number; width: number; height: number }
export function browserBoundsFromDomRect(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, scrollX: number, scrollY: number, zoomFactor: number): BrowserBounds {
  const scale = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  return { x: Math.round((rect.left + scrollX) * scale), y: Math.round((rect.top + scrollY) * scale),
    width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) };
}
interface UseBrowserBoundsLifecycleOptions {
  ownerId?: string;
  paneId?: string;
  activeTabId: string | null;
  browserVisible?: boolean;
  browserOverlayCount: number;
  isActiveOwner: boolean;
  layoutVersion: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
}
export function useBrowserBoundsLifecycle({ ownerId, paneId, activeTabId, browserVisible, browserOverlayCount,
  isActiveOwner, layoutVersion, containerRef, contentRef }: UseBrowserBoundsLifecycleOptions) {
  const presentation = useBrowserPresentation(ownerId ?? '', paneId, activeTabId ?? undefined);
  const lease = presentation?.lease;
  const ready = !paneId || Boolean(presentation?.ready);
  const raf = useRef<number | null>(null);
  const last = useRef<BrowserBounds | null>(null);
  const first = useRef(false);
  // Legacy embeddings without pane state retain their supported single-Browser API.
  // All application panes have an id and only consume coordinator-issued authority.
  useEffect(() => {
    if (!paneId && ownerId && isActiveOwner && browserVisible && !browserOverlayCount)
      void window.electronAPI.browserActivate(ownerId, activeTabId ?? undefined);
  }, [paneId, ownerId, isActiveOwner, browserVisible, browserOverlayCount, activeTabId]);
  const update = useCallback(() => {
    if (!ready || !contentRef.current || !ownerId || !browserVisible || browserOverlayCount || !isActiveOwner) return;
    if (paneId && currentBrowserPresentation(ownerId, paneId, activeTabId ?? undefined)?.lease !== lease) return;
    const rect = contentRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const bounds = browserBoundsFromDomRect(rect, window.scrollX, window.scrollY, window.electronAPI.getWindowZoomFactor());
    if (last.current && Object.keys(bounds).every((key) => Math.abs(bounds[key as keyof BrowserBounds] - last.current![key as keyof BrowserBounds]) <= 1)) return;
    last.current = bounds;
    if (paneId) void window.electronAPI.browserSetBounds(ownerId, bounds, activeTabId ?? undefined, lease);
    else if (activeTabId) void window.electronAPI.browserSetBounds(ownerId, bounds, activeTabId);
    else void window.electronAPI.browserSetBounds(ownerId, bounds);
    if (!first.current) { first.current = true; browserFirstBounds(ownerId, bounds.x, bounds.y, bounds.width, bounds.height); }
  }, [ready, contentRef, ownerId, browserVisible, browserOverlayCount, isActiveOwner, paneId, activeTabId, lease]);
  const scheduleBoundsUpdate = useCallback((force = false) => {
    if (force) last.current = null;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => { raf.current = null; update(); });
  }, [update]);
  useEffect(() => {
    if (!paneId && ownerId && browserVisible && isActiveOwner && !browserOverlayCount && last.current) {
      if (activeTabId) void window.electronAPI.browserSetBounds(ownerId, last.current, activeTabId);
      else void window.electronAPI.browserSetBounds(ownerId, last.current);
    }
    if (!browserVisible || !isActiveOwner || browserOverlayCount) return;
    scheduleBoundsUpdate(Boolean(paneId));
    const followUp = requestAnimationFrame(() => scheduleBoundsUpdate());
    return () => cancelAnimationFrame(followUp);
  }, [layoutVersion, lease, ready, scheduleBoundsUpdate, paneId, ownerId, browserVisible, isActiveOwner, browserOverlayCount, activeTabId]);
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => scheduleBoundsUpdate());
    observer.observe(containerRef.current);
    const resized = () => scheduleBoundsUpdate();
    window.addEventListener('resize', resized);
    const interval = setInterval(resized, 2000);
    if (ownerId) browserMount(ownerId, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', resized); clearInterval(interval); };
  }, [containerRef, ownerId, scheduleBoundsUpdate]);
  useEffect(() => {
    if (!paneId && ownerId && (!browserVisible || !isActiveOwner || browserOverlayCount)) void window.electronAPI.browserHide(ownerId);
  }, [paneId, ownerId, browserVisible, isActiveOwner, browserOverlayCount]);
  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (ownerId) {
      browserUnmount(ownerId, last.current?.x ?? null, last.current?.y ?? null, last.current?.width ?? null, last.current?.height ?? null);
      if (!paneId) void window.electronAPI.browserHide(ownerId);
    }
  }, [ownerId, paneId]);
  return { scheduleBoundsUpdate };
}
