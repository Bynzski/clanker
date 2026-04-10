// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FileExplorer from '../../../src/renderer/components/FileExplorer';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { FileExplorerEntry, FileListDirectoryRequest, FileListDirectoryResult } from '../../../src/shared/types/fileExplorer';

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

describe('FileExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
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
});
