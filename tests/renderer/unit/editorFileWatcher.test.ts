// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { startEditorFileWatcher } from '../../../src/renderer/lib/editorFileWatcher';

describe('editorFileWatcher', () => {
  let mockOnFileChanged: ReturnType<typeof vi.fn>;
  let mockEditorWatchFile: ReturnType<typeof vi.fn>;
  let mockEditorUnwatchFile: ReturnType<typeof vi.fn>;
  let activeUnsub: (() => void) | null = null;

  beforeEach(() => {
    mockOnFileChanged = vi.fn(() => vi.fn());
    mockEditorWatchFile = vi.fn().mockResolvedValue(undefined);
    mockEditorUnwatchFile = vi.fn().mockResolvedValue(undefined);

    installElectronApiMock({
      onFileChanged: mockOnFileChanged,
      editorWatchFile: mockEditorWatchFile,
      editorUnwatchFile: mockEditorUnwatchFile,
    });

    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
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

  describe('watch registration policy', () => {
    it('returns an unsubscribe function and subscribes to file changes', () => {
      activeUnsub = startEditorFileWatcher();

      expect(typeof activeUnsub).toBe('function');
      expect(mockOnFileChanged).toHaveBeenCalledWith(expect.any(Function));
    });

    it('watches editor tabs across active and parked workspaces on startup', () => {
      useWorkspaceStore.setState({
        workspaces: [
          createWorkspaceFixture({
            id: 'ws-1',
            lifecycle: 'parked',
            workspacePath: '/workspace-1',
            editorTabs: [
              {
                id: 'tab-1',
                filePath: '/workspace-1/file-1.ts',
                fileName: 'file-1.ts',
                isDirty: false,
                content: '',
                originalContent: '',
              },
            ],
          }),
          createWorkspaceFixture({
            id: 'ws-2',
            lifecycle: 'active',
            workspacePath: '/workspace-2',
            editorTabs: [
              {
                id: 'tab-2',
                filePath: '/workspace-2/file-2.ts',
                fileName: 'file-2.ts',
                isDirty: false,
                content: '',
                originalContent: '',
              },
            ],
          }),
        ],
        activeWorkspaceId: 'ws-2',
      });

      activeUnsub = startEditorFileWatcher();

      expect(mockEditorWatchFile).toHaveBeenCalledTimes(2);
      expect(mockEditorWatchFile).toHaveBeenCalledWith({
        workspacePath: '/workspace-1',
        filePath: '/workspace-1/file-1.ts',
      });
      expect(mockEditorWatchFile).toHaveBeenCalledWith({
        workspacePath: '/workspace-2',
        filePath: '/workspace-2/file-2.ts',
      });
    });

    it('does not thrash watch registrations on workspace switches alone', () => {
      useWorkspaceStore.setState({
        workspaces: [
          createWorkspaceFixture({
            id: 'ws-1',
            lifecycle: 'parked',
            workspacePath: '/workspace-1',
            editorTabs: [
              {
                id: 'tab-1',
                filePath: '/workspace-1/file.ts',
                fileName: 'file.ts',
                isDirty: false,
                content: '',
                originalContent: '',
              },
            ],
          }),
          createWorkspaceFixture({
            id: 'ws-2',
            lifecycle: 'active',
            workspacePath: '/workspace-2',
            editorTabs: [
              {
                id: 'tab-2',
                filePath: '/workspace-2/file.ts',
                fileName: 'file.ts',
                isDirty: false,
                content: '',
                originalContent: '',
              },
            ],
          }),
        ],
        activeWorkspaceId: 'ws-2',
      });

      activeUnsub = startEditorFileWatcher();
      mockEditorWatchFile.mockClear();
      mockEditorUnwatchFile.mockClear();

      useWorkspaceStore.getState().selectWorkspace('ws-1');

      expect(mockEditorWatchFile).not.toHaveBeenCalled();
      expect(mockEditorUnwatchFile).not.toHaveBeenCalled();
    });

    it('unwatches only when the last owner for a file disappears', () => {
      useWorkspaceStore.setState({
        workspaces: [
          createWorkspaceFixture({
            id: 'ws-1',
            lifecycle: 'parked',
            workspacePath: '/workspace-1',
            editorTabs: [
              {
                id: 'tab-1',
                filePath: '/shared/file.ts',
                fileName: 'file.ts',
                isDirty: false,
                content: '',
                originalContent: '',
              },
            ],
          }),
          createWorkspaceFixture({
            id: 'ws-2',
            lifecycle: 'active',
            workspacePath: '/workspace-2',
            editorTabs: [
              {
                id: 'tab-2',
                filePath: '/shared/file.ts',
                fileName: 'file.ts',
                isDirty: false,
                content: '',
                originalContent: '',
              },
            ],
          }),
        ],
        activeWorkspaceId: 'ws-2',
      });

      activeUnsub = startEditorFileWatcher();
      mockEditorUnwatchFile.mockClear();

      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === 'ws-1'
            ? { ...workspace, editorTabs: [] }
            : workspace
        )),
      }));

      expect(mockEditorUnwatchFile).not.toHaveBeenCalled();

      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === 'ws-2'
            ? { ...workspace, editorTabs: [] }
            : workspace
        )),
      }));

      expect(mockEditorUnwatchFile).toHaveBeenCalledTimes(1);
      expect(mockEditorUnwatchFile).toHaveBeenCalledWith({
        workspacePath: '/workspace-2',
        filePath: '/shared/file.ts',
      });
    });

    it('cleanup unwatches all tracked files', () => {
      useWorkspaceStore.setState({
        workspaces: [
          createWorkspaceFixture({
            id: 'ws-1',
            lifecycle: 'active',
            workspacePath: '/workspace-1',
            editorTabs: [
              {
                id: 'tab-1',
                filePath: '/workspace-1/file.ts',
                fileName: 'file.ts',
                isDirty: false,
                content: '',
                originalContent: '',
              },
            ],
          }),
        ],
        activeWorkspaceId: 'ws-1',
      });

      activeUnsub = startEditorFileWatcher();
      mockEditorUnwatchFile.mockClear();

      activeUnsub();
      activeUnsub = null;

      expect(mockEditorUnwatchFile).toHaveBeenCalledTimes(1);
      expect(mockEditorUnwatchFile).toHaveBeenCalledWith({
        workspacePath: '/workspace-1',
        filePath: '/workspace-1/file.ts',
      });
    });
  });

  describe('file change routing', () => {
    it('does nothing when no tab matches the file path', () => {
      useWorkspaceStore.setState({
        workspaces: [
          createWorkspaceFixture({
            id: 'ws-1',
            lifecycle: 'active',
            editorTabs: [
              {
                id: 'tab-1',
                filePath: '/workspace/other.ts',
                fileName: 'other.ts',
                isDirty: false,
                content: '',
                originalContent: '',
              },
            ],
          }),
        ],
        activeWorkspaceId: 'ws-1',
      });

      activeUnsub = startEditorFileWatcher();

      const fileCallback = mockOnFileChanged.mock.calls[0][0];
      fileCallback({ filePath: '/workspace/unrelated.ts', deleted: false });

      const state = useWorkspaceStore.getState();
      expect(state.markEditorTabDeleted).not.toHaveBeenCalled();
      expect(state.markEditorTabExternallyChanged).not.toHaveBeenCalled();
      expect(state.reloadEditorTab).not.toHaveBeenCalled();
    });

    it('routes deleted events to matching parked workspace tabs', () => {
      const markEditorTabDeleted = vi.fn();
      useWorkspaceStore.setState({
        workspaces: [
          createWorkspaceFixture({
            id: 'ws-1',
            lifecycle: 'parked',
            workspacePath: '/workspace-1',
            editorTabs: [
              {
                id: 'tab-1',
                filePath: '/workspace-1/file.ts',
                fileName: 'file.ts',
                isDirty: false,
                content: '',
                originalContent: '',
              },
            ],
          }),
          createWorkspaceFixture({ id: 'ws-2', lifecycle: 'active', workspacePath: '/workspace-2' }),
        ],
        activeWorkspaceId: 'ws-2',
        markEditorTabDeleted,
      });

      activeUnsub = startEditorFileWatcher();

      const fileCallback = mockOnFileChanged.mock.calls[0][0];
      fileCallback({ filePath: '/workspace-1/file.ts', deleted: true });

      expect(markEditorTabDeleted).toHaveBeenCalledWith('tab-1', 'ws-1');
    });

    it('routes dirty file changes to external-change markers in the matching workspace', () => {
      const markEditorTabExternallyChanged = vi.fn();
      useWorkspaceStore.setState({
        workspaces: [
          createWorkspaceFixture({
            id: 'ws-1',
            lifecycle: 'parked',
            workspacePath: '/workspace-1',
            editorTabs: [
              {
                id: 'tab-1',
                filePath: '/workspace-1/file.ts',
                fileName: 'file.ts',
                isDirty: true,
                content: 'changed',
                originalContent: 'original',
              },
            ],
          }),
        ],
        activeWorkspaceId: 'ws-1',
        markEditorTabExternallyChanged,
      });

      activeUnsub = startEditorFileWatcher();

      const fileCallback = mockOnFileChanged.mock.calls[0][0];
      fileCallback({ filePath: '/workspace-1/file.ts', deleted: false });

      expect(markEditorTabExternallyChanged).toHaveBeenCalledWith('tab-1', 'ws-1');
    });

    it('reloads clean matching tabs even when the workspace is parked', () => {
      const reloadEditorTab = vi.fn().mockResolvedValue(undefined);
      useWorkspaceStore.setState({
        workspaces: [
          createWorkspaceFixture({
            id: 'ws-1',
            lifecycle: 'parked',
            workspacePath: '/workspace-1',
            editorTabs: [
              {
                id: 'tab-1',
                filePath: '/workspace-1/file.ts',
                fileName: 'file.ts',
                isDirty: false,
                content: '',
                originalContent: '',
              },
            ],
          }),
          createWorkspaceFixture({ id: 'ws-2', lifecycle: 'active', workspacePath: '/workspace-2' }),
        ],
        activeWorkspaceId: 'ws-2',
        reloadEditorTab,
      });

      activeUnsub = startEditorFileWatcher();

      const fileCallback = mockOnFileChanged.mock.calls[0][0];
      fileCallback({ filePath: '/workspace-1/file.ts', deleted: false });

      expect(reloadEditorTab).toHaveBeenCalledWith('tab-1', 'ws-1');
    });
  });
});
