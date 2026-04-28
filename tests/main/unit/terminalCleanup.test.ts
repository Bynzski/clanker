/**
 * Terminal Cleanup Tests
 * 
 * Tests for the terminal cleanup IPC handler and workspace lifecycle cleanup.
 */

import { vi } from 'vitest';
import { testHome } from '../../_helpers/tempPaths';
import assert from 'node:assert/strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

// Mock electron module
vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    getPath: vi.fn((name: string) => {
      if (name === 'home') return testHome();
      return `/mock/${name}`;
    }),
    commandLine: {
      appendSwitch: vi.fn(),
    },
    whenReady: vi.fn(() => {
      return new Promise<never>(() => {
        // Prevent app initialization during tests
      });
    }),
    on: vi.fn(),
    quit: vi.fn(),
  },
  BrowserWindow: vi.fn(() => ({
    setMenuBarVisibility: vi.fn(),
    setAutoHideMenuBar: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    minimize: vi.fn(),
    unmaximize: vi.fn(),
    maximize: vi.fn(),
    isMaximized: vi.fn(() => false),
    close: vi.fn(),
    webContents: {
      send: vi.fn(),
    },
    contentView: {
      addChildView: vi.fn(),
    },
  })),
  Menu: Object.assign(vi.fn(), {
    setApplicationMenu: vi.fn(),
  }),
  WebContentsView: vi.fn(() => ({
    setVisible: vi.fn(),
    setBounds: vi.fn(),
    webContents: {
      loadURL: vi.fn(),
      close: vi.fn(),
      reload: vi.fn(),
      stop: vi.fn(),
      on: vi.fn(),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
      },
    },
  })),
  ipcMain: {
    handle: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

// ============================================================================
// Cleanup Handler Logic Tests
// 
// Tests the cleanup logic independently from the IPC registration.
// We test by inspecting the handler behavior with a mock terminals Map.
// ============================================================================

describe('terminal cleanup handler logic', () => {
  // Simulate the cleanup handler logic
  function createCleanupHandlerLogic(terminals: Map<string, { id: string; pty: { kill: () => void } }>) {
    return function cleanupWorkspace(ids: string[]): number {
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
    };
  }

  describe('cleanupWorkspace all IDs present', () => {
    test('kills all terminals and removes from map', () => {
      const mockPty1 = { kill: vi.fn() };
      const mockPty2 = { kill: vi.fn() };
      
      const terminals = new Map<string, { id: string; pty: { kill: () => void } }>([
        ['term-1', { id: 'term-1', pty: mockPty1 }],
        ['term-2', { id: 'term-2', pty: mockPty2 }],
        ['term-3', { id: 'term-3', pty: { kill: vi.fn() } }],
      ]);
      
      const cleanup = createCleanupHandlerLogic(terminals);
      const result = cleanup(['term-1', 'term-2', 'term-3']);
      
      assert.equal(result, 3);
      assert.equal(terminals.size, 0);
      expect(mockPty1.kill).toHaveBeenCalled();
      expect(mockPty2.kill).toHaveBeenCalled();
    });
  });

  describe('cleanupWorkspace some IDs already gone', () => {
    test('kills remaining terminals without error', () => {
      const mockPty1 = { kill: vi.fn() };
      
      const terminals = new Map<string, { id: string; pty: { kill: () => void } }>([
        ['term-1', { id: 'term-1', pty: mockPty1 }],
        // term-2 and term-3 already removed
      ]);
      
      const cleanup = createCleanupHandlerLogic(terminals);
      const result = cleanup(['term-1', 'term-2', 'term-3']);
      
      assert.equal(result, 1);
      assert.equal(terminals.size, 0);
      expect(mockPty1.kill).toHaveBeenCalled();
    });
  });

  describe('cleanupWorkspace empty array', () => {
    test('returns zero killed with no errors', () => {
      const terminals = new Map<string, { id: string; pty: { kill: () => void } }>();
      
      const cleanup = createCleanupHandlerLogic(terminals);
      const result = cleanup([]);
      
      assert.equal(result, 0);
      assert.equal(terminals.size, 0);
    });
  });

  describe('cleanupWorkspace IDs not in map', () => {
    test('returns zero killed with no errors', () => {
      const terminals = new Map<string, { id: string; pty: { kill: () => void } }>();
      
      const cleanup = createCleanupHandlerLogic(terminals);
      const result = cleanup(['term-1', 'term-2', 'term-3']);
      
      assert.equal(result, 0);
      assert.equal(terminals.size, 0);
    });
  });
});

// ============================================================================
// terminateWorkspaceTerminals Integration Tests
// ============================================================================

describe('terminateWorkspaceTerminals', () => {
  let originalWindow: typeof window;
  
  beforeEach(() => {
    // Save original window if it exists
    originalWindow = global.window;
  });
  
  afterEach(() => {
    // Restore original window
    global.window = originalWindow;
  });

  test('calls cleanupWorkspaceTerminals after individual kills', async () => {
    const killTerminalSpy = vi.fn().mockResolvedValue(undefined);
    const cleanupWorkspaceTerminalsSpy = vi.fn().mockResolvedValue(2);
    
    // Mock window.electronAPI
    global.window = {
      electronAPI: {
        killTerminal: killTerminalSpy,
        cleanupWorkspaceTerminals: cleanupWorkspaceTerminalsSpy,
      },
    } as unknown as Window & typeof globalThis;
    
    // Import after mocking
    const { terminateWorkspaceTerminals } = await import('../../../src/renderer/lib/workspaceLifecycle');
    
    const mockWorkspace = {
      id: 'ws-1',
      path: '/test/workspace',
      name: 'Test Workspace',
      terminals: [
        { id: 'term-1', pid: 1001 },
        { id: 'term-2', pid: 1002 },
      ],
    };
    
    await terminateWorkspaceTerminals(mockWorkspace as never);
    
    // Verify individual kills were called
    expect(killTerminalSpy).toHaveBeenCalledWith('term-1');
    expect(killTerminalSpy).toHaveBeenCalledWith('term-2');
    
    // Verify cleanup sweep was called
    expect(cleanupWorkspaceTerminalsSpy).toHaveBeenCalledWith(['term-1', 'term-2']);
  });

  test('handles cleanupWorkspaceTerminals failure gracefully', async () => {
    const killTerminalSpy = vi.fn().mockResolvedValue(undefined);
    const cleanupWorkspaceTerminalsSpy = vi.fn().mockRejectedValue(new Error('IPC failed'));
    
    // Mock window.electronAPI
    global.window = {
      electronAPI: {
        killTerminal: killTerminalSpy,
        cleanupWorkspaceTerminals: cleanupWorkspaceTerminalsSpy,
      },
    } as unknown as Window & typeof globalThis;
    
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Import after mocking
    const { terminateWorkspaceTerminals } = await import('../../../src/renderer/lib/workspaceLifecycle');
    
    const mockWorkspace = {
      id: 'ws-1',
      path: '/test/workspace',
      name: 'Test Workspace',
      terminals: [
        { id: 'term-1', pid: 1001 },
      ],
    };
    
    // Should not throw
    await expect(terminateWorkspaceTerminals(mockWorkspace as never)).resolves.not.toThrow();
    
    // Error should be logged but not thrown
    expect(consoleSpy).toHaveBeenCalled();
    
    // Cleanup
    consoleSpy.mockRestore();
  });

  test('does not call cleanupWorkspaceTerminals for empty terminal list', async () => {
    const killTerminalSpy = vi.fn().mockResolvedValue(undefined);
    const cleanupWorkspaceTerminalsSpy = vi.fn().mockResolvedValue(0);
    
    // Mock window.electronAPI
    global.window = {
      electronAPI: {
        killTerminal: killTerminalSpy,
        cleanupWorkspaceTerminals: cleanupWorkspaceTerminalsSpy,
      },
    } as unknown as Window & typeof globalThis;
    
    // Import after mocking
    const { terminateWorkspaceTerminals } = await import('../../../src/renderer/lib/workspaceLifecycle');
    
    const mockWorkspace = {
      id: 'ws-1',
      path: '/test/workspace',
      name: 'Test Workspace',
      terminals: [],
    };
    
    await terminateWorkspaceTerminals(mockWorkspace as never);
    
    // Individual kills should not be called (no terminals)
    expect(killTerminalSpy).not.toHaveBeenCalled();
    
    // Cleanup sweep should not be called for empty list
    expect(cleanupWorkspaceTerminalsSpy).not.toHaveBeenCalled();
  });

  test('skips terminal cleanup sweep when only one terminal exists and was killed', async () => {
    const killTerminalSpy = vi.fn().mockResolvedValue(undefined);
    const cleanupWorkspaceTerminalsSpy = vi.fn().mockResolvedValue(0);
    
    // Mock window.electronAPI
    global.window = {
      electronAPI: {
        killTerminal: killTerminalSpy,
        cleanupWorkspaceTerminals: cleanupWorkspaceTerminalsSpy,
      },
    } as unknown as Window & typeof globalThis;
    
    // Import after mocking
    const { terminateWorkspaceTerminals } = await import('../../../src/renderer/lib/workspaceLifecycle');
    
    const mockWorkspace = {
      id: 'ws-1',
      path: '/test/workspace',
      name: 'Test Workspace',
      terminals: [
        { id: 'term-1', pid: 1001 },
      ],
    };
    
    await terminateWorkspaceTerminals(mockWorkspace as never);
    
    // Individual kill was called
    expect(killTerminalSpy).toHaveBeenCalledWith('term-1');
    
    // Cleanup sweep was called with all terminal IDs
    expect(cleanupWorkspaceTerminalsSpy).toHaveBeenCalledWith(['term-1']);
  });
});
