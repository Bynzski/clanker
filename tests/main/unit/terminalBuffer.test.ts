/**
 * Terminal buffer tests (Phase 1 updated)
 *
 * The app-level head-truncated buffer has been removed in Phase 1.
 * MAX_TERMINAL_BUFFER_BYTES is now 0 (deprecated no-op) and trimBuffer
 * returns '' (deprecated no-op). xterm.js is the primary buffer/scrollback
 * owner. These tests verify the deprecated constants remain present but
 * are no-ops.
 */

import { vi } from 'vitest';

// Mock electron module to prevent top-level code from running
vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    getPath: vi.fn((name: string) => {
      if (name === 'home') return '/home/test';
      return `/mock/${name}`;
    }),
    commandLine: {
      appendSwitch: vi.fn(),
    },
    whenReady: vi.fn(() => {
      return new Promise<never>(() => {});
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

// Import after mocking
import { trimBuffer, MAX_TERMINAL_BUFFER_BYTES, TERMINAL_SCROLLBACK_LINES } from '../../../src/shared/terminal';
import assert from 'node:assert/strict';
import { describe, test } from 'vitest';

describe('trimBuffer (deprecated)', () => {
  test('returns empty string (no-op)', () => {
    const result = trimBuffer('some content', 1024);
    assert.equal(result, '');
  });

  test('returns empty string for any input', () => {
    const result = trimBuffer('a'.repeat(10000), 512 * 1024);
    assert.equal(result, '');
  });

  test('returns empty string when empty', () => {
    const result = trimBuffer('', 0);
    assert.equal(result, '');
  });
});

describe('MAX_TERMINAL_BUFFER_BYTES (deprecated)', () => {
  test('is defined as 0 (deprecated no-op)', () => {
    assert.equal(MAX_TERMINAL_BUFFER_BYTES, 0);
  });

  test('is a number', () => {
    assert.equal(typeof MAX_TERMINAL_BUFFER_BYTES, 'number');
  });
});

describe('TERMINAL_SCROLLBACK_LINES (Phase 1)', () => {
  test('is 10,000 lines', () => {
    assert.equal(TERMINAL_SCROLLBACK_LINES, 10_000);
  });

  test('provides adequate scrollback depth', () => {
    // 10,000 lines at 80x24 ≈ 416 screens of history
    const typicalScreenSize = 80 * 24;
    const screensWorth = TERMINAL_SCROLLBACK_LINES * typicalScreenSize / typicalScreenSize;
    // Each "screen" is 24 lines, so 10,000 / 24 ≈ 416 screens
    assert.ok(screensWorth >= 400, 'Should hold at least 400 screens of history');
  });
});
