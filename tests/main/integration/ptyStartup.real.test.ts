import { describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import type { BrowserWindow } from 'electron';
import type { Terminal } from '../../../src/main/ipc/terminalIpc';
import { TERMINAL_DATA } from '../../../src/shared/ipcChannels';

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }));
import { spawnPtyProcess, waitForTerminalCleanup } from '../../../src/main/ipc/ptySpawn';

/** A real native PTY, without a harness/model call: socket startup backpressure must not send XOFF,
 * lose/reorder bytes, or deadlock the READY transition. Windows keeps the simulated unit coverage. */
describe.skipIf(process.platform === 'win32')('real PTY startup backpressure', () => {
  it('holds a long startup until READY then delivers every byte exactly once in order', async () => {
    const terminals = new Map<string, Terminal>();
    const delivered: string[] = [];
    const window = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, isCrashed: () => false,
        send: (channel: string, payload: { data: string }) => { if (channel === TERMINAL_DATA) delivered.push(payload.data); } },
    };
    const body = 'BEGIN:' + '0123456789'.repeat(10_000) + ':END';
    const payload = 'SIZE:120x40:' + body;
    spawnPtyProcess({ id: 'real', spawnCmd: process.execPath,
      spawnArgs: ['-e', `process.stdout.write('SIZE:' + process.stdout.columns + 'x' + process.stdout.rows + ':' + ${JSON.stringify(body)}); setInterval(() => {}, 1000);`],
      cwd: os.tmpdir(), env: {}, terminals,
      mainWindow: window as unknown as BrowserWindow, getIsShuttingDown: () => false,
      startupBufferLimit: { bytes: 1024, chunks: 100 }, initialGeometry: { cols: 120, rows: 40 },
    });
    const terminal = terminals.get('real')!;
    try {
      await vi.waitFor(() => expect(terminal.startupPaused).toBe(true), { timeout: 3000 });
      expect(delivered).toEqual([]);
      expect(terminal.pty.cols).toBe(120);
      expect(terminal.pty.rows).toBe(40);
      const held = terminal.startupBuffer.join('');
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(terminal.startupBuffer.join('')).toBe(held); // Node socket reads really stopped
      for (const chunk of terminal.startupBuffer) window.webContents.send(TERMINAL_DATA, { data: chunk });
      terminal.startupBuffer = [];
      terminal.startupBufferReady = true;
      terminal.startupPaused = false;
      terminal.pty.resume();
      await vi.waitFor(() => expect(delivered.join('')).toBe(payload), { timeout: 3000 });
    } finally {
      terminal.pty.resume();
      terminal.pty.kill();
      await terminal.exited;
      await waitForTerminalCleanup();
    }
  }, 10_000);
});
