/**
 * Shared PTY spawn helper.
 *
 * Extracted from terminalIpc.ts so both terminalIpc.ts and sessionIpc.ts can
 * spawn PTY processes with the same buffering and lifecycle behaviour.
 */

import { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import { TERMINAL_DATA, TERMINAL_EXIT } from '../../shared/ipcChannels';
import type { Terminal } from './terminalIpc';
import type { RecipeCommandStartup } from '../recipeCommandStartup';
import { isWindowAvailable } from '../windowManager';

const pendingCleanups = new Set<Promise<void>>();

/** Quit waits for cleanup already started by explicit kills or window teardown. */
export async function waitForTerminalCleanup(): Promise<void> {
  await Promise.all([...pendingCleanups]);
}

export interface SpawnPtyOptions {
  id: string;
  spawnCmd: string;
  /** A single string is a verbatim Windows command line (node-pty passes it unchanged). */
  spawnArgs: string[] | string;
  cwd: string;
  env: { [key: string]: string };
  terminals: Map<string, Terminal>;
  mainWindow: BrowserWindow | null;
  getIsShuttingDown: () => boolean;
  /** Optional banner line sent to the renderer before any PTY data. */
  launchLabel?: string;
  harnessId?: string;
  initialCommand?: string;
  workspaceId?: string;
  checkoutContextId?: string;
  environmentId?: string;
  remoteWorkingDir?: string;
  recipeCommandStartup?: RecipeCommandStartup;
  onExit?: (id: string) => void | Promise<void>;
  onOutput?: (data: string) => void;
  /**
   * Bound on output held until the renderer reports its terminal ready. The default fits an ordinary
   * launch, whose pane exists before the process starts. A replacement process starts before its pane
   * adopts it and replays a whole conversation, so it asks for more; output past the bound is
   * forwarded as before (a later resize makes the TUI redraw).
   */
  startupBufferLimit?: { bytes: number; chunks: number };
  filterData?: (data: string) => string;
}

export function spawnPtyProcess(opts: SpawnPtyOptions): { id: string; pid: number } {
  const {
    id,
    spawnCmd,
    spawnArgs,
    cwd,
    env,
    terminals,
    mainWindow,
    getIsShuttingDown,
    launchLabel,
    harnessId,
    initialCommand,
    recipeCommandStartup,
    onExit,
  } = opts;

  const startupLimit = opts.startupBufferLimit ?? { bytes: 16 * 1024, chunks: 100 };

  const ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
    name: 'xterm-256color',
    cwd,
    env,
    handleFlowControl: false,
  });

  const terminal: Terminal = {
    id,
    pid: ptyProcess.pid,
    pty: ptyProcess,
    cwd,
    workspaceId: opts.workspaceId,
    checkoutContextId: opts.checkoutContextId,
    environmentId: opts.environmentId,
    remoteWorkingDir: opts.remoteWorkingDir,
    harnessId,
    startupBuffer: [],
    startupBufferReady: false,
    initialCommand,
    recipeCommandStartup,
  };
  let cleanup: Promise<void> | undefined;
  terminal.releaseResources = () => {
    if (!cleanup) {
      // Reserve once before invoking callbacks, including reentrant exit/kill.
      let finish!: () => void;
      cleanup = new Promise<void>((resolve) => { finish = resolve; });
      pendingCleanups.add(cleanup);
      void (async () => {
        try { await onExit?.(id); }
        catch (error) { console.warn('[clanker-grid] terminal resource cleanup failed:', error); }
        finally { pendingCleanups.delete(cleanup!); finish(); }
      })();
    }
    return cleanup;
  };
  terminals.set(id, terminal);

  if (launchLabel && isWindowAvailable(mainWindow)) {
    mainWindow.webContents.send(TERMINAL_DATA, { id, data: `${launchLabel}\r\n` });
  }

  ptyProcess.onData((data: string) => {
    if (getIsShuttingDown()) return;
    const term = terminals.get(id);
    if (!term) return;
    data = opts.filterData?.(data) ?? data;
    if (!data) return;
    try { opts.onOutput?.(data); }
    catch (error) { console.warn('[clanker-grid] terminal output observer failed:', error); }
    term.recipeCommandStartup?.onData(data);

    if (!term.startupBufferReady) {
      const totalSize = term.startupBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
      if (totalSize < startupLimit.bytes && term.startupBuffer.length < startupLimit.chunks) {
        term.startupBuffer.push(data);
        return;
      }
    }

    if (isWindowAvailable(mainWindow)) {
      mainWindow.webContents.send(TERMINAL_DATA, { id, data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminal.recipeCommandStartup?.onExit(exitCode);
    void terminal.releaseResources?.();
    if (getIsShuttingDown()) return;
    terminals.delete(id);
    if (isWindowAvailable(mainWindow)) {
      mainWindow.webContents.send(TERMINAL_EXIT, { id, exitCode });
    }
  });

  return { id, pid: ptyProcess.pid };
}
