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
      // Return a promise that never resolves to prevent createWindow from running during module import
      return new Promise<never>(() => {
        // This promise never resolves, preventing app initialization during tests
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

// Import after mocking
import { trimBuffer, MAX_TERMINAL_BUFFER_BYTES } from '../../../src/shared/terminal';
import assert from 'node:assert/strict';
import { describe, test } from 'vitest';

describe('trimBuffer', () => {
  const cap = MAX_TERMINAL_BUFFER_BYTES;

  test('returns unchanged buffer when under cap', () => {
    const buffer = 'Hello, World!';
    const result = trimBuffer(buffer, cap);
    assert.equal(result, buffer);
  });

  test('returns unchanged buffer when exactly at cap', () => {
    // Create a string with exactly cap characters (1 char = 1 byte in UTF-8 for ASCII)
    const buffer = 'a'.repeat(cap);
    const result = trimBuffer(buffer, cap);
    assert.equal(result, buffer);
    assert.equal(result.length, cap);
  });

  test('returns unchanged buffer when empty', () => {
    const buffer = '';
    const result = trimBuffer(buffer, cap);
    assert.equal(result, '');
  });

  test('truncates buffer from head when over cap', () => {
    // Create a buffer that exceeds the cap
    const originalContent = 'This is the beginning of the buffer';
    const padding = 'x'.repeat(cap + 100);
    const buffer = originalContent + padding;

    // Verify the original buffer is over cap
    assert.ok(buffer.length > cap);

    const result = trimBuffer(buffer, cap);

    // Result should be under or equal to cap
    assert.ok(result.length <= cap);

    // Result should be truncated from the head, so the tail (padding) should be preserved
    assert.ok(result.endsWith('x'.repeat(result.length - originalContent.length)));
  });

  test('handles unicode characters correctly', () => {
    // Unicode characters can be multiple bytes in UTF-8
    // Create a buffer with unicode that exceeds the byte cap
    const unicodeChar = '\u{1F600}'; // emoji = 4 bytes in UTF-8
    const buffer = unicodeChar.repeat(cap + 10);

    const result = trimBuffer(buffer, cap);

    // The result should be under the byte cap, not character cap
    const encoder = new TextEncoder();
    assert.ok(encoder.encode(result).length <= cap);
  });

  test('returns tail portion when significantly over cap', () => {
    // Test with a clear marker at the beginning and end
    const marker = '===END===';
    const padding = 'A'.repeat(cap * 2);
    const buffer = marker + padding;

    const result = trimBuffer(buffer, cap);

    // The result should not contain the marker (it was at the head)
    assert.ok(!result.includes(marker));
    // The result should be mostly 'A's from the tail
    assert.ok(result.startsWith('A'));
  });
});

describe('MAX_TERMINAL_BUFFER_BYTES', () => {
  test('is defined as 512KB', () => {
    assert.equal(MAX_TERMINAL_BUFFER_BYTES, 512 * 1024);
    assert.equal(MAX_TERMINAL_BUFFER_BYTES, 524_288);
  });

  test('is a positive number', () => {
    assert.ok(MAX_TERMINAL_BUFFER_BYTES > 0);
    assert.ok(MAX_TERMINAL_BUFFER_BYTES < 10 * 1024 * 1024); // reasonable upper bound
  });
});

describe('terminal buffer cap integration', () => {
  test('cap is reasonable for terminal usage', () => {
    // 512KB should still cover a meaningful amount of recent terminal history
    // A typical terminal is 80x24 = 1920 chars, so 512KB = ~270 screens
    const typicalScreenSize = 80 * 24;
    const screensWorth = MAX_TERMINAL_BUFFER_BYTES / typicalScreenSize;

    assert.ok(screensWorth >= 100, 'Should hold at least 100 screens of history');
  });
});
