import { useEffect, useRef, useState, useCallback, type DragEvent } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { LocateFixed, Lock, Unlock } from 'lucide-react';
import { useDragHandle } from './DynamicPaneLayout';
import { getZoomShortcutAction } from '../lib/keyboardShortcuts';
import './TerminalPane.css';
import '@xterm/xterm/css/xterm.css';

type XTermInstance = import('@xterm/xterm').Terminal;
type FitAddonInstance = import('@xterm/addon-fit').FitAddon;

interface Props {
  paneId: string;
  compact?: boolean;
}

export default function TerminalPane({ paneId, compact = false }: Props) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermInstance | null>(null);
  const fitAddonRef = useRef<FitAddonInstance | null>(null);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [terminalRuntimeReady, setTerminalRuntimeReady] = useState(false);
  const dragHandleProps = useDragHandle();

  const {
    setActiveTerminal,
    removeTerminal,
    removePane,
    activeTerminalId,
    panes,
    terminals,
    bringPaneIntoView,
    togglePaneLock,
  } = useWorkspaceStore();
  const pane = panes.find((item: typeof panes[0]) => item.id === paneId);
  const terminal = terminals.find((item: typeof terminals[0]) => item.id === pane?.terminalId);
  const terminalId = terminal?.id ?? null;
  const paneLocked = pane?.locked ?? false;

  const resizeTerminal = useCallback(() => {
    if (terminalId == null || fitAddonRef.current == null || xtermRef.current == null) return;
    fitAddonRef.current.fit();
    const dims = fitAddonRef.current.proposeDimensions();
    if (dims != null) {
      window.electronAPI.resizeTerminal(terminalId, dims.cols, dims.rows).catch(console.error);
    }
  }, [terminalId]);

  useEffect(() => {
    if (terminalRef.current == null || xtermRef.current != null) return;

    let cancelled = false;
    let handleResize: (() => void) | null = null;
    let terminalInstance: XTermInstance | null = null;
    setTerminalRuntimeReady(false);

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
        scrollback: 10000,
      });

      const fitAddon = new fitAddonModule.FitAddon();
      xterm.loadAddon(fitAddon);
      xterm.open(terminalRef.current);
      fitAddon.fit();

      terminalInstance = xterm;
      xtermRef.current = xterm;
      fitAddonRef.current = fitAddon;
      setTerminalRuntimeReady(true);

      handleResize = () => {
        if (resizeTimeoutRef.current != null) {
          clearTimeout(resizeTimeoutRef.current);
        }
        resizeTimeoutRef.current = setTimeout(resizeTerminal, 50);
      };

      window.addEventListener('resize', handleResize);
      setTimeout(handleResize, 100);
    }).catch((error) => {
      console.error('Failed to initialize terminal runtime:', error);
    });

    return () => {
      cancelled = true;
      if (handleResize) {
        window.removeEventListener('resize', handleResize);
      }
      terminalInstance?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      setTerminalRuntimeReady(false);
      if (resizeTimeoutRef.current != null) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
    };
  }, [resizeTerminal]);

  useEffect(() => {
    if (!terminalRuntimeReady || xtermRef.current == null || terminalId == null) return;

    const xterm = xtermRef.current;
    let inputDisposable: { dispose: () => void } | null = null;
    let disposeData: (() => void) | null = null;
    let disposeExit: (() => void) | null = null;
    let selectionDisposable: { dispose: () => void } | null = null;
    let cancelled = false;

    const startStreaming = () => {
      if (cancelled || xtermRef.current == null) return;

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

      const dataHandler = (data: { id: string; data: string }) => {
        if (data.id === terminalId && xtermRef.current != null) {
          xtermRef.current.write(data.data);
        }
      };

      disposeData = window.electronAPI.onTerminalData(dataHandler);

      const exitHandler = (data: { id: string; exitCode: number }) => {
        if (data.id === terminalId && xtermRef.current != null) {
          xtermRef.current.write(`\r\n\x1b[33mProcess exited with code ${data.exitCode}\x1b[0m\r\n`);
        }
      };

      disposeExit = window.electronAPI.onTerminalExit(exitHandler);

      // Copy selected text to clipboard when selection changes (mouse selection)
      selectionDisposable = xterm.onSelectionChange(() => {
        if (xterm.hasSelection()) {
          const selection = xterm.getSelection();
          window.electronAPI.writeClipboard(selection).catch(console.error);
        }
      });

      xterm.attachCustomKeyEventHandler((event) => {
        const zoomAction = getZoomShortcutAction(event);
        if (zoomAction != null) {
          if (zoomAction === 'in') {
            void window.electronAPI.zoomInWindow();
          } else if (zoomAction === 'out') {
            void window.electronAPI.zoomOutWindow();
          } else {
            void window.electronAPI.resetZoomWindow();
          }
          event.preventDefault();
          return false;
        }

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

      setTimeout(resizeTerminal, 100);
    };

    window.electronAPI.getTerminalBuffer(terminalId)
      .then((buffer) => {
        if (cancelled || xtermRef.current == null) return;
        if (buffer.length > 0) {
          xtermRef.current.write(buffer);
        }
        startStreaming();
      })
      .catch((error) => {
        console.error('Failed to load terminal buffer:', error);
        startStreaming();
      });

    return () => {
      cancelled = true;
      inputDisposable?.dispose();
      disposeData?.();
      disposeExit?.();
      selectionDisposable?.dispose();
    };
  }, [terminalId, terminalRuntimeReady, resizeTerminal]);

  useEffect(() => {
    if (terminalRef.current == null) return;

    const observer = new ResizeObserver(() => {
      if (resizeTimeoutRef.current != null) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(resizeTerminal, 50);
    });

    observer.observe(terminalRef.current);

    return () => {
      observer.disconnect();
      if (resizeTimeoutRef.current != null) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
    };
  }, [resizeTerminal]);

  useEffect(() => {
    if (!terminalRuntimeReady || xtermRef.current == null) return;

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
  }, [setActiveTerminal, terminalId, terminalRuntimeReady]);

  useEffect(() => {
    setIsActive(activeTerminalId === terminal?.id);
  }, [activeTerminalId, terminal?.id]);

  useEffect(() => {
    if (terminalRuntimeReady && fitAddonRef.current != null) {
      setTimeout(resizeTerminal, 50);
    }
  }, [terminalId, terminalRuntimeReady, resizeTerminal]);

  const handleClose = useCallback(async () => {
    if (terminal == null) return;
    try {
      await window.electronAPI.killTerminal(terminal.id);
      removeTerminal(terminal.id);
      if (paneId != null) {
        removePane(paneId);
      }
    } catch (err) {
      console.error('Failed to kill terminal:', err);
    }
  }, [terminal, removeTerminal, removePane, paneId]);

  const handleBringIntoView = useCallback(() => {
    if (paneId) {
      bringPaneIntoView(paneId);
    }
  }, [bringPaneIntoView, paneId]);

  const handleToggleLock = useCallback(() => {
    if (paneId) {
      togglePaneLock(paneId);
    }
  }, [paneId, togglePaneLock]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
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
  }, [terminalId]);

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
    <div className={`terminal-pane ${compact ? 'compact' : ''} ${isActive ? 'active' : ''}`}>
      {!compact && (
        <div className="terminal-header" {...dragHandleProps}>
          <div className="terminal-drag-handle" aria-hidden="true" title="Drag to move pane" />
          <div className="terminal-status-indicator" data-active={isActive} />
          <span className="terminal-title" />
          <div className="terminal-header-actions">
            <button className="terminal-action" onClick={handleBringIntoView} title="Bring into view">
              <LocateFixed size={14} strokeWidth={2} />
            </button>
            <button className="terminal-action" onClick={handleToggleLock} title={paneLocked ? 'Unlock pane' : 'Lock pane'}>
              {paneLocked ? <Unlock size={14} strokeWidth={2} /> : <Lock size={14} strokeWidth={2} />}
            </button>
            <button className="terminal-close" onClick={handleClose} title="Close terminal">
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
      />
    </div>
  );
}
