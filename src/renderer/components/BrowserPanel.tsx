import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  ChangeEventHandler,
  FocusEventHandler,
  KeyboardEventHandler,
} from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, ExternalLink, MousePointer2 } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { BrowserHistoryEntry } from '../../shared/types/browserHistory';
import { useScopedWorkspace } from './WorkspaceScope';
import { useDragHandle } from './dragHandleContext';
import './BrowserPanel.css';
import BrowserUrlInput from './BrowserUrlInput';
import BrowserTabStrip from './BrowserTabStrip';
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

interface BrowserToolbarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  handleBack: () => void;
  handleForward: () => void;
  handleRefresh: () => void;
  handleStop: () => void;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const pushBrowserOverlay = useWorkspaceStore((state) => state.pushBrowserOverlay);
  const popBrowserOverlay = useWorkspaceStore((state) => state.popBrowserOverlay);
  const removeBrowserTab = useWorkspaceStore((state) => state.removeBrowserTab);
  const setActiveBrowserTab = useWorkspaceStore((state) => state.setActiveBrowserTab);
  const moveBrowserTab = useWorkspaceStore((state) => state.moveBrowserTab);
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
    syncDisplayedUrl(displayedUrl);
    resetAutocompleteState();
  }, [activeTabId, displayedUrl, resetAutocompleteState, syncDisplayedUrl]);

  useEffect(() => {
    if (historySuggestions.length === 0 || !workspace?.id) {
      return;
    }

    pushBrowserOverlay(workspace.id);
    return () => popBrowserOverlay(workspace.id);
  }, [historySuggestions.length, popBrowserOverlay, pushBrowserOverlay, workspace?.id]);

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
    if (!workspace?.id || !isActiveWorkspace) {
      setAnnotationActive(false);
      return;
    }

    let cancelled = false;
    const applyState = (state: {
      enabled: boolean;
      workspaceId: string | null;
    }) => {
      if (!cancelled) {
        setAnnotationActive(state.enabled && state.workspaceId === workspace.id);
      }
    };
    const loadInitialState = async () => {
      try {
        const state = await window.electronAPI.annotationGetState();
        applyState(state);
        if (!cancelled && state.copyTriggered && state.enabled && state.workspaceId === workspace.id) {
          await window.electronAPI.annotationTriggerCopy();
        }
      } catch {
        // Ignore errors
      }
    };

    const unsubscribeState = window.electronAPI.onAnnotationStateChanged(applyState);
    const unsubscribeEscape = window.electronAPI.onAnnotationEscape((payload) => {
      if (payload.workspaceId === workspace.id) {
        setAnnotationActive(false);
      }
    });

    void loadInitialState();
    return () => {
      cancelled = true;
      unsubscribeState();
      unsubscribeEscape();
    };
  }, [isActiveWorkspace, workspace?.id]);

  useEffect(() => {
    if (!workspace?.id || !workspace.browserVisible || !isActiveWorkspace || !annotationActive) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const pollCopyTrigger = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const state = await window.electronAPI.annotationGetState();
        if (cancelled) return;
        setAnnotationActive(state.enabled && state.workspaceId === workspace.id);
        if (state.copyTriggered) {
          await window.electronAPI.annotationTriggerCopy();
        }
      } catch {
        // Ignore transient page-context errors while navigating.
      } finally {
        inFlight = false;
      }
    };

    const interval = setInterval(() => void pollCopyTrigger(), 500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [annotationActive, isActiveWorkspace, workspace?.browserVisible, workspace?.id]);

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
    scheduleBoundsUpdate,
  });

  const handleMoveTab = useCallback(async (tabId: string, targetTabId: string) => {
    if (!workspace?.id || !activeTabId) return;
    const moved = await window.electronAPI.browserMoveTab(workspace.id, tabId, targetTabId, activeTabId);
    if (!moved) return;
    moveBrowserTab(tabId, targetTabId, workspace.id);
    scheduleBoundsUpdate(true);
  }, [activeTabId, moveBrowserTab, scheduleBoundsUpdate, workspace?.id]);

  return (
    <div className="browser-panel" ref={containerRef}>
      <div className="browser-pane-header">
        <div className="pane-drag-surface" title="Drag to move pane" aria-label="Move browser pane" {...dragHandleProps}>
          <div className="browser-pane-drag-handle" aria-hidden="true" />
          <span className="browser-pane-title">Browser</span>
        </div>
        <BrowserTabStrip
          tabs={browserTabs}
          activeTabId={activeTabId}
          onNewTab={() => void handleNewTab()}
          onSwitchTab={(tabId) => void handleSwitchTab(tabId)}
          onCloseTab={(event, tabId) => void handleCloseTab(event, tabId)}
          onMoveTab={(tabId, targetTabId) => void handleMoveTab(tabId, targetTabId)}
        />
      </div>
      <BrowserToolbar
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        handleBack={handleBack}
        handleForward={handleForward}
        handleRefresh={handleRefresh}
        handleStop={handleStop}
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
