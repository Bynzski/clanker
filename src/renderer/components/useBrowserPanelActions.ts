import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

interface RemoveBrowserTabResult {
  removed: boolean;
  nextActiveTabId: string | null;
}

interface UseBrowserPanelActionsOptions {
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
    window.electronAPI.browserBack(ownerId);
  }, [ownerId]);

  const handleForward = useCallback(() => {
    if (!ownerId) return;
    window.electronAPI.browserForward(ownerId);
  }, [ownerId]);

  const handleRefresh = useCallback(() => {
    if (!ownerId) return;
    window.electronAPI.browserRefresh(ownerId);
  }, [ownerId]);

  const handleStop = useCallback(() => {
    if (!ownerId) return;
    window.electronAPI.browserStop(ownerId);
  }, [ownerId]);

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
    await window.electronAPI.browserSwitchTab(ownerId, tabId);
    scheduleBoundsUpdate(true);
  }, [activeTabId, scheduleBoundsUpdate, setActiveBrowserTab, ownerId]);

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
