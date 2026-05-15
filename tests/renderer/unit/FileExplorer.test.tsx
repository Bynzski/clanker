// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileExplorer from '../../../src/renderer/components/FileExplorer';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { FileExplorerEntry, FileListDirectoryRequest, FileListDirectoryResult } from '../../../src/shared/types/fileExplorer';
import type { ExplorerTreeChangedEvent } from '../../../src/shared/types/fileExplorer';

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
  });
}

function setActiveWorkspace(overrides: Partial<ReturnType<typeof createWorkspaceFixture>> = {}) {
  const workspace = createWorkspaceFixture({
    explorerVisible: true,
    ...overrides,
  });

  useWorkspaceStore.setState({
    ...workspace,
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
  });

  return workspace;
}

function createEntry(name: string, entryPath: string, isDirectory: boolean): FileExplorerEntry {
  return {
    name,
    path: entryPath,
    isDirectory,
    size: 1,
    modified: 1,
  };
}

async function findTreeNodeInput(): Promise<HTMLInputElement> {
  return waitFor(() => {
    const el = document.querySelector('.tree-node-input') as HTMLInputElement | null;
    expect(el).not.toBeNull();
    return el as HTMLInputElement;
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('FileExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('normalizes workspace and directory paths (trailing slashes) for directory loads', async () => {
    const workspace = setActiveWorkspace({ workspacePath: '/workspace/' });
    const electronApi = installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    });

    render(<FileExplorer />);

    await waitFor(() => {
      expect(electronApi.fileListDirectory).toHaveBeenCalledWith({
        workspacePath: '/workspace',
        directoryPath: '/workspace',
      });
    });

    // Ensure we don't accidentally call with the trailing slash variant.
    expect(electronApi.fileListDirectory).not.toHaveBeenCalledWith({
      workspacePath: workspace.workspacePath,
      directoryPath: workspace.workspacePath,
    });
  });

  it('loads the workspace root when visible', async () => {
    const workspace = setActiveWorkspace({ workspacePath: '/workspace' });
    const electronApi = installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    });

    render(<FileExplorer />);

    await waitFor(() => {
      expect(electronApi.fileListDirectory).toHaveBeenCalledWith({
        workspacePath: workspace.workspacePath,
        directoryPath: workspace.workspacePath,
      });
    });
  });

  it('does not load the workspace root when hidden', async () => {
    setActiveWorkspace({ explorerVisible: false, workspacePath: '/workspace' });
    const electronApi = installElectronApiMock();

    render(<FileExplorer />);

    await waitFor(() => {
      expect(screen.queryByText('Explorer')).toBeNull();
    });
    expect(electronApi.fileListDirectory).not.toHaveBeenCalled();
  });

  it('ignores explorer watcher events while hidden', async () => {
    setActiveWorkspace({ explorerVisible: false, workspacePath: '/workspace' });
    const fileListDirectory = vi.fn().mockResolvedValue({ success: true, entries: [] });
    let explorerTreeChangedHandler: ((event: ExplorerTreeChangedEvent) => void) | null = null;
    const electronApi = installElectronApiMock({
      fileListDirectory,
      onExplorerTreeChanged: vi.fn((callback) => {
        explorerTreeChangedHandler = callback;
        return () => {
          explorerTreeChangedHandler = null;
        };
      }),
    });

    render(<FileExplorer />);

    expect(electronApi.onExplorerTreeChanged).toHaveBeenCalledTimes(1);
    expect(explorerTreeChangedHandler).not.toBeNull();

    await act(async () => {
      explorerTreeChangedHandler?.({ directoryPath: '/workspace/src' });
    });

    expect(fileListDirectory).not.toHaveBeenCalled();
  });

  it('coalesces repeated explorer watcher events for expanded directories', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const rootEntries = [createEntry('src', '/workspace/src', true)];
    const childEntries = [createEntry('index.ts', '/workspace/src/index.ts', false)];
    let explorerTreeChangedHandler: ((event: ExplorerTreeChangedEvent) => void) | null = null;
    const fileListDirectory = vi.fn(async (request: FileListDirectoryRequest): Promise<FileListDirectoryResult> => {
      if (request.directoryPath === '/workspace') {
        return { success: true, entries: rootEntries };
      }

      if (request.directoryPath === '/workspace/src') {
        return { success: true, entries: childEntries };
      }

      return { success: false, entries: [], errorCode: 'invalid-path', error: 'bad path' };
    });
    installElectronApiMock({
      fileListDirectory,
      onExplorerTreeChanged: vi.fn((callback) => {
        explorerTreeChangedHandler = callback;
        return () => {
          explorerTreeChangedHandler = null;
        };
      }),
    });

    render(<FileExplorer />);

    fireEvent.click(await screen.findByText('src'));
    expect(await screen.findByText('index.ts')).toBeInTheDocument();

    fileListDirectory.mockClear();

    await act(async () => {
      explorerTreeChangedHandler?.({ directoryPath: '/workspace/src' });
      explorerTreeChangedHandler?.({ directoryPath: '/workspace/src' });
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(fileListDirectory).toHaveBeenCalledTimes(1);
    expect(fileListDirectory).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      directoryPath: '/workspace/src',
    });
  });

  it('shows hidden files and does not preload child directories on mount', async () => {
    const workspace = setActiveWorkspace({ workspacePath: '/workspace' });
    const rootEntries = [
      createEntry('src', '/workspace/src', true),
      createEntry('.env', '/workspace/.env', false),
    ];
    const electronApi = installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: rootEntries }),
    });

    render(<FileExplorer />);

    expect(await screen.findByText('.env')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(electronApi.fileListDirectory).toHaveBeenCalledTimes(1);
    expect(electronApi.fileListDirectory).toHaveBeenCalledWith({
      workspacePath: workspace.workspacePath,
      directoryPath: workspace.workspacePath,
    });
  });

  it('lazy loads children when a folder is expanded', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const rootEntries = [createEntry('src', '/workspace/src', true)];
    const childEntries = [createEntry('index.ts', '/workspace/src/index.ts', false)];
    const fileListDirectory = vi.fn(async (request: FileListDirectoryRequest): Promise<FileListDirectoryResult> => {
      if (request.directoryPath === '/workspace') {
        return { success: true, entries: rootEntries };
      }

      if (request.directoryPath === '/workspace/src') {
        return { success: true, entries: childEntries };
      }

      return { success: false, entries: [], errorCode: 'invalid-path', error: 'bad path' };
    });
    installElectronApiMock({ fileListDirectory });

    render(<FileExplorer />);

    fireEvent.click(await screen.findByText('src'));

    expect(await screen.findByText('index.ts')).toBeInTheDocument();
    expect(fileListDirectory).toHaveBeenNthCalledWith(1, {
      workspacePath: '/workspace',
      directoryPath: '/workspace',
    });
    expect(fileListDirectory).toHaveBeenNthCalledWith(2, {
      workspacePath: '/workspace',
      directoryPath: '/workspace/src',
    });
  });

  it('selects a file on click', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('README.md', '/workspace/README.md', false)],
      }),
    });

    render(<FileExplorer />);

    const fileNode = await screen.findByText('README.md');
    fireEvent.click(fileNode);

    expect(useWorkspaceStore.getState().explorerSelectedPath).toBe('/workspace/README.md');
    expect(fileNode.closest('.tree-node')).toHaveClass('selected');
  });

  it('renders an error state when directory loading fails', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: false,
        entries: [],
        errorCode: 'permission-denied',
        error: 'Permission denied while listing directory',
      }),
    });

    render(<FileExplorer />);

    expect(await screen.findByText('Permission denied while listing directory')).toBeInTheDocument();
  });

  it('surfaces thrown IPC errors instead of masking them', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockRejectedValue(new Error('No handler registered for file-list-directory')),
    });

    render(<FileExplorer />);

    expect(await screen.findByText('No handler registered for file-list-directory')).toBeInTheDocument();
  });

  it('opens a file in the editor on double-click', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('README.md', '/workspace/README.md', false)],
      }),
    });

    render(<FileExplorer />);

    const fileNode = await screen.findByText('README.md');
    fireEvent.dblClick(fileNode);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().editorTabs).toHaveLength(1);
      expect(useWorkspaceStore.getState().editorTabs[0].filePath).toBe('/workspace/README.md');
    });
  });

  it('does not open a directory in the editor on double-click', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('src', '/workspace/src', true)],
      }),
    });

    render(<FileExplorer />);

    const folderNode = await screen.findByText('src');
    fireEvent.dblClick(folderNode);

    // No editor tab should be created
    expect(useWorkspaceStore.getState().editorTabs).toHaveLength(0);
  });

  it('single-click selects a file without opening the editor', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('index.ts', '/workspace/index.ts', false)],
      }),
    });

    render(<FileExplorer />);

    const fileNode = await screen.findByText('index.ts');
    fireEvent.click(fileNode);

    // Selection should work but no editor tab created
    expect(useWorkspaceStore.getState().explorerSelectedPath).toBe('/workspace/index.ts');
    expect(useWorkspaceStore.getState().editorTabs).toHaveLength(0);
  });

  it('creates new files inside the selected folder', async () => {
    const workspace = setActiveWorkspace({ workspacePath: '/workspace' });
    const rootEntries = [createEntry('src', '/workspace/src', true)];
    const childEntries = [createEntry('index.ts', '/workspace/src/index.ts', false)];
    const fileCreate = vi.fn().mockResolvedValue({ success: true });
    const fileListDirectory = vi.fn(async (request: FileListDirectoryRequest): Promise<FileListDirectoryResult> => {
      if (request.directoryPath === '/workspace') {
        return { success: true, entries: rootEntries };
      }

      if (request.directoryPath === '/workspace/src') {
        return { success: true, entries: childEntries };
      }

      return { success: false, entries: [], errorCode: 'invalid-path', error: 'bad path' };
    });
    installElectronApiMock({ fileCreate, fileListDirectory });
    const user = userEvent.setup();

    render(<FileExplorer />);

    fireEvent.click(await screen.findByText('src'));
    fireEvent.click(await screen.findByText('index.ts'));
    await user.click(screen.getByTitle('New File'));

    const input = await findTreeNodeInput();
    await user.type(input, 'notes.md{enter}');

    await waitFor(() => {
      expect(fileCreate).toHaveBeenCalledWith({
        workspacePath: workspace.workspacePath,
        targetPath: '/workspace/src/notes.md',
        type: 'file',
      });
    });
  });

  it('opens a terminal from the explorer and registers it in the workspace store', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const initialTerminalCount = useWorkspaceStore.getState().terminals.length;
    const fileListDirectory = vi.fn().mockResolvedValue({
      success: true,
      entries: [createEntry('src', '/workspace/src', true)],
    });
    const spawnTerminal = vi.fn().mockResolvedValue({ id: 'terminal-2', pid: 2024 });
    installElectronApiMock({ fileListDirectory, spawnTerminal });
    const user = userEvent.setup();

    render(<FileExplorer />);

    fireEvent.contextMenu(await screen.findByText('src'));
    await user.click(screen.getByRole('menuitem', { name: 'Open in Terminal' }));

    await waitFor(() => {
      expect(spawnTerminal).toHaveBeenCalledWith('/workspace/src');
      expect(useWorkspaceStore.getState().terminals).toHaveLength(initialTerminalCount + 1);
      expect(useWorkspaceStore.getState().terminals).toContainEqual({
        id: 'terminal-2',
        pid: 2024,
        workingDir: '/workspace/src',
      });
    });
  });

  it('renames files immediately in the explorer tree before refresh completes', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const rootEntries = [createEntry('README.md', '/workspace/README.md', false)];
    const refreshedEntries = [createEntry('docs.md', '/workspace/docs.md', false)];
    const refreshDeferred = createDeferred<FileListDirectoryResult>();
    const fileListDirectory = vi.fn(async (request: FileListDirectoryRequest): Promise<FileListDirectoryResult> => {
      if (request.directoryPath === '/workspace' && fileListDirectory.mock.calls.length === 1) {
        return { success: true, entries: rootEntries };
      }

      if (request.directoryPath === '/workspace') {
        return refreshDeferred.promise;
      }

      return { success: false, entries: [], errorCode: 'invalid-path', error: 'bad path' };
    });
    installElectronApiMock({
      fileListDirectory,
      fileRename: vi.fn().mockResolvedValue({ success: true }),
    });
    const user = userEvent.setup();

    render(<FileExplorer />);

    fireEvent.contextMenu(await screen.findByText('README.md'));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const input = await findTreeNodeInput();
    await user.clear(input);
    await user.type(input, 'docs.md{enter}');

    await waitFor(() => {
      expect(screen.getByText('docs.md')).toBeInTheDocument();
    });

    refreshDeferred.resolve({ success: true, entries: refreshedEntries });
    await waitFor(() => {
      expect(fileListDirectory).toHaveBeenCalledTimes(2);
    });
  });

  it('renaming a directory clears stale subtree state while still refreshing the parent directory', async () => {
    setActiveWorkspace({
      workspacePath: '/workspace',
      explorerExpandedPaths: ['/workspace/src'],
      explorerEntriesByPath: {
        '/workspace': [
          createEntry('src', '/workspace/src', true),
          createEntry('README.md', '/workspace/README.md', false),
        ],
        '/workspace/src': [createEntry('index.ts', '/workspace/src/index.ts', false)],
      },
    });
    const refreshedEntries = [
      createEntry('lib', '/workspace/lib', true),
      createEntry('README.md', '/workspace/README.md', false),
    ];
    const refreshDeferred = createDeferred<FileListDirectoryResult>();
    const fileListDirectory = vi.fn(async (request: FileListDirectoryRequest): Promise<FileListDirectoryResult> => {
      if (request.directoryPath === '/workspace') {
        return refreshDeferred.promise;
      }

      return { success: true, entries: [] };
    });
    installElectronApiMock({
      fileListDirectory,
      fileRename: vi.fn().mockResolvedValue({ success: true }),
    });
    const user = userEvent.setup();

    render(<FileExplorer />);

    fireEvent.contextMenu(await screen.findByText('src'));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const input = await findTreeNodeInput();
    await user.clear(input);
    await user.type(input, 'lib{enter}');

    await waitFor(() => {
      expect(screen.getByText('lib')).toBeInTheDocument();
      expect(screen.getByText('README.md')).toBeInTheDocument();
    });

    expect(useWorkspaceStore.getState().explorerExpandedPaths).not.toContain('/workspace/src');
    expect(useWorkspaceStore.getState().explorerEntriesByPath['/workspace/src']).toBeUndefined();

    refreshDeferred.resolve({ success: true, entries: refreshedEntries });
    await waitFor(() => {
      expect(fileListDirectory).toHaveBeenCalledWith({
        workspacePath: '/workspace',
        directoryPath: '/workspace',
      });
    });
  });

  it('deleting a directory clears stale subtree state while still refreshing the parent directory', async () => {
    setActiveWorkspace({
      workspacePath: '/workspace',
      explorerExpandedPaths: ['/workspace/src'],
      explorerEntriesByPath: {
        '/workspace': [
          createEntry('src', '/workspace/src', true),
          createEntry('README.md', '/workspace/README.md', false),
        ],
        '/workspace/src': [createEntry('index.ts', '/workspace/src/index.ts', false)],
      },
    });
    const refreshedEntries = [createEntry('README.md', '/workspace/README.md', false)];
    const refreshDeferred = createDeferred<FileListDirectoryResult>();
    const fileListDirectory = vi.fn(async (request: FileListDirectoryRequest): Promise<FileListDirectoryResult> => {
      if (request.directoryPath === '/workspace') {
        return refreshDeferred.promise;
      }

      return { success: true, entries: [] };
    });
    installElectronApiMock({
      fileListDirectory,
      fileDelete: vi.fn().mockResolvedValue({ success: true }),
    });

    render(<FileExplorer />);

    fireEvent.contextMenu(await screen.findByText('src'));
    fireEvent.click(await screen.findByText('Delete'));
    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => {
      expect(screen.queryByText('src')).not.toBeInTheDocument();
      expect(screen.getByText('README.md')).toBeInTheDocument();
    });

    expect(useWorkspaceStore.getState().explorerExpandedPaths).not.toContain('/workspace/src');
    expect(useWorkspaceStore.getState().explorerEntriesByPath['/workspace/src']).toBeUndefined();

    refreshDeferred.resolve({ success: true, entries: refreshedEntries });
    await waitFor(() => {
      expect(fileListDirectory).toHaveBeenCalledWith({
        workspacePath: '/workspace',
        directoryPath: '/workspace',
      });
    });
  });
});


// =========================================================================
// S8: Inline create/rename UI + delete confirmation
// =========================================================================
describe('S8: Inline create/rename UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('renders "New File" and "New Folder" header buttons', () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    });

    render(<FileExplorer />);

    expect(screen.getByTitle('New File')).toBeInTheDocument();
    expect(screen.getByTitle('New Folder')).toBeInTheDocument();
  });

  it('context menu "Rename" action triggers inline rename input', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('index.ts', '/workspace/index.ts', false)],
      }),
    });

    render(<FileExplorer />);

    const fileNode = await screen.findByText('index.ts');
    fireEvent.contextMenu(fileNode);

    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Rename'));

    const input = document.querySelector('.tree-node-input') as HTMLInputElement;
    await waitFor(() => {
      expect(input).toBeInTheDocument();
      expect(input).toHaveFocus();
    });
  });

  it('commits rename on Enter key', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const fileRename = vi.fn().mockResolvedValue({ success: true });
    const fileListDirectory = vi.fn().mockResolvedValue({
      success: true,
      entries: [createEntry('index.ts', '/workspace/index.ts', false)],
    });
    installElectronApiMock({ fileRename, fileListDirectory });

    render(<FileExplorer />);

    const fileNode = await screen.findByText('index.ts');
    fireEvent.contextMenu(fileNode);

    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Rename'));

    const input = document.querySelector('.tree-node-input') as HTMLInputElement;
    await waitFor(() => expect(input).toBeInTheDocument());

    await userEvent.clear(input);
    await userEvent.type(input, 'main.ts');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(fileRename).toHaveBeenCalledWith({
        workspacePath: '/workspace',
        oldPath: '/workspace/index.ts',
        newPath: '/workspace/main.ts',
      });
    });

    await waitFor(() => {
      expect(fileListDirectory).toHaveBeenCalledWith({
        workspacePath: '/workspace',
        directoryPath: '/workspace',
      });
    });
  });

  it('clicking "Open Folder" loads a folder entry instead of doing nothing', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const fileListDirectory = vi.fn().mockImplementation(async (request: FileListDirectoryRequest): Promise<FileListDirectoryResult> => {
      if (request.directoryPath === '/workspace') {
        return {
          success: true,
          entries: [createEntry('src', '/workspace/src', true)],
        };
      }

      if (request.directoryPath === '/workspace/src') {
        return {
          success: true,
          entries: [],
        };
      }

      return {
        success: false,
        entries: [],
        errorCode: 'invalid-path',
        error: 'Invalid path',
      };
    });
    installElectronApiMock({ fileListDirectory });

    render(<FileExplorer />);

    const folderNode = await screen.findByText('src');
    fireEvent.contextMenu(folderNode);

    await waitFor(() => {
      expect(screen.getByText('Open Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Open Folder'));

    await waitFor(() => {
      expect(fileListDirectory).toHaveBeenCalledWith({
        workspacePath: '/workspace',
        directoryPath: '/workspace/src',
      });
    });
  });

  it('clicking "Reveal in File Manager" uses the reveal bridge', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const revealInFileManager = vi.fn().mockResolvedValue(true);
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('index.ts', '/workspace/index.ts', false)],
      }),
      revealInFileManager,
    });

    render(<FileExplorer />);

    const fileNode = await screen.findByText('index.ts');
    fireEvent.contextMenu(fileNode);

    await waitFor(() => {
      expect(screen.getByText('Reveal in File Manager')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reveal in File Manager'));

    await waitFor(() => {
      expect(revealInFileManager).toHaveBeenCalledWith('/workspace/index.ts');
    });
  });

  it('clicking "Copy Relative Path" copies a workspace-relative path', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const writeClipboard = vi.fn().mockResolvedValue({ success: true });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('src', '/workspace/src', true)],
      }),
      writeClipboard,
    });

    render(<FileExplorer />);

    const folderNode = await screen.findByText('src');
    fireEvent.contextMenu(folderNode);

    await waitFor(() => {
      expect(screen.getByText('Copy Relative Path')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Copy Relative Path'));

    await waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith('src');
    });
  });

  it('cancels rename on Escape key', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const fileRename = vi.fn().mockResolvedValue({ success: true });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('index.ts', '/workspace/index.ts', false)],
      }),
      fileRename,
    });

    render(<FileExplorer />);

    const fileNode = await screen.findByText('index.ts');
    fireEvent.contextMenu(fileNode);

    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Rename'));

    const input = document.querySelector('.tree-node-input') as HTMLInputElement;
    await waitFor(() => expect(input).toBeInTheDocument());

    await userEvent.clear(input);
    await userEvent.type(input, 'main.ts');
    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(fileRename).not.toHaveBeenCalled();
    });

    expect(document.querySelector('.tree-node-input')).toBeNull();
    expect(screen.getByText('index.ts')).toBeInTheDocument();
  });

  it('renaming a file open in editor updates the editor tab path', async () => {
    setActiveWorkspace({
      workspacePath: '/workspace',
      editorTabs: [{
        id: 'tab-1',
        filePath: '/workspace/index.ts',
        fileName: 'index.ts',
        isDirty: false,
        content: 'console.log("hi")',
        originalContent: 'console.log("hi")',
      }],
    });
    const fileRename = vi.fn().mockResolvedValue({ success: true });
    const fileListDirectory = vi.fn().mockResolvedValue({
      success: true,
      entries: [createEntry('index.ts', '/workspace/index.ts', false)],
    });
    installElectronApiMock({ fileRename, fileListDirectory });

    render(<FileExplorer />);

    const fileNode = await screen.findByText('index.ts');
    fireEvent.contextMenu(fileNode);

    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Rename'));

    const input = document.querySelector('.tree-node-input') as HTMLInputElement;
    await waitFor(() => expect(input).toBeInTheDocument());

    await userEvent.clear(input);
    await userEvent.type(input, 'main.ts');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      const tab = useWorkspaceStore.getState().editorTabs.find(t => t.id === 'tab-1');
      expect(tab?.filePath).toBe('/workspace/main.ts');
      expect(tab?.fileName).toBe('main.ts');
    });
  });

  it('shows inline validation and does not create reserved Windows names', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const fileCreate = vi.fn().mockResolvedValue({ success: true });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('README.md', '/workspace/README.md', false)],
      }),
      fileCreate,
    });

    render(<FileExplorer />);

    fireEvent.click(screen.getByTitle('New File'));

    const input = await findTreeNodeInput();
    await userEvent.type(input, 'CON{enter}');

    expect(fileCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Name is reserved by Windows')).toBeInTheDocument();
  });

  it('does not create file when name is empty on Enter', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const fileCreate = vi.fn().mockResolvedValue({ success: true });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
      fileCreate,
    });

    render(<FileExplorer />);

    fireEvent.click(screen.getByTitle('New File'));

    const input = await findTreeNodeInput();
    fireEvent.keyDown(input, { key: 'Enter' });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fileCreate).not.toHaveBeenCalled();
  });

  // Regression: issue #34 — adding a file in an empty workspace silently failed
  // because FileTree returned the "No files" placeholder before the create input
  // had a chance to render.
  it('creates a file at the workspace root when the directory is empty', async () => {
    const workspace = setActiveWorkspace({ workspacePath: '/workspace' });
    const fileCreate = vi.fn().mockResolvedValue({ success: true });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
      fileCreate,
    });

    render(<FileExplorer />);

    expect(await screen.findByText('No files')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('New File'));

    const input = await findTreeNodeInput();
    expect(screen.queryByText('No files')).not.toBeInTheDocument();
    await userEvent.type(input, 'notes.md{enter}');

    await waitFor(() => {
      expect(fileCreate).toHaveBeenCalledWith({
        workspacePath: workspace.workspacePath,
        targetPath: '/workspace/notes.md',
        type: 'file',
      });
    });
  });

  it('creates a folder at the workspace root when the directory is empty', async () => {
    const workspace = setActiveWorkspace({ workspacePath: '/workspace' });
    const fileCreate = vi.fn().mockResolvedValue({ success: true });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
      fileCreate,
    });

    render(<FileExplorer />);

    expect(await screen.findByText('No files')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('New Folder'));

    const input = await findTreeNodeInput();
    await userEvent.type(input, 'docs{enter}');

    await waitFor(() => {
      expect(fileCreate).toHaveBeenCalledWith({
        workspacePath: workspace.workspacePath,
        targetPath: '/workspace/docs',
        type: 'directory',
      });
    });
  });

  // Edge: a directory selected after being collapsed is still in the entry cache,
  // so resolveCreateParentPath returns its path — but TreeNodeChildren only
  // renders the create input when the directory is expanded. Auto-expand on
  // startCreating so the input always has a place to render.
  it('auto-expands a collapsed-but-loaded parent directory when creating', async () => {
    const workspace = setActiveWorkspace({
      workspacePath: '/workspace',
      explorerSelectedPath: '/workspace/src',
      explorerEntriesByPath: {
        '/workspace': [createEntry('src', '/workspace/src', true)],
        '/workspace/src': [],
      },
      explorerExpandedPaths: [],
    });
    const fileCreate = vi.fn().mockResolvedValue({ success: true });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
      fileCreate,
    });

    render(<FileExplorer />);

    await screen.findByText('src');
    fireEvent.click(screen.getByTitle('New File'));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().explorerExpandedPaths).toContain('/workspace/src');
    });

    const input = await findTreeNodeInput();
    await userEvent.type(input, 'notes.md{enter}');

    await waitFor(() => {
      expect(fileCreate).toHaveBeenCalledWith({
        workspacePath: workspace.workspacePath,
        targetPath: '/workspace/src/notes.md',
        type: 'file',
      });
    });
  });

  it('surfaces an alert when fileCreate fails so the user is not left guessing', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const fileCreate = vi.fn().mockResolvedValue({
      success: false,
      error: 'Permission denied',
    });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
      fileCreate,
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    try {
      render(<FileExplorer />);

      fireEvent.click(screen.getByTitle('New File'));
      const input = await findTreeNodeInput();
      await userEvent.type(input, 'notes.md{enter}');

      await waitFor(() => {
        expect(fileCreate).toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith('Permission denied');
      });
    } finally {
      alertSpy.mockRestore();
    }
  });
});


// =========================================================================
// S10: Delete + Rename coordination with editor tabs
// =========================================================================
describe('S10: Delete + Rename coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('deleting a file that is open in the editor closes the editor tab', async () => {
    setActiveWorkspace({
      workspacePath: '/workspace',
      editorTabs: [{
        id: 'tab-1',
        filePath: '/workspace/index.ts',
        fileName: 'index.ts',
        isDirty: false,
        content: 'console.log("hi")',
        originalContent: 'console.log("hi")',
      }],
      explorerEntriesByPath: {
        '/workspace': [createEntry('index.ts', '/workspace/index.ts', false)],
      },
    });
    const fileDelete = vi.fn().mockResolvedValue({ success: true });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
      fileDelete,
    });

    render(<FileExplorer />);

    const fileNode = await screen.findByText('index.ts');
    fireEvent.contextMenu(fileNode);

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete'));

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to delete "index.ts"? This cannot be undone.')).toBeInTheDocument();
    });

    // Click the Delete button in the confirmation dialog
    fireEvent.click(screen.getByText('Delete'));

    // Wait for the tab to be closed
    await waitFor(() => {
      expect(useWorkspaceStore.getState().editorTabs).toHaveLength(0);
    });
  });

  // Edge: previously only FILE_IN_USE failures alerted; other errors (permission
  // denied, ENOSPC, etc.) silently console.error'd, leaving the user with no
  // indication the action failed. All delete failures should now surface.
  it('alerts when fileDelete fails for any reason (not just FILE_IN_USE)', async () => {
    setActiveWorkspace({
      workspacePath: '/workspace',
      explorerEntriesByPath: {
        '/workspace': [createEntry('locked.txt', '/workspace/locked.txt', false)],
      },
    });
    const fileDelete = vi.fn().mockResolvedValue({
      success: false,
      errorCode: 'PERMISSION_DENIED',
      error: 'Permission denied',
    });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('locked.txt', '/workspace/locked.txt', false)],
      }),
      fileDelete,
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    try {
      render(<FileExplorer />);

      const fileNode = await screen.findByText('locked.txt');
      fireEvent.contextMenu(fileNode);
      fireEvent.click(await screen.findByText('Delete'));
      fireEvent.click(await screen.findByText('Delete'));

      await waitFor(() => {
        expect(fileDelete).toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith('Permission denied');
      });
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('alerts when fileRename fails for any reason (not just FILE_IN_USE)', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    const fileRename = vi.fn().mockResolvedValue({
      success: false,
      errorCode: 'PERMISSION_DENIED',
      error: 'Permission denied',
    });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('index.ts', '/workspace/index.ts', false)],
      }),
      fileRename,
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    try {
      render(<FileExplorer />);

      const fileNode = await screen.findByText('index.ts');
      fireEvent.contextMenu(fileNode);
      fireEvent.click(await screen.findByText('Rename'));

      const input = document.querySelector('.tree-node-input') as HTMLInputElement;
      await waitFor(() => expect(input).toBeInTheDocument());
      await userEvent.clear(input);
      await userEvent.type(input, 'main.ts{enter}');

      await waitFor(() => {
        expect(fileRename).toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith('Permission denied');
      });
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('deleting a directory closes all editor tabs for files inside that directory', async () => {
    setActiveWorkspace({
      workspacePath: '/workspace',
      editorTabs: [
        {
          id: 'tab-1',
          filePath: '/workspace/src/index.ts',
          fileName: 'index.ts',
          isDirty: false,
          content: 'console.log("hi")',
          originalContent: 'console.log("hi")',
        },
        {
          id: 'tab-2',
          filePath: '/workspace/src/utils.ts',
          fileName: 'utils.ts',
          isDirty: false,
          content: 'export {}',
          originalContent: 'export {}',
        },
        {
          id: 'tab-3',
          filePath: '/workspace/README.md',
          fileName: 'README.md',
          isDirty: false,
          content: '# Project',
          originalContent: '# Project',
        },
      ],
      explorerEntriesByPath: {
        '/workspace': [
          createEntry('src', '/workspace/src', true),
          createEntry('README.md', '/workspace/README.md', false),
        ],
      },
    });
    const fileDelete = vi.fn().mockResolvedValue({ success: true });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
      fileDelete,
    });

    render(<FileExplorer />);

    // Open context menu on src folder
    const folderNode = await screen.findByText('src');
    fireEvent.contextMenu(folderNode);

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete'));

    // Confirmation dialog should appear for directory
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to delete "src"? This cannot be undone.')).toBeInTheDocument();
    });

    // Click Delete in the confirmation dialog
    fireEvent.click(screen.getByText('Delete'));

    // Wait for tabs inside src/ to be closed, but README.md tab should remain
    await waitFor(() => {
      const tabs = useWorkspaceStore.getState().editorTabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe('/workspace/README.md');
    });
  });
});


// =========================================================================
// S9: Keyboard Navigation
// =========================================================================
describe('S9: Keyboard navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('renders the file-tree with tabIndex so it can receive keyboard focus', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [
          createEntry('index.ts', '/workspace/index.ts', false),
        ],
      }),
    });

    render(<FileExplorer />);

    // Wait for the tree to render so .file-tree is in the DOM
    await screen.findByText('index.ts');

    const treeContainer = document.querySelector('.file-tree') as HTMLDivElement;
    expect(treeContainer).not.toBeNull();
    expect(treeContainer.tabIndex).toBe(0);
  });

  it('ArrowDown moves selection to next node', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [
          createEntry('index.ts', '/workspace/index.ts', false),
          createEntry('README.md', '/workspace/README.md', false),
        ],
      }),
    });

    render(<FileExplorer />);

    await screen.findByText('index.ts');

    const treeContainer = document.querySelector('.file-tree') as HTMLDivElement;
    treeContainer.focus();

    // First ArrowDown: selects the first node (nothing was selected yet)
    fireEvent.keyDown(treeContainer, { key: 'ArrowDown' });
    expect(useWorkspaceStore.getState().explorerSelectedPath).toBe('/workspace/index.ts');

    // Second ArrowDown: moves to the next node
    fireEvent.keyDown(treeContainer, { key: 'ArrowDown' });

    expect(useWorkspaceStore.getState().explorerSelectedPath).toBe('/workspace/README.md');
  });

  it('ArrowUp moves selection to previous node', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [
          createEntry('index.ts', '/workspace/index.ts', false),
          createEntry('README.md', '/workspace/README.md', false),
        ],
      }),
    });

    render(<FileExplorer />);

    await screen.findByText('index.ts');

    const treeContainer = document.querySelector('.file-tree') as HTMLDivElement;

    // Move down first, then up
    fireEvent.keyDown(treeContainer, { key: 'ArrowDown' });
    fireEvent.keyDown(treeContainer, { key: 'ArrowUp' });

    expect(useWorkspaceStore.getState().explorerSelectedPath).toBe('/workspace/index.ts');
  });

  it('ArrowRight expands a collapsed folder', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockImplementation(async (request: { directoryPath: string }) => {
        if (request.directoryPath === '/workspace') {
          return { success: true, entries: [createEntry('src', '/workspace/src', true)] };
        }
        if (request.directoryPath === '/workspace/src') {
          return { success: true, entries: [createEntry('index.ts', '/workspace/src/index.ts', false)] };
        }
        return { success: true, entries: [] };
      }),
    });

    render(<FileExplorer />);

    // Wait for the src folder to appear in the tree
    await screen.findByText('src');

    const treeContainer = document.querySelector('.file-tree') as HTMLDivElement;
    treeContainer.focus();

    // Press ArrowRight on the folder — should expand it
    fireEvent.keyDown(treeContainer, { key: 'ArrowRight' });

    // Wait for the folder to expand and lazy-load its children
    await waitFor(() => {
      expect(useWorkspaceStore.getState().explorerExpandedPaths).toContain('/workspace/src');
    });
  });

  it('ArrowLeft collapses an expanded folder', async () => {
    setActiveWorkspace({
      workspacePath: '/workspace',
      explorerExpandedPaths: ['/workspace/src'],
      explorerEntriesByPath: {
        '/workspace': [createEntry('src', '/workspace/src', true)],
        '/workspace/src': [createEntry('index.ts', '/workspace/src/index.ts', false)],
      },
    });
    // Use mockImplementation to preserve pre-populated entries.
    // When called for /workspace (on mount), return [] so root pre-populated entries are preserved.
    // When called for /workspace/src (on lazy-load), return [] so children pre-populated entries are preserved.
    installElectronApiMock({
      fileListDirectory: vi.fn().mockImplementation(async (request: { directoryPath: string }) => {
        if (request.directoryPath === '/workspace') {
          return { success: true, entries: [] };
        }
        if (request.directoryPath === '/workspace/src') {
          return { success: true, entries: [] };
        }
        return { success: true, entries: [] };
      }),
    });

    render(<FileExplorer />);

    // Wait for the tree to render with the src folder visible
    await screen.findByText('src');
    await screen.findByText('index.ts');

    const treeContainer = document.querySelector('.file-tree') as HTMLDivElement;
    treeContainer.focus();

    // Press ArrowLeft on the expanded folder — should collapse it
    fireEvent.keyDown(treeContainer, { key: 'ArrowLeft' });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().explorerExpandedPaths).not.toContain('/workspace/src');
    });
  });

  it('Enter opens a file in the editor', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('index.ts', '/workspace/index.ts', false)],
      }),
    });

    render(<FileExplorer />);

    await screen.findByText('index.ts');

    const treeContainer = document.querySelector('.file-tree') as HTMLDivElement;
    treeContainer.focus();

    // ArrowDown selects the file (it's the first/only item)
    fireEvent.keyDown(treeContainer, { key: 'ArrowDown' });

    // Enter opens the selected file
    fireEvent.keyDown(treeContainer, { key: 'Enter' });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().editorTabs).toHaveLength(1);
      expect(useWorkspaceStore.getState().editorTabs[0].filePath).toBe('/workspace/index.ts');
    });
  });

  it('Enter toggles folder expansion', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn()
        // First call: mount — return the src folder so tree renders
        .mockResolvedValueOnce({ success: true, entries: [createEntry('src', '/workspace/src', true)] })
        // Second call: expanding src — return empty (pre-populated children are preserved separately)
        .mockResolvedValueOnce({ success: true, entries: [] })
        // Third+ calls: collapse/re-expand
        .mockResolvedValue({ success: true, entries: [] }),
    });

    render(<FileExplorer />);

    // Wait for the src folder to appear in the tree
    await screen.findByText('src');

    const treeContainer = document.querySelector('.file-tree') as HTMLDivElement;
    treeContainer.focus();

    // Enter on collapsed folder — should expand
    fireEvent.keyDown(treeContainer, { key: 'Enter' });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().explorerExpandedPaths).toContain('/workspace/src');
    });

    // Enter again — should collapse
    fireEvent.keyDown(treeContainer, { key: 'Enter' });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().explorerExpandedPaths).not.toContain('/workspace/src');
    });
  });

  it('F2 triggers rename state on selected node', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('index.ts', '/workspace/index.ts', false)],
      }),
    });

    render(<FileExplorer />);

    await screen.findByText('index.ts');

    const treeContainer = document.querySelector('.file-tree') as HTMLDivElement;
    treeContainer.focus();

    // ArrowDown selects the file
    fireEvent.keyDown(treeContainer, { key: 'ArrowDown' });

    // F2 triggers rename
    fireEvent.keyDown(treeContainer, { key: 'F2' });

    await waitFor(() => {
      expect(document.querySelector('.tree-node-input')).toBeInTheDocument();
    });
  });
});


// =========================================================================
// Issue #3: Typing filter for the file explorer
// =========================================================================
describe('Issue #3: explorer filter input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  function setUpFilterFixture() {
    setActiveWorkspace({
      workspacePath: '/workspace',
      explorerExpandedPaths: ['/workspace/src'],
      explorerEntriesByPath: {
        '/workspace': [
          createEntry('src', '/workspace/src', true),
          createEntry('docs', '/workspace/docs', true),
          createEntry('README.md', '/workspace/README.md', false),
        ],
        '/workspace/src': [
          createEntry('index.ts', '/workspace/src/index.ts', false),
          createEntry('utils.ts', '/workspace/src/utils.ts', false),
        ],
        '/workspace/docs': [
          createEntry('guide.md', '/workspace/docs/guide.md', false),
        ],
      },
    });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    });
  }

  it('renders the filter input above the tree', () => {
    setUpFilterFixture();
    render(<FileExplorer />);

    expect(screen.getByLabelText('Filter files')).toBeInTheDocument();
  });

  it('hides non-matching entries when a query is typed', async () => {
    setUpFilterFixture();
    render(<FileExplorer />);

    await screen.findByText('README.md');
    expect(screen.getByText('utils.ts')).toBeInTheDocument();

    const filter = screen.getByLabelText('Filter files');
    await userEvent.type(filter, 'utils');

    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
    expect(screen.queryByText('guide.md')).not.toBeInTheDocument();
    expect(screen.queryByText('docs')).not.toBeInTheDocument();
    expect(screen.getByText('utils.ts')).toBeInTheDocument();
    // Ancestor of the match stays visible
    expect(screen.getByText('src')).toBeInTheDocument();
  });

  it('matches case-insensitively', async () => {
    setUpFilterFixture();
    render(<FileExplorer />);

    await screen.findByText('README.md');

    const filter = screen.getByLabelText('Filter files');
    await userEvent.type(filter, 'readme');

    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.queryByText('utils.ts')).not.toBeInTheDocument();
  });

  it('auto-expands a collapsed directory that contains a match', async () => {
    setActiveWorkspace({
      workspacePath: '/workspace',
      explorerExpandedPaths: [],
      explorerEntriesByPath: {
        '/workspace': [createEntry('src', '/workspace/src', true)],
        '/workspace/src': [createEntry('config.ts', '/workspace/src/config.ts', false)],
      },
    });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    });
    render(<FileExplorer />);

    await screen.findByText('src');
    expect(screen.queryByText('config.ts')).not.toBeInTheDocument();

    const filter = screen.getByLabelText('Filter files');
    await userEvent.type(filter, 'config');

    expect(screen.getByText('config.ts')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();

    // Filter-driven expansion should not mutate the persistent expanded set,
    // so clearing the filter restores the original collapsed view.
    expect(useWorkspaceStore.getState().explorerExpandedPaths).not.toContain('/workspace/src');
  });

  it('shows "No matches" when the filter excludes every entry', async () => {
    setUpFilterFixture();
    render(<FileExplorer />);

    await screen.findByText('README.md');

    const filter = screen.getByLabelText('Filter files');
    await userEvent.type(filter, 'nonexistent-xyz');

    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('clearing the filter restores the original tree', async () => {
    setUpFilterFixture();
    render(<FileExplorer />);

    await screen.findByText('README.md');

    const filter = screen.getByLabelText('Filter files') as HTMLInputElement;
    await userEvent.type(filter, 'utils');
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Clear filter'));

    expect(filter.value).toBe('');
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
  });

  it('pressing "/" with the tree focused moves focus to the filter input', async () => {
    setUpFilterFixture();
    render(<FileExplorer />);

    await screen.findByText('README.md');

    const treeContainer = document.querySelector('.file-tree') as HTMLDivElement;
    treeContainer.focus();
    fireEvent.keyDown(treeContainer, { key: '/' });

    const filter = screen.getByLabelText('Filter files');
    expect(filter).toHaveFocus();
  });

  it('Escape in the filter input clears a non-empty query', async () => {
    setUpFilterFixture();
    render(<FileExplorer />);

    await screen.findByText('README.md');
    const filter = screen.getByLabelText('Filter files') as HTMLInputElement;
    await userEvent.type(filter, 'utils');
    expect(filter.value).toBe('utils');

    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(filter.value).toBe('');
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('filter composes with the hidden-files toggle', async () => {
    setActiveWorkspace({
      workspacePath: '/workspace',
      showHiddenFiles: false,
      explorerEntriesByPath: {
        '/workspace': [
          createEntry('.env', '/workspace/.env', false),
          createEntry('env.config.ts', '/workspace/env.config.ts', false),
        ],
      },
    });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    });
    render(<FileExplorer />);

    await screen.findByText('env.config.ts');
    expect(screen.queryByText('.env')).not.toBeInTheDocument();

    const filter = screen.getByLabelText('Filter files');
    await userEvent.type(filter, 'env');

    // The dotfile must remain hidden even though it matches the query.
    expect(screen.queryByText('.env')).not.toBeInTheDocument();
    expect(screen.getByText('env.config.ts')).toBeInTheDocument();
  });
});
