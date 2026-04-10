// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../src/renderer/App';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
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

describe('App workspace open integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });
    installElectronApiMock({
      getLastWorkspace: vi.fn().mockResolvedValue('/workspace/'),
      getHarnessOptions: vi.fn().mockResolvedValue({ codex: true, '': true }),
      getHarnessModels: vi.fn().mockResolvedValue([]),
      spawnTerminal: vi.fn().mockResolvedValue({ id: 'terminal-1', pid: 1234 }),
      getTerminalBuffer: vi.fn().mockResolvedValue(''),
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    });
  });

  it('shows the main screen after selecting a workspace', async () => {
    render(<App />);

    expect(screen.getByText('Launch Workspace')).toBeInTheDocument();
    const pathInput = document.querySelector('.gate-input') as HTMLInputElement | null;
    expect(pathInput).toBeTruthy();

    await act(async () => {
      fireEvent.change(pathInput!, { target: { value: '/workspace/' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Launch Workspace'));
    });

    await waitFor(() => {
      expect(document.querySelector('.titlebar')).toBeTruthy();
      expect(document.querySelector('.header')).toBeTruthy();
      expect(document.querySelector('.main-content')).toBeTruthy();
    });
  });
});
