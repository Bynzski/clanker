import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, ExternalLink, LocateFixed, Lock, Unlock, MousePointer2, ChevronDown, Plus } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { BrowserTab } from '../store/workspaceTypes';
import { useScopedWorkspace } from './WorkspaceScope';
import { useDragHandle } from './DynamicPaneLayout';
import './BrowserPanel.css';
import {
  browserMount,
  browserUnmount,
  browserFirstBounds,
  browserReactMount,
  browserReactUnmount,
} from '../lib/workspaceSwitchDebug';

interface BrowserPanelProps {
  workspaceId?: string;
  /** Compatibility prop retained for existing callers/tests. BrowserPanel now derives URL from the active browser tab. */
  url?: string;
  /** Compatibility callback retained for legacy tests; tab-aware store updates are canonical. */
  onUrlChange?: (url: string) => void;
  layoutVersion: number;
}

function getTabLabel(tab: BrowserTab | null): string {
  if (!tab) return 'New Tab';
  const title = tab.title.trim();
  if (title) return title;
  try {
    return new URL(tab.url).hostname || tab.url || 'New Tab';
  } catch {
    return tab.url || 'New Tab';
  }
}

function getTabSubtitle(tab: BrowserTab): string {
  try {
    const parsed = new URL(tab.url);
    return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return tab.url;
  }
}

export default function BrowserPanel({ workspaceId, url, onUrlChange, layoutVersion }: BrowserPanelProps) {
  const workspace = useScopedWorkspace(workspaceId);
  const activeTab = workspace?.browserPane?.tabs.find((tab) => tab.id === workspace.browserPane?.activeTabId) ?? null;
  const activeTabId = activeTab?.id ?? null;
  const displayedUrl = url ?? activeTab?.url ?? workspace?.browserUrl ?? '';

  const [inputUrl, setInputUrl] = useState(displayedUrl);
  const [canGoBack, setCanGoBack] = useState(activeTab?.canGoBack ?? false);
  const [canGoForward, setCanGoForward] = useState(activeTab?.canGoForward ?? false);
  const [tabsOpen, setTabsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const tabsMenuRef = useRef<HTMLDivElement>(null);
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const firstBoundsSentRef = useRef(false);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const bringBrowserIntoView = useWorkspaceStore((state) => state.bringBrowserIntoView);
  const toggleBrowserLock = useWorkspaceStore((state) => state.toggleBrowserLock);
  const addBrowserTab = useWorkspaceStore((state) => state.addBrowserTab);
  const removeBrowserTab = useWorkspaceStore((state) => state.removeBrowserTab);
  const setActiveBrowserTab = useWorkspaceStore((state) => state.setActiveBrowserTab);
  const updateBrowserTab = useWorkspaceStore((state) => state.updateBrowserTab);
  const browserLocked = workspace?.browserPane?.locked ?? false;
  const browserOverlayCount = workspace?.browserOverlayCount ?? 0;
  const browserTabs = workspace?.browserPane?.tabs ?? [];
  const [annotationActive, setAnnotationActive] = useState(false);
  const dragHandleProps = useDragHandle();
  const isActiveWorkspace = workspace?.id != null && workspace.id === activeWorkspaceId;

  useEffect(() => {
    browserReactMount(workspace?.id ?? 'unknown');
    return () => {
      browserReactUnmount(workspace?.id ?? 'unknown');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const callBrowserSetBounds = useCallback((bounds: { x: number; y: number; width: number; height: number }) => {
    if (!workspace?.id) return;
    if (activeTabId) {
      window.electronAPI.browserSetBounds(workspace.id, bounds, activeTabId);
    } else {
      window.electronAPI.browserSetBounds(workspace.id, bounds);
    }
  }, [activeTabId, workspace?.id]);

  const updateBounds = useCallback(() => {
    if (!contentRef.current || !workspace?.browserVisible || browserOverlayCount > 0 || !workspace.id || !isActiveWorkspace) return;

    const rect = contentRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const scale = window.devicePixelRatio || 1;
    const newBounds = {
      x: Math.round((rect.left + window.scrollX) * scale),
      y: Math.round((rect.top + window.scrollY) * scale),
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
    };

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
      browserFirstBounds(workspace.id, newBounds.x, newBounds.y, newBounds.width, newBounds.height);
    }
  }, [browserOverlayCount, callBrowserSetBounds, isActiveWorkspace, workspace?.browserVisible, workspace?.id]);

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
    if (activeTab) {
      setCanGoBack(activeTab.canGoBack);
      setCanGoForward(activeTab.canGoForward);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!workspace?.browserVisible || browserOverlayCount > 0 || !workspace.id || !isActiveWorkspace) return;
    const healthCheckInterval = setInterval(() => {
      scheduleBoundsUpdate();
    }, 2000);
    return () => clearInterval(healthCheckInterval);
  }, [browserOverlayCount, isActiveWorkspace, scheduleBoundsUpdate, workspace?.id, workspace?.browserVisible]);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      scheduleBoundsUpdate();
    });

    resizeObserver.observe(containerRef.current);
    firstBoundsSentRef.current = false;
    if (workspace?.id && isActiveWorkspace) {
      browserMount(workspace.id, lastBoundsRef.current === null);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [isActiveWorkspace, scheduleBoundsUpdate, workspace?.id]);

  useEffect(() => {
    const handleWindowResize = () => {
      scheduleBoundsUpdate();
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [scheduleBoundsUpdate]);

  useEffect(() => {
    setInputUrl(displayedUrl);
    setTabsOpen(false);
  }, [activeTabId, displayedUrl]);

  useEffect(() => {
    if (!tabsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!tabsMenuRef.current?.contains(event.target as Node)) {
        setTabsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [tabsOpen]);

  useEffect(() => {
    if (!workspace?.id || !isActiveWorkspace) {
      setCanGoBack(false);
      setCanGoForward(false);
      return;
    }

    let cancelled = false;
    const updateState = async () => {
      try {
        const [back, forward] = await Promise.all([
          window.electronAPI.canGoBack(workspace.id),
          window.electronAPI.canGoForward(workspace.id),
        ]);
        if (!cancelled) {
          setCanGoBack(back);
          setCanGoForward(forward);
          if (activeTabId) {
            updateBrowserTab(activeTabId, { canGoBack: back, canGoForward: forward }, workspace.id);
          }
        }
      } catch {
        // Ignore errors
      }
    };

    updateState();
    const interval = setInterval(updateState, 500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTabId, isActiveWorkspace, updateBrowserTab, workspace?.id]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      const wsId = workspace?.id ?? null;
      const lb = lastBoundsRef.current;
      lastBoundsRef.current = null;
      firstBoundsSentRef.current = false;
      if (wsId) {
        browserUnmount(wsId, lb?.x ?? null, lb?.y ?? null, lb?.width ?? null, lb?.height ?? null);
        window.electronAPI.browserHide(wsId);
      }
    };
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace?.id) {
      setAnnotationActive(false);
      return;
    }

    let cancelled = false;
    const updateState = async () => {
      try {
        const state = await window.electronAPI.annotationGetState();
        if (!cancelled) {
          setAnnotationActive(state.enabled && state.workspaceId === workspace.id);
          if (state.copyTriggered) {
            await window.electronAPI.annotationTriggerCopy();
          }
        }
      } catch {
        // Ignore errors
      }
    };

    const unsubscribeEscape = window.electronAPI.onAnnotationEscape(() => {
      setAnnotationActive(false);
    });

    updateState();
    const interval = setInterval(updateState, 500);
    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribeEscape();
    };
  }, [workspace?.id]);

  const handleAnnotationToggle = async () => {
    if (!workspace?.id) return;

    if (annotationActive) {
      await window.electronAPI.annotationDisable();
      setAnnotationActive(false);
    } else {
      const result = await window.electronAPI.annotationEnable(workspace.id);
      if (result.success) {
        setAnnotationActive(true);
      }
    }
  };

  useEffect(() => {
    if (!workspace?.browserVisible || !workspace.id) return;

    if (!isActiveWorkspace) {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      window.electronAPI.browserHide(workspace.id);
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
      window.electronAPI.browserHide(workspace.id);
      return;
    }

    scheduleBoundsUpdate();
    const followUpFrame = window.requestAnimationFrame(() => {
      scheduleBoundsUpdate();
    });

    return () => {
      window.cancelAnimationFrame(followUpFrame);
    };
  }, [browserOverlayCount, callBrowserSetBounds, isActiveWorkspace, scheduleBoundsUpdate, workspace?.id, workspace?.browserVisible]);

  const handleNavigate = async () => {
    let navigateUrl = inputUrl.trim();
    if (!navigateUrl || !workspace?.id) return;

    if (!navigateUrl.startsWith('http://') && !navigateUrl.startsWith('https://')) {
      navigateUrl = 'https://' + navigateUrl;
    }

    const success = activeTabId
      ? await window.electronAPI.browserTabNavigate(workspace.id, activeTabId, navigateUrl)
      : await window.electronAPI.browserNavigate(workspace.id, navigateUrl);

    if (success) {
      if (activeTabId) {
        updateBrowserTab(activeTabId, { url: navigateUrl }, workspace.id);
      }
      onUrlChange?.(navigateUrl);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleNavigate();
    }
  };

  const handleBack = () => {
    if (!workspace?.id) return;
    window.electronAPI.browserBack(workspace.id);
  };

  const handleForward = () => {
    if (!workspace?.id) return;
    window.electronAPI.browserForward(workspace.id);
  };

  const handleRefresh = () => {
    if (!workspace?.id) return;
    window.electronAPI.browserRefresh(workspace.id);
  };

  const handleStop = () => {
    if (!workspace?.id) return;
    window.electronAPI.browserStop(workspace.id);
  };

  const handleOpenExternal = () => {
    if (displayedUrl) {
      window.electronAPI.openExternal(displayedUrl);
    }
  };

  const handleBringIntoView = () => {
    if (workspaceId) {
      bringBrowserIntoView(workspaceId);
    } else {
      bringBrowserIntoView();
    }
  };

  const handleToggleLock = () => {
    if (workspaceId) {
      toggleBrowserLock(workspaceId);
    } else {
      toggleBrowserLock();
    }
  };

  const handleNewTab = async () => {
    if (!workspace?.id) return;
    const tabId = addBrowserTab(workspace.id);
    if (!tabId) return;

    await window.electronAPI.browserCreateTab(workspace.id, tabId);
    setActiveBrowserTab(tabId, workspace.id);
    await window.electronAPI.browserSwitchTab(workspace.id, tabId);
    setTabsOpen(false);
    scheduleBoundsUpdate(true);
  };

  const handleSwitchTab = async (tabId: string) => {
    if (!workspace?.id || tabId === activeTabId) {
      setTabsOpen(false);
      return;
    }

    const changed = setActiveBrowserTab(tabId, workspace.id);
    if (!changed) return;
    await window.electronAPI.browserSwitchTab(workspace.id, tabId);
    setTabsOpen(false);
    scheduleBoundsUpdate(true);
  };

  const handleCloseTab = async (event: React.MouseEvent, tabId: string) => {
    event.stopPropagation();
    if (!workspace?.id || browserTabs.length <= 1) return;

    const { removed, nextActiveTabId } = removeBrowserTab(tabId, workspace.id);
    if (!removed) return;

    await window.electronAPI.browserCloseTab(workspace.id, tabId);
    if (nextActiveTabId) {
      await window.electronAPI.browserSwitchTab(workspace.id, nextActiveTabId);
    }
    scheduleBoundsUpdate(true);
  };

  return (
    <div className="browser-panel" ref={containerRef}>
      <div className="browser-pane-header" {...dragHandleProps}>
        <div className="browser-pane-drag-handle" aria-hidden="true" title="Drag to move pane" />
        <span className="browser-pane-title">Browser</span>
        <span className="browser-pane-spacer" />
        {browserLocked ? <Lock size={12} strokeWidth={2} className="browser-pane-lock" /> : null}
      </div>
      <div className="browser-toolbar">
        <button className="browser-nav-btn" onClick={handleBack} disabled={!canGoBack} title="Back">
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <button className="browser-nav-btn" onClick={handleForward} disabled={!canGoForward} title="Forward">
          <ArrowRight size={16} strokeWidth={2} />
        </button>
        <button className="browser-nav-btn" onClick={handleRefresh} title="Refresh">
          <RotateCw size={16} strokeWidth={2} />
        </button>
        <button className="browser-nav-btn browser-stop" onClick={handleStop} title="Stop">
          <X size={16} strokeWidth={2} />
        </button>

        <div className="browser-tab-menu" ref={tabsMenuRef}>
          <button
            className="browser-tab-trigger"
            type="button"
            onClick={() => setTabsOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={tabsOpen}
            title="Browser tabs"
          >
            <span className="browser-tab-count">{browserTabs.length || 1}</span>
            <span className="browser-tab-current">{getTabLabel(activeTab)}</span>
            <ChevronDown size={14} strokeWidth={2} />
          </button>
          {tabsOpen ? (
            <div className="browser-tab-dropdown" role="menu" aria-label="Browser tabs">
              <div className="browser-tab-dropdown-header">
                <span>Tabs</span>
                <button className="browser-tab-add" type="button" onClick={() => void handleNewTab()} title="New tab">
                  <Plus size={14} strokeWidth={2} />
                </button>
              </div>
              <div className="browser-tab-list">
                {browserTabs.map((tab) => {
                  const isActive = tab.id === activeTabId;
                  return (
                    <div
                      key={tab.id}
                      className={`browser-tab-row ${isActive ? 'active' : ''}`}
                      role="menuitem"
                      tabIndex={0}
                      onClick={() => void handleSwitchTab(tab.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void handleSwitchTab(tab.id);
                        }
                      }}
                    >
                      <span className="browser-tab-row-main">
                        <span className="browser-tab-row-title">{getTabLabel(tab)}</span>
                        <span className="browser-tab-row-url">{getTabSubtitle(tab)}</span>
                      </span>
                      <button
                        className="browser-tab-close"
                        type="button"
                        onClick={(event) => void handleCloseTab(event, tab.id)}
                        disabled={browserTabs.length <= 1}
                        title={browserTabs.length <= 1 ? 'Cannot close the last tab' : 'Close tab'}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="browser-url-container">
          <input
            type="text"
            className="browser-url-input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL..."
          />
        </div>

        <button className="browser-go-btn" onClick={() => void handleNavigate()}>
          Go
        </button>

        <button className="browser-nav-btn browser-external" onClick={handleOpenExternal} title="Open in system browser">
          <ExternalLink size={16} strokeWidth={2} />
        </button>

        <button className="browser-nav-btn" onClick={handleBringIntoView} title="Bring browser into view">
          <LocateFixed size={16} strokeWidth={2} />
        </button>

        <button className="browser-nav-btn" onClick={handleToggleLock} title={browserLocked ? 'Unlock browser pane' : 'Lock browser pane'}>
          {browserLocked ? <Unlock size={16} strokeWidth={2} /> : <Lock size={16} strokeWidth={2} />}
        </button>

        <button
          className={`browser-nav-btn ${annotationActive ? 'browser-annotation-active' : ''}`}
          onClick={handleAnnotationToggle}
          title={annotationActive ? 'Exit annotation mode (Esc)' : 'Enter annotation mode'}
        >
          <MousePointer2 size={16} strokeWidth={2} />
        </button>
      </div>
      <div className="browser-content-shell">
        <div className="browser-content" ref={contentRef} />
      </div>
    </div>
  );
}
