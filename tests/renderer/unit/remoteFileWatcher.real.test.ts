// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { startRemoteFileWatcher } from '../../../src/renderer/lib/remoteFileWatcher';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { FileReadResult } from '../../../src/shared/types/editor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('remote notifications during real editor operations', () => {
  let api: ReturnType<typeof installElectronApiMock>;
  let stop: () => void;
  const workspace = createWorkspaceFixture({
    id: 'remote', environmentId: 'ssh-host', workspacePath: '/ws',
    editorTabs: [{ id: 'tab', filePath: '/ws/file', fileName: 'file', content: 'original', originalContent: 'original', isDirty: false }],
    activeEditorTabId: 'tab',
  });
  const change = (deleted = false) => api.onRemoteFilesChanged.mock.calls[0][0]({
    workspaceId: workspace.id, directoryPaths: [], files: [{ filePath: '/ws/file', deleted, initial: false }],
  });
  const tab = () => useWorkspaceStore.getState().getWorkspaceById(workspace.id)?.editorTabs[0];

  beforeEach(() => {
    api = installElectronApiMock();
    useWorkspaceStore.setState({ ...workspace, workspaces: [workspace], activeWorkspaceId: workspace.id, pendingEditorOperations: {} });
    stop = startRemoteFileWatcher();
  });
  afterEach(() => { stop(); useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, pendingEditorOperations: {} }); });

  it.each([
    { alreadyDeleted: false, result: { success: true, content: 'older contents' } },
    { alreadyDeleted: true, result: { success: true, content: 'older contents' } },
    { alreadyDeleted: false, result: { success: false, errorCode: 'read-error' as const } },
  ])('invalidates a focus refresh on deletion: %j', async ({ alreadyDeleted, result }) => {
    if (alreadyDeleted) useWorkspaceStore.getState().markEditorTabDeleted('tab', workspace.id);
    const focusRead = deferred<FileReadResult>();
    api.editorReadFile.mockReturnValueOnce(focusRead.promise);
    const refresh = useWorkspaceStore.getState().reloadEditorTab('tab', workspace.id, { onlyIfClean: true });
    change(true);
    expect(tab()?.isDeleted).toBe(true);
    focusRead.resolve(result);
    await refresh;
    expect(tab()).toMatchObject({ content: 'original', originalContent: 'original', isDeleted: true, hasExternalChange: false });
    // A still-missing file produces no additional deletion notification.
    api.onRemoteFilesChanged.mock.calls[0][0]({ workspaceId: workspace.id, files: [], directoryPaths: [] });
    expect(tab()?.isDeleted).toBe(true);
    expect(api.editorReadFile).toHaveBeenCalledTimes(1);
    // The invalidation belongs to the old read; recreation can reload normally.
    api.editorReadFile.mockResolvedValueOnce({ success: true, content: 'recreated file' });
    change();
    await waitFor(() => expect(tab()).toMatchObject({ content: 'recreated file', isDeleted: false, hasExternalChange: false }));
    expect(api.editorReadFile).toHaveBeenCalledTimes(2);
  });

  it('reloads a change queued during a manual read after that read clears the external-change flag', async () => {
    const manualRead = deferred<FileReadResult>();
    const freshRead = deferred<FileReadResult>();
    api.editorReadFile.mockReturnValueOnce(manualRead.promise).mockReturnValueOnce(freshRead.promise);
    const manualReload = useWorkspaceStore.getState().reloadEditorTab('tab', workspace.id);
    change();
    change();
    expect(api.editorReadFile).toHaveBeenCalledTimes(1);
    manualRead.resolve({ success: true, content: 'older edit' });
    await manualReload;
    expect(tab()).toMatchObject({ content: 'older edit', hasExternalChange: false });
    expect(api.editorReadFile).toHaveBeenCalledTimes(2);
    freshRead.resolve({ success: true, content: 'newest edit' });
    await waitFor(() => expect(tab()).toMatchObject({ content: 'newest edit', hasExternalChange: false, isDirty: false }));
    // An unchanged snapshot must not cause another read once the queue drains.
    api.onRemoteFilesChanged.mock.calls[0][0]({ workspaceId: workspace.id, directoryPaths: [], files: [], unchangedFilePaths: ['/ws/file'] });
    expect(api.editorReadFile).toHaveBeenCalledTimes(2);
  });

  it('retains a change if a manual operation starts during the automatic read', async () => {
    const automaticRead = deferred<FileReadResult>();
    const manualRead = deferred<FileReadResult>();
    api.editorReadFile.mockReturnValueOnce(automaticRead.promise).mockReturnValueOnce(manualRead.promise)
      .mockResolvedValueOnce({ success: true, content: 'newest edit' });
    change();
    const manualReload = useWorkspaceStore.getState().reloadEditorTab('tab', workspace.id);
    automaticRead.resolve({ success: true, content: 'older automatic edit' });
    // Let the automatic handler finish while the manual operation is pending.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.editorReadFile).toHaveBeenCalledTimes(2);
    manualRead.resolve({ success: true, content: 'older manual edit' });
    await manualReload;
    await waitFor(() => expect(tab()?.content).toBe('newest edit'));
    expect(api.editorReadFile).toHaveBeenCalledTimes(3);
  });

  it('preserves a queued dirty change after a failed save', async () => {
    useWorkspaceStore.getState().updateEditorContent('tab', 'unsaved edits', workspace.id);
    const saveResult = deferred<{ success: boolean; errorCode: 'permission-denied' }>();
    api.editorWriteFile.mockReturnValueOnce(saveResult.promise);
    const save = useWorkspaceStore.getState().saveEditorFile('tab', workspace.id);
    change();
    saveResult.resolve({ success: false, errorCode: 'permission-denied' });
    await save;
    expect(tab()).toMatchObject({ content: 'unsaved edits', originalContent: 'original', isDirty: true, hasExternalChange: true });
    expect(api.editorReadFile).not.toHaveBeenCalled();
  });

  it('reloads a queued change after a successful save clears the external-change flag', async () => {
    useWorkspaceStore.getState().updateEditorContent('tab', 'saved edits', workspace.id);
    const saveResult = deferred<{ success: boolean }>();
    api.editorWriteFile.mockReturnValueOnce(saveResult.promise);
    api.editorReadFile.mockResolvedValueOnce({ success: true, content: 'newest edit' });
    const save = useWorkspaceStore.getState().saveEditorFile('tab', workspace.id);
    change();
    saveResult.resolve({ success: true });
    await save;
    await waitFor(() => expect(tab()).toMatchObject({ content: 'newest edit', isDirty: false, hasExternalChange: false }));
    expect(api.editorReadFile).toHaveBeenCalledTimes(1);
  });

  it('retains an unchanged-file retry queued during a manual read', async () => {
    useWorkspaceStore.getState().markEditorTabExternallyChanged('tab', workspace.id);
    const manualRead = deferred<FileReadResult>();
    api.editorReadFile.mockReturnValueOnce(manualRead.promise).mockResolvedValueOnce({ success: true, content: 'newest edit' });
    const reload = useWorkspaceStore.getState().reloadEditorTab('tab', workspace.id);
    api.onRemoteFilesChanged.mock.calls[0][0]({ workspaceId: workspace.id, directoryPaths: [], files: [], unchangedFilePaths: ['/ws/file'] });
    manualRead.resolve({ success: true, content: 'older edit' });
    await reload;
    await waitFor(() => expect(tab()?.content).toBe('newest edit'));
    expect(api.editorReadFile).toHaveBeenCalledTimes(2);
  });

  it('keeps a parked workspace notification scoped until that workspace is active again', async () => {
    const manualRead = deferred<FileReadResult>();
    api.editorReadFile.mockReturnValueOnce(manualRead.promise).mockResolvedValueOnce({ success: true, content: 'newest edit' });
    const reload = useWorkspaceStore.getState().reloadEditorTab('tab', workspace.id);
    change();
    const other = createWorkspaceFixture({ id: 'other-host', environmentId: 'ssh-other', workspacePath: '/ws', editorTabs: workspace.editorTabs });
    useWorkspaceStore.setState({ workspaces: [useWorkspaceStore.getState().getWorkspaceById(workspace.id)!, other], activeWorkspaceId: other.id });
    manualRead.resolve({ success: true, content: 'older edit' });
    await reload;
    expect(api.editorReadFile).toHaveBeenCalledTimes(1);
    useWorkspaceStore.setState({ activeWorkspaceId: workspace.id });
    await waitFor(() => expect(tab()?.content).toBe('newest edit'));
    expect(api.editorReadFile).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: workspace.id, filePath: '/ws/file' }));
    expect(useWorkspaceStore.getState().getWorkspaceById(other.id)?.editorTabs[0].content).toBe('original');
  });

  it('keeps a deletion queued during a manual read from being cleared by that read', async () => {
    const manualRead = deferred<FileReadResult>();
    api.editorReadFile.mockReturnValueOnce(manualRead.promise);
    const reload = useWorkspaceStore.getState().reloadEditorTab('tab', workspace.id);
    change(true);
    manualRead.resolve({ success: true, content: 'older edit' });
    await reload;
    expect(tab()?.isDeleted).toBe(true);
    expect(api.editorReadFile).toHaveBeenCalledTimes(1);
  });

  it('discards deferred notifications for a closed tab', async () => {
    const manualRead = deferred<FileReadResult>();
    api.editorReadFile.mockReturnValueOnce(manualRead.promise);
    const reload = useWorkspaceStore.getState().reloadEditorTab('tab', workspace.id);
    change();
    useWorkspaceStore.getState().closeEditorTab('tab', workspace.id);
    manualRead.resolve({ success: true, content: 'older edit' });
    await reload;
    expect(tab()).toBeUndefined();
    expect(api.editorReadFile).toHaveBeenCalledTimes(1);
  });
});
