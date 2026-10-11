// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRemoteFileWatcher } from '../../../src/renderer/lib/remoteFileWatcher';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { snapshot, EMPTY_ATTENTION } from '../../_helpers/attentionSnapshots';
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
    useAgentAttentionStore.setState(EMPTY_ATTENTION);
    useWorkspaceStore.setState({ workspaces: [remote], activeWorkspaceId: remote.id, reloadEditorTab: vi.fn().mockResolvedValue(undefined), markEditorTabExternallyChanged: vi.fn(), markEditorTabDeleted: vi.fn() });
  });
  afterEach(() => { stop?.(); stop = undefined; });
  function emit(event: RemoteFilesChangedEvent) {
    api.onRemoteFilesChanged.mock.calls[0][0](event);
  }

  it('batches active remote targets without thrashing on buffer edits and stops on a local switch', () => {
    stop = startRemoteFileWatcher();
    expect(api.remoteFilesWatch).toHaveBeenCalledWith({ workspaceId: 'remote', selectionGeneration: expect.any(Number), filePaths: ['/ws/clean', '/ws/dirty'], directoryPaths: ['/ws', '/ws/src'] });
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
    expect(api.remoteFilesWatch).toHaveBeenLastCalledWith({ workspaceId: 'remote', selectionGeneration: expect.any(Number), filePaths: ['/ws/clean'], directoryPaths: [] });
    useWorkspaceStore.setState({ workspaces: [] });
    expect(api.remoteFilesWatch).toHaveBeenLastCalledWith(null);
  });

  it('polls only the focused remote checkout and ignores late events from the previous root', () => {
    const context = { id: 'remote::a', workspaceId: 'remote', environmentId: 'host', path: '/ws-worktrees/a', kind: 'worktree' as const, branch: 'a' };
    const scoped = { ...remote, checkoutContexts: [context], activeTerminalId: 'a1', terminals: [
      { id: 'a1', pid: 1, workingDir: context.path, checkoutContextId: context.id },
      { id: 'a2', pid: 2, workingDir: context.path, checkoutContextId: context.id },
    ], editorTabs: [...tabs, { ...tabs[0], id: 'isolated', filePath: `${context.path}/clean`, checkoutContextId: context.id, checkoutRoot: context.path }], explorerExpandedPaths: ['/ws/src', `${context.path}/src`] };
    useWorkspaceStore.setState({ workspaces: [scoped] });
    stop = startRemoteFileWatcher();
    expect(api.remoteFilesWatch).toHaveBeenLastCalledWith({ workspaceId: 'remote', selectionGeneration: expect.any(Number), checkoutContextId: context.id, filePaths: [`${context.path}/clean`], directoryPaths: [context.path, `${context.path}/src`] });
    useWorkspaceStore.setState({ workspaces: [{ ...scoped, activeTerminalId: 'a2' }] });
    expect(api.remoteFilesWatch).toHaveBeenCalledTimes(1);
    emit({ workspaceId: 'remote', files: [{ filePath: '/ws/clean', deleted: true, initial: false }], directoryPaths: [] });
    expect(useWorkspaceStore.getState().markEditorTabDeleted).not.toHaveBeenCalled();
    emit({ workspaceId: 'remote', checkoutContextId: context.id, files: [{ filePath: `${context.path}/clean`, deleted: false, initial: false }], directoryPaths: [] });
    expect(useWorkspaceStore.getState().reloadEditorTab).toHaveBeenCalledWith('isolated', 'remote', { onlyIfClean: true });
  });

  it('reacts to authenticated observations, rejects A→main→A late epochs, and stops on historical/missing reports', () => {
    const context = { id: 'remote::a', workspaceId: 'remote', environmentId: 'host', path: '/ws-worktrees/a', kind: 'worktree' as const };
    const scoped = { ...remote, checkoutContexts: [context], activeTerminalId: 'agent', terminals: [{ id: 'agent', pid: 1, workingDir: '/ws', checkoutContextId: 'remote::main' }], editorTabs: [{ ...tabs[0], id: 'a-file', filePath: `${context.path}/clean`, checkoutContextId: context.id, checkoutRoot: context.path }] };
    useWorkspaceStore.setState({ workspaces: [scoped] });
    stop = startRemoteFileWatcher();
    let revision = 0;
    const report = (checkoutContextId: string, path: string, state: 'current' | 'last-reported' = 'current') => {
      const value = snapshot('agent', 'idle', ++revision, { location: { checkoutContextId, path }, locationProvenance: { state, sessionId: 'S' } });
      useAgentAttentionStore.getState().applyChange({ terminalId: 'agent', revision, snapshot: value }, false);
    };
    report(context.id, context.path);
    const old = api.remoteFilesWatch.mock.calls[api.remoteFilesWatch.mock.calls.length - 1][0]!;
    expect(old).toMatchObject({ checkoutContextId: context.id, filePaths: [`${context.path}/clean`] });
    report('remote::main', '/ws'); report(context.id, context.path);
    const current = api.remoteFilesWatch.mock.calls[api.remoteFilesWatch.mock.calls.length - 1][0]!;
    expect(current.selectionGeneration).not.toBe(old.selectionGeneration);
    emit({ workspaceId: 'remote', checkoutContextId: context.id, selectionGeneration: old.selectionGeneration, files: [{ filePath: `${context.path}/clean`, deleted: true, initial: false }], directoryPaths: [] });
    expect(useWorkspaceStore.getState().markEditorTabDeleted).not.toHaveBeenCalled();
    emit({ workspaceId: 'remote', checkoutContextId: context.id, selectionGeneration: current.selectionGeneration, files: [{ filePath: `${context.path}/clean`, deleted: false, initial: false }], directoryPaths: [] });
    expect(useWorkspaceStore.getState().reloadEditorTab).toHaveBeenCalledWith('a-file', 'remote', { onlyIfClean: true });
    report(context.id, context.path, 'last-reported'); expect(api.remoteFilesWatch).toHaveBeenLastCalledWith(null);
    report(context.id, context.path);
    useWorkspaceStore.setState({ workspaces: [{ ...scoped, checkoutContexts: [{ ...context, missing: true }] }] });
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
