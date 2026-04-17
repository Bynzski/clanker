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

export interface SpawnPtyOptions {
  id: string;
  spawnCmd: string;
  spawnArgs: string[];
  cwd: string;
  env: { [key: string]: string };
  terminals: Map<string, Terminal>;
  mainWindow: BrowserWindow | null;
  getIsShuttingDown: () => boolean;
  /** Optional banner line sent to the renderer before any PTY data. */
  launchLabel?: string;
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
  } = opts;

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
    startupBuffer: [],
    startupBufferReady: false,
  };
  terminals.set(id, terminal);

  if (launchLabel && mainWindow) {
    mainWindow.webContents.send(TERMINAL_DATA, { id, data: `${launchLabel}\r\n` });
  }

  ptyProcess.onData((data: string) => {
    if (getIsShuttingDown()) return;
    const term = terminals.get(id);
    if (!term) return;

    if (!term.startupBufferReady) {
      const totalSize = term.startupBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
      if (totalSize < 16 * 1024 && term.startupBuffer.length < 100) {
        term.startupBuffer.push(data);
        return;
      }
    }

    if (mainWindow) {
      mainWindow.webContents.send(TERMINAL_DATA, { id, data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (getIsShuttingDown()) return;
    terminals.delete(id);
    if (mainWindow) {
      mainWindow.webContents.send(TERMINAL_EXIT, { id, exitCode });
    }
  });

  return { id, pid: ptyProcess.pid };
}
