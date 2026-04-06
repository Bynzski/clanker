import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useWorkspaceStore, Terminal } from '../store/workspaceStore';
import './TerminalPane.css';
import '@xterm/xterm/css/xterm.css';

interface Props {
  terminal: Terminal | undefined;
  paneId?: string;
  compact?: boolean;
}

export default function TerminalPane({ terminal, paneId, compact = false }: Props) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isActive, setIsActive] = useState(false);

  const { setActiveTerminal, removeTerminal, removePane, activeTerminalId } = useWorkspaceStore();

  const resizeTerminal = useCallback(() => {
    if (terminal == null || fitAddonRef.current == null || xtermRef.current == null) return;
    fitAddonRef.current.fit();
    const dims = fitAddonRef.current.proposeDimensions();
    if (dims != null) {
      window.electronAPI.resizeTerminal(terminal.id, dims.cols, dims.rows).catch(console.error);
    }
  }, [terminal?.id]);

  useEffect(() => {
    if (terminalRef.current == null || xtermRef.current != null) return;

    const xterm = new XTerm({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#f85149',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#e6edf3',
        brightBlack: '#8b949e',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#ffffff',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    const handleResize = () => {
      if (resizeTimeoutRef.current != null) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(resizeTerminal, 50);
    };

    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      if (resizeTimeoutRef.current != null) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
    };
  }, [resizeTerminal]);

  useEffect(() => {
    if (xtermRef.current == null || terminal == null) return;

    const xterm = xtermRef.current;
    let inputDisposable: { dispose: () => void } | null = null;
    let disposeData: (() => void) | null = null;
    let disposeExit: (() => void) | null = null;
    let cancelled = false;

    const startStreaming = () => {
      if (cancelled || xtermRef.current == null) return;

      inputDisposable = xterm.onData((data) => {
        window.electronAPI.writeTerminal(terminal.id, data).catch(console.error);
      });

      const dataHandler = (data: { id: string; data: string }) => {
        if (data.id === terminal.id && xtermRef.current != null) {
          xtermRef.current.write(data.data);
        }
      };

      disposeData = window.electronAPI.onTerminalData(dataHandler);

      const exitHandler = (data: { id: string; exitCode: number }) => {
        if (data.id === terminal.id && xtermRef.current != null) {
          xtermRef.current.write(`\r\n\x1b[33mProcess exited with code ${data.exitCode}\x1b[0m\r\n`);
        }
      };

      disposeExit = window.electronAPI.onTerminalExit(exitHandler);
      setTimeout(resizeTerminal, 100);
    };

    window.electronAPI.getTerminalBuffer(terminal.id)
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
    };
  }, [terminal?.id, resizeTerminal]);

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
    if (xtermRef.current == null) return;

    const handleFocus = () => {
      setIsActive(true);
      if (terminal != null) {
        setActiveTerminal(terminal.id);
      }
    };

    const xterm = xtermRef.current;
    xterm.element?.addEventListener('click', handleFocus);

    return () => {
      xterm.element?.removeEventListener('click', handleFocus);
    };
  }, [terminal?.id]);

  useEffect(() => {
    setIsActive(activeTerminalId === terminal?.id);
  }, [activeTerminalId, terminal?.id]);

  useEffect(() => {
    if (fitAddonRef.current != null) {
      setTimeout(resizeTerminal, 50);
    }
  }, [terminal?.id, resizeTerminal]);

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
        <div className="terminal-header">
          <span className="terminal-title" />
          <button className="terminal-close" onClick={handleClose} title="Close terminal">
            ×
          </button>
        </div>
      )}
      <div className="terminal-content" ref={terminalRef} />
    </div>
  );
}
