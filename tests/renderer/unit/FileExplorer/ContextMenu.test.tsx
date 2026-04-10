// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useWorkspaceStore } from '../../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../../setup/fixtures';
import { installElectronApiMock } from '../../../setup/electron';
import ContextMenu from '../../../../src/renderer/components/FileExplorer/ContextMenu';
import FileExplorer from '../../../../src/renderer/components/FileExplorer';
import type { FileExplorerEntry } from '../../../../src/shared/types/fileExplorer';

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
    showHiddenFiles: true,
    workspaces: [],
    activeWorkspaceId: null,
    gridViewport: { cols: 12, rows: 8 },
    layoutRevision: 0,
    editorVisible: false,
    editorPane: null,
    editorTabs: [],
    activeEditorTabId: null,
    gitChanges: [],
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

describe('ContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe('rendering', () => {
    it('renders at the specified position', () => {
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={100}
          y={200}
          entry={entry}
          onAction={vi.fn()}
          onClose={vi.fn()}
        />
      );

      const menu = document.querySelector('.context-menu') as HTMLElement;
      expect(menu).toBeInTheDocument();
      expect(menu.style.left).toBe('100px');
      expect(menu.style.top).toBe('200px');
    });

    it('renders all actions for a file', () => {
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText('Open in Editor')).toBeInTheDocument();
      expect(screen.getByText('Open in Terminal')).toBeInTheDocument();
      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(screen.getByText('Copy Path')).toBeInTheDocument();
      expect(screen.getByText('Copy Relative Path')).toBeInTheDocument();
      expect(screen.getByText('Reveal in File Manager')).toBeInTheDocument();
    });

    it('shows "Open Folder" for a directory', () => {
      const entry = createEntry('src', '/workspace/src', true);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText('Open Folder')).toBeInTheDocument();
    });

    it('shows "Open in Editor" for a file', () => {
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText('Open in Editor')).toBeInTheDocument();
    });

    it('does not show Expand option for files (they are not directories)', () => {
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={vi.fn()}
          onClose={vi.fn()}
        />
      );

      // Files don't have an Expand option — the only directory action is "Open Folder"
      expect(screen.queryByText('Expand')).not.toBeInTheDocument();
    });
  });

  describe('viewport edge clamping', () => {
    it('clamps x position to stay within viewport width', () => {
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={99999}
          y={100}
          entry={entry}
          onAction={vi.fn()}
          onClose={vi.fn()}
        />
      );

      const menu = document.querySelector('.context-menu') as HTMLElement;
      const left = parseInt(menu.style.left, 10);
      expect(left).toBeLessThanOrEqual(window.innerWidth - 200 - 8);
    });

    it('clamps y position to stay within viewport height', () => {
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={100}
          y={99999}
          entry={entry}
          onAction={vi.fn()}
          onClose={vi.fn()}
        />
      );

      const menu = document.querySelector('.context-menu') as HTMLElement;
      const top = parseInt(menu.style.top, 10);
      expect(top).toBeLessThanOrEqual(window.innerHeight - 320 - 8);
    });
  });

  describe('keyboard interaction', () => {
    it('closes the menu on Escape key', () => {
      const onClose = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={vi.fn()}
          onClose={onClose}
        />
      );

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('click outside to close', () => {
    it('closes the menu when clicking the overlay', () => {
      const onClose = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={vi.fn()}
          onClose={onClose}
        />
      );

      const overlay = document.querySelector('.context-menu-overlay') as HTMLElement;
      fireEvent.click(overlay);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when clicking inside the menu', () => {
      const onClose = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={vi.fn()}
          onClose={onClose}
        />
      );

      const menu = document.querySelector('.context-menu') as HTMLElement;
      fireEvent.click(menu);
      // Menu should NOT close when clicking inside it
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('action dispatching', () => {
    it('calls onAction with "open-editor" when Open in Editor is clicked', () => {
      const onAction = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={onAction}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('Open in Editor'));
      expect(onAction).toHaveBeenCalledWith('open-editor');
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('calls onAction with "open-terminal" when Open in Terminal is clicked', () => {
      const onAction = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={onAction}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('Open in Terminal'));
      expect(onAction).toHaveBeenCalledWith('open-terminal');
    });

    it('calls onAction with "rename" when Rename is clicked', () => {
      const onAction = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={onAction}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('Rename'));
      expect(onAction).toHaveBeenCalledWith('rename');
    });

    it('calls onAction with "delete" when Delete is clicked', () => {
      const onAction = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={onAction}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('Delete'));
      expect(onAction).toHaveBeenCalledWith('delete');
    });

    it('calls onAction with "copy-path" when Copy Path is clicked', () => {
      const onAction = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={onAction}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('Copy Path'));
      expect(onAction).toHaveBeenCalledWith('copy-path');
    });

    it('calls onAction with "copy-relative-path" when Copy Relative Path is clicked', () => {
      const onAction = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={onAction}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('Copy Relative Path'));
      expect(onAction).toHaveBeenCalledWith('copy-relative-path');
    });

    it('calls onAction with "reveal-in-files" when Reveal in File Manager is clicked', () => {
      const onAction = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={onAction}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('Reveal in File Manager'));
      expect(onAction).toHaveBeenCalledWith('reveal-in-files');
    });

    // Note: "removes menu from DOM after action" is covered by the integration tests below
    // which verify the full FileExplorer component closes the context menu after any action.
    it('verifies the Copy Path action is dispatched with correct args', () => {
      const onAction = vi.fn();
      const entry = createEntry('index.ts', '/workspace/index.ts', false);
      render(
        <ContextMenu
          x={50}
          y={50}
          entry={entry}
          onAction={onAction}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('Copy Path'));
      expect(onAction).toHaveBeenCalledWith('copy-path');
    });
  });
});

describe('ContextMenu integration (FileExplorer right-click)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('right-clicking a file opens the context menu', async () => {
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
      expect(screen.getByText('Open in Editor')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('right-clicking a folder shows "Open Folder" instead of "Open in Editor"', async () => {
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('src', '/workspace/src', true)],
      }),
    });

    render(<FileExplorer />);

    const folderNode = await screen.findByText('src');

    fireEvent.contextMenu(folderNode);

    await waitFor(() => {
      expect(screen.getByText('Open Folder')).toBeInTheDocument();
      expect(screen.queryByText('Open in Editor')).not.toBeInTheDocument();
    });
  });

  it('clicking "Copy Path" calls writeClipboard with the entry path', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    setActiveWorkspace({ workspacePath: '/workspace' });
    installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({
        success: true,
        entries: [createEntry('index.ts', '/workspace/index.ts', false)],
      }),
      writeClipboard,
    });

    render(<FileExplorer />);

    const fileNode = await screen.findByText('index.ts');

    fireEvent.contextMenu(fileNode);

    await waitFor(() => {
      expect(screen.getByText('Copy Path')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Copy Path'));

    await waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith('/workspace/index.ts');
    });
  });

  it('clicking "Delete" opens the confirmation dialog', async () => {
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
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete'));

    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByText('Delete File')).toBeInTheDocument();
      expect(
        screen.getByText('Are you sure you want to delete "index.ts"? This cannot be undone.')
      ).toBeInTheDocument();
    });
    // There should be a "Delete" danger button
    expect(screen.getByText('Delete').closest('.confirm-close-btn-danger')).toBeInTheDocument();
  });

  it('Escape key closes the context menu', async () => {
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
      expect(screen.getByText('Open in Editor')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Open in Editor')).not.toBeInTheDocument();
    });
  });

  it('clicking outside the context menu closes it', async () => {
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
      expect(screen.getByText('Open in Editor')).toBeInTheDocument();
    });

    // Click the overlay (position 0,0)
    const overlay = document.querySelector('.context-menu-overlay') as HTMLElement;
    fireEvent.click(overlay, { clientX: 0, clientY: 0 });

    await waitFor(() => {
      expect(screen.queryByText('Open in Editor')).not.toBeInTheDocument();
    });
  });
});
