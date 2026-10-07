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
import { isTerminalGeometry } from '../../shared/terminalGeometry';

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
   * adopts it and replays a whole conversation, so it asks for more. At the bound, socket reads pause
   * until READY (not XON/XOFF flow control), retaining at most the bound plus one native PTY chunk.
   */
  startupBufferLimit?: { bytes: number; chunks: number };
  /** Best-known pane geometry, especially for a replacement adopting the very same pane. */
  initialGeometry?: { cols: number; rows: number };
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
    ...(isTerminalGeometry(opts.initialGeometry) ? { cols: opts.initialGeometry.cols, rows: opts.initialGeometry.rows } : {}),
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
  // The process' real exit, owned by the record: lifecycle moves that must not overlap a live process wait on
  // this, never on the record having left the terminal table (which retirement does immediately).
  let markExited!: () => void;
  terminal.exited = new Promise<void>((resolve) => { markExited = resolve; });
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

  let startupBytes = 0;
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
      startupBytes += Buffer.byteLength(data);
      term.startupBuffer.push(data);
      if (!term.startupPaused && (startupBytes >= startupLimit.bytes || term.startupBuffer.length >= startupLimit.chunks)) {
        // node-pty.pause() pauses its Node socket reads; it sends no XOFF and handleFlowControl stays
        // false. Kernel backpressure bounds startup memory without dropping/reordering ANSI output or
        // sending it before xterm exists. READY drains the prefix before resuming this same stream.
        term.startupPaused = true;
        ptyProcess.pause();
      }
      return;
    }

    if (isWindowAvailable(mainWindow)) {
      mainWindow.webContents.send(TERMINAL_DATA, { id, data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    markExited();
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
