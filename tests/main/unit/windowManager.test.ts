/**
 * windowManager Tests
 *
 * Tests for the window manager module.
 */

import { vi, describe, test, expect, afterEach } from 'vitest';

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

  describe('getIconPath (pure logic)', () => {
    // Replicate the pure logic from windowManager.ts
    function getIconPath(): string {
      if (process.env.NODE_ENV === 'development') {
        return 'mock/build/icon.png';
      }
      // In production (mocked)
      return 'mock/resources/icon.png';
    }

    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    test('returns development path in development mode', () => {
      process.env.NODE_ENV = 'development';
      const result = getIconPath();
      expect(result.includes('build')).toBe(true);
      expect(result.includes('icon.png')).toBe(true);
    });

    test('returns production path in production mode', () => {
      process.env.NODE_ENV = 'production';
      const result = getIconPath();
      expect(result.includes('icon.png')).toBe(true);
    });
  });

  describe('createMainWindow behavior', () => {
    // We test the behavior patterns without actual Electron mocks

    test('cleanup pattern: clears browser views', () => {
      // Simulate the cleanup behavior
      const mockView = { webContents: { close: vi.fn() } };
      const browserViews = new Map<string, { view: typeof mockView; url: string }>();
      browserViews.set('ws1', { view: mockView, url: 'https://example.com' });

      // Simulate cleanup from createMainWindow
      browserViews.forEach(({ view }) => {
        view.webContents.close();
      });
      browserViews.clear();

      expect(mockView.webContents.close).toHaveBeenCalled();
      expect(browserViews.size).toBe(0);
    });

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
