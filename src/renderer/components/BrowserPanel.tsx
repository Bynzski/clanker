import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  RefObject,
  ChangeEventHandler,
  FocusEventHandler,
  KeyboardEventHandler,
} from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, ExternalLink, MousePointer2, ChevronDown, Plus } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { BrowserHistoryEntry } from '../../shared/types/browserHistory';
import type { BrowserTab } from '../store/workspaceTypes';
import { useScopedWorkspace } from './WorkspaceScope';
import { useDragHandle } from './dragHandleContext';
import './BrowserPanel.css';
import BrowserUrlInput from './BrowserUrlInput';
import { useBrowserUrlAutocomplete } from './useBrowserUrlAutocomplete';
import { useBrowserPanelActions } from './useBrowserPanelActions';
import { useBrowserBoundsLifecycle } from './useBrowserBoundsLifecycle';
import {
  browserReactMount,
  browserReactUnmount,
} from '../lib/workspaceSwitchDebug';

interface BrowserPanelProps {
  workspaceId?: string;
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

function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function normalizeBrowserInputUrl(rawUrl: string): string {
  const navigateUrl = rawUrl.trim();
  const lowerUrl = navigateUrl.toLowerCase();

  if (lowerUrl.startsWith('file://') || lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
    return navigateUrl;
  }

  if (navigateUrl.startsWith('/')) {
    return `file://${navigateUrl}`;
  }

  if (isWindowsDrivePath(navigateUrl)) {
    return `file:///${navigateUrl.replace(/\\/g, '/')}`;
  }

  return `https://${navigateUrl}`;
}

function getTabSubtitle(tab: BrowserTab): string {
  try {
    const parsed = new URL(tab.url);
    return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return tab.url;
  }
}

interface BrowserTabMenuProps {
  tabsMenuRef: RefObject<HTMLDivElement | null>;
  tabsOpen: boolean;
  browserTabs: BrowserTab[];
  activeTab: BrowserTab | null;
  activeTabId: string | null;
  onToggle: () => void;
  onNewTab: () => void;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (event: ReactMouseEvent, tabId: string) => void;
}

function BrowserTabMenu({
  tabsMenuRef,
  tabsOpen,
  browserTabs,
  activeTab,
  activeTabId,
  onToggle,
  onNewTab,
  onSwitchTab,
  onCloseTab,
}: BrowserTabMenuProps) {
  return (
    <div className="browser-tab-menu" ref={tabsMenuRef}>
      <button
        className="browser-tab-trigger"
        type="button"
        onClick={onToggle}
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
            <button className="browser-tab-add" type="button" onClick={onNewTab} title="New tab">
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
                  onClick={() => onSwitchTab(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSwitchTab(tab.id);
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
                    onClick={(event) => onCloseTab(event, tab.id)}
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
  );
}

interface BrowserToolbarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  handleBack: () => void;
  handleForward: () => void;
  handleRefresh: () => void;
  handleStop: () => void;
  tabsMenuRef: RefObject<HTMLDivElement | null>;
  tabsOpen: boolean;
  browserTabs: BrowserTab[];
  activeTab: BrowserTab | null;
  activeTabId: string | null;
  setTabsOpen: (value: boolean | ((open: boolean) => boolean)) => void;
  handleNewTab: () => Promise<void>;
  handleSwitchTab: (tabId: string) => Promise<void>;
  handleCloseTab: (event: ReactMouseEvent, tabId: string) => Promise<void>;
  inputUrl: string;
  historySuggestions: BrowserHistoryEntry[];
  highlightedSuggestionIndex: number;
  handleInputChange: ChangeEventHandler<HTMLInputElement>;
  handleInputFocus: FocusEventHandler<HTMLInputElement>;
  handleInputBlur: FocusEventHandler<HTMLInputElement>;
  handleInputKeyDown: KeyboardEventHandler<HTMLInputElement>;
  setHighlightedSuggestionIndex: (index: number) => void;
  handleSuggestionClick: (entry: BrowserHistoryEntry) => void;
  submitUrl: () => Promise<void>;
  handleOpenExternal: () => void;
  annotationActive: boolean;
  handleAnnotationToggle: () => Promise<void>;
}

function BrowserToolbar({
  canGoBack,
  canGoForward,
  handleBack,
  handleForward,
  handleRefresh,
  handleStop,
  tabsMenuRef,
  tabsOpen,
  browserTabs,
  activeTab,
  activeTabId,
  setTabsOpen,
  handleNewTab,
  handleSwitchTab,
  handleCloseTab,
  inputUrl,
  historySuggestions,
  highlightedSuggestionIndex,
  handleInputChange,
  handleInputFocus,
  handleInputBlur,
  handleInputKeyDown,
  setHighlightedSuggestionIndex,
  handleSuggestionClick,
  submitUrl,
  handleOpenExternal,
  annotationActive,
  handleAnnotationToggle,
}: BrowserToolbarProps) {
  return (
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

      <BrowserTabMenu
        tabsMenuRef={tabsMenuRef}
        tabsOpen={tabsOpen}
        browserTabs={browserTabs}
        activeTab={activeTab}
        activeTabId={activeTabId}
        onToggle={() => setTabsOpen((open) => !open)}
        onNewTab={() => {
          void handleNewTab();
        }}
        onSwitchTab={(tabId) => {
          void handleSwitchTab(tabId);
        }}
        onCloseTab={(event, tabId) => {
          void handleCloseTab(event, tabId);
        }}
      />

      <BrowserUrlInput
        inputUrl={inputUrl}
        historySuggestions={historySuggestions}
        highlightedSuggestionIndex={highlightedSuggestionIndex}
        onInputChange={handleInputChange}
        onInputFocus={handleInputFocus}
        onInputBlur={handleInputBlur}
        onInputKeyDown={handleInputKeyDown}
        onHighlightSuggestion={setHighlightedSuggestionIndex}
        onSuggestionClick={handleSuggestionClick}
      />

      <button className="browser-go-btn" onClick={() => void submitUrl()}>
        Go
      </button>

      <button className="browser-nav-btn browser-external" onClick={handleOpenExternal} title="Open in system browser">
        <ExternalLink size={16} strokeWidth={2} />
      </button>

      <button
        className={`browser-nav-btn ${annotationActive ? 'browser-annotation-active' : ''}`}
        onClick={handleAnnotationToggle}
        title={annotationActive ? 'Exit annotation mode (Esc)' : 'Enter annotation mode'}
      >
        <MousePointer2 size={16} strokeWidth={2} />
      </button>
    </div>
  );
}

export default function BrowserPanel({ workspaceId, layoutVersion }: BrowserPanelProps) {
  const workspace = useScopedWorkspace(workspaceId);
  const activeTab = workspace?.browserPane?.tabs.find((tab) => tab.id === workspace.browserPane?.activeTabId) ?? null;
  const activeTabId = activeTab?.id ?? null;
  const displayedUrl = activeTab?.url ?? workspace?.browserUrl ?? '';

  const [canGoBack, setCanGoBack] = useState(activeTab?.canGoBack ?? false);
  const [canGoForward, setCanGoForward] = useState(activeTab?.canGoForward ?? false);
  const [tabsOpen, setTabsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const tabsMenuRef = useRef<HTMLDivElement>(null);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const pushBrowserOverlay = useWorkspaceStore((state) => state.pushBrowserOverlay);
  const popBrowserOverlay = useWorkspaceStore((state) => state.popBrowserOverlay);
  const removeBrowserTab = useWorkspaceStore((state) => state.removeBrowserTab);
  const setActiveBrowserTab = useWorkspaceStore((state) => state.setActiveBrowserTab);
  const updateBrowserTab = useWorkspaceStore((state) => state.updateBrowserTab);
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

  const { scheduleBoundsUpdate } = useBrowserBoundsLifecycle({
    workspaceId: workspace?.id,
    activeTabId,
    browserVisible: workspace?.browserVisible,
    browserOverlayCount,
    isActiveWorkspace,
    layoutVersion,
    containerRef,
    contentRef,
  });

  useEffect(() => {
    if (activeTab) {
      setCanGoBack(activeTab.canGoBack);
      setCanGoForward(activeTab.canGoForward);
    }
  }, [activeTab]);

  const handleNavigate = useCallback(async (rawUrl: string): Promise<string | null> => {
    let navigateUrl = rawUrl.trim();
    if (!navigateUrl || !workspace?.id) return null;

    navigateUrl = normalizeBrowserInputUrl(navigateUrl);

    const success = activeTabId
      ? await window.electronAPI.browserTabNavigate(workspace.id, activeTabId, navigateUrl)
      : await window.electronAPI.browserNavigate(workspace.id, navigateUrl);

    if (!success) {
      return null;
    }

    if (activeTabId) {
      updateBrowserTab(activeTabId, { url: navigateUrl }, workspace.id);
    }

    return navigateUrl;
  }, [activeTabId, updateBrowserTab, workspace?.id]);

  const {
    inputUrl,
    historySuggestions,
    highlightedSuggestionIndex,
    handleInputChange,
    handleInputFocus,
    handleInputBlur,
    handleInputKeyDown,
    setHighlightedSuggestionIndex,
    handleSuggestionClick,
    submitUrl,
    syncDisplayedUrl,
    resetAutocompleteState,
  } = useBrowserUrlAutocomplete({
    displayedUrl,
    activeTabId,
    getHistory: window.electronAPI.browserHistoryGet,
    onNavigate: handleNavigate,
  });

  useEffect(() => {
    setTabsOpen(false);
    syncDisplayedUrl(displayedUrl);
    resetAutocompleteState();
  }, [activeTabId, displayedUrl, resetAutocompleteState, syncDisplayedUrl]);

  useEffect(() => {
    const overlayOpen = tabsOpen || historySuggestions.length > 0;
    if (!overlayOpen || !workspace?.id) {
      return;
    }

    pushBrowserOverlay(workspace.id);
    return () => popBrowserOverlay(workspace.id);
  }, [historySuggestions.length, popBrowserOverlay, pushBrowserOverlay, tabsOpen, workspace?.id]);

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

  const {
    handleBack,
    handleForward,
    handleRefresh,
    handleStop,
    handleOpenExternal,
    handleAnnotationToggle,
    handleNewTab,
    handleSwitchTab,
    handleCloseTab,
  } = useBrowserPanelActions({
    workspaceId: workspace?.id ?? null,
    activeTabId,
    browserTabsCount: browserTabs.length,
    displayedUrl,
    annotationActive,
    setAnnotationActive,
    removeBrowserTab,
    setActiveBrowserTab,
    onTabMenuClose: () => setTabsOpen(false),
    scheduleBoundsUpdate,
  });

  return (
    <div className="browser-panel" ref={containerRef}>
      <div className="browser-pane-header">
        <div className="pane-drag-surface" title="Drag to move pane" aria-label="Move browser pane" {...dragHandleProps}>
          <div className="browser-pane-drag-handle" aria-hidden="true" />
          <span className="browser-pane-title">Browser</span>
          <span className="browser-pane-spacer" />
        </div>
      </div>
      <BrowserToolbar
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        handleBack={handleBack}
        handleForward={handleForward}
        handleRefresh={handleRefresh}
        handleStop={handleStop}
        tabsMenuRef={tabsMenuRef}
        tabsOpen={tabsOpen}
        browserTabs={browserTabs}
        activeTab={activeTab}
        activeTabId={activeTabId}
        setTabsOpen={setTabsOpen}
        handleNewTab={handleNewTab}
        handleSwitchTab={handleSwitchTab}
        handleCloseTab={handleCloseTab}
        inputUrl={inputUrl}
        historySuggestions={historySuggestions}
        highlightedSuggestionIndex={highlightedSuggestionIndex}
        handleInputChange={handleInputChange}
        handleInputFocus={handleInputFocus}
        handleInputBlur={handleInputBlur}
        handleInputKeyDown={handleInputKeyDown}
        setHighlightedSuggestionIndex={setHighlightedSuggestionIndex}
        handleSuggestionClick={handleSuggestionClick}
        submitUrl={submitUrl}
        handleOpenExternal={handleOpenExternal}
        annotationActive={annotationActive}
        handleAnnotationToggle={handleAnnotationToggle}
      />
      <div className="browser-content-shell">
        <div className="browser-content" ref={contentRef} />
      </div>
    </div>
  );
}
