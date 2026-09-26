// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkspaceGateContent, { TERMINAL_PRESETS } from '../../../src/renderer/components/WorkspaceGateContent';

// Platform-neutral path constants for test fixtures
const TEST_HOME_USER = path.join(path.sep === '\\' ? 'C:\\Users\\user' : '/home', 'user');
const TEST_PROJECTS = path.join(TEST_HOME_USER, 'projects');
const TEST_PROJECT = path.join(TEST_HOME_USER, 'project');

describe('WorkspaceGateContent', () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock localStorage for jsdom
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
      clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
    });
    window.electronAPI = {
      getLastWorkspace: vi.fn().mockResolvedValue(TEST_HOME_USER + path.sep),
      getBaseDirectory: vi.fn().mockResolvedValue(TEST_PROJECTS + path.sep),
      openBaseDirectoryDialog: vi.fn().mockResolvedValue(null),
      getHarnessOptions: vi.fn().mockResolvedValue({
        codex: true,
        claude: false,
        opencode: false,
        pi: false,
      }),
      getHarnessModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4', label: 'GPT-4' },
        { id: 'gpt-3.5', label: 'GPT-3.5' },
      ]),
      getHarnessDefaults: vi.fn().mockResolvedValue({
        codex: { model: '', favorites: [], flags: '', visible: true },
        claude: { model: '', favorites: [], flags: '', visible: true },
        opencode: { model: '', favorites: [], flags: '', visible: true },
        pi: { model: '', favorites: [], flags: '', visible: true },
      }),
      openDirectoryDialog: vi.fn().mockResolvedValue(null),
      readDirectory: vi.fn().mockResolvedValue([]),
    } as unknown as typeof window.electronAPI;
  });

  function renderGate(overrides: { initialPath?: string } = {}) {
    return render(<WorkspaceGateContent onSubmit={mockOnSubmit} {...overrides} />);
  }

  // =========================================================================
  // Rendering
  // =========================================================================
  it('renders the title and subtitle', () => {
    renderGate();
    expect(screen.getByText('Clanker Grid')).toBeTruthy();
    expect(screen.getByText('Developer Workspace Launcher')).toBeTruthy();
  });

  it('renders the Launch Workspace button', () => {
    renderGate();
    expect(screen.getByText('Launch Workspace')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Worktree options' })).toBeTruthy();
  });

  it('opens the worktree view and returns to the workspace launcher', () => {
    renderGate({ initialPath: '/repo/' });
    fireEvent.click(screen.getByRole('button', { name: 'Worktree options' }));
    expect(screen.getByText('Task worktree')).toBeTruthy();
    expect(screen.queryByText('Launch Workspace')).toBeNull();
    expect((screen.getByLabelText('Repository') as HTMLInputElement).value).toBe('/repo/');
    fireEvent.click(screen.getByText('Back to workspace'));
    expect(screen.getByText('Launch Workspace')).toBeTruthy();
    expect((screen.getByPlaceholderText('project name') as HTMLInputElement).value).toBe('/repo/');
  });

  it('creates a task worktree before opening its checkout', async () => {
    window.electronAPI.gitGetBranchState = vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', branches: [{ name: 'main', isCurrent: true }] });
    window.electronAPI.gitListWorktrees = vi.fn().mockResolvedValue({ success: true, worktrees: [] });
    window.electronAPI.gitCreateWorktree = vi.fn().mockResolvedValue({ success: true, worktree: { path: '/repo-worktrees/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false } });
    renderGate({ initialPath: '/repo/' });
    fireEvent.click(screen.getByRole('button', { name: 'Worktree options' }));
    fireEvent.click(screen.getByText('Load repository'));
    await screen.findByText('Task branch');
    fireEvent.change(screen.getByLabelText('Task branch'), { target: { value: 'task' } });
    fireEvent.click(screen.getByText('Create and open worktree'));
    await waitFor(() => expect(window.electronAPI.gitCreateWorktree).toHaveBeenCalledWith('/repo/', 'main', 'task'));
    expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: '/repo-worktrees/task' }));
  });

  it('opens an existing worktree and requires inspection before removal', async () => {
    const worktree = { path: '/repo-worktrees/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false };
    window.electronAPI.gitGetBranchState = vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', branches: [] });
    window.electronAPI.gitListWorktrees = vi.fn().mockResolvedValue({ success: true, worktrees: [worktree] });
    window.electronAPI.gitInspectWorktree = vi.fn().mockResolvedValue({ success: true, worktree, hasChanges: false });
    window.electronAPI.gitRemoveWorktree = vi.fn().mockResolvedValue({ success: true });
    renderGate({ initialPath: '/repo/' });
    fireEvent.click(screen.getByRole('button', { name: 'Worktree options' }));
    fireEvent.click(screen.getByText('Load repository'));
    await screen.findByText(/task · \/repo-worktrees\/task/);
    fireEvent.click(screen.getByText('Open'));
    expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: worktree.path }));
    fireEvent.click(screen.getByText('Remove…'));
    await screen.findByText(/Remove checkout at/);
    expect(window.electronAPI.gitRemoveWorktree).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Remove this worktree'));
    await waitFor(() => expect(window.electronAPI.gitRemoveWorktree).toHaveBeenCalledWith('/repo/', worktree.path, 'task', []));
  });

  it('does not open a prunable worktree with a missing checkout', async () => {
    const worktree = { path: '/repo-worktrees/missing', branch: 'missing', isMain: false, isLocked: false, isPrunable: true };
    window.electronAPI.gitGetBranchState = vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', branches: [] });
    window.electronAPI.gitListWorktrees = vi.fn().mockResolvedValue({ success: true, worktrees: [worktree] });
    renderGate({ initialPath: '/repo/' });
    fireEvent.click(screen.getByRole('button', { name: 'Worktree options' }));
    fireEvent.click(screen.getByText('Load repository'));
    await screen.findByText(/missing · \/repo-worktrees\/missing/);
    const open = screen.getByRole('button', { name: 'Open' });
    expect(open.hasAttribute('disabled')).toBe(true);
    fireEvent.click(open);
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('renders terminal presets', () => {
    renderGate();
    for (const preset of TERMINAL_PRESETS) {
      expect(screen.getByText(new RegExp(`${preset.count} terminal`))).toBeTruthy();
    }
  });

  it('uses initialPath when provided', () => {
    renderGate({ initialPath: TEST_PROJECT + path.sep });
    const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
    expect(input.value).toBe(TEST_PROJECT + path.sep);
  });

  // =========================================================================
  // Terminal preset selection
  // =========================================================================
  it('selects terminal preset on click', () => {
    renderGate({ initialPath: '/workspace/' });
    const preset1 = screen.getByText('1 terminal');
    fireEvent.click(preset1);
    // The preset should now be selected (visual confirmation via class)
    expect(preset1.closest('.grid-option')?.classList.contains('selected')).toBe(true);
  });

  // =========================================================================
  // Harness selection
  // =========================================================================
  it('shows available harnesses from electron API', async () => {
    renderGate();
    await waitFor(() => {
      // Only codex is enabled in our mock, plus the terminal-only option
      expect(screen.getByText('Codex')).toBeTruthy();
    });
  });

  it('preserves the default harness while options are loading', async () => {
    let resolveOptions: (value: Awaited<ReturnType<typeof window.electronAPI.getHarnessOptions>>) => void;
    const optionsPromise = new Promise<Awaited<ReturnType<typeof window.electronAPI.getHarnessOptions>>>((resolve) => {
      resolveOptions = resolve;
    });
    vi.mocked(window.electronAPI.getHarnessOptions).mockReturnValue(optionsPromise);

    renderGate({ initialPath: '/workspace/' });

    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ harness: 'codex' })
    );
    mockOnSubmit.mockClear();

    resolveOptions!({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'codex' },
    });

    await waitFor(() => {
      expect(screen.getByText('Codex')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ harness: 'codex' })
    );
  });

  it('hides harnesses whose visibility is disabled', async () => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'codex' },
      claude: { name: 'Claude', command: 'claude', args: [], icon: 'claude' },
    });
    vi.mocked(window.electronAPI.getHarnessDefaults).mockResolvedValue({
      codex: { model: '', favorites: [], flags: '', visible: false },
      claude: { model: '', favorites: [], flags: '', visible: true },
      opencode: { model: '', favorites: [], flags: '', visible: true },
      pi: { model: '', favorites: [], flags: '', visible: true },
    });

    renderGate();

    await waitFor(() => {
      expect(screen.getByText('Claude')).toBeTruthy();
      expect(screen.queryByText('Codex')).toBeNull();
    });
    expect(screen.getByText('Terminal')).toBeTruthy();
  });

  it('changes harness on click', async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByText('Codex')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Codex'));
    // Should load models for codex
    await waitFor(() => {
      expect(window.electronAPI.getHarnessModels).toHaveBeenCalledWith('codex');
    });
  });

  // =========================================================================
  // Form submission
  // =========================================================================
  it('calls onSubmit with correct data', async () => {
    renderGate({ initialPath: '/workspace/' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
      expect(input.value).toBe('/workspace/');
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/workspace/',
        terminalCount: expect.any(Number),
        harness: expect.any(String),
      })
    );
  });

  it('appends trailing slash to path on submit', async () => {
    renderGate({ initialPath: '/workspace' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
      expect(input.value).toBe('/workspace');
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/' })
    );
  });

  it('accepts UNC-style absolute paths on submit', async () => {
    renderGate({ initialPath: '//server/share/repo' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
      expect(input.value).toBe('//server/share/repo');
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ path: '//server/share/repo/' })
    );
  });

  it('does not submit when path is empty', () => {
    renderGate({ initialPath: '' });
    // Override input to be empty
    const input = screen.getByPlaceholderText('project name');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('resolves relative input against the base directory on submit', async () => {
    renderGate({ initialPath: 'my-project' });
    // Wait for base to load before submitting
    await waitFor(() => {
      expect(window.electronAPI.getBaseDirectory).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ path: TEST_PROJECTS.replace(/\\/g, '/') + '/my-project/' })
      );
    });
  });

  // =========================================================================
  // Directory picker
  // =========================================================================
  it('opens directory picker when browse button is clicked', async () => {
    renderGate({ initialPath: '/workspace/' });
    const browseBtn = screen.getByTitle('Browse directories');
    fireEvent.click(browseBtn);
    expect(window.electronAPI.openDirectoryDialog).toHaveBeenCalled();
  });

  it('updates path when directory is selected', async () => {
    vi.mocked(window.electronAPI.openDirectoryDialog).mockResolvedValue('/selected/dir');
    renderGate({ initialPath: '/workspace/' });
    fireEvent.click(screen.getByTitle('Browse directories'));
    await waitFor(() => {
      const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
      expect(input.value).toBe('/selected/dir/');
    });
  });

  // =========================================================================
  // Keyboard shortcuts
  // =========================================================================
  it('submits on Enter key', async () => {
    renderGate({ initialPath: '/workspace/' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
      expect(input.value).toBe('/workspace/');
    });
    const input = screen.getByPlaceholderText('project name');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSubmit).toHaveBeenCalled();
  });

  it('prevents suggestion mousedown from stealing focus and applies suggestion click', async () => {
    vi.mocked(window.electronAPI.readDirectory).mockImplementation(async (dirPath: string) => {
      const normalizedPath = dirPath.replace(/\\/g, '/');
      if (normalizedPath.endsWith('/projects/')) {
        return [{ name: 'alpha', isDirectory: true }];
      }
      return [];
    });

    renderGate();

    const input = screen.getByPlaceholderText('project name') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a' } });

    const suggestionPath = 'alpha/';
    const suggestion = await screen.findByText(suggestionPath);

    const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    const dispatchResult = suggestion.dispatchEvent(mouseDownEvent);
    expect(dispatchResult).toBe(false);
    expect(mouseDownEvent.defaultPrevented).toBe(true);

    fireEvent.click(suggestion);
    expect(input.value).toBe(suggestionPath);

    await waitFor(() => {
      expect(screen.queryByText(suggestionPath)).toBeNull();
    });
  });

  // =========================================================================
  // Model selector
  // =========================================================================
  it('shows model picker when a harness is selected', async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByText('Codex')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Codex'));
    // New compact picker shows a model pill instead of "Model" label
    await waitFor(() => {
      expect(document.querySelector('.model-pill')).toBeTruthy();
    });
  });

  it('does not show model picker for terminal-only mode', async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Terminal'));
    // Terminal-only mode should not show the model picker
    expect(document.querySelector('.model-picker')).toBeNull();
  });
});
