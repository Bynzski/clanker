import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileExplorer from '../../../src/renderer/components/FileExplorer';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { FileListDirectoryResult } from '../../../src/shared/types/fileExplorer';
import { checkoutSelectionToken } from '../../../src/renderer/lib/checkoutSelectionRuntime';
import { useExplorerDirectoryLoader } from '../../../src/renderer/lib/useExplorerDirectoryLoader';
import { renderHook } from '@testing-library/react';
import { executeDelete, executeRename, type ExplorerActionDeps } from '../../../src/renderer/components/FileExplorer/explorerActionHandlers';
const entry = (name: string, directory = false, root = '/repo') => ({ name, path: `${root}/${name}`, isDirectory: directory, size: 1, modified: 1 });
const empty: FileListDirectoryResult = { success: true, entries: [] };
const pending: Array<(value: FileListDirectoryResult) => void> = [];
function deferred() {
  let resolve!: (value: FileListDirectoryResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<FileListDirectoryResult>((yes, no) => { resolve = yes; reject = no; });
  pending.push(resolve); return { promise, resolve, reject };
}
let api: ReturnType<typeof installElectronApiMock>;
function setup(environmentId = 'local', cached = true) {
  const workspace = createWorkspaceFixture({ id: 'ws', workspacePath: '/repo', environmentId, explorerVisible: true,
    explorerEntriesByPath: cached ? { '/repo': [entry('src', true), entry('keep.txt'), entry('.hidden')], '/repo/src': [entry('nested.txt', false, '/repo/src')] } : {}, explorerExpandedPaths: cached ? ['/repo/src'] : [] });
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws', workspaces: [workspace] });
  return workspace;
}
beforeEach(() => { useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null }); api = installElectronApiMock({ fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }) }); });
afterEach(async () => { await act(async () => { for (const resolve of pending.splice(0)) resolve(empty); }); vi.useRealTimers(); });
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;
const refresh = () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

describe('directory history is presentation, not acquisition success', () => {
  it('cold load, authoritative empty, then unavailable historical empty are distinct', async () => {
    setup('local', false); const read = deferred(); api.fileListDirectory.mockReturnValueOnce(read.promise);
    render(<FileExplorer workspaceId="ws" />); expect(screen.getByText('Loading…')).toBeVisible();
    expect(workspace().explorerEntriesByPath['/repo']).toBeUndefined();
    await act(async () => read.resolve(empty)); expect(screen.getByText('No files')).toBeVisible();
    api.fileListDirectory.mockResolvedValue({ success: false, entries: [], error: 'Unavailable' }); refresh();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Last known'));
    expect(workspace().explorerEntriesByPath['/repo']).toEqual([]);
    expect(screen.queryByText('No files')).toBeNull(); expect(screen.getByText('No entries in previous listing')).toBeVisible();
  });
  it.each(['structured', 'thrown'] as const)('preserves root/nested history through %s failure and retry', async failure => {
    setup(); const root = deferred(); const child = deferred();
    api.fileListDirectory.mockImplementation(request => request.directoryPath === '/repo' ? root.promise : child.promise);
    render(<FileExplorer workspaceId="ws" />);
    expect(screen.getByText('keep.txt')).toBeVisible(); expect(screen.getByText('nested.txt')).toBeVisible();
    expect(screen.getAllByText(/Last known · Refreshing/)).toHaveLength(2);
    await act(async () => {
      if (failure === 'thrown') { root.reject(new Error('Read refused')); child.reject(new Error('Child refused')); }
      else { root.resolve({ success: false, entries: [], error: 'Read refused' }); child.resolve({ success: false, entries: [], error: 'Child refused' }); }
    });
    expect(screen.getByText('keep.txt')).toBeVisible(); expect(screen.getByText('nested.txt')).toBeVisible();
    expect(screen.getByText('Read refused')).toBeVisible(); expect(screen.getByText('Child refused')).toBeVisible();
    expect(workspace().explorerLoadingPaths).toEqual([]);
    const retry = deferred(); api.fileListDirectory.mockReturnValue(retry.promise); refresh();
    expect(screen.getByText('Read refused')).toBeVisible(); // retry does not erase errors
    await act(async () => retry.resolve({ success: true, entries: [entry('replacement.txt')] }));
    expect(screen.getByText('replacement.txt')).toBeVisible(); expect(screen.queryByText('keep.txt')).toBeNull();
    expect(workspace().explorerErrorsByPath['/repo']).toBeNull();
    expect(workspace().explorerVerifiedByPath?.['/repo']).toBe(checkoutSelectionToken('ws'));
  });
  it('keeps filters, hidden preference, selection, keyboard navigation and dirty buffers during a failed refresh', async () => {
    setup(); useWorkspaceStore.getState().setShowHiddenFiles(false, 'ws');
    useWorkspaceStore.setState(state => ({ workspaces: state.workspaces.map(ws => ({ ...ws, editorTabs: [{ id: 'dirty', filePath: '/repo/keep.txt', fileName: 'keep.txt', content: 'unsaved', originalContent: 'old', isDirty: true }] })) }));
    const read = deferred(); api.fileListDirectory.mockReturnValue(read.promise);
    render(<FileExplorer workspaceId="ws" variant="section" />);
    fireEvent.change(screen.getByLabelText('Filter files'), { target: { value: 'keep' } });
    expect(screen.queryByText('.hidden')).toBeNull(); expect(screen.queryByText('src')).toBeNull();
    const tree = document.querySelector('.file-tree')!; fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(workspace().explorerSelectedPath).toBe('/repo/keep.txt');
    await act(async () => read.reject(new Error('Disconnected')));
    expect(screen.getByText('keep.txt')).toBeVisible(); expect(screen.getByLabelText('Filter files')).toHaveValue('keep');
    expect(workspace().editorTabs[0]).toMatchObject({ isDirty: true, content: 'unsaved', originalContent: 'old' });
  });
});

describe('watcher demand and action safety', () => {
  it('dispatches every queued expanded directory and its forced successors before declaring current', async () => {
    setup('ssh:fixture', false);
    act(() => useWorkspaceStore.getState().setExplorerExpandedPaths(Array.from({ length: 8 }, (_, i) => `/repo/dir${i}`), 'ws'));
    const held = Array.from({ length: 3 }, deferred);
    api.fileListDirectory.mockImplementationOnce(() => held[0].promise).mockImplementationOnce(() => held[1].promise).mockImplementationOnce(() => held[2].promise).mockResolvedValue(empty);
    render(<FileExplorer workspaceId="ws" />);
    await act(async () => { await Promise.resolve(); });
    expect(api.fileListDirectory).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 5; i++) fireEvent(window, new Event('focus'));
    await act(async () => { for (const read of held) read.resolve(empty); });
    expect(api.fileListDirectory).toHaveBeenCalledTimes(12);
    const token = checkoutSelectionToken('ws');
    for (const path of ['/repo', ...workspace().explorerExpandedPaths]) expect(workspace().explorerVerifiedByPath?.[path]).toBe(token);
    expect(workspace().explorerLoadingPaths).toEqual([]);
  });
  it('coalesces manual/focus/watcher overlap into one successor and retries unchanged failed paths', async () => {
    setup('ssh:fixture', false); vi.useFakeTimers();
    let changed: Parameters<typeof window.electronAPI.onRemoteFilesChanged>[0] | undefined;
    api.onRemoteFilesChanged.mockImplementation(callback => { changed = callback; return vi.fn(); });
    const first = deferred(); const second = deferred();
    api.fileListDirectory.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue(empty);
    render(<FileExplorer workspaceId="ws" />);
    await act(async () => { await Promise.resolve(); });
    refresh(); for (let i = 0; i < 10; i++) fireEvent(window, new Event('focus'));
    act(() => changed?.({ workspaceId: 'ws', files: [], directoryPaths: ['/repo'] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(api.fileListDirectory).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(empty); });
    expect(api.fileListDirectory).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve({ success: false, entries: [], error: 'Disconnected' }); });
    act(() => changed?.({ workspaceId: 'ws', files: [], directoryPaths: [], unchangedDirectoryPaths: ['/repo'] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(api.fileListDirectory).toHaveBeenCalledTimes(3);
    expect(workspace().explorerErrorsByPath['/repo']).toBeNull();
  });
  it('stale names do not survive unavailable checkout guidance or grant file-operation access', async () => {
    setup(); const read = deferred(); api.fileListDirectory.mockReturnValue(read.promise);
    render(<FileExplorer workspaceId="ws" />); expect(screen.getByText('keep.txt')).toBeVisible();
    act(() => useWorkspaceStore.setState(state => ({ workspaces: state.workspaces.map(ws => ({ ...ws, fileSurfaceContextId: 'retired' })) })));
    expect(screen.queryByText('keep.txt')).toBeNull();
    expect(screen.getByText(/no longer registered|released|unavailable/i)).toBeVisible();
    expect(api.editorReadFile).not.toHaveBeenCalled(); expect(api.fileDelete).not.toHaveBeenCalled(); expect(api.fileRename).not.toHaveBeenCalled();
  });
});

describe('scoped loader retirement and confirmed mutation ordering', () => {
  it.each(['ssh:one', 'ssh:two', 'local'])('A→B→A rejects old replies at the same textual root (%s)', async environmentId => {
    setup(environmentId); const old = deferred(); const fresh = deferred(); api.fileListDirectory.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const hook = renderHook(() => useExplorerDirectoryLoader('ws', environmentId, '/repo'));
    let first!: Promise<FileListDirectoryResult>; act(() => { first = hook.result.current.load('/repo'); });
    await act(async () => { await Promise.resolve(); });
    act(() => { useWorkspaceStore.setState({ activeWorkspaceId: null }); useWorkspaceStore.setState({ activeWorkspaceId: 'ws' }); });
    hook.rerender(); let second!: Promise<FileListDirectoryResult>; act(() => { second = hook.result.current.load('/repo'); });
    await act(async () => { old.resolve({ success: true, entries: [entry('obsolete.txt')] }); await first; });
    expect(workspace().explorerEntriesByPath['/repo']?.some(item => item.name === 'obsolete.txt')).toBe(false);
    await act(async () => { fresh.resolve(empty); await second; });
    expect(workspace().explorerEntriesByPath['/repo']).toEqual([]);
  });
  it.each(['rename', 'delete'] as const)('%s confirmed by main cannot be resurrected by an older parent read or failed follow-up', async mutation => {
    setup(); const old = deferred(); api.fileListDirectory.mockReturnValueOnce(old.promise).mockResolvedValue({ success: false, entries: [], error: 'Follow-up unavailable' });
    const hook = renderHook(() => useExplorerDirectoryLoader('ws', 'local', '/repo'));
    let first!: Promise<FileListDirectoryResult>; act(() => { first = hook.result.current.load('/repo'); });
    await act(async () => { await Promise.resolve(); });
    const updated = mutation === 'rename' ? [entry('renamed.txt')] : [];
    const state = useWorkspaceStore.getState();
    const deps: ExplorerActionDeps = { resolvedWorkspaceId: 'ws', normalizedWorkspacePath: '/repo',
      explorerEntriesByPath: workspace().explorerEntriesByPath, explorerExpandedPaths: [],
      setExplorerSelectedPath: state.setExplorerSelectedPath, setExplorerDirectoryEntries: state.setExplorerDirectoryEntries,
      setExplorerExpandedPaths: state.setExplorerExpandedPaths, clearExplorerDirectoryState: state.clearExplorerDirectoryState,
      toggleExplorerPath: state.toggleExplorerPath, loadDirectory: path => hook.result.current.load(path, { force: true }), isCurrent: hook.result.current.valid,
    };
    // Narrow the initial fixture parent to the one target for an exact post-mutation assertion.
    act(() => state.setExplorerDirectoryEntries('/repo', [entry('keep.txt')], 'ws'));
    const snapshot = () => workspace();
    await act(async () => {
      if (mutation === 'rename') await executeRename('/repo/keep.txt', 'renamed.txt', [], '/repo', deps, state.renameEditorTabPath, snapshot);
      else await executeDelete(entry('keep.txt'), [], '/repo', state.closeEditorTab, deps, snapshot);
    });
    expect(mutation === 'rename' ? api.fileRename : api.fileDelete).toHaveBeenCalledOnce();
    await act(async () => { old.resolve({ success: true, entries: [entry('keep.txt')] }); await first; });
    expect(workspace().explorerEntriesByPath['/repo']).toEqual(updated);
    await act(async () => { await hook.result.current.load('/repo', { force: true }); });
    expect(workspace().explorerEntriesByPath['/repo']).toEqual(updated);
    expect(workspace().explorerErrorsByPath['/repo']).toBe('Follow-up unavailable');
  });
  it('does not dispatch for missing/released contexts, or after workspace closure', async () => {
    setup(); const hook = renderHook(() => useExplorerDirectoryLoader('ws', 'local', '/repo', 'retired'));
    await act(async () => { expect((await hook.result.current.load('/repo')).success).toBe(false); });
    expect(api.fileListDirectory).not.toHaveBeenCalled();
    act(() => useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null }));
    await act(async () => { expect((await hook.result.current.load('/repo')).success).toBe(false); });
  });
  it('isolates two SSH environments and local workspaces sharing a textual directory', async () => {
    const a = setup('ssh:one'); const b = createWorkspaceFixture({ ...a, id: 'other', environmentId: 'ssh:two', checkoutContexts: undefined });
    const old = deferred(); api.fileListDirectory.mockReturnValueOnce(old.promise).mockResolvedValue(empty);
    const hook = renderHook(() => useExplorerDirectoryLoader('ws', 'ssh:one', '/repo'));
    let first!: Promise<FileListDirectoryResult>; act(() => { first = hook.result.current.load('/repo'); });
    await act(async () => { await Promise.resolve(); });
    act(() => useWorkspaceStore.setState({ workspaces: [a, b], activeWorkspaceId: 'other' }));
    await act(async () => { old.resolve({ success: true, entries: [entry('wrong-host.txt')] }); await first; });
    expect(useWorkspaceStore.getState().getWorkspaceById('other')!.explorerEntriesByPath).toEqual(b.explorerEntriesByPath);
    expect(workspace().explorerLoadingPaths).toEqual([]);
  });
});
