// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import Header from '../../../src/renderer/components/Header';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

// Mock GitButton to isolate Header tests
vi.mock('../../../src/renderer/components/GitButton', () => ({
  default: ({ workspacePath }: { workspacePath: string }) => (
    <div data-testid="git-button" data-path={workspacePath}>GitButton</div>
  ),
}));

describe('Header', () => {
  it('discovers history on SSH workspaces and ignores late responses from a previous workspace', async () => {
    // This setup runs after beforeEach, keeping the usual header fixture intact.
    installElectronApiMock();
    let finish!: (sessions: import('../../../src/shared/types/session').HarnessSession[]) => void;
    vi.mocked(window.electronAPI.discoverSessions).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'remote-a', environmentId: 'ssh-a' }), createWorkspaceFixture({ id: 'remote-b', environmentId: 'ssh-b' })], activeWorkspaceId: 'remote-a' });
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    expect(window.electronAPI.discoverSessions).toHaveBeenCalledWith('remote-a');
    act(() => { useWorkspaceStore.setState({ activeWorkspaceId: 'remote-b' }); });
    await act(async () => finish([{ id: 'old', harness: 'codex', title: 'Host A session', cwd: '/workspace', timestamp: 1 }]));
    expect(screen.queryByText('Host A session')).toBeNull();
    expect(screen.queryByText(/Remote history is read-only/)).toBeNull();
    vi.mocked(window.electronAPI.discoverSessions).mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    await waitFor(() => expect(window.electronAPI.discoverSessions).toHaveBeenCalledWith('remote-b'));
  });
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspacePath: '/workspace',
      activeWorkspaceId: 'ws-1',
      workspaces: [
        {
          id: 'ws-1',
          lifecycle: 'active',
          name: 'test',
          workspacePath: '/workspace',
          harness: 'codex',
          model: '',
          terminals: [{ id: 't1', pid: 1, workingDir: '/workspace' }],
          panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 } }],
          browserVisible: false,
          browserUrl: 'https://github.com',
          activeTerminalId: 't1',
          browserPane: null,
          editorPane: null,
          editorVisible: false,
          notesPane: null,
          notesVisible: false,
          editorTabs: [],
          activeEditorTabId: null,
          layoutRoot: null,
          explorerVisible: false,
          explorerSidebarWidth: 280,
          explorerExpandedPaths: [],
          explorerSelectedPath: null,
          explorerEntriesByPath: {},
          explorerLoadingPaths: [],
          explorerErrorsByPath: {},
    showHiddenFiles: true,
          gitChanges: [],
          gitCurrentBranch: null,
          gitIsRepo: false,
          gitIsDetached: false,
          runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
        },
      ],
      harness: 'codex',
      model: '',
      browserVisible: false,
      terminals: [{ id: 't1', pid: 1, workingDir: '/workspace' }],
      panes: [{ id: 'p1', terminalId: 't1', position: { x: 0, y: 0, w: 6, h: 6 } }],
      addTerminal: vi.fn(),
      closeWorkspace: vi.fn(),
      fitAllPanes: vi.fn(),
      setHarness: vi.fn(),
      toggleBrowser: vi.fn(),
      toggleNotesPane: vi.fn(),
    });

    window.electronAPI = {
      getHarnessOptions: vi.fn().mockResolvedValue({
        codex: true,
        claude: false,
        opencode: false,
        pi: false,
      }),
      getAiCommitSettings: vi.fn().mockResolvedValue({
        enabled: false,
        provider: 'codex',
        model: '',
      }),
      setAiCommitEnabled: vi.fn().mockResolvedValue(undefined),
      setAiCommitProvider: vi.fn().mockResolvedValue(undefined),
      setAiCommitModel: vi.fn().mockResolvedValue(undefined),
      getHarnessModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4', label: 'GPT-4' },
      ]),
      getHarnessDefaults: vi.fn().mockResolvedValue({
        codex: { model: '', favorites: [], flags: '' },
        opencode: { model: '', favorites: [], flags: '' },
        pi: { model: '', favorites: [], flags: '' },
        claude: { model: '', favorites: [], flags: '' },
      }),
      setHarnessDefaults: vi.fn().mockResolvedValue(undefined),
      spawnTerminal: vi.fn().mockResolvedValue({ id: 'new-t', pid: 42 }),
      killTerminal: vi.fn().mockResolvedValue({ success: true }),
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
    return render(<Header />);
  }

  // =========================================================================
  // Basic Rendering
  // =========================================================================
  describe('basic rendering', () => {
    it('does not render Open Workspace button', () => {
      renderHeader();
      expect(screen.queryByText('Open Workspace')).toBeNull();
    });

    it('does not render a separate New Terminal button', () => {
      renderHeader();
      expect(screen.queryByText('New Terminal')).toBeNull();
    });

    it('renders icon-only Fit All Panes button', () => {
      renderHeader();
      expect(screen.getByLabelText('Fit all panes')).toBeTruthy();
      expect(screen.queryByText('Fit All Panes')).toBeNull();
    });

    it('renders static browser toggle button', () => {
      renderHeader();
      expect(screen.getByText('Browser')).toBeTruthy();
    });

    it('renders static explorer toggle button', () => {
      renderHeader();
      expect(screen.getByText('Explorer')).toBeTruthy();
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

    it('renders header-right div', () => {
      renderHeader();
      expect(document.querySelector('.header-right')).toBeTruthy();
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
      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === 'ws-1' ? { ...workspace, workspacePath: '' } : workspace
        )),
      }));
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

    it('launches the clicked harness without changing the workspace selection', async () => {
      const setHarness = vi.mocked(useWorkspaceStore.getState().setHarness);
      renderHeader();
      await waitFor(() => {
        expect(screen.getByText('Codex')).toBeTruthy();
      });
      setHarness.mockClear();
      fireEvent.click(screen.getByText('Codex'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith('/workspace', 'codex', undefined);
      });
      expect(setHarness).not.toHaveBeenCalled();
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

    it('hides harness pills when visibility is disabled', async () => {
      (window.electronAPI.getHarnessOptions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        codex: true,
        claude: true,
        opencode: false,
        pi: false,
      });
      (window.electronAPI.getHarnessDefaults as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        codex: { model: '', favorites: [], flags: '', visible: false },
        claude: { model: '', favorites: [], flags: '', visible: true },
        opencode: { model: '', favorites: [], flags: '', visible: true },
        pi: { model: '', favorites: [], flags: '', visible: true },
      });

      renderHeader();

      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeTruthy();
      });
      expect(screen.queryByText('Codex')).toBeNull();
    });

    it('handles getHarnessOptions failure gracefully', async () => {
      (window.electronAPI.getHarnessOptions as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
      renderHeader();
      await waitFor(() => {
        expect(screen.getByText('Terminal')).toBeTruthy();
      });
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

    it('adds the spawned terminal to the store', async () => {
      const addTerminal = vi.mocked(useWorkspaceStore.getState().addTerminal);
      renderHeader();
      fireEvent.click(screen.getByText('Terminal'));
      await waitFor(() => {
        expect(addTerminal).toHaveBeenCalledWith(expect.objectContaining({
          id: 'new-t',
          pid: 42,
          workingDir: '/workspace',
          harnessId: null,
        }));
      });
    });

    it('calls fitAllPanes when Fit All Panes is clicked', () => {
      const fitAllPanes = useWorkspaceStore.getState().fitAllPanes as ReturnType<typeof vi.fn>;
      renderHeader();
      fireEvent.click(screen.getByLabelText('Fit all panes'));
      expect(fitAllPanes).toHaveBeenCalled();
    });

    it('calls toggleBrowser when Browser is clicked', () => {
      const toggleBrowser = useWorkspaceStore.getState().toggleBrowser as ReturnType<typeof vi.fn>;
      renderHeader();
      fireEvent.click(screen.getByText('Browser'));
      expect(toggleBrowser).toHaveBeenCalled();
    });

    it('calls toggleNotesPane when Notes is clicked', () => {
      const toggleNotesPane = useWorkspaceStore.getState().toggleNotesPane as ReturnType<typeof vi.fn>;
      renderHeader();
      fireEvent.click(screen.getByText('Notes'));
      expect(toggleNotesPane).toHaveBeenCalled();
    });

    it('marks browser button active when browser is visible', () => {
      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === 'ws-1' ? { ...workspace, browserVisible: true } : workspace
        )),
      }));
      renderHeader();
      expect(screen.getByText('Browser').closest('.header-btn')?.classList.contains('active')).toBe(true);
    });

    it('marks notes button active when notes are visible', () => {
      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === 'ws-1' ? { ...workspace, notesVisible: true } : workspace
        )),
      }));
      renderHeader();
      expect(screen.getByText('Notes').closest('.header-btn')?.classList.contains('active')).toBe(true);
    });

    it('handles spawnTerminal failure gracefully', async () => {
      (window.electronAPI.spawnTerminal as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Failed to spawn'));
      renderHeader();
      fireEvent.click(screen.getByText('Terminal'));
      await waitFor(() => {
        expect(screen.getByText('Terminal')).toBeTruthy();
      });
    });
  });

  // =========================================================================
  // Pane Locked State
  // =========================================================================

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
      expect(screen.getByText('AI commit messages')).toBeTruthy();
    });

    it('closes settings dropdown when clicked again', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      expect(screen.getByText('AI commit messages')).toBeTruthy();
      fireEvent.click(screen.getByTitle('Settings'));
      expect(screen.queryByText('AI commit messages')).toBeNull();
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

    it('places Appearance first and keeps Settings open while switching themes', async () => {
      const { useThemeStore } = await import('../../../src/renderer/theme/themeStore');
      useThemeStore.setState({ theme: 'dark' });
      renderHeader();
      fireEvent.click(screen.getByTitle('Settings'));
      const dropdown = document.querySelector('.settings-dropdown');
      expect(dropdown?.firstElementChild).toHaveAttribute('aria-label', 'Appearance');
      const theme = screen.getByRole('combobox', { name: 'Theme' });
      fireEvent.change(theme, { target: { value: 'light' } });
      expect(theme).toHaveValue('light');
      expect(document.querySelector('.settings-dropdown')).toBe(dropdown);
      expect(screen.getByText('AI commit messages')).toBeVisible();
      fireEvent.change(theme, { target: { value: 'dark' } });
      expect(theme).toHaveValue('dark');
      expect(document.querySelector('.settings-dropdown')).toBe(dropdown);
    });

    it('persists harness visibility changes from settings', async () => {
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));

      const checkbox = await screen.findByLabelText('Hide Codex');
      fireEvent.click(checkbox);

      await waitFor(() => {
        expect(window.electronAPI.setHarnessDefaults).toHaveBeenCalledWith(
          expect.objectContaining({
            codex: expect.objectContaining({ visible: false }),
          })
        );
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
      expect(selects.length).toBe(3); // Appearance, Provider and Model selects
      expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy();
    });

    it('handles getAiCommitSettings failure gracefully', async () => {
      (window.electronAPI.getAiCommitSettings as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Failed to load'));
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
    });

    it('handles setAiCommitEnabled failure gracefully', async () => {
      (window.electronAPI.setAiCommitEnabled as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Failed to save'));
      renderHeader();
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
      fireEvent.click(screen.getByTitle('Settings'));
      fireEvent.click(screen.getByRole('checkbox', { name: /AI commit messages/i }));
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
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
      await waitFor(() => {
        expect(screen.getByTitle('Settings')).toBeTruthy();
      });
    });
  });

  // =========================================================================
  // Direct Terminal Launch
  // =========================================================================
  describe('direct terminal launch', () => {
    it('uses the workspace model when launching its configured harness', async () => {
      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === 'ws-1' ? { ...workspace, model: 'gpt-4' } : workspace
        )),
      }));
      renderHeader();
      await waitFor(() => {
        expect(screen.getByText('Codex')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Codex'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith('/workspace', 'codex', 'gpt-4');
      });
    });

    it('launches the clicked harness instead of the configured workspace harness', async () => {
      (window.electronAPI.getHarnessOptions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        codex: true,
        claude: true,
        opencode: false,
        pi: false,
      });
      renderHeader();
      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Claude'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith('/workspace', 'claude', undefined);
      });
    });

    it('does not pass a harness or model for a plain terminal', async () => {
      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === 'ws-1' ? { ...workspace, model: 'gpt-4' } : workspace
        )),
      }));
      renderHeader();
      fireEvent.click(screen.getByText('Terminal'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith('/workspace', undefined, undefined);
      });
    });

    it('uses the root path when the workspace path is empty', async () => {
      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === 'ws-1' ? { ...workspace, workspacePath: '' } : workspace
        )),
      }));
      renderHeader();
      fireEvent.click(screen.getByText('Terminal'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith('/', undefined, undefined);
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
    it('still offers a plain terminal without an open workspace', () => {
      useWorkspaceStore.setState({
        workspaces: [],
        activeWorkspaceId: null,
        workspacePath: '',
      });
      renderHeader();
      expect(screen.getByText('Terminal')).toBeTruthy();
      expect(screen.queryByText('New Terminal')).toBeNull();
    });

    it('does not render GitButton without workspacePath', () => {
      useWorkspaceStore.setState({
        workspaces: [],
        activeWorkspaceId: null,
        workspacePath: '',
      });
      renderHeader();
      expect(screen.queryByTestId('git-button')).toBeNull();
    });

    it('can still add terminals without a workspace', async () => {
      useWorkspaceStore.setState({
        workspaces: [],
        activeWorkspaceId: null,
        workspacePath: '',
      });
      renderHeader();
      fireEvent.click(screen.getByText('Terminal'));
      await waitFor(() => {
        expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith('/', undefined, undefined);
      });
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
            lifecycle: 'parked',
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
            editorPane: null,
            editorVisible: false,
            editorTabs: [],
            activeEditorTabId: null,
            layoutRoot: null,
            explorerVisible: false,
            explorerSidebarWidth: 280,
            explorerExpandedPaths: [],
            explorerSelectedPath: null,
            explorerEntriesByPath: {},
            explorerLoadingPaths: [],
            explorerErrorsByPath: {},
    showHiddenFiles: true,
            gitChanges: [],
          gitCurrentBranch: null,
          gitIsRepo: false,
          gitIsDetached: false,
          runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
          },
          {
            id: 'ws-2',
            lifecycle: 'active',
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
            editorPane: null,
            editorVisible: false,
            editorTabs: [],
            activeEditorTabId: null,
            layoutRoot: null,
            explorerVisible: false,
            explorerSidebarWidth: 280,
            explorerExpandedPaths: [],
            explorerSelectedPath: null,
            explorerEntriesByPath: {},
            explorerLoadingPaths: [],
            explorerErrorsByPath: {},
    showHiddenFiles: true,
            gitChanges: [],
          gitCurrentBranch: null,
          gitIsRepo: false,
          gitIsDetached: false,
          runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
          },
        ],
        activeWorkspaceId: 'ws-2',
        workspacePath: '/workspace2',
      });
      renderHeader();
      expect(screen.getByText('Terminal')).toBeTruthy();
    });
  });
});
