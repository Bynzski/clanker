// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileExplorer from '../../../src/renderer/components/FileExplorer';
import ExplorerLifecycleCoordinator from '../../../src/renderer/components/ExplorerLifecycleCoordinator';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { FileListDirectoryRequest, FileListDirectoryResult } from '../../../src/shared/types/fileExplorer';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import { startEditorFileWatcher } from '../../../src/renderer/lib/editorFileWatcher';

const MAIN = '/p/app';
const context = (name: string): CheckoutContext => ({ id: `ws::${name}`, workspaceId: 'ws', environmentId: 'local', path: `/p/app-worktrees/${name}`, kind: 'worktree', branch: name });
const A = context('alpha'), B = context('beta');
const rootContext: CheckoutContext = { id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: MAIN, kind: 'main' };
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;
const focus = (id: string) => act(() => useWorkspaceStore.getState().setActiveTerminal(id));

describe('focus-driven checkout files (real Explorer, watcher coordinator and editor store)', () => {
  let api: ReturnType<typeof installElectronApiMock>;
  beforeEach(() => {
    api = installElectronApiMock({
      fileListDirectory: vi.fn(async (request: FileListDirectoryRequest) => ({ success: true, entries: [{ name: 'same.txt', path: `${request.directoryPath}/same.txt`, isDirectory: false, size: 1, modified: 1 }] })),
      editorReadFile: vi.fn(async (request: { filePath: string }) => ({ success: true, content: request.filePath })),
      editorWriteFile: vi.fn().mockResolvedValue({ success: true }),
    });
    const terminals = [
      { id: 'main', pid: 1, workingDir: MAIN },
      { id: 'a1', pid: 2, workingDir: A.path, checkoutContextId: A.id },
      { id: 'a2', pid: 3, workingDir: A.path, checkoutContextId: A.id },
      { id: 'b', pid: 4, workingDir: B.path, checkoutContextId: B.id },
    ];
    const ws = createWorkspaceFixture({ id: 'ws', workspacePath: MAIN, checkoutContexts: [rootContext, A, B], terminals,
      panes: terminals.map((terminal) => ({ id: `pane-${terminal.id}`, terminalId: terminal.id })),
      activeTerminalId: 'main', explorerVisible: true, explorerEntriesByPath: {}, explorerExpandedPaths: [], editorTabs: [], activeEditorTabId: null });
    useWorkspaceStore.setState({ ...ws, workspaces: [ws], activeWorkspaceId: 'ws', pendingEditorOperations: {} });
  });
  afterEach(cleanup);
  const mount = () => render(<><ExplorerLifecycleCoordinator /><FileExplorer workspaceId="ws" /></>);
  const loaded = (root: string) => waitFor(() => expect(workspace().explorerEntriesByPath[root]).toBeDefined());

  it('follows main → alpha → beta → main and does not reload or rewatch within alpha', async () => {
    mount(); await loaded(MAIN);
    focus('a1'); await loaded(A.path);
    expect(screen.getByText('Checkout: alpha')).toBeTruthy();
    expect(api.fileListDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'ws', workspacePath: A.path, checkoutContextId: A.id, directoryPath: A.path }));
    expect(api.explorerStartWatching).toHaveBeenLastCalledWith('ws', A.id);
    const lists = api.fileListDirectory.mock.calls.length, watches = api.explorerStartWatching.mock.calls.length;
    focus('a2'); await act(async () => {});
    expect(api.fileListDirectory).toHaveBeenCalledTimes(lists);
    expect(api.explorerStartWatching).toHaveBeenCalledTimes(watches);
    focus('b'); await loaded(B.path);
    expect(screen.getByText('Checkout: beta')).toBeTruthy();
    focus('main');
    expect(screen.queryByText(/Checkout:/)).toBeNull();
    expect(api.explorerStartWatching).toHaveBeenLastCalledWith('ws');
  });

  it('keeps same relative filenames, saves and editor watches bound to their original checkout', async () => {
    mount(); await loaded(MAIN);
    await act(async () => useWorkspaceStore.getState().openFileInEditor(`${MAIN}/same.txt`, 'ws'));
    focus('a1'); await loaded(A.path);
    fireEvent.doubleClick(await screen.findByText('same.txt'));
    await waitFor(() => expect(workspace().editorTabs).toHaveLength(2));
    const isolated = workspace().editorTabs.find((tab) => tab.checkoutContextId === A.id)!;
    expect(isolated.content).toBe(`${A.path}/same.txt`);
    act(() => useWorkspaceStore.getState().updateEditorContent(isolated.id, 'alpha edit', 'ws'));
    const stop = startEditorFileWatcher();
    try {
      expect(api.editorWatchFile).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: A.path, workspaceId: 'ws', checkoutContextId: A.id, filePath: `${A.path}/same.txt` }));
      focus('b'); await loaded(B.path);
      await act(async () => useWorkspaceStore.getState().saveEditorFile(isolated.id, 'ws'));
      expect(api.editorWriteFile).toHaveBeenLastCalledWith({ workspacePath: A.path, workspaceId: 'ws', checkoutContextId: A.id, filePath: `${A.path}/same.txt`, content: 'alpha edit' });
      act(() => useWorkspaceStore.getState().setActiveEditorTab(isolated.id, 'ws'));
      expect(screen.getByText('Checkout: alpha')).toBeTruthy();
    } finally { stop(); }
  });

  it('falls back when the active context is released and preserves dirty tabs without rebinding saves', async () => {
    focus('a1'); mount(); await loaded(A.path);
    await act(async () => useWorkspaceStore.getState().openFileInEditor(`${A.path}/same.txt`, 'ws'));
    const tab = workspace().editorTabs[0];
    act(() => useWorkspaceStore.getState().updateEditorContent(tab.id, 'unsaved', 'ws'));
    act(() => useWorkspaceStore.getState().removeCheckoutContext('ws', A.id));
    await loaded(MAIN);
    expect(screen.queryByText('Checkout: alpha')).toBeNull();
    api.editorWriteFile.mockResolvedValueOnce({ success: false, errorCode: 'invalid-path' });
    let saved: boolean | undefined;
    await act(async () => { saved = await useWorkspaceStore.getState().saveEditorFile(tab.id, 'ws'); });
    expect(saved).toBe(false);
    expect(api.editorWriteFile).toHaveBeenLastCalledWith(expect.objectContaining({ workspacePath: A.path, checkoutContextId: A.id }));
    expect(workspace().editorTabs[0]).toMatchObject({ content: 'unsaved', isDirty: true, filePath: `${A.path}/same.txt` });
  });

  it('routes create, rename and delete through the focused checkout, ignoring another root’s selection', async () => {
    mount(); await loaded(MAIN);
    act(() => useWorkspaceStore.getState().setExplorerSelectedPath(`${MAIN}/same.txt`, 'ws'));
    focus('a1'); await loaded(A.path);
    api.fileCreate.mockResolvedValue({ success: true });
    api.fileRename.mockResolvedValue({ success: true });
    api.fileDelete.mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'New File' }));
    const input = document.querySelector('.tree-node-input')!;
    fireEvent.change(input, { target: { value: 'new.txt' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.fileCreate).toHaveBeenCalledWith({ workspacePath: A.path, workspaceId: 'ws', checkoutContextId: A.id, targetPath: `${A.path}/new.txt`, type: 'file' }));
    fireEvent.contextMenu(await screen.findByText('same.txt'));
    fireEvent.click(await screen.findByText('Rename'));
    const rename = document.querySelector('.tree-node-input')!;
    fireEvent.change(rename, { target: { value: 'renamed.txt' } });
    fireEvent.keyDown(rename, { key: 'Enter' });
    await waitFor(() => expect(api.fileRename).toHaveBeenCalledWith({ workspacePath: A.path, workspaceId: 'ws', checkoutContextId: A.id, oldPath: `${A.path}/same.txt`, newPath: `${A.path}/renamed.txt` }));
    fireEvent.contextMenu(await screen.findByText('same.txt'));
    fireEvent.click(await screen.findByText('Delete'));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.fileDelete).toHaveBeenCalledWith({ workspacePath: A.path, workspaceId: 'ws', checkoutContextId: A.id, targetPath: `${A.path}/same.txt` }));
  });

  it('reconciles a deleted checkout after its tree watcher reports the root’s parent', async () => {
    focus('a1'); mount(); await loaded(A.path);
    api.reconcileCheckoutContexts.mockResolvedValue({ success: true, contexts: [{ ...A, missing: true }, B], dropped: [] });
    act(() => api.onExplorerTreeChanged.mock.calls[0][0]({ directoryPath: '/p/app-worktrees' }));
    await loaded(MAIN);
    expect(api.reconcileCheckoutContexts).toHaveBeenCalledWith('ws');
    expect(screen.queryByText('Checkout: alpha')).toBeNull();
    expect(api.explorerStartWatching).toHaveBeenLastCalledWith('ws');
  });

  it('does not reuse retired caches or accept an old response when a new context occupies the same path', async () => {
    let resolve!: (result: FileListDirectoryResult) => void;
    const pending = new Promise<FileListDirectoryResult>((done) => { resolve = done; });
    const normal = api.fileListDirectory.getMockImplementation() as (request: FileListDirectoryRequest) => Promise<FileListDirectoryResult>;
    api.fileListDirectory.mockImplementation((request: FileListDirectoryRequest) => request.checkoutContextId === A.id ? pending : normal(request));
    focus('a1'); mount();
    await waitFor(() => expect(api.fileListDirectory).toHaveBeenCalled());
    act(() => {
      useWorkspaceStore.getState().removeCheckoutContext('ws', A.id);
      useWorkspaceStore.getState().upsertCheckoutContext('ws', { ...A, id: 'ws::replacement', branch: 'replacement' });
      useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((entry) => ({ ...entry, terminals: entry.terminals.map((terminal) => terminal.id === 'a1' ? { ...terminal, checkoutContextId: 'ws::replacement' } : terminal) })) }));
    });
    await loaded(A.path);
    expect(screen.getByText('Checkout: replacement')).toBeTruthy();
    await act(async () => { resolve({ success: true, entries: [{ name: 'old-copy.txt', path: `${A.path}/old-copy.txt`, isDirectory: false, size: 0, modified: 0 }] }); });
    expect(screen.queryByText('old-copy.txt')).toBeNull();
    expect(workspace().explorerEntriesByPath[A.path]?.map((entry) => entry.name)).toEqual(['same.txt']);
  });

  it('discards late directory responses after focus switches to another checkout', async () => {
    let resolve!: (result: FileListDirectoryResult) => void;
    const pending = new Promise<FileListDirectoryResult>((done) => { resolve = done; });
    const normal = api.fileListDirectory.getMockImplementation() as (request: FileListDirectoryRequest) => Promise<FileListDirectoryResult>;
    api.fileListDirectory.mockImplementation((request: FileListDirectoryRequest) => request.checkoutContextId === A.id ? pending : normal(request));
    focus('a1'); mount();
    await waitFor(() => expect(api.fileListDirectory).toHaveBeenCalled());
    focus('b'); await loaded(B.path);
    await act(async () => { resolve({ success: true, entries: [{ name: 'wrong.txt', path: `${A.path}/wrong.txt`, isDirectory: false, size: 0, modified: 0 }] }); });
    expect(screen.queryByText('wrong.txt')).toBeNull();
    expect(workspace().explorerEntriesByPath[A.path]).toBeUndefined();
  });
});
