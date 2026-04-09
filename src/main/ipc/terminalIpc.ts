/**
 * Terminal IPC Handlers
 *
 * Registers all terminal-related IPC handlers. Extracted from main.ts per S2.1.
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import Store from 'electron-store';
import { buildHarnessSpawnArgs } from '../harnessLaunch';
import { trimBuffer, MAX_TERMINAL_BUFFER_BYTES } from '../terminalUtils';

interface Terminal {
  id: string;
  pid: number;
  pty: pty.IPty;
  buffer: string;
}

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
}

export function registerTerminalIpc(deps: RegisterTerminalIpcDeps): void {
  const { getTerminals, getMainWindow, getStore, getSafeWorkspacePath, getHarnessOptions } = deps;

  ipcMain.handle('spawn-terminal', (_, workingDir: string, harness?: string, model?: string) => {
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
      }
    );

    const terminal: Terminal = { id, pid: ptyProcess.pid, pty: ptyProcess, buffer: '' };
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
        mainWindow.webContents.send('terminal-data', { id, data: visibleLaunch });
        terminal.buffer += visibleLaunch;
      }
    }

    ptyProcess.onData((data: string) => {
      terminal.buffer += data;
      if (terminal.buffer.length > MAX_TERMINAL_BUFFER_BYTES) {
        terminal.buffer = trimBuffer(terminal.buffer, MAX_TERMINAL_BUFFER_BYTES);
      }
      if (mainWindow) {
        mainWindow.webContents.send('terminal-data', { id, data });
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      terminals.delete(id);
      if (mainWindow) {
        mainWindow.webContents.send('terminal-exit', { id, exitCode });
      }
    });

    return { id, pid: ptyProcess.pid };
  });

  ipcMain.handle('get-terminal-buffer', (_, id: string) => {
    const terminals = getTerminals();
    return terminals.get(id)?.buffer ?? '';
  });

  ipcMain.handle('write-terminal', (_, { id, data }: { id: string; data: string }) => {
    const terminals = getTerminals();
    const terminal = terminals.get(id);
    if (terminal) {
      terminal.pty.write(data);
    }
  });

  ipcMain.handle('resize-terminal', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const terminals = getTerminals();
    const terminal = terminals.get(id);
    if (terminal) {
      terminal.pty.resize(cols, rows);
    }
  });

  ipcMain.handle('kill-terminal', (_, id: string) => {
    const terminals = getTerminals();
    const terminal = terminals.get(id);
    if (terminal) {
      terminal.pty.kill();
      terminals.delete(id);
    }
  });

  ipcMain.handle('terminal:cleanup-workspace', (_, ids: string[]) => {
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
}
