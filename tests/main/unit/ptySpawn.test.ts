import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { Terminal } from '../../../src/main/ipc/terminalIpc';
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
import { spawn } from 'node-pty';
import { spawnPtyProcess, waitForTerminalCleanup } from '../../../src/main/ipc/ptySpawn';

function fixture() {
  let exited!: (event: { exitCode: number }) => void;
  let data!: (chunk: string) => void;
  const process = { pid: 1, onExit: (callback: typeof exited) => { exited = callback; }, onData: (callback: typeof data) => { data = callback; } };
  vi.mocked(spawn).mockReturnValue(process as never);
  const terminals = new Map<string, Terminal>();
  const window = { isDestroyed: vi.fn().mockReturnValue(false), webContents: { isDestroyed: vi.fn().mockReturnValue(false), isCrashed: vi.fn().mockReturnValue(false), send: vi.fn() } };
  const onExit = vi.fn<() => void | Promise<void>>();
  spawnPtyProcess({ id: 'remote', spawnCmd: 'ssh', spawnArgs: [], cwd: '/desktop', env: {}, terminals,
    mainWindow: window as unknown as BrowserWindow, getIsShuttingDown: () => false, onExit });
  return { terminals, window, onExit, exit: () => exited({ exitCode: 0 }), data: (chunk: string) => data(chunk) };
}
afterEach(async () => { await waitForTerminalCleanup(); vi.restoreAllMocks(); });

describe('PTY resource lifecycle', () => {
  it('releases resources once when explicit kill and late PTY exit overlap, and waits for cleanup', async () => {
    const f = fixture();
    let finish!: () => void;
    f.onExit.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const terminal = f.terminals.get('remote')!;
    const cleanup = terminal.releaseResources!();
    f.terminals.delete('remote'); // Explicit kill removes ownership before PTY reports exit.
    f.exit();
    expect(terminal.releaseResources!()).toBe(cleanup);
    expect(f.onExit).toHaveBeenCalledTimes(1);
    let drained = false;
    const drain = waitForTerminalCleanup().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    finish();
    await drain;
  });

  it.each(['isDestroyed', 'isCrashed'] as const)('cleans up when renderer %s without sending late terminal data or exit events', async (state) => {
    const f = fixture();
    f.window.webContents[state].mockReturnValue(true);
    f.terminals.get('remote')!.startupBufferReady = true;
    f.data('late data');
    f.exit();
    await waitForTerminalCleanup();
    expect(f.window.webContents.send).not.toHaveBeenCalled();
    expect(f.onExit).toHaveBeenCalledTimes(1);
    expect(f.terminals.size).toBe(0);
  });
});
