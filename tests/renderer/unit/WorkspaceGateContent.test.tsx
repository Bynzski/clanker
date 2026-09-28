// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WorkspaceGateContent, { TERMINAL_PRESETS } from '../../../src/renderer/components/WorkspaceGateContent';
import { sameWorkspacePath } from '../../../src/renderer/lib/pathUtils';

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
      gitGetBranchState: vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', branches: [{ name: 'main', isCurrent: true }] }),
      gitListWorktrees: vi.fn().mockResolvedValue({ success: true, worktrees: [] }),
    } as unknown as typeof window.electronAPI;
  });

  function renderGate(overrides: { initialPath?: string } = {}) {
    return render(<WorkspaceGateContent onSubmit={mockOnSubmit} {...overrides} />);
  }

  async function openWorktreeOptions() {
    const button = screen.getByRole('button', { name: 'Worktree options' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
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

  it('opens the worktree view and returns to the workspace launcher', async () => {
    renderGate({ initialPath: '/repo/' });
    await openWorktreeOptions();
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
    await openWorktreeOptions();
    fireEvent.click(screen.getByText('Load repository'));
    await screen.findByText('Task branch');
    fireEvent.change(screen.getByLabelText('Task branch'), { target: { value: 'task' } });
    fireEvent.click(screen.getByText('Create and open worktree'));
    await waitFor(() => expect(window.electronAPI.gitCreateWorktree).toHaveBeenCalledWith('/repo/', 'main', 'task'));
    expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: '/repo-worktrees/task' }));
  });

  it('opens an existing worktree and requires inspection before removal', async () => {
    const worktree = { path: '/repo-worktrees/task-5f66ef4178e31b5f4a9b', branch: 'task', isMain: false, isLocked: false, isPrunable: false };
    window.electronAPI.gitGetBranchState = vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', branches: [] });
    window.electronAPI.gitListWorktrees = vi.fn().mockResolvedValue({ success: true, worktrees: [worktree] });
    window.electronAPI.gitInspectWorktree = vi.fn().mockResolvedValue({ success: true, worktree, hasChanges: false });
    window.electronAPI.gitRemoveWorktree = vi.fn().mockResolvedValue({ success: true });
    renderGate({ initialPath: '/repo/' });
    await openWorktreeOptions();
    fireEvent.click(screen.getByText('Load repository'));
    const identity = await screen.findByTitle(worktree.path);
    expect(identity).toHaveTextContent('repo');
    expect(identity).toHaveTextContent('task');
    expect(identity).not.toHaveTextContent('5f66ef4178e31b5f4a9b');
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
    await openWorktreeOptions();
    fireEvent.click(screen.getByText('Load repository'));
    expect(await screen.findByTitle(worktree.path)).toHaveTextContent('missing');
    const open = screen.getByRole('button', { name: 'Open' });
    expect(open.hasAttribute('disabled')).toBe(true);
    fireEvent.click(open);
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('keeps a generated worktree container out of workspace choices', async () => {
    const projects = TEST_PROJECTS.replace(/\\/g, '/');
    const repository = `${projects}/test`;
    const container = `${projects}/test-worktrees`;
    const checkout = `${container}/player-5f66ef4178e31b5f4a9b`;
    window.electronAPI.gitGetBranchState = vi.fn().mockImplementation(async (value: string) => ({
      success: true,
      // A generated container nested in another repository also reports isRepo.
      isRepo: [repository, container, checkout].some((candidate) => sameWorkspacePath(candidate, value)),
      currentBranch: 'main',
      branches: [{ name: 'main', isCurrent: true }],
    }));
    window.electronAPI.gitListWorktrees = vi.fn().mockResolvedValue({ success: true, worktrees: [
      { path: repository, branch: 'main', isMain: true, isLocked: false, isPrunable: false },
      { path: checkout, branch: 'player', isMain: false, isLocked: false, isPrunable: false },
    ] });
    window.electronAPI.readDirectory = vi.fn().mockResolvedValue([
      { name: 'test', isDirectory: true },
      { name: 'test-worktrees', isDirectory: true },
    ]);

    renderGate({ initialPath: `${container}/` });
    await screen.findByText('Worktrees require a Git repository or linked checkout.');
    expect(screen.getByRole('button', { name: 'Worktree options' })).toBeDisabled();
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This folder holds worktrees for test');
    expect(mockOnSubmit).not.toHaveBeenCalled();

    const input = screen.getByPlaceholderText('project name');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'test' } });
    expect(await screen.findByText('test/')).toBeTruthy();
    expect(screen.queryByText('test-worktrees/')).toBeNull();

    fireEvent.change(input, { target: { value: `${checkout}/` } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Worktree options' })).toBeEnabled());
  });

  it('keeps looking for directory suggestions after generated containers', async () => {
    const projects = TEST_PROJECTS.replace(/\\/g, '/');
    const containers = Array.from({ length: 17 }, (_, index) => `test-${String(index).padStart(2, '0')}-worktrees`);
    const visibleName = 'test-visible-directory-after-the-containers';
    window.electronAPI.readDirectory = vi.fn().mockResolvedValue([
      ...containers.map((name) => ({ name, isDirectory: true })),
      { name: visibleName, isDirectory: true },
    ]);
    window.electronAPI.gitGetBranchState = vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', branches: [] });
    window.electronAPI.gitListWorktrees = vi.fn().mockImplementation(async (value: string) => {
      const selected = value.replace(/\\/g, '/').replace(/\/$/, '');
      const repository = selected.endsWith('-worktrees') ? selected.slice(0, -'-worktrees'.length) : selected;
      return { success: true, worktrees: selected.endsWith('-worktrees')
        ? [{ path: projects, branch: 'main', isMain: true, isLocked: false, isPrunable: false }]
        : [
          { path: repository, branch: 'main', isMain: true, isLocked: false, isPrunable: false },
          { path: `${repository}-worktrees/checkout`, branch: 'task', isMain: false, isLocked: false, isPrunable: false },
        ] };
    });

    renderGate({ initialPath: `${projects}/test-` });
    fireEvent.focus(screen.getByPlaceholderText('project name'));
    expect(await screen.findByText(`${projects}/${visibleName}/`)).toBeTruthy();
    expect(screen.queryByText(`${projects}/test-00-worktrees/`)).toBeNull();
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

  it('launches the selected Hermes provider model and can return to the Hermes default', async () => {
    const selectedId = 'hermes-provider:openrouter:anthropic%2Fclaude-sonnet';
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      hermes: { name: 'Hermes', command: 'hermes', args: ['--tui'], icon: '☿' },
    });
    vi.mocked(window.electronAPI.getHarnessModels).mockResolvedValue([
      { id: selectedId, label: 'OpenRouter · anthropic/claude-sonnet' },
    ]);

    renderGate({ initialPath: '/workspace/' });
    fireEvent.click(await screen.findByRole('button', { name: 'Hermes' }));
    await waitFor(() => expect(window.electronAPI.getHarnessModels).toHaveBeenCalledWith('hermes'));
    await screen.findByTitle('Change model');

    // A discovered model must not silently replace Hermes's own default.
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ harness: 'hermes', model: undefined }));

    fireEvent.click(screen.getByTitle('Change model'));
    fireEvent.click(screen.getByText('Browse all models'));
    fireEvent.click(screen.getByText('anthropic/claude-sonnet', { selector: '.discovery-model-label .hermes-model-id' }));
    expect(screen.getByTitle('Change model')).toHaveTextContent('anthropic/claude-sonnet');
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ harness: 'hermes', model: selectedId }));

    fireEvent.click(screen.getByTitle('Change model'));
    fireEvent.click(screen.getByText('Use Hermes default'));
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ harness: 'hermes', model: undefined }));
  });

  it('shows a saved provider-aware Hermes default and preserves its ID at launch', async () => {
    const savedId = 'hermes-provider:openrouter:anthropic%2Fclaude-sonnet';
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      hermes: { name: 'Hermes', command: 'hermes', args: ['--tui'], icon: '☿' },
    });
    vi.mocked(window.electronAPI.getHarnessModels).mockResolvedValue([
      { id: savedId, label: 'OpenRouter · anthropic/claude-sonnet' },
      { id: 'hermes-provider:copilot:other', label: 'GitHub Copilot · other' },
    ]);
    vi.mocked(window.electronAPI.getHarnessDefaults).mockResolvedValue({
      hermes: { model: savedId, favorites: [savedId], flags: '', visible: true },
    });
    renderGate({ initialPath: '/workspace/' });
    fireEvent.click(await screen.findByRole('button', { name: 'Hermes' }));
    await waitFor(() => expect(screen.getByTitle('Change model')).toHaveTextContent('anthropic/claude-sonnet'));
    fireEvent.click(screen.getByTitle('Change model'));
    fireEvent.click(screen.getByText('Browse all models'));
    fireEvent.click(screen.getByText('other', { selector: '.discovery-model-label .hermes-model-id' }));
    fireEvent.click(screen.getByTitle('Change model'));
    fireEvent.click(screen.getByText('Use saved default'));
    expect(screen.getByTitle('Change model')).toHaveTextContent('anthropic/claude-sonnet');
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ harness: 'hermes', model: savedId }));
  });

  it('shows full duplicate Hermes slugs before their providers and refreshes without clearing the selection', async () => {
    const first = 'hermes-provider:codex:gpt-5.3-codex-900k';
    const second = 'hermes-provider:copilot:gpt-5.3-codex-900k';
    const third = 'hermes-provider:openrouter:anthropic%2Fclaude-opus';
    const initial = [
      { id: first, label: 'ChatGPT or Codex Subscription · gpt-5.3-codex-900k' },
      { id: second, label: 'GitHub Copilot · gpt-5.3-codex-900k' },
    ];
    const refreshed = [...initial, { id: third, label: 'anthropic/claude-opus · OpenRouter' }];
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      hermes: { name: 'Hermes', command: 'hermes', args: ['--tui'], icon: '☿' },
    });
    vi.mocked(window.electronAPI.getHarnessModels).mockImplementation(async (_harness, refresh) => refresh ? refreshed : initial);
    renderGate({ initialPath: '/workspace/' });
    fireEvent.click(await screen.findByRole('button', { name: 'Hermes' }));
    fireEvent.click(await screen.findByTitle('Change model'));
    fireEvent.click(screen.getByText('Browse all models'));

    const rows = screen.getAllByText('gpt-5.3-codex-900k', { selector: '.discovery-item .hermes-model-id' })
      .map((entry) => entry.closest('.discovery-item')!);
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.hermes-model-provider')).toHaveTextContent('ChatGPT or Codex Subscription');
    expect(rows[1].querySelector('.hermes-model-provider')).toHaveTextContent('GitHub Copilot');
    fireEvent.click(rows[1]);
    expect(screen.getByTitle('Change model').querySelector('.hermes-model-id')).toHaveTextContent('gpt-5.3-codex-900k');
    expect(screen.getByTitle('Change model').querySelector('.hermes-model-provider')).toHaveTextContent('GitHub Copilot');

    fireEvent.click(screen.getByTitle('Change model'));
    fireEvent.click(screen.getByText('Browse all models'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Hermes models' }));
    await waitFor(() => expect(window.electronAPI.getHarnessModels).toHaveBeenCalledWith('hermes', true));
    expect(screen.getByTitle('Change model').querySelector('.hermes-model-provider')).toHaveTextContent('GitHub Copilot');
    const newRow = await screen.findByText('anthropic/claude-opus', { selector: '.discovery-item .hermes-model-id' });
    expect(newRow.closest('.discovery-item')?.querySelector('.hermes-model-provider')).toHaveTextContent('OpenRouter');
    fireEvent.click(newRow);
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ harness: 'hermes', model: third }));
  });

  it('accepts a custom Hermes model even with discovered options', async () => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      hermes: { name: 'Hermes', command: 'hermes', args: ['--tui'], icon: '☿' },
    });
    vi.mocked(window.electronAPI.getHarnessModels).mockResolvedValue([
      { id: 'hermes-provider:openrouter:model', label: 'OpenRouter · model' },
    ]);
    renderGate({ initialPath: '/workspace/' });
    fireEvent.click(await screen.findByRole('button', { name: 'Hermes' }));
    await screen.findByTitle('Change model');
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermes model' }), { target: { value: 'custom/model' } });
    expect(screen.getByTitle('Change model')).toHaveTextContent('custom/model');
    expect(screen.getByTitle('Change model').querySelector('.model-pill-warning')).toBeNull();
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ harness: 'hermes', model: 'custom/model' }));
  });

  it('launches Hermes with a manually entered model when no catalog is available', async () => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      hermes: { name: 'Hermes', command: 'hermes', args: ['--tui'], icon: '☿' },
    });
    vi.mocked(window.electronAPI.getHarnessModels).mockResolvedValue([]);

    renderGate({ initialPath: '/workspace/' });
    fireEvent.click(await screen.findByRole('button', { name: 'Hermes' }));
    const modelInput = screen.getByRole('textbox', { name: 'Hermes model' });
    fireEvent.change(modelInput, { target: { value: 'openrouter/custom-model' } });
    fireEvent.click(screen.getByText('Launch Workspace'));

    expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
      path: '/workspace/',
      harness: 'hermes',
      model: 'openrouter/custom-model',
    }));
  });

  it('keeps a Hermes launch model scoped to Hermes across delayed defaults loading', async () => {
    const defaults = {
      codex: { model: 'openai/codex-default', favorites: [], flags: '', visible: true },
      hermes: { model: 'anthropic/hermes-default', favorites: [], flags: '', visible: true },
    };
    let resolveDelayedDefaults!: (value: typeof defaults) => void;
    const delayedDefaults = new Promise<typeof defaults>((resolve) => {
      resolveDelayedDefaults = resolve;
    });
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'codex' },
      hermes: { name: 'Hermes', command: 'hermes', args: ['--tui'], icon: '☿' },
    });
    vi.mocked(window.electronAPI.getHarnessModels).mockResolvedValue([]);
    vi.mocked(window.electronAPI.getHarnessDefaults).mockResolvedValue(defaults);

    renderGate({ initialPath: '/workspace/' });
    await screen.findByText('openai/codex-default');
    vi.mocked(window.electronAPI.getHarnessDefaults).mockReturnValue(delayedDefaults);
    fireEvent.click(screen.getByRole('button', { name: 'Hermes' }));
    const modelInput = screen.getByRole('textbox', { name: 'Hermes model' }) as HTMLInputElement;
    expect(modelInput.value).toBe('anthropic/hermes-default');

    fireEvent.change(modelInput, { target: { value: 'openrouter/selected-model' } });
    await act(async () => resolveDelayedDefaults(defaults));
    expect(modelInput.value).toBe('openrouter/selected-model');
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
      harness: 'hermes',
      model: 'openrouter/selected-model',
    }));
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

  it('selects Antigravity from a window keypress outside editable controls', async () => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      codex: { name: 'Codex', command: 'codex', args: [], icon: '🧠' },
      agy: { name: 'Antigravity', command: 'agy', args: [], icon: '🪐' },
    });
    renderGate({ initialPath: '/workspace/' });
    await screen.findByRole('button', { name: 'Antigravity' });

    fireEvent.keyDown(window, { key: 'a' });

    expect(screen.getByRole('button', { name: 'Antigravity' })).toHaveClass('selected');
  });

  it('does not trigger harness shortcuts while typing in the workspace input', async () => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      codex: { name: 'Codex', command: 'codex', args: [], icon: '🧠' },
      agy: { name: 'Antigravity', command: 'agy', args: [], icon: '🪐' },
    });
    renderGate({ initialPath: '/workspace/' });
    await screen.findByRole('button', { name: 'Antigravity' });

    fireEvent.keyDown(screen.getByPlaceholderText('project name'), { key: 'a' });

    expect(screen.getByRole('button', { name: 'Codex' })).toHaveClass('selected');
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
