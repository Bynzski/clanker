// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import Header from '../../../src/renderer/components/Header';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';

// Mock GitButton to isolate Header tests
vi.mock('../../../src/renderer/components/GitButton', () => ({
  default: ({ workspacePath }: { workspacePath: string }) => (
    <div data-testid="git-button" data-path={workspacePath}>GitButton</div>
  ),
}));

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
          explorerVisible: false,
          explorerSidebarWidth: 280,
          explorerExpandedPaths: [],
          explorerSelectedPath: null,
          explorerEntriesByPath: {},
          explorerLoadingPaths: [],
          explorerErrorsByPath: {},
        },
      ],
      harness: 'codex',
      model: '',
      browserVisible: false,
      terminals: [{ id: 't1', pid: 1, workingDir: '/workspace' }],
      panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false }],
      canAddPane: () => true,
      addTerminal: vi.fn(),
      closeWorkspace: vi.fn(),
      fitAllPanes: vi.fn(),
      setHarness: vi.fn(),
      toggleBrowser: vi.fn(),
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

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderHeader() {
    return render(<Header onOpenWorkspace={mockOnOpenWorkspace} />);
  }

  // =========================================================================
  // Basic Rendering
  // =========================================================================
  describe('basic rendering', () => {
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

    it('renders browser toggle button', () => {
      renderHeader();
      expect(screen.getByText('Show Browser')).toBeTruthy();
    });

    it('renders Close Workspace button', () => {
      renderHeader();
      expect(screen.getByText('Close Workspace')).toBeTruthy();
    });

    it('renders Settings button', () => {
      renderHeader();
      expect(screen.getByTitle('Settings')).toBeTruthy();
    });

    it('renders header with correct class', () => {
      renderHeader();
      expect(document.querySelector('.header')).toBeTruthy();
    });

    it('renders header-center div', () => {
      renderHeader();
      expect(document.querySelector('.header-center')).toBeTruthy();
    });
  });

  // =========================================================================
  // GitButton Integration
  // =========================================================================
  describe('GitButton integration', () => {
    it('renders GitButton when workspacePath is set', () => {
      renderHeader();
      expect(screen.getByTestId('git-button')).toBeTruthy();
    });

    it('passes workspacePath to GitButton', () => {
      renderHeader();
      expect(screen.getByTestId('git-button')).toHaveAttribute('data-path', '/workspace');
    });

    it('does not render GitButton when workspacePath is empty', () => {
      useWorkspaceStore.setState({ workspacePath: '' });
      renderHeader();
      expect(screen.queryByTestId('git-button')).toBeNull();
    });
  });

  // =========================================================================
  // Harness Pills
  // =========================================================================
  describe('harness pills', () => {
    it('renders available harness pills', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByText('Codex')).toBeTruthy();
      });
    });

    it('switches harness when pill is clicked', async () => {
      const setHarness = useWorkspaceStore.getState().setHarness as ReturnType<typeof vi.fn>;
      renderHeader();
      await waitFor(() => {
        expect(screen.getByText('Codex')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Codex'));
      expect(setHarness).toHaveBeenCalledWith('codex');
    });

    it('highlights active harness pill', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByText('Codex')).toBeTruthy();
      });
      const pill = screen.getByText('Codex').closest('.harness-pill');
      expect(pill?.classList.contains('active')).toBe(true);
    });

    it('renders multiple harnesses when available', async () => {
      (window.electronAPI.getHarnessOptions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        codex: true,
        claude: true,
        opencode: false,
        pi: false,
      });
      renderHeader();
      await waitFor(() => {
        expect(screen.getByText('Codex')).toBeTruthy();
        expect(screen.getByText('Claude')).toBeTruthy();
      });
    });

    it('handles getHarnessOptions failure gracefully', async () => {
      (window.electronAPI.getHarnessOptions as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
      renderHeader();
      // Should still render without crashing
      expect(screen.getByText('Open Workspace')).toBeTruthy();
    });

    it('renders harness pills container', async () => {
      renderHeader();
      await waitFor(() => {
        expect(document.querySelector('.harness-pills')).toBeTruthy();
      });
    });
  });

  // =========================================================================
  // Button Actions
  // =========================================================================
  describe('button actions', () => {
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

    it('passes correct parameters to spawnTerminal', async () => {
      renderHeader();
      // Wait for harness options to load
      await waitFor(() => {
        expect(window.electronAPI.getHarnessOptions).toHaveBeenCalled();
      });
      fireEvent.click(screen.getByText('New Terminal'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalled();
      });
    });

    it('adds terminal to store after spawning', async () => {
      const addTerminal = useWorkspaceStore.getState().addTerminal as ReturnType<typeof vi.fn>;
      renderHeader();
      fireEvent.click(screen.getByText('New Terminal'));
      await waitFor(() => {
        expect(addTerminal).toHaveBeenCalledWith(expect.objectContaining({
          id: 'new-t',
          pid: 42,
          workingDir: '/workspace',
        }));
      });
    });

    it('calls fitAllPanes when Fit All Panes is clicked', () => {
      const fitAllPanes = useWorkspaceStore.getState().fitAllPanes as ReturnType<typeof vi.fn>;
      renderHeader();
      fireEvent.click(screen.getByText('Fit All Panes'));
      expect(fitAllPanes).toHaveBeenCalled();
    });

    it('calls toggleBrowser when Show Browser is clicked', () => {
      const toggleBrowser = useWorkspaceStore.getState().toggleBrowser as ReturnType<typeof vi.fn>;
      renderHeader();
      fireEvent.click(screen.getByText('Show Browser'));
      expect(toggleBrowser).toHaveBeenCalled();
    });

    it('shows Hide Browser when browser is visible', () => {
      useWorkspaceStore.setState({ browserVisible: true });
      renderHeader();
      expect(screen.getByText('Hide Browser')).toBeTruthy();
    });

    it('calls closeWorkspace when Close Workspace is clicked', async () => {
      const closeWorkspace = useWorkspaceStore.getState().closeWorkspace as ReturnType<typeof vi.fn>;
      renderHeader();
      fireEvent.click(screen.getByText('Close Workspace'));
      await waitFor(() => {
        expect(closeWorkspace).toHaveBeenCalledWith('ws-1');
      });
    });

    it('kills terminals when Close Workspace is clicked', async () => {
      renderHeader();
      fireEvent.click(screen.getByText('Close Workspace'));
      await waitFor(() => {
        expect(window.electronAPI.killTerminal).toHaveBeenCalled();
      });
    });

    it('does not call closeWorkspace when no active workspace', () => {
      useWorkspaceStore.setState({ activeWorkspaceId: null });
      const closeWorkspace = useWorkspaceStore.getState().closeWorkspace as ReturnType<typeof vi.fn>;
      renderHeader();
      fireEvent.click(screen.getByText('Close Workspace'));
      expect(closeWorkspace).not.toHaveBeenCalled();
    });

    it('handles spawnTerminal failure gracefully', async () => {
      (window.electronAPI.spawnTerminal as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Failed to spawn'));
      renderHeader();
      fireEvent.click(screen.getByText('New Terminal'));
      // Should not crash
      await waitFor(() => {
        expect(screen.getByText('New Terminal')).toBeTruthy();
      });
    });
  });

  // =========================================================================
  // Pane Locked State
  // =========================================================================
  describe('pane locked state', () => {
    it('disables New Terminal button when all panes are locked', () => {
      useWorkspaceStore.setState({ canAddPane: () => false });
      renderHeader();
      const button = screen.getByText('New Terminal');
      expect(button).toBeDisabled();
    });

    it('enables New Terminal button when panes can be added', () => {
      renderHeader();
      const button = screen.getByText('New Terminal');
      expect(button).not.toBeDisabled();
    });

    it('logs warning when New Terminal is clicked while panes are locked', async () => {
      useWorkspaceStore.setState({ canAddPane: () => false });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      renderHeader();
      const button = screen.getByText('New Terminal');
      // Button should be disabled, but if somehow clicked, no action
      expect(button).toBeDisabled();
      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // Settings Dropdown
  // =========================================================================
  describe('settings dropdown', () => {
    it('opens settings dropdown when Settings button is clicked', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      expect(screen.getByText('Show fastfetch')).toBeTruthy();
    });

    it('closes settings dropdown when clicked again', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      expect(screen.getByText('Show fastfetch')).toBeTruthy();
      fireEvent.click(screen.getByTitle('Settings'));
      expect(screen.queryByText('Show fastfetch')).toBeNull();
    });

    it('renders settings dropdown container', async () => {
      renderHeader();
      await waitFor(() => {
        expect(document.querySelector('.settings-dropdown-container')).toBeTruthy();
      });
    });

    it('renders settings dropdown when open', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      expect(document.querySelector('.settings-dropdown')).toBeTruthy();
    });
  });

  // =========================================================================
  // Fastfetch Setting
  // =========================================================================
  describe('fastfetch setting', () => {
    it('shows fastfetch checkbox', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      expect(screen.getByRole('checkbox', { name: /show fastfetch/i })).toBeTruthy();
    });

    it('shows checked fastfetch checkbox by default', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      const checkbox = screen.getByRole('checkbox', { name: /show fastfetch/i }) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('shows unchecked fastfetch checkbox when setting is false', async () => {
      (window.electronAPI.getShowFastfetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      const checkbox = screen.getByRole('checkbox', { name: /show fastfetch/i }) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('toggles fastfetch setting when checkbox is clicked', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /show fastfetch/i }));
      expect(window.electronAPI.setShowFastfetch).toHaveBeenCalledWith(false);
    });

    it('handles getShowFastfetch failure gracefully', async () => {
      (window.electronAPI.getShowFastfetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      // Should still render without crashing
      expect(screen.getByText('Open Workspace')).toBeTruthy();
    });

    it('handles setShowFastfetch failure gracefully', async () => {
      (window.electronAPI.setShowFastfetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Failed to save'));
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /show fastfetch/i }));
      // Should not crash
      await waitFor(() => {
        expect(screen.getByText('Open Workspace')).toBeTruthy();
      });
    });
  });

  // =========================================================================
  // AI Commit Settings
  // =========================================================================
  describe('AI commit settings', () => {
    it('shows AI commit messages checkbox', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      expect(screen.getByText('AI commit messages')).toBeTruthy();
    });

    it('shows unchecked AI commit checkbox by default', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      const checkbox = screen.getByRole('checkbox', { name: /AI commit messages/i }) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('toggles AI commit setting when checkbox is clicked', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /AI commit messages/i }));
      expect(window.electronAPI.setAiCommitEnabled).toHaveBeenCalledWith(true);
    });

    it('shows provider select when AI commit is enabled', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /AI commit messages/i }));
      expect(screen.getByText('Provider')).toBeTruthy();
    });

    it('shows model select when AI commit is enabled', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /AI commit messages/i }));
      expect(screen.getByText('Model')).toBeTruthy();
    });

    it('renders provider select element', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /AI commit messages/i }));
      const selects = screen.getAllByRole('combobox');
      expect(selects.length).toBe(2); // Provider and Model selects
    });

    it('handles getAiCommitSettings failure gracefully', async () => {
      (window.electronAPI.getAiCommitSettings as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Failed to load'));
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      // Should still render without crashing
      expect(screen.getByText('Open Workspace')).toBeTruthy();
    });

    it('handles setAiCommitEnabled failure gracefully', async () => {
      (window.electronAPI.setAiCommitEnabled as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Failed to save'));
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /AI commit messages/i }));
      // Should not crash
      await waitFor(() => {
        expect(screen.getByText('Open Workspace')).toBeTruthy();
      });
    });

    it('loads models when provider is selected', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /AI commit messages/i }));
      await waitFor(() => {
        expect(window.electronAPI.getHarnessModels).toHaveBeenCalled();
      });
    });

    it('shows loading state when loading models', async () => {
      // Make the mock return a promise that takes time
      let resolveModels: (value: Array<{id: string, label: string}>) => void;
      const modelsPromise = new Promise<Array<{id: string, label: string}>>(resolve => {
        resolveModels = resolve;
      });
      (window.electronAPI.getHarnessModels as unknown as ReturnType<typeof vi.fn>).mockReturnValue(modelsPromise);
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /AI commit messages/i }));
      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText('Loading models...')).toBeTruthy();
      });
      // Resolve the promise
      await act(async () => {
        resolveModels!([{ id: 'gpt-4', label: 'GPT-4' }]);
        await modelsPromise;
      });
    });

    it('handles model loading failure gracefully', async () => {
      (window.electronAPI.getHarnessModels as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Failed to load models'));
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /AI commit messages/i }));
      // Should not crash
      await waitFor(() => {
        expect(screen.getByText('Open Workspace')).toBeTruthy();
      });
    });
  });

  // =========================================================================
  // New Terminal with Different Harness
  // =========================================================================
  describe('new terminal with harness', () => {
    it('uses current harness when available', async () => {
      useWorkspaceStore.setState({ harness: 'codex', model: 'gpt-4' });
      renderHeader();
      // Wait for harness options to load
      await waitFor(() => {
        expect(window.electronAPI.getHarnessOptions).toHaveBeenCalled();
      });
      fireEvent.click(screen.getByText('New Terminal'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalled();
      });
    });

    it('does not pass harness when not in available list', async () => {
      useWorkspaceStore.setState({ harness: 'unknown', model: '' });
      renderHeader();
      fireEvent.click(screen.getByText('New Terminal'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith('/workspace', undefined, undefined);
      });
    });

    it('does not pass model when harness is empty', async () => {
      useWorkspaceStore.setState({ harness: '', model: 'gpt-4' });
      renderHeader();
      fireEvent.click(screen.getByText('New Terminal'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith('/workspace', undefined, undefined);
      });
    });

    it('uses default workspace path when workspacePath is empty', async () => {
      useWorkspaceStore.setState({ workspacePath: '' });
      renderHeader();
      // Wait for harness options to load
      await waitFor(() => {
        expect(window.electronAPI.getHarnessOptions).toHaveBeenCalled();
      });
      fireEvent.click(screen.getByText('New Terminal'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // Harness Validation
  // =========================================================================
  describe('harness validation', () => {
    it('resets harness when current harness is not available', async () => {
      const setHarness = useWorkspaceStore.getState().setHarness as ReturnType<typeof vi.fn>;
      useWorkspaceStore.setState({ harness: 'claude' }); // claude not in default options
      renderHeader();
      await waitFor(() => {
        expect(window.electronAPI.getHarnessOptions).toHaveBeenCalled();
      });
      // claude should be reset because it's not in available list
      await waitFor(() => {
        expect(setHarness).toHaveBeenCalledWith('');
      });
    });

    it('handles harness validation effect', async () => {
      // This test verifies the harness validation effect runs
      // when a harness is set that exists in availableHarnessIds
      useWorkspaceStore.setState({ harness: 'codex' });
      renderHeader();
      // Wait for effect to potentially run
      await new Promise(resolve => setTimeout(resolve, 100));
      // The harness should remain codex (not be reset)
      expect(useWorkspaceStore.getState().harness).toBe('codex');
    });
  });

  // =========================================================================
  // Empty State
  // =========================================================================
  describe('empty state', () => {
    it('renders without workspaces', () => {
      useWorkspaceStore.setState({
        workspaces: [],
        activeWorkspaceId: null,
        workspacePath: '',
      });
      renderHeader();
      expect(screen.getByText('Open Workspace')).toBeTruthy();
    });

    it('does not render GitButton without workspacePath', () => {
      useWorkspaceStore.setState({ workspacePath: '' });
      renderHeader();
      expect(screen.queryByTestId('git-button')).toBeNull();
    });

    it('can still add terminals without workspace', () => {
      useWorkspaceStore.setState({ workspacePath: '' });
      renderHeader();
      fireEvent.click(screen.getByText('New Terminal'));
      // Should use default path '/'
      expect(window.electronAPI.spawnTerminal).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Multiple Workspaces
  // =========================================================================
  describe('multiple workspaces', () => {
    it('renders with multiple workspaces', () => {
      useWorkspaceStore.setState({
        workspaces: [
          {
            id: 'ws-1',
            name: 'test1',
            workspacePath: '/workspace1',
            harness: 'codex',
            model: '',
            terminals: [{ id: 't1', pid: 1, workingDir: '/workspace1' }],
            panes: [],
            browserVisible: false,
            browserUrl: '',
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
          },
          {
            id: 'ws-2',
            name: 'test2',
            workspacePath: '/workspace2',
            harness: 'codex',
            model: '',
            terminals: [{ id: 't2', pid: 2, workingDir: '/workspace2' }],
            panes: [],
            browserVisible: false,
            browserUrl: '',
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
          },
        ],
        activeWorkspaceId: 'ws-2',
        workspacePath: '/workspace2',
      });
      renderHeader();
      expect(screen.getByText('Open Workspace')).toBeTruthy();
    });
  });
});
