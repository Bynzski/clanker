import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { Terminal } from '../../../src/main/ipc/terminalIpc';
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
import { spawn } from 'node-pty';
import { spawnPtyProcess, waitForTerminalCleanup } from '../../../src/main/ipc/ptySpawn';

function fixture(onOutput?: (chunk: string) => void, startupBufferLimit?: { bytes: number; chunks: number }) {
  let exited!: (event: { exitCode: number }) => void;
  let data!: (chunk: string) => void;
  const process = { pid: 1, onExit: (callback: typeof exited) => { exited = callback; }, onData: (callback: typeof data) => { data = callback; } };
  vi.mocked(spawn).mockReturnValue(process as never);
  const terminals = new Map<string, Terminal>();
  const window = { isDestroyed: vi.fn().mockReturnValue(false), webContents: { isDestroyed: vi.fn().mockReturnValue(false), isCrashed: vi.fn().mockReturnValue(false), send: vi.fn() } };
  const onExit = vi.fn<() => void | Promise<void>>();
  spawnPtyProcess({ id: 'remote', spawnCmd: 'ssh', spawnArgs: [], cwd: '/desktop', env: {}, terminals,
    mainWindow: window as unknown as BrowserWindow, getIsShuttingDown: () => false, onExit, onOutput, startupBufferLimit, filterData: (data) => data.replace("SECRET", "") });
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

it('observes filtered output before the startup handshake, but ignores closed terminal output', () => {
  const observe = vi.fn(), f = fixture(observe);
  f.data('SECREThttp://localhost:5173\n');
  expect(observe).toHaveBeenCalledExactlyOnceWith('http://localhost:5173\n');
  f.terminals.delete('remote'); f.data('late'); expect(observe).toHaveBeenCalledTimes(1);
});

describe('startup buffer bound', () => {
  const flushed = (f: ReturnType<typeof fixture>) => f.window.webContents.send.mock.calls.length;

  it('an ordinary launch holds 16 KiB or 100 chunks for the renderer, then forwards the rest', () => {
    const f = fixture();
    for (let index = 0; index < 100; index += 1) f.data('x');
    expect(f.terminals.get('remote')!.startupBuffer).toHaveLength(100);
    expect(flushed(f)).toBe(0);
    f.data('overflow');
    expect(f.terminals.get('remote')!.startupBuffer).toHaveLength(100);
    expect(flushed(f)).toBe(1);

    const big = fixture();
    big.data('y'.repeat(16 * 1024));
    big.data('after');
    expect(flushed(big)).toBe(1); // past 16 KiB it is forwarded
  });

  it('a replacement process, which starts before its pane adopts it, may hold much more', () => {
    const f = fixture(undefined, { bytes: 1024 * 1024, chunks: 8192 });
    f.data('z'.repeat(200 * 1024));
    for (let index = 0; index < 500; index += 1) f.data('c');
    expect(f.terminals.get('remote')!.startupBuffer).toHaveLength(501);
    expect(flushed(f)).toBe(0);
  });

  it('still bounds memory: past the larger bound the output is forwarded, never buffered without limit', () => {
    const f = fixture(undefined, { bytes: 1000, chunks: 5 });
    for (let index = 0; index < 5; index += 1) f.data('a'.repeat(10));
    expect(f.terminals.get('remote')!.startupBuffer).toHaveLength(5);
    f.data('b');
    expect(f.terminals.get('remote')!.startupBuffer).toHaveLength(5);
    expect(flushed(f)).toBe(1);
  });
});
