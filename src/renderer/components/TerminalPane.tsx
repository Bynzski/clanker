import { useEffect, useRef, useState, useCallback, type DragEvent } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { LocateFixed, Lock, Unlock } from 'lucide-react';
import { useDragHandle } from './DynamicPaneLayout';
import { useScopedWorkspace, useScopedWorkspaceActivity } from './WorkspaceScope';
import './TerminalPane.css';
import '@xterm/xterm/css/xterm.css';

import { TERMINAL_SCROLLBACK_LINES } from '../../shared/terminal';
import {
  terminalCacheHit,
  terminalCacheMiss,
  terminalDetach,
} from '../lib/workspaceSwitchDebug';

type XTermInstance = import('@xterm/xterm').Terminal;
type FitAddonInstance = import('@xterm/addon-fit').FitAddon;

interface Props {
  workspaceId?: string;
  paneId: string;
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// xterm instance cache — preserves terminal state across workspace/tab switches
// ---------------------------------------------------------------------------
// When a TerminalPane unmounts (e.g., user switches workspace tabs), the xterm
// instance is cached here instead of being disposed. When a new TerminalPane
// mounts for the same terminalId, the cached instance is reused — preserving
// scrollback, cursor position, and running PTY session state.
//
// Entries are removed when a terminal is intentionally closed. Natural PTY
// exit keeps the cached xterm around so the finished session remains visible
// when the workspace is revisited.
// ---------------------------------------------------------------------------

interface CachedTerminal {
  xterm: XTermInstance;
  fitAddon: FitAddonInstance;
}

const xtermCache = new Map<string, CachedTerminal>();
const disposedTerminalIds = new Set<string>();

export function cacheTerminalInstance(terminalId: string, xterm: XTermInstance, fitAddon: FitAddonInstance): void {
  if (disposedTerminalIds.has(terminalId)) {
    xterm.dispose();
    return;
  }

  xtermCache.set(terminalId, { xterm, fitAddon });
}

export function writeCachedTerminalData(terminalId: string, data: string): boolean {
  const cached = xtermCache.get(terminalId);
  if (!cached) {
    return false;
  }

  cached.xterm.write(data);
  return true;
}

export function writeCachedTerminalExit(terminalId: string, exitCode: number): boolean {
  const cached = xtermCache.get(terminalId);
  if (!cached) {
    return false;
  }

  cached.xterm.write(`\r\n\x1b[33mProcess exited with code ${exitCode}\x1b[0m\r\n`);
  return true;
}

/**
 * Remove a cached xterm instance.
 * Disposes the xterm and removes it from the cache.
 */
export function evictCachedTerminal(terminalId: string): void {
  const cached = xtermCache.get(terminalId);
  if (cached) {
    cached.xterm.dispose();
    xtermCache.delete(terminalId);
  }
}

export function markTerminalDisposed(terminalId: string): void {
  disposedTerminalIds.add(terminalId);
  evictCachedTerminal(terminalId);
}

export function isTerminalDisposed(terminalId: string): boolean {
  return disposedTerminalIds.has(terminalId);
}

/**
 * Clear all cached xterm instances. Used in tests to ensure isolation.
 */
export function clearTerminalCache(): void {
  for (const [, cached] of xtermCache) {
    cached.xterm.dispose();
  }
  xtermCache.clear();
  disposedTerminalIds.clear();
}

// ---------------------------------------------------------------------------
// Resize lock — coalesces rapid resize calls during pane drag
// ---------------------------------------------------------------------------
// Only one resize IPC call may be in-flight at a time. Intermediate resize
// events are queued; only the latest dimensions are sent after the lock
// expires (100 ms). This prevents IPC flooding during rapid pane drag.
// ---------------------------------------------------------------------------

const RESIZE_LOCK_MS = 100;

export default function TerminalPane({ workspaceId, paneId, compact = false }: Props) {
  const paneRootRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermInstance | null>(null);
  const fitAddonRef = useRef<FitAddonInstance | null>(null);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resizeLockRef = useRef<NodeJS.Timeout | null>(null);
  const pendingResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [terminalRuntimeReady, setTerminalRuntimeReady] = useState(false);
  const dragHandleProps = useDragHandle();
  const workspace = useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);

  const {
    setActiveTerminal,
    removeTerminal,
    removePane,
    bringPaneIntoView,
    togglePaneLock,
  } = useWorkspaceStore();
  const pane = workspace?.panes.find((item) => item.id === paneId);
  const terminal = workspace?.terminals.find((item) => item.id === pane?.terminalId);
  const terminalId = terminal?.id ?? null;
  const paneLocked = pane?.locked ?? false;
  const headerDragHandleProps = isInteractive ? dragHandleProps : undefined;

  // -------------------------------------------------------------------------
  // Core resize logic — sends dimensions to main with lock coalescing
  // -------------------------------------------------------------------------
  const doResize = useCallback((cols: number, rows: number) => {
    if (terminalId == null) return;
    window.electronAPI.resizeTerminal(terminalId, cols, rows).catch(console.error);
  }, [terminalId]);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (resizeLockRef.current !== null) {
      // Already in a lock window — queue latest dimensions, drop intermediates
      pendingResizeRef.current = { cols, rows };
      return;
    }
    doResize(cols, rows);
    resizeLockRef.current = setTimeout(() => {
      resizeLockRef.current = null;
      if (pendingResizeRef.current) {
        const { cols: c, rows: r } = pendingResizeRef.current;
        pendingResizeRef.current = null;
        doResize(c, r);
      }
    }, RESIZE_LOCK_MS);
  }, [doResize]);

  const fitAndResize = useCallback(() => {
    if (fitAddonRef.current == null || xtermRef.current == null) return;
    fitAddonRef.current.fit();
    const dims = fitAddonRef.current.proposeDimensions();
    if (dims != null) {
      sendResize(dims.cols, dims.rows);
    }
  }, [sendResize]);

  // -------------------------------------------------------------------------
  // Interaction boundary — parked workspaces stay mounted but non-interactive.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (paneRootRef.current == null) {
      return;
    }

    paneRootRef.current.inert = !isInteractive;
    paneRootRef.current.setAttribute('aria-hidden', isInteractive ? 'false' : 'true');

    if (!isInteractive && paneRootRef.current.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }, [isInteractive]);

  // -------------------------------------------------------------------------
  // xterm lifecycle — create or restore from cache
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (terminalRef.current == null) return;

    let cancelled = false;
    let handleResize: (() => void) | null = null;
    setTerminalRuntimeReady(false);

    // Check for a cached xterm instance (workspace tab switch restore)
    const cached = terminalId != null ? xtermCache.get(terminalId) : null;

    if (cached) {
      // Reuse cached xterm — just reattach to the new DOM container
      if (terminalRef.current && cached.xterm.element) {
        terminalRef.current.appendChild(cached.xterm.element);
      }
      xtermRef.current = cached.xterm;
      fitAddonRef.current = cached.fitAddon;
      if (terminalId != null) {
        xtermCache.set(terminalId, cached);
      }
      terminalCacheHit(terminalId, workspaceId ?? undefined);
      setTerminalRuntimeReady(true);

      // Re-fit to the new container dimensions
      setTimeout(() => {
        if (!cancelled) {
          cached.fitAddon.fit();
          const dims = cached.fitAddon.proposeDimensions();
          if (dims != null) {
            sendResize(dims.cols, dims.rows);
          }
        }
      }, 50);
    } else {
      // No cached instance — create a new one
      terminalCacheMiss(terminalId ?? 'unknown', workspaceId ?? undefined);
      void Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]).then(([xtermModule, fitAddonModule]) => {
        if (cancelled || terminalRef.current == null) {
          return;
        }

        const xterm = new xtermModule.Terminal({
          allowTransparency: true,
          theme: {
            background: '#121212',
            foreground: '#e8e8e8',
            cursor: '#8b949e',
            cursorAccent: '#121212',
            selectionBackground: '#2f2f2f',
            black: '#121212',
            red: '#f85149',
            green: '#3fb950',
            yellow: '#d29922',
            blue: '#58a6ff',
            magenta: '#bc8cff',
            cyan: '#39c5cf',
            white: '#e8e8e8',
            brightBlack: '#9b9b9b',
            brightRed: '#ffa198',
            brightGreen: '#56d364',
            brightYellow: '#e3b341',
            brightBlue: '#79c0ff',
            brightMagenta: '#d2a8ff',
            brightCyan: '#56d4dd',
            brightWhite: '#ffffff',
          },
          fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Fira Mono", Menlo, Consolas, monospace',
          fontSize: 13,
          fontWeight: '400',
          fontWeightBold: '700',
          lineHeight: 1,
          letterSpacing: 0,
          cursorBlink: true,
          cursorStyle: 'bar',
          cursorInactiveStyle: 'underline',
          allowProposedApi: true,
          macOptionClickForcesSelection: true,
          macOptionIsMeta: true,
          scrollback: TERMINAL_SCROLLBACK_LINES,
        });

        const fitAddon = new fitAddonModule.FitAddon();
        xterm.loadAddon(fitAddon);
        xterm.open(terminalRef.current);
        fitAddon.fit();

        xtermRef.current = xterm;
        fitAddonRef.current = fitAddon;
        if (terminalId != null) {
          cacheTerminalInstance(terminalId, xterm, fitAddon);
        }
        setTerminalRuntimeReady(true);

        handleResize = () => {
          if (resizeTimeoutRef.current != null) {
            clearTimeout(resizeTimeoutRef.current);
          }
          resizeTimeoutRef.current = setTimeout(fitAndResize, 50);
        };

        window.addEventListener('resize', handleResize);
        setTimeout(handleResize, 100);
      }).catch((error) => {
        console.error('Failed to initialize terminal runtime:', error);
      });
    }

    // Shared resize handler for window resize events
    handleResize = () => {
      if (resizeTimeoutRef.current != null) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(fitAndResize, 50);
    };

    if (!cached) {
      // For newly created terminals, handleResize is set up in the promise callback
    } else {
      window.addEventListener('resize', handleResize);
    }

    return () => {
      cancelled = true;
      if (handleResize) {
        window.removeEventListener('resize', handleResize);
      }

      // On unmount: cache the xterm instance instead of disposing it.
      // This preserves scrollback and session state across workspace tab switches.
      const xterm = xtermRef.current;
      const fitAddon = fitAddonRef.current;
      if (xterm && fitAddon && terminalId != null) {
        if (isTerminalDisposed(terminalId)) {
          xtermRef.current = null;
          fitAddonRef.current = null;
          setTerminalRuntimeReady(false);
          if (resizeTimeoutRef.current != null) {
            clearTimeout(resizeTimeoutRef.current);
            resizeTimeoutRef.current = null;
          }
          return;
        }

        // Detach xterm element from the (soon-to-be-removed) DOM container
        if (xterm.element?.parentNode) {
          xterm.element.parentNode.removeChild(xterm.element);
        }
        xtermCache.set(terminalId, { xterm, fitAddon });
        terminalDetach(terminalId, workspaceId ?? undefined);
      }

      xtermRef.current = null;
      fitAddonRef.current = null;
      setTerminalRuntimeReady(false);
      if (resizeTimeoutRef.current != null) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
    };
  // Deliberately NOT dependent on fitAndResize/sendResize — these are stable
  // via useCallback. We want this effect to run on mount/unmount only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  useEffect(() => {
    if (!terminalRuntimeReady || terminalId == null) {
      return;
    }

    window.electronAPI.terminalReady(terminalId).catch(console.error);
  }, [terminalId, terminalRuntimeReady]);

  // -------------------------------------------------------------------------
  // IPC controls — local input/selection/resize handling only.
  // Global output delivery is handled once at app level so hidden workspaces
  // continue receiving terminal data and exit events.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!terminalRuntimeReady || xtermRef.current == null || terminalId == null || !isInteractive) return;

    const xterm = xtermRef.current;
    let inputDisposable: { dispose: () => void } | null = null;
    let disposeResized: (() => void) | null = null;
    let selectionDisposable: { dispose: () => void } | null = null;

    // Handle copy: if Ctrl+C with selection, copy and clear; otherwise pass through to PTY
    inputDisposable = xterm.onData((data) => {
      if (data === '\x03' && xterm.hasSelection()) {
        const selection = xterm.getSelection();
        window.electronAPI.writeClipboard(selection).catch(console.error);
        xterm.clearSelection();
        return; // Don't send ^C to PTY when we have a selection
      }
      window.electronAPI.writeTerminal(terminalId, data).catch(console.error);
    });

    // Phase 1: resize confirmation from main process.
    // If confirmed dimensions differ from xterm's internal dims, re-fit once.
    const resizedHandler = (data: { id: string; cols: number; rows: number }) => {
      if (data.id === terminalId && xtermRef.current != null && fitAddonRef.current != null) {
        const xtermDims = fitAddonRef.current.proposeDimensions();
        if (xtermDims != null && (xtermDims.cols !== data.cols || xtermDims.rows !== data.rows)) {
          // Geometry mismatch — re-fit to reconcile
          fitAddonRef.current.fit();
        }
      }
    };

    disposeResized = window.electronAPI.onTerminalResized(resizedHandler);

    // Copy selected text to clipboard when selection changes (mouse selection)
    selectionDisposable = xterm.onSelectionChange(() => {
      if (xterm.hasSelection()) {
        const selection = xterm.getSelection();
        window.electronAPI.writeClipboard(selection).catch(console.error);
      }
    });

    xterm.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c') {
        if (xterm.hasSelection()) {
          const selection = xterm.getSelection();
          if (selection) {
            window.electronAPI.writeClipboard(selection).catch(console.error);
          }
          xterm.clearSelection();
        }
        event.preventDefault();
        return false;
      }
      return true;
    });

    // Kick off initial resize to sync PTY dimensions
    setTimeout(fitAndResize, 100);

    return () => {
      inputDisposable?.dispose();
      disposeResized?.();
      selectionDisposable?.dispose();
    };
  // fitAndResize is a stable callback; we want this effect to re-run when
  // the terminal connection changes, not on every resize callback identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInteractive, terminalId, terminalRuntimeReady]);

  // -------------------------------------------------------------------------
  // ResizeObserver — triggers resize on container size change
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (terminalRef.current == null) return;

    const observer = new ResizeObserver(() => {
      if (resizeTimeoutRef.current != null) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(fitAndResize, 50);
    });

    observer.observe(terminalRef.current);

    return () => {
      observer.disconnect();
      if (resizeTimeoutRef.current != null) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
    };
  }, [fitAndResize]);

  // -------------------------------------------------------------------------
  // Active state — track which terminal is focused
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!terminalRuntimeReady || xtermRef.current == null || !isInteractive) return;

    const handleFocus = () => {
      setIsActive(true);
      if (terminalId != null) {
        setActiveTerminal(terminalId);
      }
    };

    const xterm = xtermRef.current;
    xterm.element?.addEventListener('click', handleFocus);

    return () => {
      xterm.element?.removeEventListener('click', handleFocus);
    };
  }, [isInteractive, setActiveTerminal, terminalId, terminalRuntimeReady]);

  useEffect(() => {
    setIsActive(isInteractive && workspace?.activeTerminalId === terminal?.id);
  }, [isInteractive, workspace?.activeTerminalId, terminal?.id]);

  // Trigger resize when terminalId changes (e.g., pane gets a new terminal)
  useEffect(() => {
    if (terminalRuntimeReady && fitAddonRef.current != null) {
      setTimeout(fitAndResize, 50);
    }
  }, [terminalId, terminalRuntimeReady, fitAndResize]);

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------
  const handleClose = useCallback(async () => {
    if (terminal == null || !isInteractive) return;
    try {
      // Evict cached xterm before killing the PTY
      markTerminalDisposed(terminal.id);
      await window.electronAPI.killTerminal(terminal.id);
      removeTerminal(terminal.id);
      if (paneId != null) {
        removePane(paneId);
      }
    } catch (err) {
      console.error('Failed to kill terminal:', err);
    }
  }, [isInteractive, terminal, removeTerminal, removePane, paneId]);

  const handleBringIntoView = useCallback(() => {
    if (!isInteractive) {
      return;
    }
    if (paneId) {
      if (workspaceId) {
        bringPaneIntoView(paneId, workspaceId);
      } else {
        bringPaneIntoView(paneId);
      }
    }
  }, [bringPaneIntoView, isInteractive, paneId, workspaceId]);

  const handleToggleLock = useCallback(() => {
    if (!isInteractive) {
      return;
    }
    if (paneId) {
      if (workspaceId) {
        togglePaneLock(paneId, workspaceId);
      } else {
        togglePaneLock(paneId);
      }
    }
  }, [isInteractive, paneId, togglePaneLock, workspaceId]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isInteractive) {
      return;
    }
    event.preventDefault();
  }, [isInteractive]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isInteractive) {
      return;
    }
    event.preventDefault();

    if (!terminalId) return;

    const dt = event.dataTransfer;
    if (!dt) return;

    const files = dt.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file) return;

    // Only handle image files for now
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
    if (!isImage) return;

    const uriList = dt.getData('text/uri-list');
    const filePath = window.electronAPI.resolveDroppedFilePath(file, uriList);

    if (!filePath) {
      // Fallback: just use the filename; agents can still use it if the file
      // is in the current working directory.
      const escapedName = file.name.replace(/'/g, "'\"'\"'");
      const textToSend = `'${escapedName}' `;
      void window.electronAPI.writeTerminal(terminalId, textToSend).catch(console.error);
      return;
    }

    // Escape single quotes so paths with spaces/special chars work in shells
    const escaped = filePath.replace(/'/g, "'\"'\"'");
    const textToSend = `'${escaped}' `;

    void window.electronAPI.writeTerminal(terminalId, textToSend).catch(console.error);
  }, [isInteractive, terminalId]);

  if (terminal == null) {
    return (
      <div className="terminal-pane empty">
        <div className="empty-state">
          <span>No terminal</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={paneRootRef}
      className={`terminal-pane ${compact ? 'compact' : ''} ${isActive ? 'active' : ''}`}
      data-workspace-interactive={isInteractive ? 'true' : 'false'}
    >
      {!compact && (
        <div className="terminal-header" {...headerDragHandleProps}>
          <div className="terminal-drag-handle" aria-hidden="true" title="Drag to move pane" />
          <div className="terminal-status-indicator" data-active={isActive} />
          <span className="terminal-title" />
          <div className="terminal-header-actions">
            <button className="terminal-action" onClick={handleBringIntoView} title="Bring into view" disabled={!isInteractive}>
              <LocateFixed size={14} strokeWidth={2} />
            </button>
            <button className="terminal-action" onClick={handleToggleLock} title={paneLocked ? 'Unlock pane' : 'Lock pane'} disabled={!isInteractive}>
              {paneLocked ? <Unlock size={14} strokeWidth={2} /> : <Lock size={14} strokeWidth={2} />}
            </button>
            <button className="terminal-close" onClick={handleClose} title="Close terminal" disabled={!isInteractive}>
              ×
            </button>
          </div>
        </div>
      )}
      <div
        className="terminal-content"
        ref={terminalRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        aria-disabled={!isInteractive}
      />
    </div>
  );
}
