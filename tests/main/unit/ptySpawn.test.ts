import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { Terminal } from '../../../src/main/ipc/terminalIpc';
import { TERMINAL_DATA } from '../../../src/shared/ipcChannels';
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
import { spawn } from 'node-pty';
import { spawnPtyProcess, waitForTerminalCleanup } from '../../../src/main/ipc/ptySpawn';

function fixture(onOutput?: (chunk: string) => void, startupBufferLimit?: { bytes: number; chunks: number }, initialGeometry?: { cols: number; rows: number }) {
  let exited!: (event: { exitCode: number }) => void;
  let data!: (chunk: string) => void;
  let paused = false;
  const pending: string[] = [];
  const process = {
    pid: 1, onExit: (callback: typeof exited) => { exited = callback; }, onData: (callback: typeof data) => { data = callback; },
    pause: vi.fn(() => { paused = true; }),
    resume: vi.fn(() => { paused = false; while (!paused && pending.length) data(pending.shift()!); }),
  };
  vi.mocked(spawn).mockReturnValue(process as never);
  const terminals = new Map<string, Terminal>();
  const window = { isDestroyed: vi.fn().mockReturnValue(false), webContents: { isDestroyed: vi.fn().mockReturnValue(false), isCrashed: vi.fn().mockReturnValue(false), send: vi.fn() } };
  const onExit = vi.fn<() => void | Promise<void>>();
  spawnPtyProcess({ id: 'remote', spawnCmd: 'ssh', spawnArgs: [], cwd: '/desktop', env: {}, terminals,
    mainWindow: window as unknown as BrowserWindow, getIsShuttingDown: () => false, onExit, onOutput, startupBufferLimit, initialGeometry, filterData: (data) => data.replace("SECRET", "") });
  return { terminals, window, onExit, process, exit: () => exited({ exitCode: 0 }),
    data: (chunk: string) => { if (paused) pending.push(chunk); else data(chunk); },
    ready: () => {
      const terminal = terminals.get('remote')!;
      for (const chunk of terminal.startupBuffer) window.webContents.send(TERMINAL_DATA, { id: 'remote', data: chunk });
      terminal.startupBuffer = [];
      terminal.startupBufferReady = true;
      terminal.startupPaused = false;
      process.resume();
    },
  };
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

  it('an ordinary launch holds 16 KiB or 100 chunks for the renderer, then pauses socket reads', () => {
    const f = fixture();
    for (let index = 0; index < 100; index += 1) f.data('x');
    expect(f.terminals.get('remote')!.startupBuffer).toHaveLength(100);
    expect(flushed(f)).toBe(0);
    f.data('overflow');
    expect(f.terminals.get('remote')!.startupBuffer).toHaveLength(100);
    expect(f.process.pause).toHaveBeenCalledOnce();
    expect(flushed(f)).toBe(0);
    f.ready();
    expect(flushed(f)).toBe(101); // prefix drained BEFORE resumed socket output

    const big = fixture();
    big.data('y'.repeat(16 * 1024));
    big.data('after');
    expect(flushed(big)).toBe(0);
    expect(big.process.pause).toHaveBeenCalledOnce();
    big.ready();
    expect(flushed(big)).toBe(2); // prefix then resumed data, never overflow followed by prefix
  });

  it('a replacement process, which starts before its pane adopts it, may hold much more', () => {
    const f = fixture(undefined, { bytes: 1024 * 1024, chunks: 8192 });
    f.data('z'.repeat(200 * 1024));
    for (let index = 0; index < 500; index += 1) f.data('c');
    expect(f.terminals.get('remote')!.startupBuffer).toHaveLength(501);
    expect(flushed(f)).toBe(0);
  });

  it('still bounds memory: past the larger bound reads pause until the prefix can be drained', () => {
    const f = fixture(undefined, { bytes: 1000, chunks: 5 });
    for (let index = 0; index < 5; index += 1) f.data('a'.repeat(10));
    expect(f.terminals.get('remote')!.startupBuffer).toHaveLength(5);
    f.data('b');
    expect(f.terminals.get('remote')!.startupBuffer).toHaveLength(5);
    expect(flushed(f)).toBe(0);
    f.ready();
    expect(flushed(f)).toBe(6);
  });
});

describe('ordered startup overflow and geometry', () => {
  it('holds all data until READY, then delivers the prefix and queued suffix exactly once in order', () => {
    const f = fixture(undefined, { bytes: 4, chunks: 2 });
    f.data('ab'); f.data('cd'); f.data('ef'); f.data('gh');
    expect(f.window.webContents.send).not.toHaveBeenCalled();
    expect(f.terminals.get('remote')!.startupBuffer).toEqual(['ab', 'cd']);
    expect(f.terminals.get('remote')!.startupBufferReady).toBe(false);
    f.ready();
    f.data('ij');
    expect(f.window.webContents.send.mock.calls.map((call) => call[1].data)).toEqual(['ab', 'cd', 'ef', 'gh', 'ij']);
  });

  it('bounds UTF-8 bytes, including a single oversized chunk, without truncating output', () => {
    const f = fixture(undefined, { bytes: 4, chunks: 100 });
    f.data('界'); f.data('界界');
    expect(f.terminals.get('remote')!.startupBuffer).toEqual(['界', '界界']); // bound plus one chunk
    expect(f.process.pause).toHaveBeenCalledOnce();
    expect(f.window.webContents.send).not.toHaveBeenCalled();
    f.ready();
    expect(f.window.webContents.send.mock.calls.map((call) => call[1].data)).toEqual(['界', '界界']);
  });

  it('spawns a replacement at the known pane size with flow control still disabled', () => {
    fixture(undefined, undefined, { cols: 143, rows: 42 });
    expect(spawn).toHaveBeenLastCalledWith('ssh', [], expect.objectContaining({ cols: 143, rows: 42, handleFlowControl: false }));
  });

  it.each([{ cols: 0, rows: 20 }, { cols: 80.5, rows: 20 }, { cols: 80, rows: Infinity }, { cols: 1001, rows: 20 }])(
    'ignores invalid geometry %j', (geometry) => {
      fixture(undefined, undefined, geometry);
      const calls = vi.mocked(spawn).mock.calls;
      const options = calls[calls.length - 1][2]!;
      expect(options).not.toHaveProperty('cols');
      expect(options).not.toHaveProperty('rows');
    },
  );
});

describe('the terminal record\'s real-exit signal', () => {
  it('settles only on the PTY\'s own exit event, not when the record leaves the table or resources are released', async () => {
    const f = fixture();
    const record = f.terminals.get('remote')!;
    let settled = false;
    void record.exited!.then(() => { settled = true; });
    f.terminals.delete('remote');
    await record.releaseResources!();
    await Promise.resolve();
    expect(settled).toBe(false);
    f.exit();
    await record.exited;
    expect(settled).toBe(true);
  });
});
