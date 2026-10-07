import { IconButton } from './ui/IconButton';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, useCallback, type DragEvent } from 'react';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import type { ILink, ILinkProvider } from '@xterm/xterm';
import { useThemeStore } from '../theme/themeStore';
import { getTerminalTheme, registerThemedTerminal, unregisterThemedTerminal } from '../theme/terminalTheme';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useTerminalAttention } from '../lib/useTerminalAttention';
import { getAttentionSuffix } from '../lib/agentAttentionPresentation';
import { AgentAttentionState } from './AgentAttentionIndicators';
import { getHarnessOption } from '../lib/harnessOptions';

import { useDragHandle } from './dragHandleContext';
import { useScopedWorkspace, useScopedWorkspaceActivity } from './WorkspaceScope';
import './TerminalPane.css';
import '@xterm/xterm/css/xterm.css';

import {
  TERMINAL_DEFAULT_FONT_SIZE,
  TERMINAL_FONT_SIZE_STEP,
  TERMINAL_MAX_FONT_SIZE,
  TERMINAL_MIN_FONT_SIZE,
  TERMINAL_SCROLLBACK_LINES,
} from '../../shared/terminal';
import {
  terminalCacheHit,
  terminalCacheMiss,
  terminalDetach,
} from '../lib/workspaceSwitchDebug';
import { openUrlInWorkspaceBrowser } from '../lib/browserTabActions';
import { publishTerminalPaneGeometry, clearTerminalPaneGeometry } from '../lib/terminalPaneGeometry';
import {
  findTerminalLinks,
  normalizeTerminalUrl,
} from '../lib/linkUtils';
import { getWheelZoomAction, getZoomActionForCommand, resolveKeyboardCommand } from '../lib/keyboardShortcuts';
import { linkRangeForMatch, readWrappedLogicalLine } from '../lib/terminalLinkRanges';
import { observeTerminalGeometry } from '../lib/terminalGeometry';

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
    unregisterThemedTerminal(xterm);
    xterm.dispose();
    return;
  }

  const previous = xtermCache.get(terminalId);
  if (previous && previous.xterm !== xterm) {
    evictCachedTerminal(terminalId);
  }
  registerThemedTerminal(xterm, useThemeStore.getState().theme);
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
function evictCachedTerminal(terminalId: string): void {
  const cached = xtermCache.get(terminalId);
  if (cached) {
    unregisterThemedTerminal(cached.xterm);
    cached.xterm.dispose();
    xtermCache.delete(terminalId);
  }
}

export function markTerminalDisposed(terminalId: string): void {
  disposedTerminalIds.add(terminalId);
  evictCachedTerminal(terminalId);
}

/** Release a disposal guard only after the pane lifecycle has finished. */
export function finishTerminalDisposal(terminalId: string): void {
  disposedTerminalIds.delete(terminalId);
}

function isTerminalDisposed(terminalId: string): boolean {
  return disposedTerminalIds.has(terminalId);
}

/**
 * Clear all cached xterm instances. Used in tests to ensure isolation.
 */
export function clearTerminalCache(): void {
  for (const [, cached] of xtermCache) {
    unregisterThemedTerminal(cached.xterm);
    cached.xterm.dispose();
  }
  xtermCache.clear();
  disposedTerminalIds.clear();
}

export default function TerminalPane({ workspaceId, paneId, compact = false }: Props) {
  const paneRootRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermInstance | null>(null);
  const fitAddonRef = useRef<FitAddonInstance | null>(null);
  const geometryRef = useRef<ReturnType<typeof observeTerminalGeometry> | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [terminalRuntimeReady, setTerminalRuntimeReady] = useState(false);
  const dragHandleProps = useDragHandle();
  const workspace = useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);

  const setActiveTerminal = useWorkspaceStore((state) => state.setActiveTerminal);
  const removeTerminal = useWorkspaceStore((state) => state.removeTerminal);
  const removePane = useWorkspaceStore((state) => state.removePane);
  const pane = workspace?.panes.find((item) => item.id === paneId);
  const terminal = workspace?.terminals.find((item) => item.id === pane?.terminalId);
  const terminalId = terminal?.id ?? null;
  const attention = useTerminalAttention(terminalId);
  const showAgentAttention = Boolean(terminal?.harnessId && terminal.attentionEnabled);
  const attentionSuffix = showAgentAttention ? getAttentionSuffix(attention) : '';
  const harnessOption = getHarnessOption(terminal?.harnessId);
  const HarnessIcon = harnessOption.Icon;
  const headerDragHandleProps = isInteractive ? dragHandleProps : undefined;

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
    setTerminalRuntimeReady(false);

    // Check for a cached xterm instance (workspace tab switch restore)
    const cached = terminalId != null ? xtermCache.get(terminalId) : null;

    if (cached) {
      registerThemedTerminal(cached.xterm, useThemeStore.getState().theme);
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
    } else {
      // No cached instance — create a new one
      terminalCacheMiss(terminalId ?? 'unknown', workspaceId ?? undefined);
      void Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]).then(([xtermModule, fitAddonModule]) => {
        if (cancelled || terminalRef.current == null || (terminalId != null && isTerminalDisposed(terminalId))) {
          return;
        }

        const xterm = new xtermModule.Terminal({
          allowTransparency: false,
          theme: getTerminalTheme(useThemeStore.getState().theme),
          fontFamily: '"DejaVu Sans Mono", "JetBrains Mono", "Fira Code", "Cascadia Code", "Fira Mono", Menlo, Consolas, monospace',
          fontSize: TERMINAL_DEFAULT_FONT_SIZE,
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
        const clipboardAddon = new ClipboardAddon();
        try {
          xterm.loadAddon(fitAddon);
          xterm.loadAddon(clipboardAddon);
          xterm.open(terminalRef.current);
        } catch (error) {
          xterm.dispose();
          throw error;
        }

        xtermRef.current = xterm;
        fitAddonRef.current = fitAddon;
        if (terminalId != null) {
          cacheTerminalInstance(terminalId, xterm, fitAddon);
        } else {
          registerThemedTerminal(xterm, useThemeStore.getState().theme);
        }
        setTerminalRuntimeReady(true);
      }).catch((error) => {
        console.error('Failed to initialize terminal runtime:', error);
      });
    }

    return () => {
      cancelled = true;
      geometryRef.current?.dispose();
      geometryRef.current = null;

      // On unmount: cache the xterm instance instead of disposing it.
      // This preserves scrollback and session state across workspace tab switches.
      const xterm = xtermRef.current;
      const fitAddon = fitAddonRef.current;
      if (xterm && fitAddon && terminalId != null) {
        if (isTerminalDisposed(terminalId)) {
          xtermRef.current = null;
          fitAddonRef.current = null;
          setTerminalRuntimeReady(false);
          finishTerminalDisposal(terminalId);
          return;
        }

        // Detach xterm element from the (soon-to-be-removed) DOM container
        if (xterm.element?.parentNode) {
          xterm.element.parentNode.removeChild(xterm.element);
        }
        xtermCache.set(terminalId, { xterm, fitAddon });
        terminalDetach(terminalId, workspaceId ?? undefined);
      } else if (xterm) {
        unregisterThemedTerminal(xterm);
        xterm.dispose();
      }

      xtermRef.current = null;
      fitAddonRef.current = null;
      setTerminalRuntimeReady(false);
    };
  // Runtime ownership changes only when the terminal identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  // -------------------------------------------------------------------------
  // Terminal links — URLs open in a new in-app tab; workspace files in editor.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const xterm = xtermRef.current;
    if (!terminalRuntimeReady || !xterm || !workspace?.workspacePath || !isInteractive) return;

    const resolvedWorkspaceId = workspace.id;
    const workspacePath = workspace.workspacePath;
    const oscLinkHandler: import('@xterm/xterm').ILinkHandler = {
      allowNonHttpProtocols: false,
      activate: (_event, text) => {
        const target = normalizeTerminalUrl(text);
        if (!target) return;
        void openUrlInWorkspaceBrowser(resolvedWorkspaceId, target).catch((error) => {
          console.error('Failed to open terminal URL:', error);
        });
      },
    };
    xterm.options.linkHandler = oscLinkHandler;

    const provider: ILinkProvider = {
      provideLinks: (bufferLineNumber, callback) => {
        const logicalLine = readWrappedLogicalLine(
          xterm.buffer.active,
          bufferLineNumber,
          xterm.cols,
        );
        if (!logicalLine) {
          callback(undefined);
          return;
        }

        const matches = findTerminalLinks(logicalLine.text, workspacePath);
        const links = matches.flatMap<ILink>((match) => {
          const range = linkRangeForMatch(logicalLine, match);
          if (!range) return [];
          return [{
            range,
            text: match.text,
            decorations: { pointerCursor: true, underline: true },
            activate: () => {
              if (match.kind === 'file') {
                void useWorkspaceStore.getState().openFileInEditor(match.target, resolvedWorkspaceId);
                return;
              }

              void openUrlInWorkspaceBrowser(resolvedWorkspaceId, match.target).catch((error) => {
                console.error('Failed to open terminal URL:', error);
              });
            },
          }];
        });
        callback(links.length > 0 ? links : undefined);
      },
    };

    const disposable = xterm.registerLinkProvider(provider);
    return () => {
      disposable.dispose();
      if (xterm.options.linkHandler === oscLinkHandler) {
        xterm.options.linkHandler = null;
      }
    };
  }, [isInteractive, terminalRuntimeReady, workspace?.id, workspace?.workspacePath]);

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
          geometryRef.current?.scheduleFit();
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

    const applyTerminalZoom = (action: 'in' | 'out' | 'reset') => {
      const current = xterm.options.fontSize ?? TERMINAL_DEFAULT_FONT_SIZE;
      const requested = action === 'reset'
        ? TERMINAL_DEFAULT_FONT_SIZE
        : current + (action === 'in' ? TERMINAL_FONT_SIZE_STEP : -TERMINAL_FONT_SIZE_STEP);
      const next = Math.min(TERMINAL_MAX_FONT_SIZE, Math.max(TERMINAL_MIN_FONT_SIZE, requested));
      if (next !== current) {
        xterm.options.fontSize = next;
        geometryRef.current?.scheduleFit();
      }
    };

    // Ctrl+wheel over the terminal zooms only this xterm. xterm runs this before
    // its own wheel processing; returning false stops scrollback/mouse handling.
    // Plain wheel returns true so xterm behaves normally.
    xterm.attachCustomWheelEventHandler((event) => {
      const wheelAction = getWheelZoomAction(event);
      if (wheelAction == null) {
        return true;
      }
      event.preventDefault();
      event.stopPropagation();
      applyTerminalZoom(wheelAction);
      return false;
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

      // Terminal-context commands (currently zoom) are owned here: terminal zoom
      // changes only this xterm's cell metrics. A matched command is always
      // consumed (even at a bound) so it never reaches the PTY or the app-level
      // listener. Anything unregistered for the terminal falls through to the PTY.
      const command = resolveKeyboardCommand(event, 'terminal');
      if (command != null) {
        event.preventDefault();
        event.stopPropagation();
        const zoomAction = getZoomActionForCommand(command);
        if (zoomAction != null && event.type === 'keydown') {
          applyTerminalZoom(zoomAction);
        }
        return false;
      }
      return true;
    });

    return () => {
      inputDisposable?.dispose();
      disposeResized?.();
      selectionDisposable?.dispose();
    };
  }, [isInteractive, terminalId, terminalRuntimeReady]);

  // Attach after input listeners: startup output can contain terminal queries.
  // Readiness is sent only after a visible fit and its PTY resize have completed.
  useEffect(() => {
    if (!terminalRuntimeReady || !terminalRef.current || !fitAddonRef.current || !isInteractive) return;
    const geometry = observeTerminalGeometry({
      container: terminalRef.current,
      fitAddon: fitAddonRef.current,
      isAlive: () => terminalId === null || !isTerminalDisposed(terminalId),
      onDimensions: (dimensions) => publishTerminalPaneGeometry(paneId, dimensions),
      resize: (cols, rows) => terminalId === null ? Promise.resolve() : window.electronAPI.resizeTerminal(terminalId, cols, rows),
      ready: () => terminalId === null ? Promise.resolve() : window.electronAPI.terminalReady(terminalId),
      onError: console.error,
    });
    geometryRef.current = geometry;
    return () => {
      geometry.dispose();
      clearTerminalPaneGeometry(paneId);
      if (geometryRef.current === geometry) geometryRef.current = null;
    };
  }, [terminalId, terminalRuntimeReady, paneId, isInteractive]);

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

  useEffect(() => {
    if (!isInteractive || !terminalRuntimeReady || terminalId == null) {
      return;
    }

    if (workspace?.activeTerminalId !== terminalId) {
      return;
    }

    xtermRef.current?.focus();
  }, [isInteractive, terminalId, terminalRuntimeReady, workspace?.activeTerminalId]);

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------
  const handleClose = useCallback(async () => {
    if (!isInteractive) return;
    const closePane = () => workspaceId ? removePane(paneId, workspaceId) : removePane(paneId);
    if (terminal == null) {
      if (pane) closePane();
      return;
    }
    try {
      await window.electronAPI.killTerminal(terminal.id);
      // Guard the React teardown after main confirms the PTY was killed. The
      // lifecycle cleanup releases this tombstone after it declines to cache
      // the disposed xterm instance.
      markTerminalDisposed(terminal.id);
      removeTerminal(terminal.id);
      if (paneId != null) {
        closePane();
      }
    } catch (err) {
      console.error('Failed to kill terminal:', err);
    }
  }, [isInteractive, terminal, pane, removeTerminal, removePane, paneId, workspaceId]);

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

  if (terminal == null && pane == null) {
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
      className={`terminal-pane ${compact ? 'compact' : ''} ${isActive ? 'active' : ''} ${showAgentAttention && attention?.unseen ? 'attention-unseen' : ''}`}
      data-workspace-interactive={isInteractive ? 'true' : 'false'}
      data-keybinding-context="terminal"
    >
      {!compact && (
        <div className="terminal-header">
          <div className="pane-drag-surface" title="Drag to move pane" aria-label="Move terminal pane" {...headerDragHandleProps}>
            <div className="terminal-drag-handle" aria-hidden="true" />
            <div className="terminal-status-indicator" data-active={isActive} />
            <span className="terminal-harness-icon" role="img" aria-label={`${harnessOption.label} harness`} title={`${harnessOption.label} harness`}>
              <HarnessIcon size={14} strokeWidth={2} />
            </span>
            <span className="terminal-title" title={terminal?.harnessId ? `${harnessOption.label}${attentionSuffix}` : 'Shell'}>
              {terminal?.displayName ?? 'Terminal'}
            </span>
            {showAgentAttention && <AgentAttentionState attention={attention} name={terminal?.displayName ?? 'Agent'} />}
          </div>
          <div className="terminal-header-actions">
            <IconButton variant="ghost" aria-label="Close terminal" className="terminal-close" onClick={handleClose} title="Close terminal" disabled={!isInteractive}>
              <X size={14} strokeWidth={2} />
            </IconButton>
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
