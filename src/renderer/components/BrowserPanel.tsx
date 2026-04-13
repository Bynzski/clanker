import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, ExternalLink, LocateFixed, Lock, Unlock } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useScopedWorkspace } from './WorkspaceScope';
import { useDragHandle } from './DynamicPaneLayout';
import './BrowserPanel.css';

interface BrowserPanelProps {
  workspaceId?: string;
  url: string;
  onUrlChange: (url: string) => void;
  layoutVersion: number;
}

export default function BrowserPanel({ workspaceId, url, onUrlChange, layoutVersion }: BrowserPanelProps) {
  const [inputUrl, setInputUrl] = useState(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // Tracks the last bounds sent to main process, used to suppress micro-jitter from
  // DPR rounding noise and unstable intermediate layout measurements.
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const workspace = useScopedWorkspace(workspaceId);
  const { browserOverlayCount, bringBrowserIntoView, toggleBrowserLock } = useWorkspaceStore();
  const browserLocked = workspace?.browserPane?.locked ?? false;
  const dragHandleProps = useDragHandle();

  // Update bounds for the browser content area
  const updateBounds = useCallback(() => {
    if (!contentRef.current || !workspace?.browserVisible || browserOverlayCount > 0 || !workspace.id) return;

    const rect = contentRef.current.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const scale = window.devicePixelRatio || 1;
    const left = rect.left + window.scrollX;
    const top = rect.top + window.scrollY;

    const newBounds = {
      x: Math.round(left * scale),
      y: Math.round(top * scale),
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
    };

    // Suppress micro-jitter: only send IPC if bounds differ by more than 1 physical pixel.
    // DPR rounding can produce ±0.5px noise per axis on successive frames; a 1px threshold
    // eliminates this noise without affecting legitimate layout changes.
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
    window.electronAPI.browserSetBounds(workspace.id, newBounds);
  }, [workspace?.browserVisible, browserOverlayCount, workspace?.id]);

  const scheduleBoundsUpdate = useCallback(() => {
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
    }

    // All resize/layout triggers funnel through a single RAF so DOM reads happen
    // through one scheduler. Later triggers replace earlier pending work so the
    // measurement tracks the most recent settled layout state.
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateBounds();
    });
  }, [updateBounds]);

  useEffect(() => {
    scheduleBoundsUpdate();
  }, [layoutVersion, scheduleBoundsUpdate]);

  // Health check: periodically ensure bounds are in sync (safety net for missed updates)
  useEffect(() => {
    if (!workspace?.browserVisible || browserOverlayCount > 0 || !workspace.id) {
      return;
    }

    const healthCheckInterval = setInterval(() => {
      scheduleBoundsUpdate();
    }, 2000);

    return () => clearInterval(healthCheckInterval);
  }, [workspace?.browserVisible, browserOverlayCount, workspace?.id, scheduleBoundsUpdate]);

  // Observe the outer panel so pane mount/show/layout changes still trigger a follow-up
  // bounds sync even if the inner content element has not emitted its own resize yet.
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      scheduleBoundsUpdate();
    });

    resizeObserver.observe(containerRef.current);

    // Initial bounds update
    scheduleBoundsUpdate();

    return () => {
      resizeObserver.disconnect();
    };
  }, [scheduleBoundsUpdate]);

  // Update bounds on window resize
  useEffect(() => {
    const handleWindowResize = () => {
      scheduleBoundsUpdate();
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
    if (!workspace?.id) {
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
  }, [workspace?.id]);

  // Hide browser view when component unmounts
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      lastBoundsRef.current = null;
      if (workspace?.id) {
        window.electronAPI.browserHide(workspace.id);
      }
    };
  }, [workspace?.id]);

  // Temporarily hide the native browser whenever a modal is open.
  useEffect(() => {
    if (!workspace?.browserVisible || !workspace.id) {
      return;
    }

    if (browserOverlayCount > 0) {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Force a fresh bounds IPC when the browser is shown again after being hidden.
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
  }, [workspace?.browserVisible, browserOverlayCount, scheduleBoundsUpdate, workspace?.id]);

  const handleNavigate = () => {
    let navigateUrl = inputUrl.trim();
    if (!navigateUrl) return;

    // Add protocol if missing
    if (!navigateUrl.startsWith('http://') && !navigateUrl.startsWith('https://')) {
      navigateUrl = 'https://' + navigateUrl;
    }

    if (!workspace?.id) return;
    window.electronAPI.browserNavigate(workspace.id, navigateUrl);
    onUrlChange(navigateUrl);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNavigate();
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
    window.electronAPI.openExternal(url);
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
