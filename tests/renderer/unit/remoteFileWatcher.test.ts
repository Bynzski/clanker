// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRemoteFileWatcher } from '../../../src/renderer/lib/remoteFileWatcher';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { RemoteFilesChangedEvent } from '../../../src/shared/types/remoteFileWatch';

describe('remote file watcher renderer routing', () => {
  let api: ReturnType<typeof installElectronApiMock>;
  let stop: (() => void) | undefined;
  const tabs = [
    { id: 'clean', filePath: '/ws/clean', fileName: 'clean', content: '', originalContent: '', isDirty: false },
    { id: 'dirty', filePath: '/ws/dirty', fileName: 'dirty', content: 'edited', originalContent: '', isDirty: true },
  ];
  const remote = createWorkspaceFixture({ id: 'remote', environmentId: 'host', workspacePath: '/ws', explorerVisible: true, explorerExpandedPaths: ['/ws/src'], editorTabs: tabs });
  beforeEach(() => {
    api = installElectronApiMock();
    useWorkspaceStore.setState({ workspaces: [remote], activeWorkspaceId: remote.id, reloadEditorTab: vi.fn().mockResolvedValue(undefined), markEditorTabExternallyChanged: vi.fn(), markEditorTabDeleted: vi.fn() });
  });
  afterEach(() => { stop?.(); stop = undefined; });
  function emit(event: RemoteFilesChangedEvent) {
    api.onRemoteFilesChanged.mock.calls[0][0](event);
  }

  it('batches active remote targets without thrashing on buffer edits and stops on a local switch', () => {
    stop = startRemoteFileWatcher();
    expect(api.remoteFilesWatch).toHaveBeenCalledWith({ workspaceId: 'remote', filePaths: ['/ws/clean', '/ws/dirty'], directoryPaths: ['/ws', '/ws/src'] });
    useWorkspaceStore.setState({ workspaces: [{ ...remote, editorTabs: tabs.map((tab) => ({ ...tab, content: 'typing' })) }] });
    expect(api.remoteFilesWatch).toHaveBeenCalledTimes(1);
    const local = createWorkspaceFixture({ id: 'local', workspacePath: '/ws' });
    useWorkspaceStore.setState({ workspaces: [remote, local], activeWorkspaceId: 'local' });
    expect(api.remoteFilesWatch).toHaveBeenLastCalledWith(null);
  });

  it('reloads clean tabs, flags dirty tabs and marks deletions without overwriting buffers', async () => {
    stop = startRemoteFileWatcher();
    emit({ workspaceId: 'remote', files: [{ filePath: '/ws/clean', deleted: false, initial: false }, { filePath: '/ws/dirty', deleted: false, initial: false }], directoryPaths: [] });
    expect(useWorkspaceStore.getState().reloadEditorTab).toHaveBeenCalledWith('clean', 'remote', { onlyIfClean: true });
    expect(useWorkspaceStore.getState().markEditorTabExternallyChanged).toHaveBeenCalledWith('dirty', 'remote');
    await Promise.resolve();
    emit({ workspaceId: 'remote', files: [{ filePath: '/ws/dirty', deleted: true, initial: false }], directoryPaths: [] });
    expect(useWorkspaceStore.getState().markEditorTabDeleted).toHaveBeenCalledWith('dirty', 'remote');
  });

  it('does not confuse same-path hosts or mark an initial dirty baseline as an external edit', () => {
    stop = startRemoteFileWatcher();
    emit({ workspaceId: 'other-host', files: [{ filePath: '/ws/clean', deleted: false, initial: false }], directoryPaths: [] });
    expect(useWorkspaceStore.getState().reloadEditorTab).not.toHaveBeenCalled();
    emit({ workspaceId: 'remote', files: [{ filePath: '/ws/dirty', deleted: false, initial: true }], directoryPaths: [] });
    expect(useWorkspaceStore.getState().markEditorTabExternallyChanged).not.toHaveBeenCalled();
  });

  it('keeps monitoring editor files when the Explorer is hidden and removes closed tabs', () => {
    stop = startRemoteFileWatcher();
    useWorkspaceStore.setState({ workspaces: [{ ...remote, explorerVisible: false, editorTabs: [tabs[0]] }] });
    expect(api.remoteFilesWatch).toHaveBeenLastCalledWith({ workspaceId: 'remote', filePaths: ['/ws/clean'], directoryPaths: [] });
    useWorkspaceStore.setState({ workspaces: [] });
    expect(api.remoteFilesWatch).toHaveBeenLastCalledWith(null);
  });

  it('retries a failed clean reload on a later unchanged snapshot', () => {
    useWorkspaceStore.setState({ workspaces: [{ ...remote, editorTabs: tabs.map((tab) => ({ ...tab, hasExternalChange: true })) }] });
    stop = startRemoteFileWatcher();
    emit({ workspaceId: 'remote', files: [], directoryPaths: [], unchangedFilePaths: ['/ws/clean', '/ws/dirty'] });
    expect(useWorkspaceStore.getState().reloadEditorTab).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().reloadEditorTab).toHaveBeenCalledWith('clean', 'remote', { onlyIfClean: true, retryIfIdle: true });
  });
});
