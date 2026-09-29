// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkspaceGateContent, { TERMINAL_PRESETS } from '../../../src/renderer/components/WorkspaceGateContent';
import { sameWorkspacePath } from '../../../src/renderer/lib/pathUtils';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';

// Platform-neutral path constants for test fixtures
const TEST_HOME_USER = path.join(path.sep === '\\' ? 'C:\\Users\\user' : '/home', 'user');
const TEST_PROJECTS = path.join(TEST_HOME_USER, 'projects');
const TEST_PROJECT = path.join(TEST_HOME_USER, 'project');

describe('WorkspaceGateContent', () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
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

  it('renders an open error beside the launch action and reports target changes', () => {
    const onTargetChange = vi.fn();
    render(<WorkspaceGateContent onSubmit={mockOnSubmit} openError="Workspace unavailable" onTargetChange={onTargetChange} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('gate-open-error');
    expect(alert.previousElementSibling).toHaveClass('gate-launch-actions');
    const initialCalls = onTargetChange.mock.calls.length;

    fireEvent.change(screen.getByPlaceholderText('project name'), { target: { value: '/new-project' } });
    expect(onTargetChange.mock.calls.length).toBeGreaterThan(initialCalls);
    fireEvent.click(screen.getByRole('button', { name: 'SSH Remote' }));
    expect(onTargetChange.mock.calls.length).toBeGreaterThan(initialCalls + 1);
  });

  it('opens harness settings from the gate and applies visibility changes on return', async () => {
    let defaults = {
      codex: { model: '', favorites: [], flags: '', visible: true },
    };
    window.electronAPI.getHarnessDefaults = vi.fn().mockImplementation(async () => defaults);
    window.electronAPI.setHarnessDefaults = vi.fn().mockImplementation(async (next) => { defaults = next; });
    renderGate({ initialPath: '/repo/' });

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByText('Harness settings')).toBeTruthy();
    const hideCodex = await screen.findByRole('checkbox', { name: 'Hide Codex' });
    fireEvent.click(hideCodex);
    await waitFor(() => expect(window.electronAPI.setHarnessDefaults).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Back to workspace' }));
    expect(screen.getByText('Launch Workspace')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Codex' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Configure' })).toBeTruthy();
  });

  it('does not flash the non-repository hint while typing a workspace path', async () => {
    window.electronAPI.gitGetBranchState = vi.fn().mockResolvedValue({ success: false, isRepo: false });
    renderGate({ initialPath: '/not-a-repo/' });
    expect(await screen.findByText('Worktrees require a Git repository or linked checkout.')).toBeTruthy();

    const input = screen.getByPlaceholderText('project name');
    fireEvent.focus(input);
    expect(screen.queryByText('Worktrees require a Git repository or linked checkout.')).toBeNull();
    fireEvent.change(input, { target: { value: '/not-a-repo/new-path' } });
    await waitFor(() => expect(window.electronAPI.gitGetBranchState).toHaveBeenCalledWith('/not-a-repo/new-path/'));
    expect(screen.queryByText('Worktrees require a Git repository or linked checkout.')).toBeNull();
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
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Codex' })).toHaveClass('selected');
    });

    fireEvent.keyDown(document.body, { key: 'a' });

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
  describe('SSH directory browsing', () => {
    const targets = [
      { id: 'alpha', kind: 'ssh' as const, label: 'Alpha', target: 'alpha.example' },
      { id: 'beta', kind: 'ssh' as const, label: 'Beta', target: 'beta.example' },
    ];

    function setupRemote() {
      window.electronAPI.sshEnvironmentList = vi.fn().mockResolvedValue(targets);
      window.electronAPI.getEnvironmentHarnessOptions = vi.fn().mockResolvedValue({
        codex: { name: 'Codex', command: 'codex', args: [], icon: 'codex' },
        pi: { name: 'Pi', command: 'pi', args: [], icon: 'pi' },
      });
      window.electronAPI.sshGetHomeDirectory = vi.fn().mockImplementation(async (id: string) => ({
        homePath: `/home/${id}`, initialPath: `/home/${id}/workspaces`,
      }));
      window.electronAPI.sshListDirectories = vi.fn().mockImplementation(async (_id: string, directory: string) => ({
        path: directory, parentPath: directory === '/' ? null : directory.substring(0, directory.lastIndexOf('/')) || '/',
        directories: [],
      }));
      window.electronAPI.sshCreateDirectory = vi.fn().mockImplementation(async (_id: string, parentPath: string, name: string) => ({
        path: `${parentPath.replace(/\/+$/, '')}/${name}`,
      }));
    }

    async function selectRemote() {
      fireEvent.click(screen.getByRole('button', { name: 'SSH Remote' }));
      await screen.findByRole('textbox', { name: 'Remote Directory Path' });
    }

    it('discovers from an open repository on the selected target and opens a checkout in that environment', async () => {
      setupRemote();
      const source = createWorkspaceFixture({ id: 'alpha-repo', environmentId: 'alpha', workspacePath: '/repo' });
      const otherHost = createWorkspaceFixture({ id: 'beta-repo', environmentId: 'beta', workspacePath: '/repo' });
      const local = createWorkspaceFixture({ id: 'local-repo', environmentId: 'local', workspacePath: '/repo' });
      useWorkspaceStore.setState({ workspaces: [source, otherHost, local], activeWorkspaceId: otherHost.id });
      vi.mocked(window.electronAPI.gitListWorktrees).mockResolvedValue({ success: true, worktrees: [{ path: '/remote-task', branch: 'task', isMain: false, isLocked: false, isPrunable: false }] });
      renderGate();
      await selectRemote();
      fireEvent.click(screen.getByRole('button', { name: 'Worktree options' }));
      await screen.findByText('/remote-task');
      expect(screen.getByLabelText('Open SSH repository')).toHaveValue(source.id);
      expect(screen.getAllByRole('option').filter((option) => option.parentElement?.id === 'remote-worktree-repository')).toHaveLength(1);
      expect(window.electronAPI.gitListWorktrees).toHaveBeenCalledWith('/repo', source.id);
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: '/remote-task', environmentId: 'alpha', environmentLabel: 'Alpha' }));
      expect(screen.queryByText('Create and open worktree')).toBeNull();
    });

    it('reinitializes the selected target path after its default root is edited', async () => {
      setupRemote();
      window.electronAPI.sshEnvironmentSave = vi.fn().mockImplementation(async (config) => ({ success: true, config }));
      renderGate();
      await selectRemote();
      await waitFor(() => expect(screen.getByLabelText('Remote Directory Path')).toHaveValue('/home/alpha/workspaces'));
      fireEvent.click(screen.getByRole('button', { name: 'Manage SSH Targets' }));
      fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha' }));
      fireEvent.change(screen.getByLabelText('Default workspace root (optional)'), { target: { value: '/srv/repos' } });
      vi.mocked(window.electronAPI.sshGetHomeDirectory).mockResolvedValue({ homePath: '/home/alpha', initialPath: '/srv/repos' });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(screen.getByLabelText('Remote Directory Path')).toHaveValue('/srv/repos'));
      expect(window.electronAPI.sshEnvironmentSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'alpha', defaultWorkspaceRoot: '/srv/repos' }));
      expect(window.electronAPI.getEnvironmentHarnessOptions).toHaveBeenCalledTimes(1);
    });

    it('rediscovers harnesses after editing the selected host and blocks launching stale choices while loading', async () => {
      setupRemote();
      window.electronAPI.sshEnvironmentSave = vi.fn().mockImplementation(async (config) => ({ success: true, config }));
      let resolveNew!: (value: { pi: boolean }) => void;
      const newDiscovery = new Promise<{ pi: boolean }>((resolve) => { resolveNew = resolve; });
      vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockResolvedValueOnce({ codex: true }).mockReturnValueOnce(newDiscovery);
      renderGate();
      await selectRemote();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Codex' })).toHaveClass('selected'));
      fireEvent.click(screen.getByRole('button', { name: 'Manage SSH Targets' }));
      fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha' }));
      fireEvent.change(screen.getByLabelText('SSH Target'), { target: { value: 'new-alpha.example' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(window.electronAPI.getEnvironmentHarnessOptions).toHaveBeenCalledTimes(2));
      expect(window.electronAPI.getEnvironmentHarnessOptions).toHaveBeenLastCalledWith('alpha');
      expect(screen.queryByRole('button', { name: 'Codex' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeDisabled();
      fireEvent.keyDown(screen.getByLabelText('Remote Directory Path'), { key: 'Enter' });
      expect(mockOnSubmit).not.toHaveBeenCalled();
      await act(async () => resolveNew({ pi: true }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Pi' })).toHaveClass('selected'));
      fireEvent.click(screen.getByRole('button', { name: 'Close SSH target manager' }));
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'alpha', harness: 'pi' }));
    });

    it('ignores a previous host discovery response after a same-ID target edit', async () => {
      setupRemote();
      window.electronAPI.sshEnvironmentSave = vi.fn().mockImplementation(async (config) => ({ success: true, config }));
      let resolveOld!: (value: { codex: boolean }) => void;
      const oldDiscovery = new Promise<{ codex: boolean }>((resolve) => { resolveOld = resolve; });
      vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockReturnValueOnce(oldDiscovery).mockResolvedValueOnce({ pi: true });
      renderGate();
      await selectRemote();
      await waitFor(() => expect(window.electronAPI.getEnvironmentHarnessOptions).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Manage SSH Targets' }));
      fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha' }));
      fireEvent.change(screen.getByLabelText('SSH Target'), { target: { value: 'new-alpha.example' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Pi' })).toHaveClass('selected'));
      await act(async () => resolveOld({ codex: true }));
      expect(screen.queryByRole('button', { name: 'Codex' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Pi' })).toHaveClass('selected');
    });

    it('initializes each target separately and ignores a previous target home request', async () => {
      setupRemote();
      let resolveAlpha!: (value: { homePath: string; initialPath: string }) => void;
      const alphaHome = new Promise<{ homePath: string; initialPath: string }>((resolve) => { resolveAlpha = resolve; });
      vi.mocked(window.electronAPI.sshGetHomeDirectory).mockImplementation((id) => id === 'alpha'
        ? alphaHome
        : Promise.resolve({ homePath: '/home/beta', initialPath: '/home/beta/workspaces' }));
      renderGate();
      await selectRemote();
      await waitFor(() => expect(window.electronAPI.sshGetHomeDirectory).toHaveBeenCalledWith('alpha'));
      fireEvent.change(document.querySelector('.ssh-env-select')!, { target: { value: 'beta' } });
      const input = screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement;
      await waitFor(() => expect(input.value).toBe('/home/beta/workspaces'));
      await act(async () => resolveAlpha({ homePath: '/home/alpha', initialPath: '/home/alpha/workspaces' }));
      expect(input.value).toBe('/home/beta/workspaces');
    });

    it('keeps manual input despite late home results, and launches with the selected harness', async () => {
      setupRemote();
      let resolveHome!: (value: { homePath: string; initialPath: string }) => void;
      const home = new Promise<{ homePath: string; initialPath: string }>((resolve) => { resolveHome = resolve; });
      vi.mocked(window.electronAPI.sshGetHomeDirectory).mockImplementation(() => home);
      renderGate();
      await selectRemote();
      const input = screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/opt/custom-project' } });
      await act(async () => resolveHome({ homePath: '/home/alpha', initialPath: '/home/alpha/workspaces' }));
      expect(input.value).toBe('/opt/custom-project');
      fireEvent.click(await screen.findByRole('button', { name: 'Pi' }));
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
        path: '/opt/custom-project', environmentId: 'alpha', environmentLabel: 'Alpha', harness: 'pi',
      }));
    });

    it('debounces autocomplete and rejects stale suggestions after edits and target switches', async () => {
      setupRemote();
      let resolveOld!: (value: { path: string; parentPath: string; directories: { name: string; path: string }[] }) => void;
      const old = new Promise<{ path: string; parentPath: string; directories: { name: string; path: string }[] }>((resolve) => { resolveOld = resolve; });
      vi.mocked(window.electronAPI.sshListDirectories).mockImplementation((id, directory) => id === 'alpha'
        ? old
        : Promise.resolve({ path: directory, parentPath: '/home/beta', directories: [{ name: 'new', path: '/home/beta/new' }] }));
      renderGate();
      await selectRemote();
      const input = screen.getByRole('textbox', { name: 'Remote Directory Path' });
      await waitFor(() => expect((input as HTMLInputElement).value).toBe('/home/alpha/workspaces'));
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '/home/alpha/ol' } });
      await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenCalledWith('alpha', '/home/alpha/'));
      fireEvent.change(document.querySelector('.ssh-env-select')!, { target: { value: 'beta' } });
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('/home/beta/workspaces'));
      await act(async () => resolveOld({ path: '/home/alpha', parentPath: '/home', directories: [{ name: 'old', path: '/home/alpha/old' }] }));
      expect(screen.queryByText('/home/alpha/old')).toBeNull();
      const betaInput = screen.getByRole('textbox', { name: 'Remote Directory Path' });
      fireEvent.focus(betaInput);
      fireEvent.change(betaInput, { target: { value: '/home/beta/ne' } });
      const suggestion = await screen.findByText('/home/beta/new');
      fireEvent.keyDown(betaInput, { key: 'ArrowDown' });
      fireEvent.keyDown(betaInput, { key: 'Enter' });
      expect((betaInput as HTMLInputElement).value).toBe('/home/beta/new');
      expect(suggestion).toBeTruthy();
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('shows child directories when an absolute path ends with a slash', async () => {
      setupRemote();
      vi.mocked(window.electronAPI.sshListDirectories).mockResolvedValue({
        path: '/home/alpha/workspaces', parentPath: '/home/alpha',
        directories: [{ name: 'clanker-test', path: '/home/alpha/workspaces/clanker-test' }],
      });
      renderGate();
      await selectRemote();
      const input = screen.getByRole('textbox', { name: 'Remote Directory Path' });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '/home/alpha/workspaces/' } });
      expect(await screen.findByText('/home/alpha/workspaces/clanker-test')).toBeTruthy();
      expect(window.electronAPI.sshListDirectories).toHaveBeenCalledWith('alpha', '/home/alpha/workspaces/');
    });

    it('navigates canonical directories, reports loading/errors, and selects the current directory', async () => {
      setupRemote();
      let resolveFirst!: (value: { path: string; parentPath: string; directories: { name: string; path: string }[] }) => void;
      const first = new Promise<{ path: string; parentPath: string; directories: { name: string; path: string }[] }>((resolve) => { resolveFirst = resolve; });
      let initialLoads = 0;
      vi.mocked(window.electronAPI.sshListDirectories).mockImplementation((_id, directory) => {
        if (directory === '/home/alpha/workspaces' && initialLoads++ === 0) return first;
        if (directory === '/srv') return Promise.reject(new Error('Permission denied'));
        return Promise.resolve({ path: directory, parentPath: directory === '/' ? null : '/home/alpha/workspaces',
          directories: directory === '/home/alpha/workspaces'
            ? [{ name: 'project', path: '/canonical/project' }, { name: 'srv', path: '/srv' }]
            : [{ name: 'project', path: '/canonical/project' }] });
      });
      renderGate();
      await selectRemote();
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('/home/alpha/workspaces'));
      fireEvent.click(screen.getByRole('button', { name: 'Browse remote directories' }));
      expect(screen.getByRole('status')).toHaveTextContent('Loading directories');
      expect(screen.getByRole('button', { name: 'Select this directory' })).toBeDisabled();
      await act(async () => resolveFirst({ path: '/home/alpha/workspaces', parentPath: '/home/alpha', directories: [{ name: 'project', path: '/canonical/project' }, { name: 'srv', path: '/srv' }] }));
      fireEvent.click(screen.getByRole('button', { name: 'srv' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Browse remote directories' }));
      await screen.findByRole('button', { name: 'project' });
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Browse remote directories' }), { key: 'ArrowDown' });
      const projectButton = screen.getByRole('button', { name: 'project' });
      expect(document.activeElement).toBe(projectButton);
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(screen.getByText('/canonical/project')).toBeTruthy());
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Browse remote directories' }), { key: 'Backspace' });
      await waitFor(() => expect(screen.getByText('/home/alpha/workspaces')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'project' }));
      await waitFor(() => expect(screen.getByText('/canonical/project')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Select this directory' }));
      expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('/canonical/project');
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: '/canonical/project', environmentId: 'alpha' }));
    });
    it('creates a new directory from the chooser and navigates into it', async () => {
      setupRemote();
      vi.mocked(window.electronAPI.sshListDirectories).mockImplementation(async (_id, dir) => {
        if (dir === '/home/alpha/workspaces/my-app') {
          return { path: '/canonical/my-app', parentPath: '/home/alpha/workspaces', directories: [] };
        }
        return { path: '/home/alpha/workspaces', parentPath: '/home/alpha', directories: [] };
      });
      vi.mocked(window.electronAPI.sshCreateDirectory).mockResolvedValue({ path: '/home/alpha/workspaces/my-app' });
      renderGate();
      await selectRemote();
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('/home/alpha/workspaces'));
      fireEvent.click(screen.getByRole('button', { name: 'Browse remote directories' }));
      await screen.findByRole('dialog', { name: 'Browse remote directories' });
      fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
      const folderInput = screen.getByRole('textbox', { name: 'New folder name' });
      fireEvent.change(folderInput, { target: { value: 'my-app' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(window.electronAPI.sshCreateDirectory).toHaveBeenCalledWith('alpha', '/home/alpha/workspaces', 'my-app'));
      await waitFor(() => expect(screen.getByText('/canonical/my-app')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Select this directory' }));
      expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('/canonical/my-app');
    });

    it('ignores a stale directory response after navigation', async () => {
      setupRemote();
      let resolveOld!: (value: { path: string; parentPath: string; directories: { name: string; path: string }[] }) => void;
      const old = new Promise<{ path: string; parentPath: string; directories: { name: string; path: string }[] }>((resolve) => { resolveOld = resolve; });
      vi.mocked(window.electronAPI.sshListDirectories).mockImplementation((_id, path) => path === '/home/alpha/workspaces'
        ? Promise.resolve({ path, parentPath: '/home/alpha', directories: [{ name: 'old', path: '/old' }, { name: 'new', path: '/new' }] })
        : path === '/old' ? old : Promise.resolve({ path: '/new', parentPath: '/', directories: [] }));
      renderGate();
      await selectRemote();
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('/home/alpha/workspaces'));
      fireEvent.click(screen.getByRole('button', { name: 'Browse remote directories' }));
      fireEvent.click(await screen.findByRole('button', { name: 'old' }));
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Browse remote directories' }), { key: 'Escape' });
      fireEvent.click(screen.getByRole('button', { name: 'Browse remote directories' }));
      fireEvent.click(await screen.findByRole('button', { name: 'new' }));
      await waitFor(() => expect(screen.getByText('/new')).toBeTruthy());
      await act(async () => resolveOld({ path: '/old', parentPath: '/', directories: [] }));
      expect(screen.getByText('/new')).toBeTruthy();
    });

    it('discards an in-flight chooser request when the SSH environment changes', async () => {
      setupRemote();
      let resolveAlpha!: (value: { path: string; parentPath: string; directories: { name: string; path: string }[] }) => void;
      const alpha = new Promise<{ path: string; parentPath: string; directories: { name: string; path: string }[] }>((resolve) => { resolveAlpha = resolve; });
      vi.mocked(window.electronAPI.sshListDirectories).mockImplementation((id, path) => id === 'alpha'
        ? alpha : Promise.resolve({ path, parentPath: '/home/beta', directories: [] }));
      renderGate();
      await selectRemote();
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('/home/alpha/workspaces'));
      fireEvent.click(screen.getByRole('button', { name: 'Browse remote directories' }));
      await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenCalledWith('alpha', '/home/alpha/workspaces'));
      fireEvent.change(document.querySelector('.ssh-env-select')!, { target: { value: 'beta' } });
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('/home/beta/workspaces'));
      await act(async () => resolveAlpha({ path: '/home/alpha/workspaces', parentPath: '/home/alpha', directories: [{ name: 'old', path: '/home/alpha/workspaces/old' }] }));
      expect(screen.queryByText('old')).toBeNull();
      expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('/home/beta/workspaces');
    });

    it('submits New Folder once while the request is pending and restores focus after closing', async () => {
      setupRemote();
      let resolveCreate!: (value: { path: string }) => void;
      vi.mocked(window.electronAPI.sshCreateDirectory).mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
      renderGate();
      await selectRemote();
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('/home/alpha/workspaces'));
      const browse = screen.getByRole('button', { name: 'Browse remote directories' });
      fireEvent.click(browse);
      fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'New folder name' }), { target: { value: 'once' } });
      const form = screen.getByRole('textbox', { name: 'New folder name' }).closest('form')!;
      fireEvent.submit(form);
      fireEvent.submit(form);
      expect(window.electronAPI.sshCreateDirectory).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Select this directory' })).toBeDisabled();
      await act(async () => resolveCreate({ path: '/home/alpha/workspaces/once' }));
      await waitFor(() => expect(screen.getByText('/home/alpha/workspaces/once')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(document.activeElement).toBe(browse);
    });


    it('closes the chooser on Escape without changing manually typed path', async () => {
      setupRemote();
      renderGate();
      await selectRemote();
      const input = screen.getByRole('textbox', { name: 'Remote Directory Path' });
      fireEvent.change(input, { target: { value: '/manual/path' } });
      fireEvent.click(screen.getByRole('button', { name: 'Browse remote directories' }));
      await screen.findByRole('dialog', { name: 'Browse remote directories' });
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Browse remote directories' }), { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Browse remote directories' })).toBeNull();
      expect((input as HTMLInputElement).value).toBe('/manual/path');
    });
  });
});
