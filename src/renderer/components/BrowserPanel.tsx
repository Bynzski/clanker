import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  ReactNode,
  ChangeEventHandler,
  FocusEventHandler,
  KeyboardEventHandler,
  PointerEventHandler,
  Ref,
} from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, ExternalLink, MousePointer2 } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import type { BrowserTab } from '../store/workspaceTypes';
import { createAndActivateBrowserTab, syncSelectedBrowserTab } from '../lib/browserTabActions';
import { useActiveBrowserOwner } from '../lib/activeDestination';
import type { BrowserHistoryEntry } from '../../shared/types/browserHistory';
import type { BrowserKeybindingCommandPayload } from '../../shared/keybindings';
import { useScopedWorkspace } from './WorkspaceScope';
import { useDragHandle } from './dragHandleContext';
import './BrowserPanel.css';
import RemotePreviewControl from './RemotePreviewControl';
import BrowserUrlInput from './BrowserUrlInput';
import BrowserTabStrip from './BrowserTabStrip';
import AnnotationHandoffDialog from './AnnotationHandoffDialog';
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

/**
 * Everything the shared Browser mechanics need from whoever owns the browser. Workspace and Assistant
 * adapters build this from their own state; the core knows nothing about either.
 */
export interface BrowserPanelModel {
  ownerId: string;
  visible: boolean;
  /** This owner is the single active Browser owner (the only one allowed to show a native view). */
  isActiveOwner: boolean;
  tabs: BrowserTab[];
  activeTabId: string | null;
  browserUrl: string;
  overlayCount: number;
  updateTab(tabId: string, partial: Partial<Pick<BrowserTab, 'url' | 'title' | 'canGoBack' | 'canGoForward'>>): void;
  removeTab(tabId: string): { removed: boolean; nextActiveTabId: string | null };
  setActiveTab(tabId: string): boolean;
  moveTab(tabId: string, targetTabId: string): void;
  pushOverlay(): void;
  popOverlay(): void;
  createTab(): Promise<string | null>;
  syncSelectedTab(): Promise<void>;
  features: {
    /** Annotation-to-agent handoff (workspace semantics). */
    annotation: boolean;
    /** The pane header is a workspace drag handle. */
    paneDrag: boolean;
  };
  /** Workspace-only: SSH remote preview control. */
  renderRemotePreview?: (navigate: (url: string) => Promise<string | null>) => ReactNode;
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

  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(navigateUrl)) return `http://${navigateUrl}`;
  return `https://${navigateUrl}`;
}

interface BrowserToolbarProps {
  remotePreviewControl?: ReactNode;
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
  handleAnnotationToggle?: () => Promise<void>;
  urlInputRef: Ref<HTMLInputElement>;
}

function BrowserToolbar({
  remotePreviewControl,
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
  urlInputRef,
}: BrowserToolbarProps) {
  return (
    <div className="browser-toolbar">
      <IconButton variant="ghost" aria-label="Back" className="browser-nav-btn" onClick={handleBack} disabled={!canGoBack} title="Back">
        <ArrowLeft size={16} strokeWidth={2} />
      </IconButton>
      <IconButton variant="ghost" aria-label="Forward" className="browser-nav-btn" onClick={handleForward} disabled={!canGoForward} title="Forward">
        <ArrowRight size={16} strokeWidth={2} />
      </IconButton>
      <IconButton variant="ghost" aria-label="Refresh" className="browser-nav-btn" onClick={handleRefresh} title="Refresh">
        <RotateCw size={16} strokeWidth={2} />
      </IconButton>
      <IconButton variant="ghost" aria-label="Stop" className="browser-nav-btn browser-stop" onClick={handleStop} title="Stop">
        <X size={16} strokeWidth={2} />
      </IconButton>

      <BrowserUrlInput
        inputRef={urlInputRef}
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

      <Button variant="primary" className="browser-go-btn" onClick={() => void submitUrl()}>
        Go
      </Button>

      <IconButton variant="ghost" aria-label="Open in system browser" className="browser-nav-btn browser-external" onClick={handleOpenExternal} title="Open in system browser">
        <ExternalLink size={16} strokeWidth={2} />
      </IconButton>

      {remotePreviewControl}
      {handleAnnotationToggle && (
        <IconButton variant="ghost" aria-label={annotationActive ? 'Exit annotation mode (Esc)' : 'Enter annotation mode'}
          className={`browser-nav-btn ${annotationActive ? 'browser-annotation-active' : ''}`}
          onClick={handleAnnotationToggle}
          title={annotationActive ? 'Exit annotation mode (Esc)' : 'Enter annotation mode'}
        >
          <MousePointer2 size={16} strokeWidth={2} />
        </IconButton>
      )}
    </div>
  );
}

export function BrowserPanelCore({ model, layoutVersion }: { model: BrowserPanelModel; layoutVersion: number }) {
  const { ownerId, tabs: browserTabs, activeTabId, isActiveOwner } = model;
  const activeTab = browserTabs.find((tab) => tab.id === activeTabId) ?? null;
  const displayedUrl = activeTab?.url ?? model.browserUrl;
  const annotationEnabled = model.features.annotation;

  const [canGoBack, setCanGoBack] = useState(activeTab?.canGoBack ?? false);
  const [canGoForward, setCanGoForward] = useState(activeTab?.canGoForward ?? false);
  const containerRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const browserOverlayCount = model.overlayCount;
  const [annotationActive, setAnnotationActive] = useState(false);
  const [handoffQueue, setHandoffQueue] = useState<Array<{ id: number; message: string }>>([]);
  const nextHandoffId = useRef(0);
  const [handoffError, setHandoffError] = useState('');
  const dragHandleProps = useDragHandle();
  // Empty header chrome is a pointer-only drag surface; the title/grip owns keyboard/a11y activation.
  const dragPointerDown = dragHandleProps?.onPointerDown as PointerEventHandler<HTMLDivElement> | undefined;
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    browserReactMount(ownerId);
    return () => {
      browserReactUnmount(ownerId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { scheduleBoundsUpdate } = useBrowserBoundsLifecycle({
    ownerId,
    activeTabId,
    browserVisible: model.visible,
    browserOverlayCount,
    isActiveOwner,
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
    if (!navigateUrl) return null;

    navigateUrl = normalizeBrowserInputUrl(navigateUrl);

    const success = activeTabId
      ? await window.electronAPI.browserTabNavigate(ownerId, activeTabId, navigateUrl)
      : await window.electronAPI.browserNavigate(ownerId, navigateUrl);

    if (!success) {
      return null;
    }

    if (activeTabId) {
      modelRef.current.updateTab(activeTabId, { url: navigateUrl });
    }

    return navigateUrl;
  }, [activeTabId, ownerId]);

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
    if (historySuggestions.length === 0) {
      return;
    }

    modelRef.current.pushOverlay();
    return () => modelRef.current.popOverlay();
  }, [historySuggestions.length]);

  const handleAnnotationActions = useCallback((state: Awaited<ReturnType<typeof window.electronAPI.annotationGetState>>) => {
    const pendingMessages = state.actions.flatMap((action) =>
      action.type === 'send' && action.success && action.message
        ? [{ id: nextHandoffId.current++, message: action.message }]
        : []);
    if (pendingMessages.length > 0) setHandoffQueue((queue) => [...queue, ...pendingMessages]);
    const failure = state.actions.find((action) => !action.success);
    if (state.overflowed) setHandoffError('Too many annotations were requested at once. Select the missed elements again.');
    else if (failure) setHandoffError(failure.error || 'Could not process annotation. Select the element again.');
    else if (state.actions.length > 0) setHandoffError('');
  }, []);

  useEffect(() => {
    if (!isActiveOwner) {
      setCanGoBack(false);
      setCanGoForward(false);
      return;
    }

    let cancelled = false;
    const updateState = async () => {
      try {
        const [back, forward] = await Promise.all([
          window.electronAPI.canGoBack(ownerId),
          window.electronAPI.canGoForward(ownerId),
        ]);
        if (!cancelled) {
          setCanGoBack(back);
          setCanGoForward(forward);
          if (activeTabId) {
            modelRef.current.updateTab(activeTabId, { canGoBack: back, canGoForward: forward });
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
  }, [activeTabId, isActiveOwner, ownerId]);

  useEffect(() => {
    if (!annotationEnabled || !isActiveOwner) {
      setAnnotationActive(false);
      setHandoffQueue([]);
      return;
    }

    let cancelled = false;
    const applyState = (state: {
      enabled: boolean;
      workspaceId: string | null;
    }) => {
      if (!cancelled) {
        setAnnotationActive(state.enabled && state.workspaceId === ownerId);
      }
    };
    const loadInitialState = async () => {
      try {
        const state = await window.electronAPI.annotationGetState();
        applyState(state);
        if (!cancelled && state.enabled && state.workspaceId === ownerId) handleAnnotationActions(state);
      } catch {
        // Ignore errors
      }
    };

    const unsubscribeState = window.electronAPI.onAnnotationStateChanged(applyState);
    const unsubscribeEscape = window.electronAPI.onAnnotationEscape((payload) => {
      if (payload.workspaceId === ownerId) {
        setAnnotationActive(false);
      }
    });

    void loadInitialState();
    return () => {
      cancelled = true;
      unsubscribeState();
      unsubscribeEscape();
    };
  }, [annotationEnabled, handleAnnotationActions, isActiveOwner, ownerId]);

  useEffect(() => {
    if (!annotationEnabled || !model.visible || !isActiveOwner || !annotationActive) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const pollAnnotationActions = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const state = await window.electronAPI.annotationGetState();
        if (cancelled) return;
        setAnnotationActive(state.enabled && state.workspaceId === ownerId);
        if (state.enabled && state.workspaceId === ownerId) handleAnnotationActions(state);
      } catch {
        // Ignore transient page-context errors while navigating.
      } finally {
        inFlight = false;
      }
    };

    const interval = setInterval(() => void pollAnnotationActions(), 500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [annotationActive, annotationEnabled, handleAnnotationActions, isActiveOwner, model.visible, ownerId]);

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
    closeTabById,
  } = useBrowserPanelActions({
    ownerId,
    activeTabId,
    browserTabsCount: browserTabs.length,
    displayedUrl,
    annotationActive,
    setAnnotationActive,
    removeBrowserTab: (tabId) => modelRef.current.removeTab(tabId),
    setActiveBrowserTab: (tabId) => modelRef.current.setActiveTab(tabId),
    createTab: () => modelRef.current.createTab(),
    syncSelectedTab: () => modelRef.current.syncSelectedTab(),
    scheduleBoundsUpdate,
  });

  // Browser-context keybindings are matched in main (the native view owns focus) and
  // arrive here as one typed signal; this runs them through the panel's own actions.
  const runKeybindingCommand = useRef<(payload: BrowserKeybindingCommandPayload) => void>(() => undefined);
  runKeybindingCommand.current = (payload) => {
    if (payload.workspaceId !== ownerId || payload.tabId !== activeTabId) return;
    switch (payload.command) {
      case 'browser.focusAddress':
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
        return;
      case 'browser.newTab':
        void handleNewTab();
        return;
      case 'browser.closeTab':
        if (activeTabId) void closeTabById(activeTabId);
        return;
      case 'browser.nextTab':
      case 'browser.previousTab': {
        if (browserTabs.length < 2) return;
        const index = browserTabs.findIndex((tab) => tab.id === activeTabId);
        if (index === -1) return;
        const step = payload.command === 'browser.nextTab' ? 1 : -1;
        void handleSwitchTab(browserTabs[(index + step + browserTabs.length) % browserTabs.length].id);
        return;
      }
    }
  };

  useEffect(() => {
    if (typeof window.electronAPI?.onBrowserKeybindingCommand !== 'function') return undefined;
    return window.electronAPI.onBrowserKeybindingCommand((payload) => runKeybindingCommand.current(payload));
  }, []);

  const handleMoveTab = useCallback(async (tabId: string, targetTabId: string) => {
    if (!activeTabId) return;
    const moved = await window.electronAPI.browserMoveTab(ownerId, tabId, targetTabId, activeTabId);
    if (!moved) return;
    modelRef.current.moveTab(tabId, targetTabId);
    scheduleBoundsUpdate(true);
  }, [activeTabId, ownerId, scheduleBoundsUpdate]);

  return (
    <div className="browser-panel" ref={containerRef}>
      <div className="browser-pane-header">
        {model.features.paneDrag ? (
          <div className="pane-drag-surface" title="Drag to move pane" aria-label="Move browser pane" {...dragHandleProps}>
            <div className="browser-pane-drag-handle" aria-hidden="true" />
            <span className="browser-pane-title">Browser</span>
          </div>
        ) : (
          <div className="pane-drag-surface"><span className="browser-pane-title">Browser</span></div>
        )}
        <BrowserTabStrip
          tabs={browserTabs}
          activeTabId={activeTabId}
          onNewTab={() => void handleNewTab()}
          onSwitchTab={(tabId) => void handleSwitchTab(tabId)}
          onCloseTab={(event, tabId) => void handleCloseTab(event, tabId)}
          onMoveTab={(tabId, targetTabId) => void handleMoveTab(tabId, targetTabId)}
        />
        <div className="browser-pane-drag-fill" aria-hidden="true" data-testid="browser-header-drag-fill" onPointerDown={model.features.paneDrag ? dragPointerDown : undefined} />
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
        handleAnnotationToggle={annotationEnabled ? handleAnnotationToggle : undefined}
        urlInputRef={urlInputRef}
        remotePreviewControl={model.renderRemotePreview?.(handleNavigate)}
      />
      {handoffError && <div className="browser-annotation-error" role="alert">{handoffError}</div>}
      <div className="browser-content-shell">
        <div className="browser-content" ref={contentRef} />
      </div>
      {annotationEnabled && handoffQueue[0] && <AnnotationHandoffDialog key={handoffQueue[0].id} sourceWorkspaceId={ownerId} initialMessage={handoffQueue[0].message} onClose={() => setHandoffQueue((queue) => queue.slice(1))} />}
    </div>
  );
}

/** Workspace adapter: state from the workspace store; annotation and SSH remote preview enabled. */
export default function BrowserPanel({ workspaceId, layoutVersion }: BrowserPanelProps) {
  const workspace = useScopedWorkspace(workspaceId);
  const activeOwner = useActiveBrowserOwner();
  const pushBrowserOverlay = useWorkspaceStore((state) => state.pushBrowserOverlay);
  const popBrowserOverlay = useWorkspaceStore((state) => state.popBrowserOverlay);
  const removeBrowserTab = useWorkspaceStore((state) => state.removeBrowserTab);
  const setActiveBrowserTab = useWorkspaceStore((state) => state.setActiveBrowserTab);
  const moveBrowserTab = useWorkspaceStore((state) => state.moveBrowserTab);
  const updateBrowserTab = useWorkspaceStore((state) => state.updateBrowserTab);
  const id = workspace?.id ?? '';
  const assistantActive = useAssistantNavStore((state) => state.activeAssistantId !== null);
  const model = useMemo<BrowserPanelModel | null>(() => {
    if (!workspace) return null;
    const remote = workspace.environmentId && workspace.environmentId !== 'local';
    return {
      ownerId: id,
      visible: workspace.browserVisible,
      // A workspace owns the native view only while it is the single active Browser owner.
      isActiveOwner: !assistantActive && activeOwner === id,
      tabs: workspace.browserPane?.tabs ?? [],
      activeTabId: workspace.browserPane?.activeTabId ?? null,
      browserUrl: workspace.browserUrl ?? '',
      overlayCount: workspace.browserOverlayCount ?? 0,
      updateTab: (tabId, partial) => { updateBrowserTab(tabId, partial, id); },
      removeTab: (tabId) => removeBrowserTab(tabId, id),
      setActiveTab: (tabId) => setActiveBrowserTab(tabId, id),
      moveTab: (tabId, targetTabId) => moveBrowserTab(tabId, targetTabId, id),
      pushOverlay: () => pushBrowserOverlay(id),
      popOverlay: () => popBrowserOverlay(id),
      createTab: () => createAndActivateBrowserTab(id),
      syncSelectedTab: () => syncSelectedBrowserTab(id),
      features: { annotation: true, paneDrag: true },
      renderRemotePreview: remote
        ? (navigate) => <RemotePreviewControl key={id} workspaceId={id} enabled={!assistantActive && activeOwner === id && Boolean(workspace.browserVisible)} onOpen={navigate} />
        : undefined,
    };
  }, [workspace, id, activeOwner, assistantActive, updateBrowserTab, removeBrowserTab, setActiveBrowserTab, moveBrowserTab, pushBrowserOverlay, popBrowserOverlay]);
  if (!model) return null;
  return <BrowserPanelCore model={model} layoutVersion={layoutVersion} />;
}
