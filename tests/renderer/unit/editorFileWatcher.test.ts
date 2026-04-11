// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';

// We need to import after setting up mocks
import { startEditorFileWatcher } from '../../../src/renderer/lib/editorFileWatcher';

describe('editorFileWatcher', () => {
  let mockOnFileChanged: ReturnType<typeof vi.fn>;
  let mockEditorWatchFile: ReturnType<typeof vi.fn>;
  let mockEditorUnwatchFile: ReturnType<typeof vi.fn>;
  let activeUnsub: (() => void) | null = null;

  beforeEach(() => {
    mockOnFileChanged = vi.fn(() => vi.fn()); // returns unsubscribe fn
    mockEditorWatchFile = vi.fn().mockResolvedValue(undefined);
    mockEditorUnwatchFile = vi.fn().mockResolvedValue(undefined);

    installElectronApiMock({
      onFileChanged: mockOnFileChanged,
      editorWatchFile: mockEditorWatchFile,
      editorUnwatchFile: mockEditorUnwatchFile,
    });

    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws-1',
      workspacePath: '/workspace',
      editorTabs: [],
      activeEditorTabId: null,
      markEditorTabDeleted: vi.fn(),
      markEditorTabExternallyChanged: vi.fn(),
      reloadEditorTab: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    if (activeUnsub) {
      activeUnsub();
      activeUnsub = null;
    }
    vi.clearAllMocks();
  });

  // =========================================================================
  // startEditorFileWatcher
  // =========================================================================
  describe('startEditorFileWatcher', () => {
    it('returns an unsubscribe function', () => {
      activeUnsub = startEditorFileWatcher();
      expect(typeof activeUnsub).toBe('function');
    });

    it('subscribes to onFileChanged', () => {
      activeUnsub = startEditorFileWatcher();
      expect(mockOnFileChanged).toHaveBeenCalledWith(expect.any(Function));
    });

    it('unsubscribe cleans up both subscriptions', () => {
      const fileUnsub = vi.fn();
      mockOnFileChanged.mockReturnValue(fileUnsub);

      activeUnsub = startEditorFileWatcher();
      activeUnsub();
      activeUnsub = null; // already cleaned up

      expect(fileUnsub).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // handleFileChanged via onFileChanged callback
  // =========================================================================
  describe('handleFileChanged', () => {
    it('does nothing when no tab matches the file path', () => {
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/other.ts',
            fileName: 'other.ts',
            isDirty: false,
            content: 'const a = 1;',
            originalContent: 'const a = 1;',
          },
        ],
      });

      activeUnsub = startEditorFileWatcher();

      // Get the callback passed to onFileChanged
      const fileCallback = mockOnFileChanged.mock.calls[0][0];
      fileCallback({ filePath: '/workspace/unrelated.ts', deleted: false });

      const state = useWorkspaceStore.getState();
      expect(state.markEditorTabDeleted).not.toHaveBeenCalled();
      expect(state.markEditorTabExternallyChanged).not.toHaveBeenCalled();
      expect(state.reloadEditorTab).not.toHaveBeenCalled();
    });

    it('calls markEditorTabDeleted when file is deleted', () => {
      const markEditorTabDeleted = vi.fn();
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
          },
        ],
        markEditorTabDeleted,
      });

      activeUnsub = startEditorFileWatcher();

      const fileCallback = mockOnFileChanged.mock.calls[0][0];
      fileCallback({ filePath: '/workspace/test.ts', deleted: true });

      expect(markEditorTabDeleted).toHaveBeenCalledWith('tab-1');
    });

    it('calls reloadEditorTab when tab is clean and not deleted', () => {
      const reloadEditorTab = vi.fn().mockResolvedValue(undefined);
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            content: 'const x = 1;',
            originalContent: 'const x = 1;',
          },
        ],
        reloadEditorTab,
      });

      activeUnsub = startEditorFileWatcher();

      const fileCallback = mockOnFileChanged.mock.calls[0][0];
      fileCallback({ filePath: '/workspace/test.ts', deleted: false });

      expect(reloadEditorTab).toHaveBeenCalledWith('tab-1');
    });

    it('calls markEditorTabExternallyChanged when tab is dirty', () => {
      const markEditorTabExternallyChanged = vi.fn();
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: true,
            content: 'const x = 2;',
            originalContent: 'const x = 1;',
          },
        ],
        markEditorTabExternallyChanged,
      });

      activeUnsub = startEditorFileWatcher();

      const fileCallback = mockOnFileChanged.mock.calls[0][0];
      fileCallback({ filePath: '/workspace/test.ts', deleted: false });

      expect(markEditorTabExternallyChanged).toHaveBeenCalledWith('tab-1');
    });

    it('does not call reloadEditorTab when tab is dirty', () => {
      const reloadEditorTab = vi.fn().mockResolvedValue(undefined);
      useWorkspaceStore.setState({
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace/test.ts',
            fileName: 'test.ts',
            isDirty: true,
            content: 'const x = 2;',
            originalContent: 'const x = 1;',
          },
        ],
        reloadEditorTab,
      });

      activeUnsub = startEditorFileWatcher();

      const fileCallback = mockOnFileChanged.mock.calls[0][0];
      fileCallback({ filePath: '/workspace/test.ts', deleted: false });

      expect(reloadEditorTab).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Workspace switch
  // =========================================================================
  describe('workspace switch', () => {
    it('unwatches old tabs when workspace changes', () => {
      useWorkspaceStore.setState({
        activeWorkspaceId: 'ws-1',
        workspacePath: '/workspace1',
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace1/file1.ts',
            fileName: 'file1.ts',
            isDirty: false,
            content: '',
            originalContent: '',
          },
          {
            id: 'tab-2',
            filePath: '/workspace1/file2.ts',
            fileName: 'file2.ts',
            isDirty: false,
            content: '',
            originalContent: '',
          },
        ],
      });

      const unsub = startEditorFileWatcher();
      activeUnsub = unsub;

      // Clear any calls from setup
      mockEditorUnwatchFile.mockClear();
      mockEditorWatchFile.mockClear();

      // Simulate workspace switch
      useWorkspaceStore.setState({
        activeWorkspaceId: 'ws-2',
        workspacePath: '/workspace2',
        editorTabs: [
          {
            id: 'tab-3',
            filePath: '/workspace2/file3.ts',
            fileName: 'file3.ts',
            isDirty: false,
            content: '',
            originalContent: '',
          },
        ],
      });

      // Should have unwatched old tabs
      expect(mockEditorUnwatchFile).toHaveBeenCalledTimes(2);
      expect(mockEditorUnwatchFile).toHaveBeenCalledWith({
        workspacePath: '/workspace1',
        filePath: '/workspace1/file1.ts',
      });
      expect(mockEditorUnwatchFile).toHaveBeenCalledWith({
        workspacePath: '/workspace1',
        filePath: '/workspace1/file2.ts',
      });

      unsub();
    });

    it('watches new tabs when workspace changes', () => {
      useWorkspaceStore.setState({
        activeWorkspaceId: 'ws-1',
        workspacePath: '/workspace1',
        editorTabs: [
          {
            id: 'tab-1',
            filePath: '/workspace1/file1.ts',
            fileName: 'file1.ts',
            isDirty: false,
            content: '',
            originalContent: '',
          },
        ],
      });

      const unsub = startEditorFileWatcher();
      activeUnsub = unsub;

      mockEditorUnwatchFile.mockClear();
      mockEditorWatchFile.mockClear();

      // Simulate workspace switch
      useWorkspaceStore.setState({
        activeWorkspaceId: 'ws-2',
        workspacePath: '/workspace2',
        editorTabs: [
          {
            id: 'tab-3',
            filePath: '/workspace2/file3.ts',
            fileName: 'file3.ts',
            isDirty: false,
            content: '',
            originalContent: '',
          },
        ],
      });

      // Should have watched new tabs
      expect(mockEditorWatchFile).toHaveBeenCalledTimes(1);
      expect(mockEditorWatchFile).toHaveBeenCalledWith({
        workspacePath: '/workspace2',
        filePath: '/workspace2/file3.ts',
      });

      unsub();
    });
  });
});
