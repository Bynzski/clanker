import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, ExternalLink, LocateFixed, Lock, Unlock } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useDragHandle } from './DynamicPaneLayout';
import './BrowserPanel.css';

interface BrowserPanelProps {
  url: string;
  onUrlChange: (url: string) => void;
  layoutVersion: number;
}

export default function BrowserPanel({ url, onUrlChange, layoutVersion }: BrowserPanelProps) {
  const [inputUrl, setInputUrl] = useState(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rafRef = useRef<number | null>(null);
  const { browserPane, browserVisible, browserOverlayCount, bringBrowserIntoView, toggleBrowserLock, activeWorkspaceId } = useWorkspaceStore();
  const browserLocked = browserPane?.locked ?? false;
  const dragHandleProps = useDragHandle();

  // Update bounds for the browser content area
  const updateBounds = useCallback(() => {
    if (!contentRef.current || !browserVisible || browserOverlayCount > 0 || !activeWorkspaceId) return;

    const rect = contentRef.current.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const scale = window.devicePixelRatio || 1;
    const left = rect.left + window.scrollX;
    const top = rect.top + window.scrollY;

    window.electronAPI.browserSetBounds(activeWorkspaceId, {
      x: Math.round(left * scale),
      y: Math.round(top * scale),
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
    });
  }, [browserVisible, browserOverlayCount, activeWorkspaceId]);

  const scheduleBoundsUpdate = useCallback(() => {
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
    const frame = window.requestAnimationFrame(scheduleBoundsUpdate);

    return () => window.cancelAnimationFrame(frame);
  }, [layoutVersion, scheduleBoundsUpdate]);

  // Health check: periodically ensure bounds are in sync (safety net for missed updates)
  useEffect(() => {
    if (!browserVisible || browserOverlayCount > 0 || !activeWorkspaceId) {
      return;
    }

    const healthCheckInterval = setInterval(() => {
      scheduleBoundsUpdate();
    }, 2000);

    return () => clearInterval(healthCheckInterval);
  }, [browserVisible, browserOverlayCount, activeWorkspaceId, scheduleBoundsUpdate]);

  // Set up resize observer to track container size changes
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      // Debounce to avoid excessive updates
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(scheduleBoundsUpdate, 16); // ~60fps
    });

    resizeObserver.observe(containerRef.current);

    // Initial bounds update
    scheduleBoundsUpdate();

    return () => {
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [scheduleBoundsUpdate]);

  // Update bounds on window resize
  useEffect(() => {
    const handleWindowResize = () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(scheduleBoundsUpdate, 16);
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [scheduleBoundsUpdate]);

  // Sync URL input when prop changes
  useEffect(() => {
    setInputUrl(url);
  }, [url]);

  // Poll for navigation state
  useEffect(() => {
    if (!activeWorkspaceId) {
      setCanGoBack(false);
      setCanGoForward(false);
      return;
    }

    let cancelled = false;
    const updateState = async () => {
      try {
        const [back, forward] = await Promise.all([
          window.electronAPI.canGoBack(activeWorkspaceId),
          window.electronAPI.canGoForward(activeWorkspaceId),
        ]);
        if (!cancelled) {
          setCanGoBack(back);
          setCanGoForward(forward);
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
  }, [activeWorkspaceId]);

  // Hide browser view when component unmounts
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      if (activeWorkspaceId) {
        window.electronAPI.browserHide(activeWorkspaceId);
      }
    };
  }, [activeWorkspaceId]);

  // Temporarily hide the native browser whenever a modal is open.
  useEffect(() => {
    if (!browserVisible || !activeWorkspaceId) {
      return;
    }

    if (browserOverlayCount > 0) {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      window.electronAPI.browserHide(activeWorkspaceId);
      return;
    }

    scheduleBoundsUpdate();
  }, [browserVisible, browserOverlayCount, scheduleBoundsUpdate, activeWorkspaceId]);

  const handleNavigate = () => {
    let navigateUrl = inputUrl.trim();
    if (!navigateUrl) return;

    // Add protocol if missing
    if (!navigateUrl.startsWith('http://') && !navigateUrl.startsWith('https://')) {
      navigateUrl = 'https://' + navigateUrl;
    }

    if (!activeWorkspaceId) return;
    window.electronAPI.browserNavigate(activeWorkspaceId, navigateUrl);
    onUrlChange(navigateUrl);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNavigate();
    }
  };

  const handleBack = () => {
    if (!activeWorkspaceId) return;
    window.electronAPI.browserBack(activeWorkspaceId);
  };

  const handleForward = () => {
    if (!activeWorkspaceId) return;
    window.electronAPI.browserForward(activeWorkspaceId);
  };

  const handleRefresh = () => {
    if (!activeWorkspaceId) return;
    window.electronAPI.browserRefresh(activeWorkspaceId);
  };

  const handleStop = () => {
    if (!activeWorkspaceId) return;
    window.electronAPI.browserStop(activeWorkspaceId);
  };

  const handleOpenExternal = () => {
    window.electronAPI.openExternal(url);
  };

  const handleBringIntoView = () => {
    bringBrowserIntoView();
  };

  const handleToggleLock = () => {
    toggleBrowserLock();
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
        <button
          className="browser-nav-btn"
          onClick={handleBack}
          disabled={!canGoBack}
          title="Back"
        >
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <button
          className="browser-nav-btn"
          onClick={handleForward}
          disabled={!canGoForward}
          title="Forward"
        >
          <ArrowRight size={16} strokeWidth={2} />
        </button>
        <button
          className="browser-nav-btn"
          onClick={handleRefresh}
          title="Refresh"
        >
          <RotateCw size={16} strokeWidth={2} />
        </button>
        <button
          className="browser-nav-btn browser-stop"
          onClick={handleStop}
          title="Stop"
        >
          <X size={16} strokeWidth={2} />
        </button>

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

        <button className="browser-go-btn" onClick={handleNavigate}>
          Go
        </button>

        <button
          className="browser-nav-btn browser-external"
          onClick={handleOpenExternal}
          title="Open in system browser"
        >
          <ExternalLink size={16} strokeWidth={2} />
        </button>

        <button
          className="browser-nav-btn"
          onClick={handleBringIntoView}
          title="Bring browser into view"
        >
          <LocateFixed size={16} strokeWidth={2} />
        </button>

        <button
          className="browser-nav-btn"
          onClick={handleToggleLock}
          title={browserLocked ? 'Unlock browser pane' : 'Lock browser pane'}
        >
          {browserLocked ? <Unlock size={16} strokeWidth={2} /> : <Lock size={16} strokeWidth={2} />}
        </button>
      </div>
      <div className="browser-content-shell">
        <div className="browser-content" ref={contentRef} />
      </div>
    </div>
  );
}
