import { useCallback } from 'react';
import type { BrowserPresentation } from '../../shared/types/browserPresentation';
import type { MouseEvent as ReactMouseEvent } from 'react';

interface RemoveBrowserTabResult {
  removed: boolean;
  nextActiveTabId: string | null;
}

interface UseBrowserPanelActionsOptions {
  presentation?: BrowserPresentation;
  scoped?: boolean;
  /** Opaque Browser owner: a workspace id or an Assistant browser scope. */
  ownerId: string | null;
  activeTabId: string | null;
  browserTabsCount: number;
  displayedUrl: string;
  annotationActive: boolean;
  setAnnotationActive: (value: boolean) => void;
  removeBrowserTab: (tabId: string) => RemoveBrowserTabResult;
  setActiveBrowserTab: (tabId: string) => boolean;
  createTab: () => Promise<string | null>;
  syncSelectedTab: () => Promise<void>;
  scheduleBoundsUpdate: (force?: boolean) => void;
}

interface UseBrowserPanelActionsResult {
  handleBack: () => void;
  handleForward: () => void;
  handleRefresh: () => void;
  handleStop: () => void;
  handleOpenExternal: () => void;
  handleAnnotationToggle: () => Promise<void>;
  handleNewTab: () => Promise<void>;
  handleSwitchTab: (tabId: string) => Promise<void>;
  handleCloseTab: (event: ReactMouseEvent, tabId: string) => Promise<void>;
  closeTabById: (tabId: string) => Promise<void>;
}

export function useBrowserPanelActions({
  presentation,
  scoped,
  ownerId,
  activeTabId,
  browserTabsCount,
  displayedUrl,
  annotationActive,
  setAnnotationActive,
  removeBrowserTab,
  setActiveBrowserTab,
  createTab,
  syncSelectedTab,
  scheduleBoundsUpdate,
}: UseBrowserPanelActionsOptions): UseBrowserPanelActionsResult {
  const handleBack = useCallback(() => {
    if (!ownerId) return;
    if (presentation) window.electronAPI.browserBack(ownerId, presentation);
    else if (!scoped) window.electronAPI.browserBack(ownerId);
  }, [ownerId, presentation, scoped]);

  const handleForward = useCallback(() => {
    if (!ownerId) return;
    if (presentation) window.electronAPI.browserForward(ownerId, presentation);
    else if (!scoped) window.electronAPI.browserForward(ownerId);
  }, [ownerId, presentation, scoped]);

  const handleRefresh = useCallback(() => {
    if (!ownerId) return;
    if (presentation) window.electronAPI.browserRefresh(ownerId, presentation);
    else if (!scoped) window.electronAPI.browserRefresh(ownerId);
  }, [ownerId, presentation, scoped]);

  const handleStop = useCallback(() => {
    if (!ownerId) return;
    if (presentation) window.electronAPI.browserStop(ownerId, presentation);
    else if (!scoped) window.electronAPI.browserStop(ownerId);
  }, [ownerId, presentation, scoped]);

  const handleOpenExternal = useCallback(() => {
    if (displayedUrl) {
      window.electronAPI.openExternal(displayedUrl);
    }
  }, [displayedUrl]);

  const handleAnnotationToggle = useCallback(async () => {
    if (!ownerId) return;

    if (annotationActive) {
      await window.electronAPI.annotationDisable();
      setAnnotationActive(false);
      return;
    }

    const result = await window.electronAPI.annotationEnable(ownerId);
    if (result.success) {
      setAnnotationActive(true);
    }
  }, [annotationActive, setAnnotationActive, ownerId]);

  const handleNewTab = useCallback(async () => {
    if (!ownerId) return;
    const tabId = await createTab();
    if (!tabId) return;
    scheduleBoundsUpdate(true);
  }, [createTab, scheduleBoundsUpdate, ownerId]);

  const handleSwitchTab = useCallback(async (tabId: string) => {
    if (!ownerId || tabId === activeTabId) return;

    const changed = setActiveBrowserTab(tabId);
    if (!changed) return;
    if (!scoped) await window.electronAPI.browserSwitchTab(ownerId, tabId);
    else await syncSelectedTab();
    scheduleBoundsUpdate(true);
  }, [activeTabId, scheduleBoundsUpdate, setActiveBrowserTab, ownerId, scoped, syncSelectedTab]);

  const closeTabById = useCallback(async (tabId: string) => {
    if (!ownerId || browserTabsCount <= 1) return;

    const { removed } = removeBrowserTab(tabId);
    if (!removed) return;

    await window.electronAPI.browserCloseTab(ownerId, tabId);
    await syncSelectedTab();
    scheduleBoundsUpdate(true);
  }, [browserTabsCount, removeBrowserTab, scheduleBoundsUpdate, syncSelectedTab, ownerId]);

  const handleCloseTab = useCallback(async (event: ReactMouseEvent, tabId: string) => {
    event.stopPropagation();
    await closeTabById(tabId);
  }, [closeTabById]);

  return {
    handleBack,
    handleForward,
    handleRefresh,
    handleStop,
    handleOpenExternal,
    handleAnnotationToggle,
    handleNewTab,
    handleSwitchTab,
    handleCloseTab,
    closeTabById,
  };
}
