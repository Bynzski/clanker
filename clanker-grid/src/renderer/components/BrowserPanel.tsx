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
  const { browserPane, bringBrowserIntoView, toggleBrowserLock } = useWorkspaceStore();
  const browserLocked = browserPane?.locked ?? false;
  const dragHandleProps = useDragHandle();

  // Update bounds for the browser content area
  const updateBounds = useCallback(() => {
    if (!contentRef.current) return;

    const rect = contentRef.current.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const scale = window.devicePixelRatio || 1;
    const left = rect.left + window.scrollX;
    const top = rect.top + window.scrollY;

    window.electronAPI.browserSetBounds({
      x: Math.round(left * scale),
      y: Math.round(top * scale),
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateBounds();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [layoutVersion, updateBounds]);

  // Set up resize observer to track container size changes
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      // Debounce to avoid excessive updates
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(updateBounds, 16); // ~60fps
    });

    resizeObserver.observe(containerRef.current);

    // Initial bounds update
    updateBounds();

    return () => {
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [updateBounds]);

  // Update bounds on window resize
  useEffect(() => {
    const handleWindowResize = () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(updateBounds, 16);
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [updateBounds]);

  // Sync URL input when prop changes
  useEffect(() => {
    setInputUrl(url);
  }, [url]);

  // Poll for navigation state
  useEffect(() => {
    const updateState = async () => {
      try {
        setCanGoBack(await window.electronAPI.canGoBack());
        setCanGoForward(await window.electronAPI.canGoForward());
      } catch (e) {
        // Ignore errors
      }
    };

    updateState();
    const interval = setInterval(updateState, 500);
    return () => clearInterval(interval);
  }, []);

  // Hide browser view when component unmounts
  useEffect(() => {
    return () => {
      window.electronAPI.browserHide();
    };
  }, []);

  const handleNavigate = () => {
    let navigateUrl = inputUrl.trim();
    if (!navigateUrl) return;

    // Add protocol if missing
    if (!navigateUrl.startsWith('http://') && !navigateUrl.startsWith('https://')) {
      navigateUrl = 'https://' + navigateUrl;
    }

    window.electronAPI.browserNavigate(navigateUrl);
    onUrlChange(navigateUrl);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNavigate();
    }
  };

  const handleBack = () => {
    window.electronAPI.browserBack();
  };

  const handleForward = () => {
    window.electronAPI.browserForward();
  };

  const handleRefresh = () => {
    window.electronAPI.browserRefresh();
  };

  const handleStop = () => {
    window.electronAPI.browserStop();
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
      <div className="browser-toolbar" {...dragHandleProps}>
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
