import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

interface RemoveBrowserTabResult {
  removed: boolean;
  nextActiveTabId: string | null;
}

interface UseBrowserPanelActionsOptions {
  workspaceId: string | null;
  activeTabId: string | null;
  browserTabsCount: number;
  displayedUrl: string;
  annotationActive: boolean;
  setAnnotationActive: (value: boolean) => void;
  addBrowserTab: (workspaceId: string) => string | null;
  removeBrowserTab: (tabId: string, workspaceId: string) => RemoveBrowserTabResult;
  setActiveBrowserTab: (tabId: string, workspaceId: string) => boolean;
  onTabMenuClose: () => void;
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
}

export function useBrowserPanelActions({
  workspaceId,
  activeTabId,
  browserTabsCount,
  displayedUrl,
  annotationActive,
  setAnnotationActive,
  addBrowserTab,
  removeBrowserTab,
  setActiveBrowserTab,
  onTabMenuClose,
  scheduleBoundsUpdate,
}: UseBrowserPanelActionsOptions): UseBrowserPanelActionsResult {
  const handleBack = useCallback(() => {
    if (!workspaceId) return;
    window.electronAPI.browserBack(workspaceId);
  }, [workspaceId]);

  const handleForward = useCallback(() => {
    if (!workspaceId) return;
    window.electronAPI.browserForward(workspaceId);
  }, [workspaceId]);

  const handleRefresh = useCallback(() => {
    if (!workspaceId) return;
    window.electronAPI.browserRefresh(workspaceId);
  }, [workspaceId]);

  const handleStop = useCallback(() => {
    if (!workspaceId) return;
    window.electronAPI.browserStop(workspaceId);
  }, [workspaceId]);

  const handleOpenExternal = useCallback(() => {
    if (displayedUrl) {
      window.electronAPI.openExternal(displayedUrl);
    }
  }, [displayedUrl]);

  const handleAnnotationToggle = useCallback(async () => {
    if (!workspaceId) return;

    if (annotationActive) {
      await window.electronAPI.annotationDisable();
      setAnnotationActive(false);
      return;
    }

    const result = await window.electronAPI.annotationEnable(workspaceId);
    if (result.success) {
      setAnnotationActive(true);
    }
  }, [annotationActive, setAnnotationActive, workspaceId]);

  const handleNewTab = useCallback(async () => {
    if (!workspaceId) return;
    const tabId = addBrowserTab(workspaceId);
    if (!tabId) return;

    await window.electronAPI.browserCreateTab(workspaceId, tabId);
    setActiveBrowserTab(tabId, workspaceId);
    await window.electronAPI.browserSwitchTab(workspaceId, tabId);
    onTabMenuClose();
    scheduleBoundsUpdate(true);
  }, [addBrowserTab, onTabMenuClose, scheduleBoundsUpdate, setActiveBrowserTab, workspaceId]);

  const handleSwitchTab = useCallback(async (tabId: string) => {
    if (!workspaceId || tabId === activeTabId) {
      onTabMenuClose();
      return;
    }

    const changed = setActiveBrowserTab(tabId, workspaceId);
    if (!changed) return;
    await window.electronAPI.browserSwitchTab(workspaceId, tabId);
    onTabMenuClose();
    scheduleBoundsUpdate(true);
  }, [activeTabId, onTabMenuClose, scheduleBoundsUpdate, setActiveBrowserTab, workspaceId]);

  const handleCloseTab = useCallback(async (event: ReactMouseEvent, tabId: string) => {
    event.stopPropagation();
    if (!workspaceId || browserTabsCount <= 1) return;

    const { removed, nextActiveTabId } = removeBrowserTab(tabId, workspaceId);
    if (!removed) return;

    await window.electronAPI.browserCloseTab(workspaceId, tabId);
    if (nextActiveTabId) {
      await window.electronAPI.browserSwitchTab(workspaceId, nextActiveTabId);
    }
    scheduleBoundsUpdate(true);
  }, [browserTabsCount, removeBrowserTab, scheduleBoundsUpdate, workspaceId]);

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
  };
}
