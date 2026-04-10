// @vitest-environment jsdom

/**
 * Proof test for nested file path copy bug
 * 
 * This test reproduces the exact scenario: right-click on a nested file
 * and verify what entry.path is captured at each step of the callback chain.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useWorkspaceStore } from '../../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../../setup/fixtures';
import { installElectronApiMock } from '../../../setup/electron';
import FileExplorer from '../../../../src/renderer/components/FileExplorer';
import type { FileExplorerEntry, FileListDirectoryRequest, FileListDirectoryResult } from '../../../../src/shared/types/fileExplorer';

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

function createEntry(name: string, entryPath: string, isDirectory: boolean): FileExplorerEntry {
  return {
    name,
    path: entryPath,
    isDirectory,
    size: 1,
    modified: 1,
  };
}

describe('PROOF: Nested file path copy bug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('PROOF: traces entry.path through context menu chain for nested file', async () => {
    const workspacePath = '/workspace';
    
    // Create a nested structure:
    // /workspace/
    //   tests/
    //     clankermade/
    //       heynow.md
    
    const rootEntries = [
      createEntry('tests', '/workspace/tests', true),
      createEntry('playwright.config.ts', '/workspace/playwright.config.ts', false),
    ];
    
    const testsEntries = [
      createEntry('clankermade', '/workspace/tests/clankermade', true),
    ];
    
    const clankermadeEntries = [
      createEntry('heynow.md', '/workspace/tests/clankermade/heynow.md', false),
    ];
    
    const fileListDirectory = vi.fn(async (request: FileListDirectoryRequest): Promise<FileListDirectoryResult> => {
      console.log('[PROOF] fileListDirectory call:', request.directoryPath);
      
      if (request.directoryPath === '/workspace') {
        return { success: true, entries: rootEntries };
      }
      if (request.directoryPath === '/workspace/tests') {
        return { success: true, entries: testsEntries };
      }
      if (request.directoryPath === '/workspace/tests/clankermade') {
        return { success: true, entries: clankermadeEntries };
      }
      return { success: false, entries: [], errorCode: 'invalid-path' };
    });
    
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    
    setActiveWorkspace({ workspacePath });
    installElectronApiMock({
      fileListDirectory,
      writeClipboard,
    });
    
    render(<FileExplorer />);
    
    // Wait for root to load
    await waitFor(() => {
      expect(screen.getByText('tests')).toBeInTheDocument();
      expect(screen.getByText('playwright.config.ts')).toBeInTheDocument();
    });
    
    console.log('[PROOF] === Step 1: Root loaded ===');
    
    // Expand 'tests' folder
    const testsButton = screen.getByText('tests').closest('button');
    fireEvent.click(testsButton!);
    
    // Wait for tests contents to load
    await waitFor(() => {
      expect(screen.getByText('clankermade')).toBeInTheDocument();
    });
    
    console.log('[PROOF] === Step 2: tests expanded, clankermade visible ===');
    
    // Expand 'clankermade' folder
    const clankermadeButton = screen.getByText('clankermade').closest('button');
    fireEvent.click(clankermadeButton!);
    
    // Wait for clankermade contents to load
    await waitFor(() => {
      expect(screen.getByText('heynow.md')).toBeInTheDocument();
    });
    
    console.log('[PROOF] === Step 3: clankermade expanded, heynow.md visible ===');
    
    // Now right-click on heynow.md (the nested file)
    const heynowButton = screen.getByText('heynow.md').closest('button');
    console.log('[PROOF] === Step 4: About to right-click heynow.md ===');
    console.log('[PROOF] heynowButton element:', heynowButton?.tagName, heynowButton?.className);
    
    fireEvent.contextMenu(heynowButton!, { clientX: 100, clientY: 200 });
    
    // Wait for context menu to appear
    await waitFor(() => {
      expect(screen.getByText('Copy Path')).toBeInTheDocument();
    });
    
    console.log('[PROOF] === Step 5: Context menu open ===');
    
    // Click "Copy Path"
    fireEvent.click(screen.getByText('Copy Path'));
    
    // Wait for clipboard call
    await waitFor(() => {
      expect(writeClipboard).toHaveBeenCalled();
    });
    
    console.log('[PROOF] === Step 6: Copy Path clicked ===');
    
    // Capture what was written to clipboard
    const copiedPath = writeClipboard.mock.calls[0][0] as string;
    console.log('[PROOF] ===== FINAL RESULT =====');
    console.log('[PROOF] Copied path:', copiedPath);
    console.log('[PROOF] Expected path:', '/workspace/tests/clankermade/heynow.md');
    console.log('[PROOF] Is correct?', copiedPath === '/workspace/tests/clankermade/heynow.md');
    
    // THE BUG: This should be '/workspace/tests/clankermade/heynow.md' but it's '/workspace/tests'
    expect(copiedPath).toBe('/workspace/tests/clankermade/heynow.md');
  });

  it('PROOF: verifies root-level file copy works correctly', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    
    const workspacePath = '/workspace';
    
    const rootEntries = [
      createEntry('playwright.config.ts', '/workspace/playwright.config.ts', false),
    ];
    
    const fileListDirectory = vi.fn(async (): Promise<FileListDirectoryResult> => {
      return { success: true, entries: rootEntries };
    });
    
    setActiveWorkspace({ workspacePath });
    installElectronApiMock({
      fileListDirectory,
      writeClipboard,
    });
    
    render(<FileExplorer />);
    
    // Wait for file to appear
    await waitFor(() => {
      expect(screen.getByText('playwright.config.ts')).toBeInTheDocument();
    });
    
    // Right-click on root file
    const fileButton = screen.getByText('playwright.config.ts').closest('button');
    fireEvent.contextMenu(fileButton!, { clientX: 100, clientY: 100 });
    
    // Wait for context menu
    await waitFor(() => {
      expect(screen.getByText('Copy Path')).toBeInTheDocument();
    });
    
    // Click Copy Path
    fireEvent.click(screen.getByText('Copy Path'));
    
    // Verify
    await waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith('/workspace/playwright.config.ts');
    });
  });

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
});