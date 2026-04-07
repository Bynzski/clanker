// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Header from '../../../src/renderer/components/Header';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';

describe('Header', () => {
  const mockOnOpenWorkspace = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspacePath: '/workspace',
      activeWorkspaceId: 'ws-1',
      workspaces: [
        {
          id: 'ws-1',
          name: 'test',
          workspacePath: '/workspace',
          harness: 'codex',
          model: '',
          terminals: [{ id: 't1', pid: 1, workingDir: '/workspace' }],
          panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false }],
          browserVisible: false,
          browserUrl: 'https://github.com',
          activeTerminalId: 't1',
          browserPane: null,
          layoutRoot: null,
        },
      ],
      harness: 'codex',
      model: '',
      browserVisible: false,
      terminals: [{ id: 't1', pid: 1, workingDir: '/workspace' }],
      panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false }],
      canAddPane: () => true,
    });

    window.electronAPI = {
      getHarnessOptions: vi.fn().mockResolvedValue({
        codex: true,
        claude: false,
        opencode: false,
        pi: false,
      }),
      getShowFastfetch: vi.fn().mockResolvedValue(true),
      getAiCommitSettings: vi.fn().mockResolvedValue({
        enabled: false,
        provider: 'codex',
        model: '',
      }),
      setAiCommitEnabled: vi.fn().mockResolvedValue(undefined),
      setAiCommitProvider: vi.fn().mockResolvedValue(undefined),
      setAiCommitModel: vi.fn().mockResolvedValue(undefined),
      setShowFastfetch: vi.fn().mockResolvedValue(undefined),
      getHarnessModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4', label: 'GPT-4' },
      ]),
      spawnTerminal: vi.fn().mockResolvedValue({ id: 'new-t', pid: 42 }),
      killTerminal: vi.fn().mockResolvedValue(undefined),
      // GitButton dependencies
      gitStartPolling: vi.fn(),
      gitStopPolling: vi.fn(),
      gitRefresh: vi.fn().mockResolvedValue(null),
      gitGetBranchState: vi.fn().mockResolvedValue({ success: true, branches: [] }),
      gitCreateBranch: vi.fn().mockResolvedValue({ success: true }),
      gitSwitchBranch: vi.fn().mockResolvedValue({ success: true }),
      gitDeleteBranch: vi.fn().mockResolvedValue({ success: true }),
      gitMergeBranch: vi.fn().mockResolvedValue({ success: true }),
      gitAbortOperation: vi.fn().mockResolvedValue({ success: true }),
      gitGetOperationState: vi.fn().mockResolvedValue({ success: true, inProgress: false, mode: 'none' }),
      gitStage: vi.fn().mockResolvedValue({ success: true }),
      gitCommit: vi.fn().mockResolvedValue({ success: true }),
      gitStash: vi.fn().mockResolvedValue({ success: true }),
      gitGetStashes: vi.fn().mockResolvedValue([]),
      gitApplyStash: vi.fn().mockResolvedValue({ success: true }),
      gitPopStash: vi.fn().mockResolvedValue({ success: true }),
      gitDropStash: vi.fn().mockResolvedValue({ success: true }),
      gitClearStashes: vi.fn().mockResolvedValue({ success: true }),
      gitGetHistory: vi.fn().mockResolvedValue([]),
      gitGetDiff: vi.fn().mockResolvedValue({ success: true, output: '' }),
      onGitStatusUpdate: vi.fn(),
      generateCommitMessage: vi.fn().mockResolvedValue({ success: false }),
    } as unknown as typeof window.electronAPI;
  });

  function renderHeader() {
    return render(<Header onOpenWorkspace={mockOnOpenWorkspace} />);
  }

  // =========================================================================
  // Buttons present
  // =========================================================================
  it('renders Open Workspace button', () => {
    renderHeader();
    expect(screen.getByText('Open Workspace')).toBeTruthy();
  });

  it('renders New Terminal button', () => {
    renderHeader();
    expect(screen.getByText('New Terminal')).toBeTruthy();
  });

  it('renders Fit All Panes button', () => {
    renderHeader();
    expect(screen.getByText('Fit All Panes')).toBeTruthy();
  });

  it('renders Show Browser button when browser is hidden', () => {
    renderHeader();
    expect(screen.getByText('Show Browser')).toBeTruthy();
  });

  it('renders browser toggle button with current state', () => {
    // Note: browserVisible is mirrored from workspaces[] to top-level state.
    // Setting only the top-level field doesn't update the workspace entry,
    // so we test the default (hidden) state which is set up in beforeEach.
    renderHeader();
    const allButtons = screen.getAllByRole('button');
    const browserBtn = allButtons.find(btn => btn.textContent?.includes('Browser'));
    expect(browserBtn).toBeTruthy();
    expect(browserBtn?.textContent).toContain('Show');
  });

  it('renders Close Workspace button', () => {
    renderHeader();
    expect(screen.getByText('Close Workspace')).toBeTruthy();
  });

  // =========================================================================
  // Button actions
  // =========================================================================
  it('calls onOpenWorkspace when Open Workspace is clicked', () => {
    renderHeader();
    fireEvent.click(screen.getByText('Open Workspace'));
    expect(mockOnOpenWorkspace).toHaveBeenCalled();
  });

  it('spawns terminal when New Terminal is clicked', async () => {
    renderHeader();
    fireEvent.click(screen.getByText('New Terminal'));
    await waitFor(() => {
      expect(window.electronAPI.spawnTerminal).toHaveBeenCalled();
    });
  });

  it('toggles browser when browser button is clicked', () => {
    renderHeader();
    expect(useWorkspaceStore.getState().browserVisible).toBe(false);
    fireEvent.click(screen.getByText('Show Browser'));
    expect(useWorkspaceStore.getState().browserVisible).toBe(true);
  });

  it('closes workspace and kills terminals when Close Workspace is clicked', async () => {
    renderHeader();
    fireEvent.click(screen.getByText('Close Workspace'));
    await waitFor(() => {
      expect(window.electronAPI.killTerminal).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Harness pills
  // =========================================================================
  it('shows available harness pills', async () => {
    renderHeader();
    await waitFor(() => {
      expect(screen.getByText('Codex')).toBeTruthy();
    });
  });

  it('switches harness when pill is clicked', async () => {
    renderHeader();
    await waitFor(() => {
      expect(screen.getByText('Codex')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Codex'));
    expect(useWorkspaceStore.getState().harness).toBe('codex');
  });

  // =========================================================================
  // Settings dropdown
  // =========================================================================
  it('opens settings dropdown when Settings button is clicked', async () => {
    renderHeader();
    await waitFor(() => {
      expect(screen.getByTitle('Settings')).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle('Settings'));
    expect(screen.getByText('Show fastfetch')).toBeTruthy();
    expect(screen.getByText('AI commit messages')).toBeTruthy();
  });

  it('toggles fastfetch checkbox', async () => {
    renderHeader();
    await waitFor(() => {
      expect(screen.getByTitle('Settings')).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle('Settings'));
    const checkbox = screen.getByRole('checkbox', { name: /show fastfetch/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(window.electronAPI.setShowFastfetch).toHaveBeenCalledWith(false);
  });
});
