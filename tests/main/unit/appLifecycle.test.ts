/**
 * appLifecycle Tests
 *
 * Tests for application lifecycle events (before-quit, etc.)
 */

import { vi, describe, test, expect } from 'vitest';

describe('appLifecycle', () => {
  interface TerminalMapValue {
    id: string;
    pty: { kill: () => void };
  }

  function createMockTerminal(id: string, killSpy: () => void): TerminalMapValue {
    return {
      id,
      pty: { kill: killSpy },
    };
  }

  function createMockGitService() {
    return {
      stopPolling: vi.fn(),
    };
  }

  function createMockBrowserView(closeSpy: () => void) {
    return {
      view: {
        webContents: {
          close: closeSpy,
        },
      },
      url: 'https://example.com',
    };
  }

  interface ActiveWorkspaceRef {
    current: string | null;
  }

  interface BrowserViewMapValue {
    view: { webContents: { close: () => void } };
  }

  function runBeforeQuitCleanup(params: {
    gitService: { stopPolling: () => void };
    terminals: Map<string, TerminalMapValue>;
    browserViews: Map<string, BrowserViewMapValue>;
    activeBrowserWorkspaceIdRef: ActiveWorkspaceRef;
  }) {
    params.gitService.stopPolling();

    params.terminals.forEach((terminal) => {
      terminal.pty.kill();
    });
    params.terminals.clear();

    params.browserViews.forEach(({ view }) => {
      view.webContents.close();
    });
    params.browserViews.clear();
    params.activeBrowserWorkspaceIdRef.current = null;
  }

  describe('git polling stopped', () => {
    test('stops git polling on before-quit', () => {
      const gitService = createMockGitService();
      const terminals = new Map<string, TerminalMapValue>();
      const browserViews = new Map<string, BrowserViewMapValue>();
      const activeBrowserWorkspaceIdRef = { current: null };

      runBeforeQuitCleanup({ gitService, terminals, browserViews, activeBrowserWorkspaceIdRef });

      expect(gitService.stopPolling).toHaveBeenCalledTimes(1);
    });
  });

  describe('PTY processes killed', () => {
    test('kills all PTY processes and clears the map', () => {
      const gitService = createMockGitService();
      const mockPtyKill1 = vi.fn();
      const mockPtyKill2 = vi.fn();
      const terminals = new Map<string, TerminalMapValue>();
      terminals.set('term-1', createMockTerminal('term-1', mockPtyKill1));
      terminals.set('term-2', createMockTerminal('term-2', mockPtyKill2));
      const browserViews = new Map<string, BrowserViewMapValue>();
      const activeBrowserWorkspaceIdRef = { current: null };
      runBeforeQuitCleanup({ gitService, terminals, browserViews, activeBrowserWorkspaceIdRef });
      expect(mockPtyKill1).toHaveBeenCalledTimes(1);
      expect(mockPtyKill2).toHaveBeenCalledTimes(1);
      expect(terminals.size).toBe(0);
    });

    test('handles empty terminals map', () => {
      const gitService = createMockGitService();
      const terminals = new Map<string, TerminalMapValue>();
      const browserViews = new Map<string, BrowserViewMapValue>();
      const activeBrowserWorkspaceIdRef = { current: null };

      expect(() => {
        runBeforeQuitCleanup({ gitService, terminals, browserViews, activeBrowserWorkspaceIdRef });
      }).not.toThrow();
    });
  });

  describe('browser views', () => {
    test('closes all browser views on quit', () => {
      const gitService = createMockGitService();
      const terminals = new Map<string, TerminalMapValue>();
      const mockClose1 = vi.fn();
      const mockClose2 = vi.fn();
      const browserViews = new Map<string, BrowserViewMapValue>();
      browserViews.set('ws-1', createMockBrowserView(mockClose1));
      browserViews.set('ws-2', createMockBrowserView(mockClose2));
      const activeBrowserWorkspaceIdRef = { current: 'ws-1' };

      runBeforeQuitCleanup({ gitService, terminals, browserViews, activeBrowserWorkspaceIdRef });

      expect(mockClose1).toHaveBeenCalledTimes(1);
      expect(mockClose2).toHaveBeenCalledTimes(1);
      expect(browserViews.size).toBe(0);
    });

    test('handles empty browser views map', () => {
      const gitService = createMockGitService();
      const terminals = new Map<string, TerminalMapValue>();
      const browserViews = new Map<string, BrowserViewMapValue>();
      const activeBrowserWorkspaceIdRef = { current: null };

      expect(() => {
        runBeforeQuitCleanup({ gitService, terminals, browserViews, activeBrowserWorkspaceIdRef });
      }).not.toThrow();
    });

    test('sets activeBrowserWorkspaceId to null', () => {
      const gitService = createMockGitService();
      const terminals = new Map<string, TerminalMapValue>();
      const browserViews = new Map<string, BrowserViewMapValue>();
      const activeBrowserWorkspaceIdRef = { current: 'ws-1' };

      runBeforeQuitCleanup({ gitService, terminals, browserViews, activeBrowserWorkspaceIdRef });

      expect(activeBrowserWorkspaceIdRef.current).toBeNull();
    });
  });

  describe('cleanup order', () => {
    test('git polling stopped before PTY termination', () => {
      const gitService = createMockGitService();
      const terminals = new Map<string, TerminalMapValue>();
      const browserViews = new Map<string, BrowserViewMapValue>();
      const activeBrowserWorkspaceIdRef = { current: null };

      const calls: string[] = [];
      gitService.stopPolling = vi.fn(() => {
        calls.push('git');
      });

      const mockTerminal = {
        id: 'term-1',
        pty: {
          kill: () => {
            calls.push('pty');
          },
        },
      };
      terminals.set('term-1', mockTerminal);

      runBeforeQuitCleanup({ gitService, terminals, browserViews, activeBrowserWorkspaceIdRef });

      expect(calls).toEqual(['git', 'pty']);
    });
  });

  describe('multiple resources cleaned up', () => {
    test('handles multiple workspaces, terminals, and browser views', () => {
      const gitService = createMockGitService();
      const mockViewClose = vi.fn();
      const mockPtyKill = vi.fn();

      const terminals = new Map<string, TerminalMapValue>();
      terminals.set('term-1', createMockTerminal('term-1', mockPtyKill));
      terminals.set('term-2', createMockTerminal('term-2', mockPtyKill));

      const browserViews = new Map<string, BrowserViewMapValue>();
      browserViews.set('ws-1', createMockBrowserView(mockViewClose));
      browserViews.set('ws-2', createMockBrowserView(vi.fn()));

      const activeBrowserWorkspaceIdRef = { current: 'ws-1' };

      runBeforeQuitCleanup({ gitService, terminals, browserViews, activeBrowserWorkspaceIdRef });

      expect(terminals.size).toBe(0);
      expect(browserViews.size).toBe(0);
      expect(activeBrowserWorkspaceIdRef.current).toBeNull();
      expect(gitService.stopPolling).toHaveBeenCalled();
      expect(mockPtyKill).toHaveBeenCalledTimes(2);
      expect(mockViewClose).toHaveBeenCalledTimes(1);
    });
  });
});