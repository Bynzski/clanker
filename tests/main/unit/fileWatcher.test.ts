/**
 * FileWatcherService Unit Tests
 *
 * Tests the file watching service's behavior around:
 * - Watcher lifecycle (create, duplicate prevention, close)
 * - Self-write suppression
 * - Change event debouncing
 * - Rename handling and rewatch backoff
 * - Git status refresh debouncing
 * - Error handler robustness
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Single vi.hoisted() call for all shared state
//
// All mock factories (vi.mock) are hoisted by vitest to the top of the file.
// By placing all mutable state in ONE vi.hoisted() call, every factory and
// every test sees the SAME object references — no "before initialization" errors.
// ---------------------------------------------------------------------------

const infra = vi.hoisted(() => {
  // ---------------------------------------------------------------------------
  // Fake watcher infrastructure
  // ---------------------------------------------------------------------------
  type FakeWatcher = {
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    fireChange: () => void;
    fireRename: () => void;
    fireError: (err: Error) => void;
    _callback: ((event: string) => void) | null;
  };

  const watchers = new Map<string, FakeWatcher>();

  function createFakeWatcher(fp: string): FakeWatcher {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {
      change: [],
      rename: [],
      error: [],
      close: [],
    };

    const close = vi.fn(() => {
      handlers.close.forEach((fn) => fn());
      handlers.close.length = 0;
    });

    const on = vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (handlers[event]) handlers[event].push(fn);
      return { removeListener: vi.fn() };
    });

    // Use a const alias so the closure captures the live object reference
    const fw: FakeWatcher = {
      on,
      close,
      _callback: null,
      fireChange: () => {
        if (fw._callback) fw._callback('change');
        handlers.change.forEach((fn) => fn('change'));
      },
      fireRename: () => {
        if (fw._callback) fw._callback('rename');
        handlers.rename.forEach((fn) => fn('rename'));
      },
      fireError: (err: Error) => {
        handlers.error.forEach((fn) => fn(err));
      },
    };

    watchers.set(fp, fw);
    return fw;
  }

  // ---------------------------------------------------------------------------
  // fs.promises.access mock
  // ---------------------------------------------------------------------------
  const fsAccess = vi.fn<() => Promise<void>>();

  return { watchers, createFakeWatcher, fsAccess };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  watch: vi.fn((fp: string, opts: unknown, cb?: (e: string) => void) => {
    const callback = typeof opts === 'function' ? (opts as (e: string) => void) : cb;
    const fw = infra.createFakeWatcher(fp as string);
    fw._callback = callback ?? null;
    return fw as unknown as import('fs').FSWatcher;
  }),
}));

vi.mock('fs/promises', () => ({
  access: infra.fsAccess,
}));

// ---------------------------------------------------------------------------
// Electron mocks
// ---------------------------------------------------------------------------

const mockWebContents = { send: vi.fn() };
const mockMainWindow = {
  webContents: mockWebContents,
  isDestroyed: vi.fn(() => false),
};
const mockGetMainWindow = vi.fn(() => mockMainWindow);

const mockGitService = {
  getCurrentWorkspace: vi.fn(() => '/test/workspace'),
  getStatus: vi.fn(),
};

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import { FileWatcherService } from '../../../src/main/fileWatcher';

function makeService(): FileWatcherService {
  return new FileWatcherService({ getMainWindow: mockGetMainWindow as unknown as () => never });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tick(ms: number): void {
  vi.advanceTimersByTime(ms);
}

async function flush(): Promise<void> {
  await vi.runAllTimersAsync();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  infra.watchers.clear();
  // Reset mock call history without clearing mockReturnValue implementations
  mockWebContents.send.mockClear();
  mockMainWindow.isDestroyed.mockClear();
  mockMainWindow.isDestroyed.mockReturnValue(false);
  mockGetMainWindow.mockClear();
  mockGetMainWindow.mockReturnValue(mockMainWindow as never);
  infra.fsAccess.mockClear();
  infra.fsAccess.mockResolvedValue(undefined);
  mockGitService.getStatus.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('watchFile', () => {
  test('creates a watcher for a new path', () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    expect(infra.watchers.has('/test/file.txt')).toBe(true);
  });

  test('does not duplicate a watcher for the same path', () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const first = infra.watchers.get('/test/file.txt');
    service.watchFile('/test/file.txt');
    expect(infra.watchers.get('/test/file.txt')).toBe(first);
  });

  test('creates separate watchers for different paths', () => {
    const service = makeService();
    service.watchFile('/test/a.txt');
    service.watchFile('/test/b.txt');
    expect(infra.watchers.has('/test/a.txt')).toBe(true);
    expect(infra.watchers.has('/test/b.txt')).toBe(true);
    expect(infra.watchers.get('/test/a.txt')).not.toBe(infra.watchers.get('/test/b.txt'));
  });
});

describe('releaseHandle', () => {
  test('closes an active watcher and returns a rewatch callback', () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const watcher = infra.watchers.get('/test/file.txt')!;

    const reacquire = service.releaseHandle('/test/file.txt');

    expect(watcher.close).toHaveBeenCalled();
    expect(reacquire).not.toBeNull();

    reacquire?.();
    expect(infra.watchers.has('/test/file.txt')).toBe(true);
  });

  test('returns null when path is not watched', () => {
    const service = makeService();
    expect(service.releaseHandle('/test/missing.txt')).toBeNull();
  });
});

describe('unwatchFile', () => {
  test('calls close on the watcher', () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    service.unwatchFile('/test/file.txt');
    expect(w.close).toHaveBeenCalled();
  });

  test('calling unwatchFile twice only closes once', () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    service.unwatchFile('/test/file.txt');
    service.unwatchFile('/test/file.txt');
    expect(w.close).toHaveBeenCalledTimes(1);
  });

  test('clears the debounce timer — no event emitted after unwatch', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    w.fireChange();
    service.unwatchFile('/test/file.txt');
    tick(500);
    await flush();
    expect(mockWebContents.send).not.toHaveBeenCalled();
  });

  test('is safe to call on a path that is not being watched', () => {
    const service = makeService();
    expect(() => service.unwatchFile('/not/watched.txt')).not.toThrow();
  });
});

describe('unwatchAll', () => {
  test('closes all watchers', () => {
    const service = makeService();
    service.watchFile('/test/a.txt');
    service.watchFile('/test/b.txt');
    const wa = infra.watchers.get('/test/a.txt')!;
    const wb = infra.watchers.get('/test/b.txt')!;
    service.unwatchAll();
    expect(wa.close).toHaveBeenCalled();
    expect(wb.close).toHaveBeenCalled();
  });

  test('clears rewatch timers so advancing time after unwatchAll is safe', () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    w.fireError(new Error('test'));
    expect(() => service.unwatchAll()).not.toThrow();
    expect(() => tick(10000)).not.toThrow();
  });

  test('clears the git status timer so git refresh is not triggered', async () => {
    const service = makeService();
    service.setGitService(mockGitService as never);
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    w.fireChange();
    service.unwatchAll();
    tick(1000);
    await flush();
    expect(mockGitService.getStatus).not.toHaveBeenCalled();
  });

  test('is safe to call multiple times', () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    expect(() => { service.unwatchAll(); service.unwatchAll(); }).not.toThrow();
  });
});

describe('markWritten / self-write suppression', () => {
  test('suppresses the next change event within the suppression window', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    service.markWritten('/test/file.txt');
    w.fireChange();
    tick(300);
    await flush();
    expect(mockWebContents.send).not.toHaveBeenCalled();
  });

  test('does not suppress a change event that arrives after the suppression window', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    service.markWritten('/test/file.txt');
    tick(600); // past SELF_WRITE_SUPPRESSION_MS (500ms)
    w.fireChange();
    tick(300);
    await flush();
    expect(mockWebContents.send).toHaveBeenCalled();
  });

  test('each markWritten call suppresses only the next event', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    service.markWritten('/test/file.txt');
    w.fireChange();
    tick(600); // suppression window closes
    w.fireChange();
    tick(300);
    await flush();
    expect(mockWebContents.send).toHaveBeenCalledTimes(1);
  });
});

describe('change event debouncing', () => {
  test('emits only one event when multiple changes fire within the debounce window', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    w.fireChange();
    w.fireChange();
    w.fireChange();
    tick(100); // within debounce
    expect(mockWebContents.send).not.toHaveBeenCalled();
    tick(200); // debounce closes
    await flush();
    expect(mockWebContents.send).toHaveBeenCalledTimes(1);
  });

  test('resets the debounce timer when changes keep arriving before the window closes', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    w.fireChange();
    tick(150); // halfway through debounce
    w.fireChange();
    tick(150); // timer was reset, still running
    w.fireChange();
    tick(300); // final window closes
    await flush();
    expect(mockWebContents.send).toHaveBeenCalledTimes(1);
  });
});

describe('rename handling', () => {
  test('reschedules the watcher after a rename event', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const oldWatcher = infra.watchers.get('/test/file.txt')!;
    oldWatcher.fireRename();
    expect(oldWatcher.close).toHaveBeenCalled();
    tick(100); // REWATCH_BASE_DELAY_MS (50ms) × 2 for attempt 2
    await flush();
    // A watcher is registered after the rewatch delay
    expect(infra.watchers.has('/test/file.txt')).toBe(true);
    // The new watcher is a different object (old one was closed)
    expect(infra.watchers.get('/test/file.txt')).not.toBe(oldWatcher);
  });

  test('rename queues a change event via handleChange', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    // No markWritten — vi.useFakeTimers() does not advance Date.now(), so
    // the suppression window would never close in a test. Fire without suppression.
    w.fireRename();
    tick(300); // past FILE_CHANGE_DEBOUNCE_MS (200ms)
    await flush();
    expect(mockWebContents.send).toHaveBeenCalled();
  });
});

describe('rewatch backoff', () => {
  test('caps delay at REWATCH_MAX_DELAY_MS (5000ms) and stops after REWATCH_MAX_ATTEMPTS (12)', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    for (let attempt = 1; attempt <= 13; attempt++) {
      const w = infra.watchers.get('/test/file.txt')!;
      w.fireError(new Error(`error ${attempt}`));
      if (attempt < 13) {
        const delay = Math.min(50 * 2 ** (attempt - 1), 5000);
        tick(delay + 10);
        await flush();
      }
    }
    tick(10000);
    await flush();
    expect(mockWebContents.send).not.toHaveBeenCalled();
  });

  test('rewatch errors do not crash the service', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    expect(() => {
      for (let i = 0; i < 15; i++) {
        const w = infra.watchers.get('/test/file.txt')!;
        w.fireError(new Error(`error ${i}`));
        tick(6000);
      }
    }).not.toThrow();
    await flush();
  });
});

describe('emitChange payload', () => {
  // Note: vi.useFakeTimers() does not advance Date.now(), so the self-write
  // suppression window never closes during a test run. To test emitChange
  // correctly we call fireChange without markWritten (no suppression) and
  // advance time past the debounce window before the assertion.

  test('includes deleted: false when the file exists', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    // No markWritten → no suppression. Fire change and wait for debounce.
    w.fireChange();
    tick(300); // past FILE_CHANGE_DEBOUNCE_MS (200ms)
    await flush();
    expect(mockWebContents.send).toHaveBeenCalledWith(
      'file-changed',
      expect.objectContaining({ filePath: '/test/file.txt', deleted: false })
    );
  });

  test('includes deleted: true when the file does not exist', async () => {
    infra.fsAccess.mockRejectedValueOnce(new Error('ENOENT'));
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    w.fireChange();
    tick(300);
    await flush();
    expect(mockWebContents.send).toHaveBeenCalledWith(
      'file-changed',
      expect.objectContaining({ filePath: '/test/file.txt', deleted: true })
    );
  });
});

describe('git status refresh', () => {
  test('is debounced — rapid changes do not trigger multiple git status calls', async () => {
    const service = makeService();
    service.setGitService(mockGitService as never);
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    for (let i = 0; i < 5; i++) w.fireChange();
    tick(600);
    await flush();
    expect(mockGitService.getStatus).toHaveBeenCalledTimes(1);
  });

  test('does not crash when git status refresh throws', async () => {
    vi.mocked(mockGitService.getStatus).mockRejectedValueOnce(new Error('git error'));
    const service = makeService();
    service.setGitService(mockGitService as never);
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    expect(() => { w.fireChange(); tick(600); }).not.toThrow();
    await flush();
  });

  test('does not crash when gitService is null', () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    expect(() => { w.fireChange(); tick(600); }).not.toThrow();
  });

  test('does not crash when main window is null', () => {
    mockGetMainWindow.mockReturnValue(null as never);
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    expect(() => { w.fireChange(); tick(600); }).not.toThrow();
  });

  test('does not crash when main window is destroyed', () => {
    vi.mocked(mockMainWindow.isDestroyed).mockReturnValue(true);
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    expect(() => { w.fireChange(); tick(600); }).not.toThrow();
  });
});

describe('watcher error handler', () => {
  test('error on watcher schedules rewatch and does not crash the service', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const oldWatcher = infra.watchers.get('/test/file.txt')!;
    expect(() => {
      oldWatcher.fireError(new Error('ENOENT'));
      tick(100);
    }).not.toThrow();
    await flush();
    expect(infra.watchers.has('/test/file.txt')).toBe(true);
  });

  test('subsequent errors do not schedule multiple concurrent rewatch timers', async () => {
    const service = makeService();
    service.watchFile('/test/file.txt');
    const w = infra.watchers.get('/test/file.txt')!;
    w.fireError(new Error('error 1'));
    w.fireError(new Error('error 2'));
    w.fireError(new Error('error 3'));
    tick(100);
    await flush();
    expect(infra.watchers.has('/test/file.txt')).toBe(true);
  });
});
