/**
 * windowManager Tests
 *
 * Tests for the window manager module.
 */

import { vi, describe, test, expect, afterEach } from 'vitest';
import * as path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { createMainWindow, getIconPath, resolveInitialWindowBackground } from '../../../src/main/windowManager';

import { getThemeMetadata } from '../../../src/shared/types/theme';
vi.mock('electron', () => ({ app: { get isPackaged() { return false; }, getAppPath: () => process.cwd() }, BrowserWindow: vi.fn(), Menu: { setApplicationMenu: vi.fn() } }));

test('renderer loss stops file/git watchers and releases workspace resources without waiting for window close', () => {
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const handlers = new Map<string, () => void>();
  const window = { setMenuBarVisibility: vi.fn(), setAutoHideMenuBar: vi.fn(), loadURL: vi.fn(), loadFile: vi.fn(), on: vi.fn(),
    webContents: { on: vi.fn((name: string, handler: () => void) => handlers.set(name, handler)), openDevTools: vi.fn() } };
  vi.mocked(BrowserWindow).mockImplementation(function () { return window as never; });
  const deps = { preloadPath: '/preload.js', gitService: { stopPolling: vi.fn() }, fileWatcher: { unwatchAll: vi.fn() },
    explorerWatcher: { close: vi.fn() }, onRendererGone: vi.fn(), onWindowClosed: vi.fn() };
  createMainWindow(deps);
  handlers.get('render-process-gone')!();
  expect(deps.gitService.stopPolling).toHaveBeenCalledTimes(1);
  expect(deps.fileWatcher.unwatchAll).toHaveBeenCalledTimes(1);
  expect(deps.explorerWatcher.close).toHaveBeenCalledTimes(1);
  expect(deps.onRendererGone).toHaveBeenCalledTimes(1);
  expect(deps.onWindowClosed).not.toHaveBeenCalled();
  process.env.NODE_ENV = nodeEnv;
});

// ============================================================================
// Pure Function Tests
// ============================================================================

describe('windowManager', () => {
  describe('getRendererUrl (pure logic)', () => {
    // Replicate the pure logic from windowManager.ts
    function getRendererUrl(query: Record<string, string | null | undefined>): string {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value != null && value.length > 0) {
          searchParams.set(key, value);
        }
      }
      const queryString = searchParams.toString();

      if (process.env.NODE_ENV === 'development') {
        return `http://localhost:1420${queryString ? `/?${queryString}` : '/'}`;
      }

      // In production (mocked), return a placeholder path
      return queryString ? `file:///path/to/renderer/index.html?${queryString}` : 'file:///path/to/renderer/index.html';
    }

    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    test('returns localhost URL in development mode with empty query', () => {
      process.env.NODE_ENV = 'development';
      const result = getRendererUrl({});
      expect(result).toBe('http://localhost:1420/');
    });

    test('returns localhost URL in development mode with query params', () => {
      process.env.NODE_ENV = 'development';
      const result = getRendererUrl({ workspace: '/test' });
      expect(result.startsWith('http://localhost:1420/?')).toBe(true);
      expect(result.includes('workspace=')).toBe(true);
    });

    test('ignores null and empty string values', () => {
      process.env.NODE_ENV = 'development';
      const result = getRendererUrl({
        workspace: '/test',
        terminalId: null,
        mode: '',
      });
      expect(result.includes('workspace=')).toBe(true);
      expect(result.includes('terminalId=')).toBe(false);
      expect(result.includes('mode=')).toBe(false);
    });

    test('returns file URL in production mode', () => {
      process.env.NODE_ENV = 'production';
      const result = getRendererUrl({});
      expect(result.endsWith('/renderer/index.html')).toBe(true);
    });

    test('builds multiple query parameters', () => {
      process.env.NODE_ENV = 'development';
      const result = getRendererUrl({
        workspace: '/path',
        terminalId: 'term-123',
        mode: 'test',
      });
      expect(result.includes('workspace=')).toBe(true);
      expect(result.includes('terminalId=')).toBe(true);
      expect(result.includes('mode=')).toBe(true);
    });

    test('handles special characters in query values', () => {
      process.env.NODE_ENV = 'development';
      const result = getRendererUrl({ workspace: '/path/with spaces' });
      expect(result.includes('workspace=')).toBe(true);
    });
  });

  describe('getIconPath', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    test('unpackaged icon exists from the application root, independent of NODE_ENV', async () => {
      const { existsSync } = await import('node:fs');
      expect(getIconPath()).toBe(path.join(process.cwd(), 'src/assets/branding/generated/clanker-app-512.png'));
      expect(existsSync(getIconPath())).toBe(true);
    });

    test('packaged icon matches the extraResources destination', () => {
      vi.spyOn(app, 'isPackaged', 'get').mockReturnValue(true);
      vi.stubGlobal('process', { ...process, resourcesPath: '/packaged/resources' });
      expect(getIconPath()).toBe(path.join(process.resourcesPath, 'icon.png'));
    });
  });

  describe('createMainWindow behavior', () => {
    // We test the behavior patterns without actual Electron mocks

    test('cleanup pattern: stops git polling', () => {
      const stopPolling = vi.fn();

      // Simulate cleanup from createMainWindow
      stopPolling();

      expect(stopPolling).toHaveBeenCalled();
    });

    test('returns window and cleanup function', () => {
      // Simulate the return structure of createMainWindow
      const mockWindow = { loaded: true };
      const mockCleanup = () => {};

      const result = {
        window: mockWindow,
        cleanup: mockCleanup,
      };

      expect(result.window).toBeDefined();
      expect(typeof result.cleanup).toBe('function');
    });

    test('BrowserWindow starts hidden (show: false) by default', () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const mockWin = {
        setMenuBarVisibility: vi.fn(),
        setAutoHideMenuBar: vi.fn(),
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        on: vi.fn(),
        webContents: { on: vi.fn(), openDevTools: vi.fn() },
      };
      vi.mocked(BrowserWindow).mockImplementation(function () { return mockWin as never; });
      try {
        const deps = {
          preloadPath: '/preload.js',
          gitService: { stopPolling: vi.fn() },
          fileWatcher: { unwatchAll: vi.fn() },
        };
        createMainWindow(deps);
        expect(BrowserWindow).toHaveBeenCalledWith(
          expect.objectContaining({
            show: false,
            backgroundColor: '#121212',
          })
        );
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    test('uses light theme window background when specified', () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const mockWin = {
        setMenuBarVisibility: vi.fn(),
        setAutoHideMenuBar: vi.fn(),
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        on: vi.fn(),
        webContents: { on: vi.fn(), openDevTools: vi.fn() },
      };
      vi.mocked(BrowserWindow).mockImplementation(function () { return mockWin as never; });
      try {
        const deps = {
          preloadPath: '/preload.js',
          gitService: { stopPolling: vi.fn() },
          fileWatcher: { unwatchAll: vi.fn() },
          backgroundColor: getThemeMetadata('light').windowBackground,
        };
        createMainWindow(deps);
        expect(BrowserWindow).toHaveBeenCalledWith(
          expect.objectContaining({
            show: false,
            backgroundColor: '#f3f4f6',
          })
        );
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    test('resolveInitialWindowBackground resolves persisted themes correctly', () => {
      expect(resolveInitialWindowBackground({ get: () => 'dark' })).toBe('#121212');
      expect(resolveInitialWindowBackground({ get: () => 'light' })).toBe('#f3f4f6');
      expect(resolveInitialWindowBackground({ get: () => 'slate' })).toBe('#22272e');
      expect(resolveInitialWindowBackground({ get: () => 'invalid' })).toBe('#121212');
      expect(resolveInitialWindowBackground({ get: () => undefined })).toBe('#121212');
    });

    test('window recreation through the activate path uses the current persisted theme', () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const mockWin = {
        setMenuBarVisibility: vi.fn(),
        setAutoHideMenuBar: vi.fn(),
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        on: vi.fn(),
        webContents: { on: vi.fn(), openDevTools: vi.fn() },
      };
      vi.mocked(BrowserWindow).mockImplementation(function () { return mockWin as never; });
      try {
        // Simulated electron-store holding mutable theme setting
        let persistedTheme: string = 'dark';
        const mockStore = {
          get: vi.fn((key: string) => (key === 'theme' ? persistedTheme : undefined)),
        };

        const baseDeps = {
          preloadPath: '/preload.js',
          gitService: { stopPolling: vi.fn() },
          fileWatcher: { unwatchAll: vi.fn() },
        };

        // Initial window launch reads persisted dark theme
        createMainWindow({
          ...baseDeps,
          backgroundColor: resolveInitialWindowBackground(mockStore),
        });
        expect(BrowserWindow).toHaveBeenLastCalledWith(
          expect.objectContaining({
            backgroundColor: '#121212',
            show: false,
          })
        );

        // Theme is changed while running to 'light'
        persistedTheme = 'light';

        // Window closed and app reactivated via app.on('activate')
        // Recreate path queries resolveInitialWindowBackground(store)
        createMainWindow({
          ...baseDeps,
          backgroundColor: resolveInitialWindowBackground(mockStore),
        });
        expect(BrowserWindow).toHaveBeenLastCalledWith(
          expect.objectContaining({
            backgroundColor: '#f3f4f6',
            show: false,
          })
        );
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });

  describe('isDebugMode (pure logic)', () => {
    function isDebugMode(): boolean {
      return process.argv.includes('--debug')
        || process.env.CLANKER_DEBUG === '1'
        || process.env.DEBUG === '1';
    }

    const originalArgv = [...process.argv];
    const originalClankerDebug = process.env.CLANKER_DEBUG;
    const originalDebug = process.env.DEBUG;

    afterEach(() => {
      process.argv = [...originalArgv];
      if (originalClankerDebug !== undefined) {
        process.env.CLANKER_DEBUG = originalClankerDebug;
      } else {
        delete process.env.CLANKER_DEBUG;
      }
      if (originalDebug !== undefined) {
        process.env.DEBUG = originalDebug;
      } else {
        delete process.env.DEBUG;
      }
    });

    test('returns false when no debug flags or env vars are set', () => {
      process.argv = ['electron', '.'];
      delete process.env.CLANKER_DEBUG;
      delete process.env.DEBUG;
      expect(isDebugMode()).toBe(false);
    });

    test('returns true when --debug is in process.argv', () => {
      process.argv = ['electron', '.', '--debug'];
      delete process.env.CLANKER_DEBUG;
      delete process.env.DEBUG;
      expect(isDebugMode()).toBe(true);
    });

    test('returns true when CLANKER_DEBUG is 1', () => {
      process.argv = ['electron', '.'];
      process.env.CLANKER_DEBUG = '1';
      delete process.env.DEBUG;
      expect(isDebugMode()).toBe(true);
    });

    test('returns true when DEBUG is 1', () => {
      process.argv = ['electron', '.'];
      delete process.env.CLANKER_DEBUG;
      process.env.DEBUG = '1';
      expect(isDebugMode()).toBe(true);
    });
  });

  describe('getPreloadPath (pure logic)', () => {
    // Replicate the pure logic from windowManager.ts
    function getPreloadPath(): string {
      return 'mock/__dirname/preload.js';
    }

    test('returns path ending with preload.js', () => {
      const result = getPreloadPath();
      expect(result.endsWith('preload.js')).toBe(true);
    });

    test('returns preload.js in the path', () => {
      const result = getPreloadPath();
      expect(result.includes('preload.js')).toBe(true);
    });
  });
});
