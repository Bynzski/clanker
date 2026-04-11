/**
 * fileIpc.ts Unit Tests
 *
 * Tests that every handler in `fileIpc.ts` returns a valid result object
 * (never `undefined` or raw thrown errors) for all error paths.
 *
 * Coverage areas:
 * - FILE_LIST_DIRECTORY error results
 * - FILE_READ error results (non-existent, permission-denied, workspace-root escape)
 * - FILE_WRITE returns { success: false, errorCode } and does not throw
 * - FILE_CREATE / FILE_DELETE / FILE_RENAME error paths
 * - FILE_WATCH / FILE_UNWATCH delegation and registration
 * - REVEAL_IN_FILE_MANAGER malformed input
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Electron mock — provides the ipcMain that fileIpc registers against
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}));

import { ipcMain } from 'electron';

type MockIpcMain = typeof ipcMain & {
  handle: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Mock factories — must use vi.hoisted() so references are available when
// vi.mock factory functions run (Vitest hoists vi.mock calls to the top of the
// file before any runtime code executes).
// ---------------------------------------------------------------------------

const { mockListDirectory, mockReadFile, mockWriteFile, mockCreateFile,
  mockCreateDirectory, mockDeleteEntry, mockRenameEntry,
  mockResolveAndValidateWatchPath } = vi.hoisted(() => ({
  mockListDirectory: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockCreateFile: vi.fn(),
  mockCreateDirectory: vi.fn(),
  mockDeleteEntry: vi.fn(),
  mockRenameEntry: vi.fn(),
  mockResolveAndValidateWatchPath: vi.fn(),
}));

const { mockWatchFile, mockUnwatchFile, mockMarkWritten } = vi.hoisted(() => ({
  mockWatchFile: vi.fn(),
  mockUnwatchFile: vi.fn(),
  mockMarkWritten: vi.fn(),
}));

vi.mock('../../../src/main/fileService', () => ({
  listDirectory: mockListDirectory,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  createFile: mockCreateFile,
  createDirectory: mockCreateDirectory,
  deleteEntry: mockDeleteEntry,
  renameEntry: mockRenameEntry,
  resolveAndValidateWatchPath: mockResolveAndValidateWatchPath,
}));

vi.mock('../../../src/main/fileWatcher', () => ({
  FileWatcherService: vi.fn().mockImplementation(() => ({
    watchFile: mockWatchFile,
    unwatchFile: mockUnwatchFile,
    markWritten: mockMarkWritten,
  })),
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { registerFileIpc, type RegisterFileIpcDeps } from '../../../src/main/ipc/fileIpc';
import { FILE_LIST_DIRECTORY, FILE_READ, FILE_WRITE, FILE_CREATE, FILE_DELETE, FILE_RENAME, REVEAL_IN_FILE_MANAGER, FILE_WATCH, FILE_UNWATCH } from '../../../src/shared/ipcChannels';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHandler(channel: string): (...args: unknown[]) => unknown {
  const mockIpc = ipcMain as MockIpcMain;
  const calls = mockIpc.handle.mock.calls as Array<[string, (...args: unknown[]) => unknown]>;
  const match = calls.find(([c]) => c === channel);
  if (!match) throw new Error(`No handler registered for channel: ${channel}`);
  return match[1];
}

// The FileWatcherService mock returned here must satisfy the RegisterFileIpcDeps
// interface. The cast is safe because the IPC handler only calls watchFile,
// unwatchFile, and markWritten — none of which require the full service shape.
function getMockFileWatcher() {
  return {
    watchFile: mockWatchFile,
    unwatchFile: mockUnwatchFile,
    markWritten: mockMarkWritten,
  } as unknown as RegisterFileIpcDeps['getFileWatcher'] extends (...args: never[]) => infer R ? R : never;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('registerFileIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // FILE_LIST_DIRECTORY
  // -------------------------------------------------------------------------

  describe('FILE_LIST_DIRECTORY', () => {
    test('returns success result from fileService', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_LIST_DIRECTORY);

      vi.mocked(mockListDirectory).mockResolvedValue({
        success: true,
        entries: [{ name: 'README.md', path: '/ws/README.md', isDirectory: false, size: 100, modified: 0 }],
      });

      const result = await handler({}, { workspacePath: '/ws', directoryPath: '/ws' });
      expect(result).toEqual({
        success: true,
        entries: [{ name: 'README.md', path: '/ws/README.md', isDirectory: false, size: 100, modified: 0 }],
      });
    });

    test('returns error result shape for invalid path', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_LIST_DIRECTORY);

      vi.mocked(mockListDirectory).mockResolvedValue({
        success: false,
        entries: [],
        errorCode: 'invalid-path',
        error: 'Directory path is invalid for this workspace',
      });

      const result = await handler({}, { workspacePath: '/ws', directoryPath: '/outside' });
      expect(result).toEqual({
        success: false,
        entries: [],
        errorCode: 'invalid-path',
        error: 'Directory path is invalid for this workspace',
      });
    });

    test('returns error result shape for permission-denied', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_LIST_DIRECTORY);

      vi.mocked(mockListDirectory).mockResolvedValue({
        success: false,
        entries: [],
        errorCode: 'permission-denied',
        error: 'Permission denied while listing directory',
      });

      const result = await handler({}, { workspacePath: '/ws', directoryPath: '/ws/restricted' });
      expect(result).toEqual({
        success: false,
        entries: [],
        errorCode: 'permission-denied',
        error: 'Permission denied while listing directory',
      });
    });
  });

  // -------------------------------------------------------------------------
  // FILE_READ
  // -------------------------------------------------------------------------

  describe('FILE_READ', () => {
    test('returns success result from fileService', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_READ);

      vi.mocked(mockReadFile).mockResolvedValue({ success: true, content: 'hello world' });

      const result = await handler({}, { workspacePath: '/ws', filePath: '/ws/file.txt' });
      expect(result).toEqual({ success: true, content: 'hello world' });
    });

    test('returns error result for not-found path', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_READ);

      vi.mocked(mockReadFile).mockResolvedValue({
        success: false,
        errorCode: 'not-found',
        error: 'File not found',
      });

      const result = await handler({}, { workspacePath: '/ws', filePath: '/ws/nonexistent.txt' });
      expect(result).toEqual({
        success: false,
        errorCode: 'not-found',
        error: 'File not found',
      });
    });

    test('returns error result for permission-denied path', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_READ);

      vi.mocked(mockReadFile).mockResolvedValue({
        success: false,
        errorCode: 'read-error',
        error: 'Permission denied reading file',
      });

      const result = await handler({}, { workspacePath: '/ws', filePath: '/ws/forbidden.txt' });
      expect(result).toEqual({
        success: false,
        errorCode: 'read-error',
        error: 'Permission denied reading file',
      });
    });

    test('returns error result for path outside workspace root', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_READ);

      vi.mocked(mockReadFile).mockResolvedValue({
        success: false,
        errorCode: 'invalid-path',
        error: 'File path is outside workspace',
      });

      const result = await handler({}, { workspacePath: '/ws', filePath: '/etc/passwd' });
      expect(result).toEqual({
        success: false,
        errorCode: 'invalid-path',
        error: 'File path is outside workspace',
      });
    });

    test('returns error result for binary file', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_READ);

      vi.mocked(mockReadFile).mockResolvedValue({
        success: false,
        errorCode: 'binary-file',
        error: 'File is binary and cannot be displayed',
      });

      const result = await handler({}, { workspacePath: '/ws', filePath: '/ws/image.png' });
      expect(result).toEqual({
        success: false,
        errorCode: 'binary-file',
        error: 'File is binary and cannot be displayed',
      });
    });
  });

  // -------------------------------------------------------------------------
  // FILE_WRITE
  // -------------------------------------------------------------------------

  describe('FILE_WRITE', () => {
    test('returns success result and marks file as written', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_WRITE);

      vi.mocked(mockWriteFile).mockResolvedValue({ success: true });

      const result = await handler({}, { workspacePath: '/ws', filePath: '/ws/file.txt', content: 'new content' });

      expect(result).toEqual({ success: true });
      expect(mockMarkWritten).toHaveBeenCalledWith('/ws/file.txt');
    });

    test('returns { success: false, errorCode } for invalid path — does not throw', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_WRITE);

      vi.mocked(mockWriteFile).mockResolvedValue({
        success: false,
        errorCode: 'invalid-path',
        error: 'File path is outside workspace',
      });

      // Must not throw
      const result = await handler({}, { workspacePath: '/ws', filePath: '/etc/shadow', content: 'data' });
      expect(result).toEqual({
        success: false,
        errorCode: 'invalid-path',
        error: 'File path is outside workspace',
      });
      // Must not call markWritten on failure
      expect(mockMarkWritten).not.toHaveBeenCalled();
    });

    test('returns { success: false, errorCode } for write error — does not throw', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_WRITE);

      vi.mocked(mockWriteFile).mockResolvedValue({
        success: false,
        errorCode: 'write-error',
        error: 'Failed to write file',
      });

      const result = await handler({}, { workspacePath: '/ws', filePath: '/ws/readonly.txt', content: 'data' });
      expect(result).toEqual({
        success: false,
        errorCode: 'write-error',
        error: 'Failed to write file',
      });
      expect(mockMarkWritten).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // FILE_CREATE
  // -------------------------------------------------------------------------

  describe('FILE_CREATE', () => {
    test('returns success result for file creation', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_CREATE);

      vi.mocked(mockCreateFile).mockResolvedValue({ success: true });

      const result = await handler({}, { workspacePath: '/ws', targetPath: '/ws/new.txt', type: 'file' });
      expect(result).toEqual({ success: true });
    });

    test('returns success result for directory creation', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_CREATE);

      vi.mocked(mockCreateDirectory).mockResolvedValue({ success: true });

      const result = await handler({}, { workspacePath: '/ws', targetPath: '/ws/newdir', type: 'directory' });
      expect(result).toEqual({ success: true });
    });

    test('returns error result for path outside workspace', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_CREATE);

      vi.mocked(mockCreateFile).mockResolvedValue({ success: false, error: 'File path is outside workspace' });

      const result = await handler({}, { workspacePath: '/ws', targetPath: '/etc/evil', type: 'file' });
      expect(result).toEqual({ success: false, error: 'File path is outside workspace' });
    });

    test('returns error result when file already exists', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_CREATE);

      vi.mocked(mockCreateFile).mockResolvedValue({ success: false, error: 'File already exists' });

      const result = await handler({}, { workspacePath: '/ws', targetPath: '/ws/existing.txt', type: 'file' });
      expect(result).toEqual({ success: false, error: 'File already exists' });
    });

    test('returns error result for permission-denied on directory creation', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_CREATE);

      vi.mocked(mockCreateDirectory).mockResolvedValue({ success: false, error: 'Permission denied creating directory' });

      const result = await handler({}, { workspacePath: '/ws', targetPath: '/ws/forbidden-dir', type: 'directory' });
      expect(result).toEqual({ success: false, error: 'Permission denied creating directory' });
    });
  });

  // -------------------------------------------------------------------------
  // FILE_DELETE
  // -------------------------------------------------------------------------

  describe('FILE_DELETE', () => {
    test('returns success result', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_DELETE);

      vi.mocked(mockDeleteEntry).mockResolvedValue({ success: true });

      const result = await handler({}, { workspacePath: '/ws', targetPath: '/ws/todelete.txt' });
      expect(result).toEqual({ success: true });
    });

    test('returns error result for path outside workspace', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_DELETE);

      vi.mocked(mockDeleteEntry).mockResolvedValue({ success: false, error: 'Path is outside workspace' });

      const result = await handler({}, { workspacePath: '/ws', targetPath: '/etc/passwd' });
      expect(result).toEqual({ success: false, error: 'Path is outside workspace' });
    });

    test('returns error result for path not found', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_DELETE);

      vi.mocked(mockDeleteEntry).mockResolvedValue({ success: false, error: 'Path does not exist' });

      const result = await handler({}, { workspacePath: '/ws', targetPath: '/ws/nonexistent.txt' });
      expect(result).toEqual({ success: false, error: 'Path does not exist' });
    });

    test('returns error result for permission-denied', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_DELETE);

      vi.mocked(mockDeleteEntry).mockResolvedValue({ success: false, error: 'Permission denied deleting path' });

      const result = await handler({}, { workspacePath: '/ws', targetPath: '/ws/forbidden.txt' });
      expect(result).toEqual({ success: false, error: 'Permission denied deleting path' });
    });

    test('returns error result for workspace root deletion attempt', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_DELETE);

      vi.mocked(mockDeleteEntry).mockResolvedValue({ success: false, error: 'Cannot delete workspace root' });

      const result = await handler({}, { workspacePath: '/ws', targetPath: '/ws' });
      expect(result).toEqual({ success: false, error: 'Cannot delete workspace root' });
    });
  });

  // -------------------------------------------------------------------------
  // FILE_RENAME
  // -------------------------------------------------------------------------

  describe('FILE_RENAME', () => {
    test('returns success result', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_RENAME);

      vi.mocked(mockRenameEntry).mockResolvedValue({ success: true });

      const result = await handler({}, { workspacePath: '/ws', oldPath: '/ws/old.txt', newPath: '/ws/new.txt' });
      expect(result).toEqual({ success: true });
    });

    test('returns error result for source path outside workspace', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_RENAME);

      vi.mocked(mockRenameEntry).mockResolvedValue({ success: false, error: 'Source path is outside workspace' });

      const result = await handler({}, { workspacePath: '/ws', oldPath: '/etc/passwd', newPath: '/ws/newname.txt' });
      expect(result).toEqual({ success: false, error: 'Source path is outside workspace' });
    });

    test('returns error result for destination path outside workspace', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_RENAME);

      vi.mocked(mockRenameEntry).mockResolvedValue({ success: false, error: 'Destination path is outside workspace' });

      const result = await handler({}, { workspacePath: '/ws', oldPath: '/ws/old.txt', newPath: '/etc/evil' });
      expect(result).toEqual({ success: false, error: 'Destination path is outside workspace' });
    });

    test('returns error result when destination already exists', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_RENAME);

      vi.mocked(mockRenameEntry).mockResolvedValue({ success: false, error: 'A file or directory already exists at the destination' });

      const result = await handler({}, { workspacePath: '/ws', oldPath: '/ws/old.txt', newPath: '/ws/existing.txt' });
      expect(result).toEqual({ success: false, error: 'A file or directory already exists at the destination' });
    });

    test('returns error result for source path not found', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_RENAME);

      vi.mocked(mockRenameEntry).mockResolvedValue({ success: false, error: 'Source path does not exist' });

      const result = await handler({}, { workspacePath: '/ws', oldPath: '/ws/nonexistent.txt', newPath: '/ws/newname.txt' });
      expect(result).toEqual({ success: false, error: 'Source path does not exist' });
    });

    test('returns error result for permission-denied', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_RENAME);

      vi.mocked(mockRenameEntry).mockResolvedValue({ success: false, error: 'Permission denied renaming path' });

      const result = await handler({}, { workspacePath: '/ws', oldPath: '/ws/old.txt', newPath: '/ws/new.txt' });
      expect(result).toEqual({ success: false, error: 'Permission denied renaming path' });
    });
  });

  // -------------------------------------------------------------------------
  // REVEAL_IN_FILE_MANAGER
  // -------------------------------------------------------------------------

  describe('REVEAL_IN_FILE_MANAGER', () => {
    test('returns true when filePath is valid', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(REVEAL_IN_FILE_MANAGER);

      const result = await handler({}, '/ws/README.md');
      expect(result).toBe(true);
    });

    test('returns false for empty string', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(REVEAL_IN_FILE_MANAGER);

      const result = await handler({}, '');
      expect(result).toBe(false);
    });

    test('returns false for whitespace-only string', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(REVEAL_IN_FILE_MANAGER);

      const result = await handler({}, '   ');
      expect(result).toBe(false);
    });

    test('returns false for null/undefined', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(REVEAL_IN_FILE_MANAGER);

      const result = await handler({}, null);
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // FILE_WATCH
  // -------------------------------------------------------------------------

  describe('FILE_WATCH', () => {
    test('returns true and delegates to fileWatcher when validation succeeds', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_WATCH);

      vi.mocked(mockResolveAndValidateWatchPath).mockResolvedValue({
        success: true,
        filePath: '/ws/file.txt',
      });

      const result = await handler({}, { workspacePath: '/ws', filePath: '/ws/file.txt' });

      expect(result).toBe(true);
      expect(mockResolveAndValidateWatchPath).toHaveBeenCalledWith('/ws', '/ws/file.txt');
      expect(mockWatchFile).toHaveBeenCalledWith('/ws/file.txt');
    });

    test('returns false when workspacePath is missing', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_WATCH);

      const result = await handler({}, { workspacePath: '', filePath: '/ws/file.txt' });

      expect(result).toBe(false);
      expect(mockWatchFile).not.toHaveBeenCalled();
    });

    test('returns false when filePath is missing', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_WATCH);

      const result = await handler({}, { workspacePath: '/ws', filePath: '' });

      expect(result).toBe(false);
      expect(mockWatchFile).not.toHaveBeenCalled();
    });

    test('returns false when workspacePath is null/undefined', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_WATCH);

      const result = await handler({}, { workspacePath: undefined as unknown as string, filePath: '/ws/file.txt' });

      expect(result).toBe(false);
      expect(mockWatchFile).not.toHaveBeenCalled();
    });

    test('returns false when path is outside workspace root', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_WATCH);

      vi.mocked(mockResolveAndValidateWatchPath).mockResolvedValue({
        success: false,
        error: 'File path is outside workspace',
      });

      const result = await handler({}, { workspacePath: '/ws', filePath: '/etc/passwd' });

      expect(result).toBe(false);
      expect(mockWatchFile).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // FILE_UNWATCH
  // -------------------------------------------------------------------------

  describe('FILE_UNWATCH', () => {
    test('returns true and delegates to fileWatcher when filePath is provided', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_UNWATCH);

      const result = await handler({}, { workspacePath: '/ws', filePath: '/ws/file.txt' });

      expect(result).toBe(true);
      expect(mockUnwatchFile).toHaveBeenCalled();
    });

    test('returns false when filePath is missing', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_UNWATCH);

      const result = await handler({}, { workspacePath: '/ws', filePath: '' });

      expect(result).toBe(false);
      expect(mockUnwatchFile).not.toHaveBeenCalled();
    });

    test('returns false when filePath is null/undefined', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_UNWATCH);

      const result = await handler({}, { workspacePath: '/ws', filePath: undefined as unknown as string });

      expect(result).toBe(false);
      expect(mockUnwatchFile).not.toHaveBeenCalled();
    });

    test('returns true for null workspacePath (unwatch tolerates stale workspace)', async () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });
      const handler = extractHandler(FILE_UNWATCH);

      const result = await handler({}, { workspacePath: null as unknown as string, filePath: '/ws/file.txt' });

      expect(result).toBe(true);
      expect(mockUnwatchFile).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // FILE_CHANGED — event channel registration
  // -------------------------------------------------------------------------

  describe('FILE_CHANGED event registration', () => {
    test('registers a no-op listener on FILE_CHANGED', () => {
      registerFileIpc({ getFileWatcher: getMockFileWatcher as RegisterFileIpcDeps["getFileWatcher"] });

      const mockIpc = ipcMain as MockIpcMain;
      expect(mockIpc.on).toHaveBeenCalledWith('file-changed', expect.any(Function));
    });
  });
});