/**
 * Terminal IPC Handlers
 *
 * Registers all terminal-related IPC handlers. Extracted from main.ts per S2.1.
 */

import { ipcMain, BrowserWindow, clipboard } from 'electron';
import * as pty from 'node-pty';
import Store from 'electron-store';
import { buildHarnessSpawnArgs } from '../harnessLaunch';
import {
  SPAWN_TERMINAL,
  GET_TERMINAL_BUFFER,
  WRITE_TERMINAL,
  RESIZE_TERMINAL,
  KILL_TERMINAL,
  TERMINAL_CLEANUP_WORKSPACE,
  TERMINAL_DATA,
  TERMINAL_EXIT,
  TERMINAL_RESIZED,
  TERMINAL_READY,
  WRITE_CLIPBOARD,
} from '../../shared/ipcChannels';

interface Terminal {
  id: string;
  pid: number;
  pty: pty.IPty;
  /**
   * Bounded startup buffer — holds PTY output only during the brief window
   * between PTY spawn and renderer confirming xterm is ready.
   * Cleared after flush on TERMINAL_READY.
   * Max 16 KB to prevent unbounded growth if renderer never signals ready.
   */
  startupBuffer: string[];
  startupBufferReady: boolean;
}

export type { Terminal };

interface StoreSchema {
  lastWorkspace: string;
  showFastfetch: boolean;
  aiCommitEnabled: boolean;
  aiCommitProvider: string;
  aiCommitModel: string;
}

interface RegisterTerminalIpcDeps {
  getTerminals: () => Map<string, Terminal>;
  getMainWindow: () => BrowserWindow | null;
  getStore: () => Store<StoreSchema>;
  getSafeWorkspacePath: (workingDir: string) => string;
  getHarnessOptions: () => Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>;
  getAppShuttingDown?: () => boolean;
}

let appShuttingDown = false;

export function setAppShuttingDown(shuttingDown: boolean): void {
  appShuttingDown = shuttingDown;
}

export function registerTerminalIpc(deps: RegisterTerminalIpcDeps): void {
  const { getTerminals, getMainWindow, getStore, getSafeWorkspacePath, getHarnessOptions } = deps;

  const ok = () => ({ success: true as const });
  const fail = (error: string) => ({ success: false as const, error });

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;
  const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;
  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

  ipcMain.handle(SPAWN_TERMINAL, (_, workingDir: string, harness?: string, model?: string) => {
    const terminals = getTerminals();
    const mainWindow = getMainWindow();
    const store = getStore();

    const id = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const cwd = getSafeWorkspacePath(workingDir);

    // Use user's default shell, fallback to bash
    const userShell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');

    // Spawn with interactive flags for better shell experience
    const shellArgs = ['-i'];

    const harnessEnv = harness && getHarnessOptions()[harness]?.env ? getHarnessOptions()[harness].env : {};

    const harnessConfig = harness ? getHarnessOptions()[harness] : undefined;
    const harnessArgs = harnessConfig ? buildHarnessSpawnArgs(harnessConfig, model) : [];

    // Escape an argument for safe use in a single-quoted shell command string.
    const shellEscape = (arg: string): string => {
      const escaped = arg.replace(/'/g, "'\\''");
      return `'${escaped}'`;
    };

    // Build the harness command string with proper escaping
    const harnessCmdStr = harnessConfig
      ? `${harnessConfig.command} ${harnessArgs.map(shellEscape).join(' ')}; exec "$SHELL" -i`
      : '';

    const harnessCmd = harnessConfig
      ? { spawnCmd: userShell, spawnArgs: ['-i', '-c', harnessCmdStr] }
      : { spawnCmd: userShell, spawnArgs: shellArgs };

    const ptyProcess = pty.spawn(
      harnessCmd.spawnCmd,
      harnessCmd.spawnArgs,
      {
        name: 'xterm-256color',
        cwd,
        env: {
          ...process.env as { [key: string]: string },
          ...harnessEnv,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          TERM_PROGRAM: 'clanker-grid',
          FORCE_COLOR: '1',
          ...(store.get('showFastfetch') ? {} : { CLANKER_GRID: '1' }),
        },
        // Phase 1 fix: disable flow control to remove it as a startup variable.
        // The congestion-timer approach was found to stall shell startup (fish DA1 query timeout).
        // Flow control can be re-enabled in Phase 2 with a proper readiness handshake.
        handleFlowControl: false,
      }
    );

    const terminal: Terminal = { id, pid: ptyProcess.pid, pty: ptyProcess, startupBuffer: [], startupBufferReady: false };
    terminals.set(id, terminal);

    if (harness && getHarnessOptions()[harness]) {
      const config = getHarnessOptions()[harness];
      const launchArgs = buildHarnessSpawnArgs(config, model);
      console.info('[clanker-grid] harness launch', {
        harness,
        command: config.command,
        args: launchArgs,
        model: model ?? null,
      });
      if (mainWindow) {
        const visibleLaunch = `[clanker-grid] ${config.command} ${launchArgs.join(' ')}\r\n`;
        mainWindow.webContents.send(TERMINAL_DATA, { id, data: visibleLaunch });
      }
    }

    ptyProcess.onData((data: string) => {
      if (appShuttingDown) return;

      const terminal = terminals.get(id);
      if (!terminal) return;

      // During startup window (before renderer confirms xterm is ready),
      // buffer the data. This protects the critical DA1 query/response window.
      if (!terminal.startupBufferReady) {
        // Bounded buffer: max 16 KB or 100 chunks, whichever comes first.
        // This prevents unbounded growth if renderer never signals ready.
        const totalSize = terminal.startupBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
        if (totalSize < 16 * 1024 && terminal.startupBuffer.length < 100) {
          terminal.startupBuffer.push(data);
          return;
        }
        // Buffer full — start sending anyway to avoid data loss.
        // This is a safety fallback; normal case should flush before hitting this limit.
      }

      if (mainWindow) {
        mainWindow.webContents.send(TERMINAL_DATA, { id, data });
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (appShuttingDown) return;
      terminals.delete(id);
      if (mainWindow) {
        mainWindow.webContents.send(TERMINAL_EXIT, { id, exitCode });
      }
    });

    return { id, pid: ptyProcess.pid };
  });

  /**
   * @deprecated GET_TERMINAL_BUFFER is retained as a no-op returning ''.
   * Session continuity is now handled by xterm instance caching in the renderer.
   * The app-level buffer has been removed (Phase 1 terminal redesign).
   */
  ipcMain.handle(GET_TERMINAL_BUFFER, () => {
    return '';
  });

  /**
   * TERMINAL_READY — Renderer confirms xterm is ready to receive data.
   * Flushes the bounded startup buffer in order, then marks the terminal as ready.
   * This ensures early PTY output (including DA1 query responses) is not lost.
   */
  ipcMain.handle(TERMINAL_READY, (_, id: string) => {
    const terminals = getTerminals();
    const terminal = terminals.get(id);
    if (!terminal || terminal.startupBufferReady) {
      return ok();
    }

    const mainWindow = getMainWindow();
    if (mainWindow && terminal.startupBuffer.length > 0) {
      // Flush buffered data in order — this includes any DA1 response from xterm
      for (const chunk of terminal.startupBuffer) {
        mainWindow.webContents.send(TERMINAL_DATA, { id, data: chunk });
      }
    }

    // Clear buffer and mark as ready
    terminal.startupBuffer = [];
    terminal.startupBufferReady = true;

    return ok();
  });

  ipcMain.handle(WRITE_TERMINAL, (_, payload: unknown) => {
    if (!isRecord(payload) || !isNonEmptyString(payload.id) || typeof payload.data !== 'string') {
      return fail('Invalid payload');
    }
    const { id, data } = payload;
    const terminals = getTerminals();
    const terminal = terminals.get(id);
    if (terminal) {
      terminal.pty.write(data);
      return ok();
    }
    return ok(); // no-op for missing terminal
  });

  ipcMain.handle(RESIZE_TERMINAL, (_, payload: unknown) => {
    if (
      !isRecord(payload)
      || !isNonEmptyString(payload.id)
      || !isFiniteNumber(payload.cols)
      || !isFiniteNumber(payload.rows)
    ) {
      return fail('Invalid payload');
    }
    const { id, cols, rows } = payload;
    const terminals = getTerminals();
    const terminal = terminals.get(id);
    if (terminal) {
      const safeCols = Math.max(1, Math.floor(cols));
      const safeRows = Math.max(1, Math.floor(rows));
      terminal.pty.resize(safeCols, safeRows);

      // Phase 1: resize confirmation — notify renderer of confirmed geometry.
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(TERMINAL_RESIZED, { id, cols: safeCols, rows: safeRows });
      }

      // Safety net: if handleFlowControl paused the PTY (e.g., via XOFF
      // interception from user pressing Ctrl+S), resume it on resize so the
      // terminal doesn't get stuck paused.
      try {
        terminal.pty.resume();
      } catch {
        // PTY may have exited; ignore.
      }

      return ok();
    }
    return ok(); // no-op for missing terminal
  });

  ipcMain.handle(KILL_TERMINAL, (_, id: string) => {
    const terminals = getTerminals();
    if (!isNonEmptyString(id)) {
      return fail('Invalid terminal id');
    }
    const terminal = terminals.get(id);
    if (terminal) {
      terminal.pty.kill();
      terminals.delete(id);
      return ok();
    }
    return ok(); // no-op for missing terminal
  });

  ipcMain.handle(TERMINAL_CLEANUP_WORKSPACE, (_, ids: string[]) => {
    const terminals = getTerminals();
    let killed = 0;
    for (const id of ids) {
      const terminal = terminals.get(id);
      if (terminal) {
        terminal.pty.kill();
        terminals.delete(id);
        killed++;
      }
    }
    return killed;
  });

  ipcMain.handle(WRITE_CLIPBOARD, (_, text: unknown) => {
    if (typeof text !== 'string') {
      return fail('Invalid text');
    }
    clipboard.writeText(text);
    return ok();
  });

  // Event channels — registered so the integration test can verify completeness.
  // These are one-way: main sends events to renderer (no handler needed).
  ipcMain.on(TERMINAL_DATA, () => { });
  ipcMain.on(TERMINAL_EXIT, () => { });
  ipcMain.on(TERMINAL_RESIZED, () => { });

  // TERMINAL_READY is a handler (ipcMain.handle), not an event channel.
}
