// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

function resetStore() {
  useWorkspaceStore.setState({
    name: '',
    workspacePath: '',
    harness: 'codex',
    model: '',
    terminals: [],
    panes: [],
    browserVisible: false,
    browserOverlayCount: 0,
    browserUrl: 'https://github.com',
    activeTerminalId: null,
    browserPane: null,
    layoutRoot: null,
    explorerVisible: false,
    explorerSidebarWidth: 280,
    explorerExpandedPaths: [],
    explorerSelectedPath: null,
    explorerEntriesByPath: {},
    explorerLoadingPaths: [],
    explorerErrorsByPath: {},
    workspaces: [],
    activeWorkspaceId: null,
    gridViewport: { cols: 12, rows: 8 },
    layoutRevision: 0,
    editorVisible: false,
    editorPane: null,
    editorTabs: [],
    activeEditorTabId: null,
    pendingEditorOperations: {},
  });
}

describe('editor store actions', () => {
  let mockElectronApi: ReturnType<typeof installElectronApiMock>;

  beforeEach(() => {
    resetStore();
    mockElectronApi = installElectronApiMock();
  });

  afterEach(() => {
    resetStore();
  });

  function addWorkspace() {
    const fixture = createWorkspaceFixture({ workspacePath: '/workspace', name: 'test' });
    const { id: _ignored, ...withoutId } = fixture;
    void _ignored;
    useWorkspaceStore.getState().addWorkspace(withoutId);
  }

  describe('openFileInEditor', () => {
    it('creates editor pane when none exists', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: true,
        content: 'hello world',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');

      const state = useWorkspaceStore.getState();
      expect(state.editorPane).not.toBeNull();
      expect(state.editorVisible).toBe(true);
      expect(state.editorTabs).toHaveLength(1);
      expect(state.activeEditorTabId).not.toBeNull();
    });

    it('reuses existing editor pane', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValue({
        success: true,
        content: 'hello',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/a.js');
      const paneId = useWorkspaceStore.getState().editorPane?.id;
      await useWorkspaceStore.getState().openFileInEditor('/workspace/b.js');

      expect(useWorkspaceStore.getState().editorPane?.id).toBe(paneId);
      expect(useWorkspaceStore.getState().editorTabs).toHaveLength(2);
    });

    it('activates existing tab if file already open', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: true,
        content: 'hello',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const tabId = useWorkspaceStore.getState().activeEditorTabId;

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');

      expect(useWorkspaceStore.getState().activeEditorTabId).toBe(tabId);
    });

    it('handles read errors (file not found)', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: false,
        errorCode: 'not-found',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/nonexistent.js');

      const state = useWorkspaceStore.getState();
      expect(state.editorTabs).toHaveLength(0);
      expect(state.editorPane).toBeNull();
    });

    it('handles file too large error', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: false,
        errorCode: 'file-too-large',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/large.js');

      const state = useWorkspaceStore.getState();
      expect(state.editorTabs).toHaveLength(0);
    });

    it('handles binary file error', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: false,
        errorCode: 'binary-file',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/binary.bin');

      const state = useWorkspaceStore.getState();
      expect(state.editorTabs).toHaveLength(0);
    });
  });

  describe('closeEditorTab', () => {
    it('removes tab and adjusts active tab', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValue({
        success: true,
        content: 'content',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/a.js');
      await useWorkspaceStore.getState().openFileInEditor('/workspace/b.js');
      const tabAId = useWorkspaceStore.getState().editorTabs[0].id;
      const tabBId = useWorkspaceStore.getState().editorTabs[1].id;

      useWorkspaceStore.getState().closeEditorTab(tabBId);

      const state = useWorkspaceStore.getState();
      expect(state.editorTabs).toHaveLength(1);
      expect(state.editorTabs[0].id).toBe(tabAId);
    });

    it('sets active to previous tab when closing active tab', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValue({
        success: true,
        content: 'content',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/a.js');
      await useWorkspaceStore.getState().openFileInEditor('/workspace/b.js');
      const tabAId = useWorkspaceStore.getState().editorTabs[0].id;

      useWorkspaceStore.getState().closeEditorTab(tabAId);

      const state = useWorkspaceStore.getState();
      expect(state.activeEditorTabId).toBeDefined();
      expect(state.editorTabs.some(t => t.id === tabAId)).toBe(false);
    });

    it('clears editor state when last tab is closed', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: true,
        content: 'content',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const tabId = useWorkspaceStore.getState().editorTabs[0].id;

      useWorkspaceStore.getState().closeEditorTab(tabId);

      const state = useWorkspaceStore.getState();
      expect(state.editorTabs).toHaveLength(0);
      expect(state.activeEditorTabId).toBeNull();
    });
  });

  describe('setActiveEditorTab', () => {
    it('switches active tab', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValue({
        success: true,
        content: 'content',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/a.js');
      await useWorkspaceStore.getState().openFileInEditor('/workspace/b.js');
      const tabBId = useWorkspaceStore.getState().editorTabs[1].id;

      useWorkspaceStore.getState().setActiveEditorTab(tabBId);

      expect(useWorkspaceStore.getState().activeEditorTabId).toBe(tabBId);
    });
  });

  describe('updateEditorContent', () => {
    it('updates content and dirty state', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: true,
        content: 'original',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const tabId = useWorkspaceStore.getState().editorTabs[0].id;

      useWorkspaceStore.getState().updateEditorContent(tabId, 'modified');

      const state = useWorkspaceStore.getState();
      const tab = state.editorTabs.find(t => t.id === tabId);
      expect(tab?.content).toBe('modified');
      expect(tab?.isDirty).toBe(true);
    });

    it('clears dirty state when content matches original', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: true,
        content: 'original',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const tabId = useWorkspaceStore.getState().editorTabs[0].id;

      useWorkspaceStore.getState().updateEditorContent(tabId, 'original');

      const state = useWorkspaceStore.getState();
      const tab = state.editorTabs.find(t => t.id === tabId);
      expect(tab?.isDirty).toBe(false);
    });
  });

  describe('saveEditorFile', () => {
    it('writes file and clears dirty state', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: true,
        content: 'original',
      });
      mockElectronApi.editorWriteFile.mockResolvedValueOnce({
        success: true,
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const tabId = useWorkspaceStore.getState().editorTabs[0].id;
      useWorkspaceStore.getState().updateEditorContent(tabId, 'modified');

      await useWorkspaceStore.getState().saveEditorFile(tabId);

      const state = useWorkspaceStore.getState();
      const tab = state.editorTabs.find(t => t.id === tabId);
      expect(tab?.isDirty).toBe(false);
      expect(tab?.originalContent).toBe('modified');
      expect(mockElectronApi.editorWriteFile).toHaveBeenCalledWith({
        workspacePath: '/workspace',
        filePath: '/workspace/test.js',
        content: 'modified',
      });
    });
  });

  describe('saveAllEditorFiles', () => {
    it('saves all dirty tabs', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValue({
        success: true,
        content: 'content',
      });
      mockElectronApi.editorWriteFile.mockResolvedValue({
        success: true,
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/a.js');
      await useWorkspaceStore.getState().openFileInEditor('/workspace/b.js');
      const state = useWorkspaceStore.getState();
      useWorkspaceStore.getState().updateEditorContent(state.editorTabs[0].id, 'modified a');
      useWorkspaceStore.getState().updateEditorContent(state.editorTabs[1].id, 'modified b');

      await useWorkspaceStore.getState().saveAllEditorFiles();

      expect(mockElectronApi.editorWriteFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('toggleEditorPane', () => {
    it('toggles visibility and creates pane when shown', () => {
      addWorkspace();

      useWorkspaceStore.getState().toggleEditorPane();

      const state = useWorkspaceStore.getState();
      expect(state.editorVisible).toBe(true);
      expect(state.editorPane).not.toBeNull();
    });

    it('hides editor when already visible', () => {
      addWorkspace();
      useWorkspaceStore.getState().toggleEditorPane();

      useWorkspaceStore.getState().toggleEditorPane();

      const state = useWorkspaceStore.getState();
      expect(state.editorVisible).toBe(false);
    });

    it('reuses existing pane when toggling', () => {
      addWorkspace();
      useWorkspaceStore.getState().toggleEditorPane();
      const existingPaneId = useWorkspaceStore.getState().editorPane?.id;

      useWorkspaceStore.getState().toggleEditorPane();
      useWorkspaceStore.getState().toggleEditorPane();

      expect(useWorkspaceStore.getState().editorPane?.id).toBe(existingPaneId);
    });
  });

  describe('toggleEditorLock', () => {
    it('toggles editor pane lock state', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: true,
        content: 'test',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      expect(useWorkspaceStore.getState().editorPane?.locked).toBe(false);

      useWorkspaceStore.getState().toggleEditorLock();
      expect(useWorkspaceStore.getState().editorPane?.locked).toBe(true);

      useWorkspaceStore.getState().toggleEditorLock();
      expect(useWorkspaceStore.getState().editorPane?.locked).toBe(false);
    });

    it('is no-op when no editor pane exists', () => {
      addWorkspace();

      useWorkspaceStore.getState().toggleEditorLock();

      expect(useWorkspaceStore.getState().editorPane).toBeNull();
    });
  });

  describe('bringEditorIntoView', () => {
    it('swaps editor pane with first leaf', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: true,
        content: 'test',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');

      useWorkspaceStore.getState().bringEditorIntoView();

      expect(useWorkspaceStore.getState().layoutRevision).toBeGreaterThan(0);
    });

    it('is no-op when editor is not visible', () => {
      addWorkspace();
      const revBefore = useWorkspaceStore.getState().layoutRevision;

      useWorkspaceStore.getState().bringEditorIntoView();

      expect(useWorkspaceStore.getState().layoutRevision).toBe(revBefore);
    });
  });

  describe('resetEditorState', () => {
    it('clears editor state', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({
        success: true,
        content: 'test',
      });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');

      useWorkspaceStore.getState().resetEditorState();

      const state = useWorkspaceStore.getState();
      expect(state.editorVisible).toBe(false);
      expect(state.editorPane).toBeNull();
      expect(state.editorTabs).toEqual([]);
      expect(state.activeEditorTabId).toBeNull();
      expect(state.pendingEditorOperations).toEqual({});
    });
  });

  describe('async operation deduplication', () => {
    it('deduplicates rapid double-open of the same file', async () => {
      addWorkspace();
      let resolveRead: (value: unknown) => void;
      const readPromise = new Promise((resolve) => { resolveRead = resolve; });
      mockElectronApi.editorReadFile.mockReturnValueOnce(readPromise);

      const open1 = useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const open2 = useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');

      // Both calls should return without error — second is deduplicated
      resolveRead!({ success: true, content: 'hello' });
      await Promise.all([open1, open2]);

      // Only one IPC call was made
      expect(mockElectronApi.editorReadFile).toHaveBeenCalledTimes(1);
      // One tab created
      expect(useWorkspaceStore.getState().editorTabs).toHaveLength(1);
      // Pending is cleared
      expect(useWorkspaceStore.getState().pendingEditorOperations).toEqual({});
    });

    it('allows concurrent opens of different files', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValue({ success: true, content: 'content' });

      await Promise.all([
        useWorkspaceStore.getState().openFileInEditor('/workspace/a.js'),
        useWorkspaceStore.getState().openFileInEditor('/workspace/b.js'),
      ]);

      expect(mockElectronApi.editorReadFile).toHaveBeenCalledTimes(2);
      expect(useWorkspaceStore.getState().editorTabs).toHaveLength(2);
      expect(useWorkspaceStore.getState().pendingEditorOperations).toEqual({});
    });

    it('deduplicates rapid double-save on the same file', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({ success: true, content: 'original' });

      let resolveWrite: (value: unknown) => void;
      const writePromise = new Promise((resolve) => { resolveWrite = resolve; });
      mockElectronApi.editorWriteFile.mockReturnValueOnce(writePromise);

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const tabId = useWorkspaceStore.getState().editorTabs[0].id;
      useWorkspaceStore.getState().updateEditorContent(tabId, 'modified');

      // First save starts (awaits writePromise)
      const save1 = useWorkspaceStore.getState().saveEditorFile(tabId);
      // Second save deduplicates — returns true immediately
      const save2 = useWorkspaceStore.getState().saveEditorFile(tabId);

      const result2 = await save2;
      expect(result2).toBe(true);

      // Now resolve the write
      resolveWrite!({ success: true });
      const result1 = await save1;
      expect(result1).toBe(true);

      // Only one IPC write call
      expect(mockElectronApi.editorWriteFile).toHaveBeenCalledTimes(1);
      // Tab is clean
      expect(useWorkspaceStore.getState().editorTabs[0].isDirty).toBe(false);
      // Pending is cleared
      expect(useWorkspaceStore.getState().pendingEditorOperations).toEqual({});
    });

    it('clears pending flag after failed save', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({ success: true, content: 'original' });
      mockElectronApi.editorWriteFile.mockResolvedValueOnce({ success: false, errorCode: 'permission-denied' });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const tabId = useWorkspaceStore.getState().editorTabs[0].id;
      useWorkspaceStore.getState().updateEditorContent(tabId, 'modified');

      const result = await useWorkspaceStore.getState().saveEditorFile(tabId);
      expect(result).toBe(false);

      // Pending is cleared even on failure
      expect(useWorkspaceStore.getState().pendingEditorOperations).toEqual({});

      // Subsequent save should be allowed (not stuck)
      mockElectronApi.editorWriteFile.mockResolvedValueOnce({ success: true });
      const result2 = await useWorkspaceStore.getState().saveEditorFile(tabId);
      expect(result2).toBe(true);
      expect(mockElectronApi.editorWriteFile).toHaveBeenCalledTimes(2);
    });

    it('clears pending flag after failed open', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({ success: false, errorCode: 'not-found' });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/missing.js');

      expect(useWorkspaceStore.getState().pendingEditorOperations).toEqual({});
      expect(useWorkspaceStore.getState().editorTabs).toHaveLength(0);
    });

    it('skips reload when save is pending for same file', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile.mockResolvedValueOnce({ success: true, content: 'original' });

      let resolveWrite: (value: unknown) => void;
      const writePromise = new Promise((resolve) => { resolveWrite = resolve; });
      mockElectronApi.editorWriteFile.mockReturnValueOnce(writePromise);

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const tabId = useWorkspaceStore.getState().editorTabs[0].id;
      useWorkspaceStore.getState().updateEditorContent(tabId, 'modified');

      // Start a save (won't resolve yet)
      const savePromise = useWorkspaceStore.getState().saveEditorFile(tabId);

      // Attempt a reload while save is in flight — should be skipped
      await useWorkspaceStore.getState().reloadEditorTab(tabId);

      // No second readFile call (reload was skipped)
      expect(mockElectronApi.editorReadFile).toHaveBeenCalledTimes(1);

      // Resolve the save
      resolveWrite!({ success: true });
      await savePromise;

      // Pending is cleared
      expect(useWorkspaceStore.getState().pendingEditorOperations).toEqual({});
    });

    it('clears pending flag after failed reload', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile
        .mockResolvedValueOnce({ success: true, content: 'original' })
        .mockResolvedValueOnce({ success: false, errorCode: 'not-found' });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const tabId = useWorkspaceStore.getState().editorTabs[0].id;

      await useWorkspaceStore.getState().reloadEditorTab(tabId);

      expect(useWorkspaceStore.getState().pendingEditorOperations).toEqual({});
      // Tab should be marked deleted since reload failed
      expect(useWorkspaceStore.getState().editorTabs[0].isDeleted).toBe(true);
    });

    it('succeeds with reload when no save is pending', async () => {
      addWorkspace();
      mockElectronApi.editorReadFile
        .mockResolvedValueOnce({ success: true, content: 'original' })
        .mockResolvedValueOnce({ success: true, content: 'updated content' });

      await useWorkspaceStore.getState().openFileInEditor('/workspace/test.js');
      const tabId = useWorkspaceStore.getState().editorTabs[0].id;

      await useWorkspaceStore.getState().reloadEditorTab(tabId);

      expect(mockElectronApi.editorReadFile).toHaveBeenCalledTimes(2);
      expect(useWorkspaceStore.getState().editorTabs[0].content).toBe('updated content');
      expect(useWorkspaceStore.getState().pendingEditorOperations).toEqual({});
    });
  });
});
