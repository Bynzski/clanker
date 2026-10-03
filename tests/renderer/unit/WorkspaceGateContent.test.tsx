// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HarnessDefaultsMap } from '../../../src/shared/types/store';
import WorkspaceGateContent from '../../../src/renderer/components/WorkspaceGateContent';
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

  async function renderGate(overrides: { initialPath?: string; fullscreen?: boolean } = {}) {
    const view = render(<WorkspaceGateContent onSubmit={mockOnSubmit} {...overrides} />);
    // Path/worktree fixtures request a plan explicitly; startup-state tests omit it.
    if (overrides.fullscreen === undefined) {
      await waitFor(() => expect(screen.getByRole('button', { name: 'Add Terminal terminal' })).toBeEnabled());
      fireEvent.keyDown(window, { key: '4' });
    }
    return view;
  }

  async function chooseBasicTerminal() {
    const add = screen.getByRole('button', { name: 'Add Terminal terminal' });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
  }

  it('starts fullscreen with zero terminals, puts Terminal last, and shows Settings below Launch', async () => {
    await renderGate({ fullscreen: true, initialPath: '/repo' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Codex terminal' })).toBeEnabled());
    expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('0');
    expect(screen.getByLabelText('Terminal terminal count')).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeDisabled();
    const rows = document.querySelectorAll('.gate-harness-row');
    expect(rows[rows.length - 1].querySelector('.gate-harness-name')).toHaveTextContent('Terminal');
    expect(screen.queryByText('Launch Recipes')).not.toBeInTheDocument();
    expect(screen.queryByText('Terminals')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configure' })).not.toBeInTheDocument();
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(document.querySelector('.gate-launch-actions')!.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('4');
    expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled();
    fireEvent.click(settings);
    expect(screen.getByText('Harness settings')).toBeInTheDocument();
  });

  async function openWorktreeOptions() {
    const button = screen.getByRole('button', { name: 'Worktree options' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
  }

  it('shows the actual saved model, allows a different model, and disables an empty launch plan', async () => {
    vi.mocked(window.electronAPI.getHarnessDefaults).mockResolvedValue({ codex: { model: 'gpt-3.5', flags: '', favorites: [] } });
    await renderGate({ fullscreen: true, initialPath: '/repo' });
    const picker = await screen.findByRole('button', { name: 'codex model' });
    await waitFor(() => expect(picker).toHaveTextContent('GPT-3.5'));
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole('button', { name: 'GPT-4' }));
    expect(picker).toHaveTextContent('GPT-4');
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Add Codex terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({
      terminalLaunches: Array.from({ length: 4 }, () => ({ harness: 'codex', model: 'gpt-4' })),
    }));
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Remove Codex terminal' }));
    expect(screen.getByRole('button', { name: 'Remove Codex terminal' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Worktree options' })).toBeEnabled());
  });

  it('preserves favorites across harness menus while an earlier save is pending', async () => {
    const user = userEvent.setup();
    let defaults: HarnessDefaultsMap = {
      codex: { model: 'gpt-4', flags: '', favorites: [], visible: true },
      opencode: { model: 'gpt-4', flags: '', favorites: [], visible: true },
    };
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    let writes = 0;
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'terminal' },
      opencode: { name: 'OpenCode', command: 'opencode', args: [], icon: 'terminal' },
    });
    vi.mocked(window.electronAPI.getHarnessDefaults).mockImplementation(async () => structuredClone(defaults));
    window.electronAPI.setHarnessDefaults = vi.fn(async (updated) => {
      if (++writes === 1) await pending;
      defaults = updated;
    });
    await renderGate({ fullscreen: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'codex model' })).toHaveTextContent('GPT-4'));
    await user.click(screen.getByRole('button', { name: 'codex model' }));
    await user.click(screen.getByRole('button', { name: 'Add GPT-4 to favorites' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'opencode model' }));
    await user.click(screen.getByRole('button', { name: 'Add GPT-3.5 to favorites' }));
    expect(window.electronAPI.setHarnessDefaults).toHaveBeenCalledOnce();
    await act(async () => finish());
    await waitFor(() => expect(window.electronAPI.setHarnessDefaults).toHaveBeenCalledTimes(2));
    expect(defaults.codex?.favorites).toEqual(['gpt-4']);
    expect(defaults.opencode?.favorites).toEqual(['gpt-3.5']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove GPT-3.5 from favorites' })).toBeEnabled());
  });

  it('fills recipe counts without opening the editor, executing commands, or changing the directory', async () => {
    window.electronAPI.recipeGetAll = vi.fn().mockResolvedValue([{
      id: 'preset', name: 'Mixed preset', workspacePath: '/other', version: 1, createdAt: 0, updatedAt: 0,
      terminalCount: 3, launches: [{ id: 'ai', type: 'harness', harnessId: 'codex' }, { id: 'cmd', type: 'command', command: 'echo hello' }],
    }]);
    const launchRecipe = vi.fn();
    render(<WorkspaceGateContent fullscreen initialPath="/repo" onSubmit={mockOnSubmit} onLaunchRecipe={launchRecipe} />);
    const chip = await screen.findByRole('button', { name: /^Mixed preset/ });
    await waitFor(() => expect(chip).toBeEnabled());
    fireEvent.click(chip);
    expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('1');
    expect(screen.getByLabelText('Terminal terminal count')).toHaveTextContent('2');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workspace directory')).toHaveValue('/repo');
    expect(launchRecipe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: '/repo/', terminalCount: 3 }));
  });

  // =========================================================================
  // Rendering
  // =========================================================================
  it('renders the title and subtitle', async () => {
    await renderGate();
    expect(screen.getByText('Clanker Grid')).toBeTruthy();
    expect(screen.getByText('Developer Workspace Launcher')).toBeTruthy();
  });

  it('renders the Launch Workspace button', async () => {
    await renderGate();
    expect(screen.getByText('Launch Workspace')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Worktree options' })).toBeTruthy();
  });

  it('renders an open error beside the launch action and reports target changes', () => {
    const onTargetChange = vi.fn();
    render(<WorkspaceGateContent onSubmit={mockOnSubmit} openError="Workspace unavailable" onTargetChange={onTargetChange} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('gate-open-error');
    expect(alert.previousElementSibling).toHaveClass('gate-settings-footer');
    const initialCalls = onTargetChange.mock.calls.length;

    fireEvent.change(screen.getByPlaceholderText('workspace directory'), { target: { value: '/new-project' } });
    expect(onTargetChange.mock.calls.length).toBeGreaterThan(initialCalls);
    fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
    // Opening the chooser preserves an error until the target actually changes.
    expect(onTargetChange.mock.calls.length).toBe(initialCalls + 1);
  });

  it('sets the fullscreen This PC working directory and resolves relative workspace entries beneath it', async () => {
    vi.mocked(window.electronAPI.openBaseDirectoryDialog).mockResolvedValue('/opt/workspaces');
    await renderGate({ fullscreen: true });
    await waitFor(() => expect(screen.getByText(TEST_PROJECTS.replace(/\\/g, '/') + '/')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set working directory for This PC' }));
    await screen.findByText('/opt/workspaces/');
    fireEvent.change(screen.getByRole('textbox', { name: 'Workspace directory' }), { target: { value: 'clanker' } });
    await chooseBasicTerminal();
    fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: '/opt/workspaces/clanker/', environmentId: 'local' }));
  });

  it('opens harness settings from the gate and applies visibility changes on return', async () => {
    let defaults = {
      codex: { model: '', favorites: [], flags: '', visible: true },
    };
    window.electronAPI.getHarnessDefaults = vi.fn().mockImplementation(async () => defaults);
    window.electronAPI.setHarnessDefaults = vi.fn().mockImplementation(async (next) => { defaults = next; });
    await renderGate({ initialPath: '/repo/' });

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Harness settings')).toBeTruthy();
    const hideCodex = await screen.findByRole('checkbox', { name: 'Hide Codex' });
    fireEvent.click(hideCodex);
    await waitFor(() => expect(window.electronAPI.setHarnessDefaults).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Back to workspace' }));
    expect(screen.getByText('Launch Workspace')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Codex terminal' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('explains unavailable worktrees on the action without a passive launch warning', async () => {
    window.electronAPI.gitGetBranchState = vi.fn().mockResolvedValue({ success: false, isRepo: false });
    await renderGate({ initialPath: '/not-a-repo/' });
    await waitFor(() => expect(window.electronAPI.gitGetBranchState).toHaveBeenCalledWith('/not-a-repo/'));
    expect(screen.getByRole('button', { name: 'Worktree options' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Worktree options' })).toHaveAttribute('title', 'Choose a Git repository or linked checkout first');
    expect(screen.queryByText('Worktrees require a Git repository or linked checkout.')).toBeNull();

    const input = screen.getByPlaceholderText('workspace directory');
    fireEvent.focus(input);
    expect(screen.queryByText('Worktrees require a Git repository or linked checkout.')).toBeNull();
    fireEvent.change(input, { target: { value: '/not-a-repo/new-path' } });
    await waitFor(() => expect(window.electronAPI.gitGetBranchState).toHaveBeenCalledWith('/not-a-repo/new-path/'));
    expect(screen.queryByText('Worktrees require a Git repository or linked checkout.')).toBeNull();
  });

  it('opens the worktree view and returns to the workspace launcher', async () => {
    await renderGate({ initialPath: '/repo/' });
    await openWorktreeOptions();
    expect(screen.getByText('Task worktree')).toBeTruthy();
    expect(screen.queryByText('Launch Workspace')).toBeNull();
    expect((screen.getByLabelText('Repository') as HTMLInputElement).value).toBe('/repo/');
    fireEvent.click(screen.getByText('Back to workspace'));
    expect(screen.getByText('Launch Workspace')).toBeTruthy();
    expect((screen.getByPlaceholderText('workspace directory') as HTMLInputElement).value).toBe('/repo/');
  });

  it('allows zero-terminal local worktree management but blocks creation and opening', async () => {
    const worktree = { path: '/repo-worktrees/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false };
    vi.mocked(window.electronAPI.gitListWorktrees).mockResolvedValue({ success: true, worktrees: [worktree] });
    window.electronAPI.gitCreateWorktree = vi.fn();
    window.electronAPI.gitInspectWorktree = vi.fn().mockResolvedValue({ success: true, worktree, hasChanges: false });
    window.electronAPI.gitRemoveWorktree = vi.fn().mockResolvedValue({ success: true });
    await renderGate({ fullscreen: true, initialPath: '/repo/' });
    await openWorktreeOptions();
    expect(screen.getByRole('status')).toHaveTextContent('Select at least one terminal');
    fireEvent.click(screen.getByRole('button', { name: 'Load repository' }));
    await screen.findByLabelText('Task branch');
    fireEvent.change(screen.getByLabelText('Task branch'), { target: { value: 'new-task' } });
    const create = screen.getByRole('button', { name: 'Create and open worktree' });
    const open = screen.getByRole('button', { name: 'Open' });
    expect(create).toBeDisabled();
    expect(open).toBeDisabled();
    fireEvent.click(create);
    fireEvent.click(open);
    expect(window.electronAPI.gitCreateWorktree).not.toHaveBeenCalled();
    expect(mockOnSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    await screen.findByRole('dialog', { name: 'Confirm worktree removal' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove this worktree' }));
    await waitFor(() => expect(window.electronAPI.gitRemoveWorktree).toHaveBeenCalledWith('/repo/', worktree.path, 'task', []));
  });

  it('keeps Worktree entry disabled for a non-repository even with zero terminals', async () => {
    vi.mocked(window.electronAPI.gitGetBranchState).mockResolvedValue({ success: true, isRepo: false, currentBranch: '', branches: [] });
    await renderGate({ fullscreen: true, initialPath: '/not-a-repo/' });
    await waitFor(() => expect(window.electronAPI.gitGetBranchState).toHaveBeenCalledWith('/not-a-repo/'));
    expect(screen.getByRole('button', { name: 'Worktree options' })).toBeDisabled();
  });

  it('creates a task worktree before opening its checkout', async () => {
    window.electronAPI.gitGetBranchState = vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', branches: [{ name: 'main', isCurrent: true }] });
    window.electronAPI.gitListWorktrees = vi.fn().mockResolvedValue({ success: true, worktrees: [] });
    window.electronAPI.gitCreateWorktree = vi.fn().mockResolvedValue({ success: true, worktree: { path: '/repo-worktrees/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false } });
    await renderGate({ initialPath: '/repo/' });
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
    await renderGate({ initialPath: '/repo/' });
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
    await renderGate({ initialPath: '/repo/' });
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

    await renderGate({ initialPath: `${container}/` });
    await waitFor(() => expect(window.electronAPI.gitListWorktrees).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Worktree options' })).toBeDisabled();
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This folder holds worktrees for test');
    expect(mockOnSubmit).not.toHaveBeenCalled();

    const input = screen.getByPlaceholderText('workspace directory');
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

    await renderGate({ initialPath: `${projects}/test-` });
    fireEvent.focus(screen.getByPlaceholderText('workspace directory'));
    expect(await screen.findByText(`${projects}/${visibleName}/`)).toBeTruthy();
    expect(screen.queryByText(`${projects}/test-00-worktrees/`)).toBeNull();
  });



  it('uses initialPath when provided', async () => {
    await renderGate({ initialPath: TEST_PROJECT + path.sep });
    const input = screen.getByPlaceholderText('workspace directory') as HTMLInputElement;
    expect(input.value).toBe(TEST_PROJECT + path.sep);
  });

  // =========================================================================
  // Terminal preset selection
  // =========================================================================


  // =========================================================================
  // Harness selection
  // =========================================================================
  it('shows available harnesses from electron API', async () => {
    await renderGate();
    await waitFor(() => {
      // Only codex is enabled in our mock, plus the terminal-only option
      expect(screen.getByText('Codex')).toBeTruthy();
    });
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

    await renderGate();

    await waitFor(() => {
      expect(screen.getByText('Claude')).toBeTruthy();
      expect(screen.queryByText('Codex')).toBeNull();
    });
    expect(screen.getByText('Terminal')).toBeTruthy();
  });















  // =========================================================================
  // Form submission
  // =========================================================================
  it('calls onSubmit with correct data', async () => {
    await renderGate({ initialPath: '/workspace/' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('workspace directory') as HTMLInputElement;
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
    await renderGate({ initialPath: '/workspace' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('workspace directory') as HTMLInputElement;
      expect(input.value).toBe('/workspace');
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/' })
    );
  });

  it('accepts UNC-style absolute paths on submit', async () => {
    await renderGate({ initialPath: '//server/share/repo' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('workspace directory') as HTMLInputElement;
      expect(input.value).toBe('//server/share/repo');
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ path: '//server/share/repo/' })
    );
  });

  it.each([true, false])('opens the configured base with a blank field without a worktree hint in fullscreen=%s', async (fullscreen) => {
    vi.mocked(window.electronAPI.gitGetBranchState).mockResolvedValue({ success: false, isRepo: false });
    await renderGate({ fullscreen });
    await screen.findByText(TEST_PROJECTS.replace(/\\/g, '/') + '/');
    await chooseBasicTerminal();
    const input = screen.getByLabelText('Workspace directory');
    await waitFor(() => expect(window.electronAPI.gitGetBranchState).toHaveBeenCalledWith(TEST_PROJECTS.replace(/\\/g, '/') + '/'));
    expect(screen.queryByText('Worktrees require a Git repository or linked checkout.')).toBeNull();
    expect(input).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ path: TEST_PROJECTS.replace(/\\/g, '/') + '/', environmentId: 'local' }));
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.queryByText('Worktrees require a Git repository or linked checkout.')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSubmit).toHaveBeenCalledTimes(2);
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ path: TEST_PROJECTS.replace(/\\/g, '/') + '/' }));
  });

  it('does not launch a blank field without a configured base', async () => {
    vi.mocked(window.electronAPI.getBaseDirectory).mockResolvedValue('');
    await renderGate({ fullscreen: true });
    await chooseBasicTerminal();
    expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Workspace directory'), { key: 'Enter' });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('resolves relative input against the base directory on submit', async () => {
    await renderGate({ initialPath: 'my-project' });
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
    await renderGate({ initialPath: '/workspace/' });
    const browseBtn = screen.getByTitle('Browse directories');
    fireEvent.click(browseBtn);
    expect(window.electronAPI.openDirectoryDialog).toHaveBeenCalled();
  });

  it('updates path when directory is selected', async () => {
    vi.mocked(window.electronAPI.openDirectoryDialog).mockResolvedValue('/selected/dir');
    await renderGate({ initialPath: '/workspace/' });
    fireEvent.click(screen.getByTitle('Browse directories'));
    await waitFor(() => {
      const input = screen.getByPlaceholderText('workspace directory') as HTMLInputElement;
      expect(input.value).toBe('/selected/dir/');
    });
  });

  // =========================================================================
  // Keyboard shortcuts
  // =========================================================================
  it('submits on Enter key', async () => {
    await renderGate({ initialPath: '/workspace/' });
    await waitFor(() => {
      const input = screen.getByPlaceholderText('workspace directory') as HTMLInputElement;
      expect(input.value).toBe('/workspace/');
    });
    const input = screen.getByPlaceholderText('workspace directory');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSubmit).toHaveBeenCalled();
  });

  it('selects Antigravity from a window keypress outside editable controls', async () => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      codex: { name: 'Codex', command: 'codex', args: [], icon: '🧠' },
      agy: { name: 'Antigravity', command: 'agy', args: [], icon: '🪐' },
    });
    await renderGate({ initialPath: '/workspace/' });
    await screen.findByRole('button', { name: 'Add Antigravity terminal' });
    await waitFor(() => {
      expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('4');
    });

    fireEvent.keyDown(document.body, { key: 'a' });

    expect(screen.getByLabelText('Antigravity terminal count')).toHaveTextContent('4');
  });

  it('does not trigger harness shortcuts while typing in the workspace input', async () => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      codex: { name: 'Codex', command: 'codex', args: [], icon: '🧠' },
      agy: { name: 'Antigravity', command: 'agy', args: [], icon: '🪐' },
    });
    await renderGate({ initialPath: '/workspace/' });
    await screen.findByRole('button', { name: 'Add Antigravity terminal' });

    fireEvent.keyDown(screen.getByPlaceholderText('workspace directory'), { key: 'a' });

    expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('4');
  });

  it('prevents suggestion mousedown from stealing focus and applies suggestion click', async () => {
    vi.mocked(window.electronAPI.readDirectory).mockImplementation(async (dirPath: string) => {
      const normalizedPath = dirPath.replace(/\\/g, '/');
      if (normalizedPath.endsWith('/projects/')) {
        return [{ name: 'alpha', isDirectory: true }];
      }
      return [];
    });

    await renderGate();

    const input = screen.getByPlaceholderText('workspace directory') as HTMLInputElement;
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

  it('switches location content and clears directory errors through the parent', async () => {
    const onTargetChange = vi.fn();
    const user = userEvent.setup();
    window.electronAPI.sshEnvironmentList = vi.fn().mockResolvedValue([{ id: 'alpha', kind: 'ssh', label: 'Alpha', target: 'alpha.example' }]);
    window.electronAPI.getEnvironmentHarnessOptions = vi.fn().mockResolvedValue({});
    window.electronAPI.sshGetHomeDirectory = vi.fn().mockResolvedValue({ homePath: '/home/alpha', initialPath: '/home/alpha' });
    vi.mocked(window.electronAPI.gitListWorktrees).mockResolvedValue({ success: true, worktrees: [
      { path: '/repo', branch: 'main', isMain: true, isLocked: false, isPrunable: false },
      { path: '/repo-worktrees/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false },
    ] });
    render(<WorkspaceGateContent onSubmit={mockOnSubmit} initialPath="/repo-worktrees/" onTargetChange={onTargetChange} />);
    await chooseBasicTerminal();
    await user.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This folder holds worktrees for repo');
    const beforeSwitch = onTargetChange.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
    await user.click(await screen.findByRole('button', { name: 'Alpha, alpha.example' }));
    expect(screen.getByLabelText('Remote Directory Path')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onTargetChange.mock.calls.length).toBeGreaterThan(beforeSwitch);
    await user.click(screen.getByRole('button', { name: 'Choose location: Alpha' }));
    await user.click(screen.getByRole('button', { name: /^This PC,/ }));
    expect(screen.getByLabelText('Workspace directory')).toBeInTheDocument();
  });

  it.each([['1', '1 terminal', 1], ['2', '2 terminals', 2], ['4', '4 terminals', 4]] as const)(
    'preserves the global %s shortcut and launched terminal count with a button focused', async (key, _label, count) => {
      const user = userEvent.setup();
      await renderGate({ initialPath: '/workspace/' });
      await screen.findByRole('button', { name: 'Add Codex terminal' });
      screen.getByRole('button', { name: 'Add Codex terminal' }).focus();
      await user.keyboard(key);
      expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent(String(count));
      await user.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ terminalCount: count }));
    },
  );

  it.each([true, false])('numeric shortcuts edit the focused/last-interacted row and preserve a mixed plan in fullscreen=%s', async (fullscreen) => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'codex' },
      pi: { name: 'Pi', command: 'pi', args: [], icon: 'pi' },
    });
    const user = userEvent.setup();
    await renderGate({ fullscreen, initialPath: '/workspace/' });
    const codex = await screen.findByRole('button', { name: 'Add Codex terminal' });
    await waitFor(() => expect(codex).toBeEnabled());
    await user.click(codex);
    await user.click(screen.getByRole('button', { name: 'Add Pi terminal' }));
    await user.keyboard('2');
    expect(screen.getByLabelText('Pi terminal count')).toHaveTextContent('2');
    expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('1');
    // Focus alone chooses a row, including the empty harness ID for plain shells.
    screen.getByRole('button', { name: 'Add Terminal terminal' }).focus();
    await user.keyboard('2');
    expect(screen.getByLabelText('Terminal terminal count')).toHaveTextContent('2');
    expect(screen.getByLabelText('Pi terminal count')).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ terminalCount: 5,
      terminalLaunches: [expect.objectContaining({ harness: 'codex' }),
        expect.objectContaining({ harness: 'pi' }), expect.objectContaining({ harness: 'pi' }),
        expect.objectContaining({ harness: '' }), expect.objectContaining({ harness: '' })] }));
    // Outside the list, numbers retain the last interacted row rather than Codex.
    await user.keyboard('4');
    expect(screen.getByLabelText('Terminal terminal count')).toHaveTextContent('4');
    expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('1');
    expect(screen.getByLabelText('Pi terminal count')).toHaveTextContent('2');
    // B explicitly collapses a mixed plan even when Terminal was last used.
    await user.keyboard('b');
    expect(screen.getByLabelText('Terminal terminal count')).toHaveTextContent('7');
    expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('0');
    expect(screen.getByLabelText('Pi terminal count')).toHaveTextContent('0');
  });

  it('bounds numeric row counts by the remaining capacity without reducing other rows', async () => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'codex' },
      pi: { name: 'Pi', command: 'pi', args: [], icon: 'pi' },
    });
    const user = userEvent.setup();
    await renderGate({ fullscreen: true, initialPath: '/workspace/' });
    const codex = await screen.findByRole('button', { name: 'Add Codex terminal' });
    await waitFor(() => expect(codex).toBeEnabled());
    for (let i = 0; i < 15; i++) await user.click(codex);
    await user.click(screen.getByRole('button', { name: 'Add Pi terminal' }));
    screen.getByRole('button', { name: 'Remove Pi terminal' }).focus();
    await user.keyboard('4');
    expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('15');
    expect(screen.getByLabelText('Pi terminal count')).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ terminalCount: 16 }));
  });

  it('keeps harness shortcuts and the basic-terminal empty domain value', async () => {
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({
      codex: { name: 'Codex', command: 'codex', args: [], icon: 'codex' },
      opencode: { name: 'OpenCode', command: 'opencode', args: [], icon: 'opencode' },
      pi: { name: 'Pi', command: 'pi', args: [], icon: 'pi' },
      agy: { name: 'Antigravity', command: 'agy', args: [], icon: 'agy' },
    });
    const user = userEvent.setup();
    await renderGate({ initialPath: '/workspace/' });
    await screen.findByRole('button', { name: 'Add Antigravity terminal' });
    screen.getByRole('button', { name: 'Add Codex terminal' }).focus();
    for (const [key, name, harness] of [['b', 'Terminal', ''], ['o', 'OpenCode', 'opencode'], ['p', 'Pi', 'pi'], ['a', 'Antigravity', 'agy'], ['c', 'Codex', 'codex']]) {
      await user.keyboard(key);
      expect(screen.getByLabelText(`${name} terminal count`)).toHaveTextContent('4');
      await user.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ harness }));
    }
    expect(mockOnSubmit).toHaveBeenCalledTimes(5);
    fireEvent.keyDown(window, { key: 'b' });
    await user.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ harness: '', model: undefined }));
  });

  it('does not apply launcher shortcuts from editable targets, modified or prevented events', async () => {
    await renderGate({ initialPath: '/workspace/' });
    await screen.findByRole('button', { name: 'Add Codex terminal' });
    const input = screen.getByPlaceholderText('workspace directory');
    for (const key of ['1', '2', 'b']) fireEvent.keyDown(input, { key });
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) fireEvent.keyDown(document.body, { key: '1', [modifier]: true });
    const prevented = new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true });
    prevented.preventDefault();
    fireEvent(document.body, prevented);
    expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('4');
    expect(screen.getByLabelText('Codex terminal count')).toHaveTextContent('4');
  });





  // =========================================================================
  // Model selector
  // =========================================================================



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
      window.electronAPI.getEnvironmentHarnessModels = vi.fn().mockResolvedValue([]);
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

    async function selectRemote(withPlan = true) {
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Alpha, alpha.example' }));
      await screen.findByRole('textbox', { name: 'Remote Directory Path' });
      if (withPlan) {
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Terminal terminal' })).toBeEnabled());
        fireEvent.keyDown(window, { key: '4' });
      }
    }

    it('uses one fullscreen location picker, searches servers, and preserves the local directory', async () => {
      setupRemote();
      await renderGate({ fullscreen: true });
      const localInput = screen.getByRole('textbox', { name: 'Workspace directory' });
      fireEvent.change(localInput, { target: { value: 'my-workspace' } });
      expect(screen.queryByRole('radio', { name: 'SSH Remote' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search locations' }), { target: { value: 'beta.example' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Beta, beta.example' }));
      await waitFor(() => expect(screen.getByText('/home/beta/workspaces/')).toBeTruthy());
      expect(screen.queryByRole('combobox')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: Beta' }));
      fireEvent.click(screen.getByRole('button', { name: /This PC/ }));
      expect(screen.getByRole('textbox', { name: 'Workspace directory' })).toHaveValue('my-workspace');
    });

    it('opens the selected server settings directly and applies its saved working directory', async () => {
      setupRemote();
      window.electronAPI.sshEnvironmentSave = vi.fn().mockImplementation(async (config) => ({ success: true, config }));
      await renderGate({ fullscreen: true });
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Alpha, alpha.example' }));
      await waitFor(() => expect(screen.getByText('/home/alpha/workspaces/')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: Alpha' }));
      fireEvent.click(screen.getByRole('button', { name: 'Settings for Alpha' }));
      expect(screen.getByLabelText('Label')).toHaveValue('Alpha');
      expect(screen.getByLabelText('SSH Target')).toHaveValue('alpha.example');
      fireEvent.change(screen.getByLabelText('Default workspace root (optional)'), { target: { value: '/srv/workspaces' } });
      vi.mocked(window.electronAPI.sshGetHomeDirectory).mockResolvedValue({ homePath: '/home/alpha', initialPath: '/srv/workspaces' });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage SSH Targets' })).toBeNull());
      await waitFor(() => expect(screen.getByText('/srv/workspaces/')).toBeTruthy());
      expect(window.electronAPI.sshEnvironmentSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'alpha', defaultWorkspaceRoot: '/srv/workspaces' }));
    });

    it.each([true, false])('opens the host-resolved SSH base with a blank field in fullscreen=%s', async (fullscreen) => {
      setupRemote();
      await renderGate({ fullscreen });
      await selectRemote();
      await screen.findByText('/home/alpha/workspaces/');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
      expect(screen.getByLabelText('Remote Directory Path')).toHaveValue('');
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/home/alpha/workspaces', environmentId: 'alpha' }));
      fireEvent.change(screen.getByLabelText('Remote Directory Path'), { target: { value: '  ' } });
      fireEvent.keyDown(screen.getByLabelText('Remote Directory Path'), { key: 'Enter' });
      expect(mockOnSubmit).toHaveBeenCalledTimes(2);
    });

    it('resolves fullscreen SSH workspace names beneath the displayed host-resolved root', async () => {
      setupRemote();
      await renderGate({ fullscreen: true });
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Alpha, alpha.example' }));
      await screen.findByText('/home/alpha/workspaces/');
      const input = screen.getByLabelText('Remote Directory Path');
      expect(input).toHaveValue('');
      expect(input).toHaveAttribute('placeholder', 'workspace directory');
      await chooseBasicTerminal();
      fireEvent.change(input, { target: { value: 'clanker-test' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/home/alpha/workspaces/clanker-test', environmentId: 'alpha' }));
      await userEvent.setup().clear(input);
      await userEvent.setup().type(input, '/home/alpha/workspaces/another-test');
      expect(input).toHaveValue('/home/alpha/workspaces/another-test');
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/home/alpha/workspaces/another-test', environmentId: 'alpha' }));
    });

    it('resolves an early relative entry only after the authoritative SSH starting directory arrives', async () => {
      setupRemote();
      let finish!: (result: { homePath: string; initialPath: string }) => void;
      vi.mocked(window.electronAPI.sshGetHomeDirectory).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      await renderGate({ fullscreen: true });
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Alpha, alpha.example' }));
      await chooseBasicTerminal();
      fireEvent.change(screen.getByLabelText('Remote Directory Path'), { target: { value: 'clanker-test' } });
      expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Browse remote directories' })).toBeDisabled();
      await act(async () => { finish({ homePath: '/home/alpha', initialPath: '/canonical/workspaces' }); });
      await screen.findByText('/canonical/workspaces/');
      expect(screen.getByLabelText('Remote Directory Path')).toHaveValue('clanker-test');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: '/canonical/workspaces/clanker-test' }));
    });

    it('does not apply a late starting directory from a previously selected SSH server', async () => {
      setupRemote();
      let finishAlpha!: (result: { homePath: string; initialPath: string }) => void;
      const alphaResult = new Promise<{ homePath: string; initialPath: string }>((resolve) => { finishAlpha = resolve; });
      vi.mocked(window.electronAPI.sshGetHomeDirectory).mockImplementation((id) => id === 'alpha'
        ? alphaResult : Promise.resolve({ homePath: '/home/beta', initialPath: '/canonical/beta' }));
      await renderGate({ fullscreen: true });
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Alpha, alpha.example' }));
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: Alpha' }));
      fireEvent.click(screen.getByRole('button', { name: 'Beta, beta.example' }));
      await screen.findByText('/canonical/beta/');
      await chooseBasicTerminal();
      fireEvent.change(screen.getByLabelText('Remote Directory Path'), { target: { value: '/opt/manual' } });
      await act(async () => { finishAlpha({ homePath: '/home/alpha', initialPath: '/canonical/alpha' }); });
      expect(screen.queryByText('/canonical/alpha/')).toBeNull();
      expect(screen.getByLabelText('Remote Directory Path')).toHaveValue('/opt/manual');
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: '/opt/manual', environmentId: 'beta' }));
    });

    it('browses from the SSH starting directory and keeps the selected child compact', async () => {
      setupRemote();
      vi.mocked(window.electronAPI.sshListDirectories).mockImplementation(async (_id, directory) => ({
        path: directory, parentPath: '/home/alpha', directories: directory === '/home/alpha/workspaces'
          ? [{ name: 'clanker-test', path: '/home/alpha/workspaces/clanker-test' }] : [],
      }));
      await renderGate({ fullscreen: true });
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Alpha, alpha.example' }));
      await screen.findByText('/home/alpha/workspaces/');
      fireEvent.click(screen.getByRole('button', { name: 'Browse remote directories' }));
      fireEvent.click(await screen.findByRole('button', { name: 'clanker-test' }));
      await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenLastCalledWith('alpha', '/home/alpha/workspaces/clanker-test'));
      fireEvent.click(screen.getByRole('button', { name: 'Select this directory' }));
      expect(screen.getByLabelText('Remote Directory Path')).toHaveValue('clanker-test');
      expect(screen.getByText('/home/alpha/workspaces/')).toBeTruthy();
    });

    it('adds a server from This PC and selects it without an intermediate SSH view', async () => {
      setupRemote();
      window.electronAPI.sshEnvironmentSave = vi.fn().mockImplementation(async (config) => ({ success: true, config }));
      await renderGate({ fullscreen: true });
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add server…' }));
      fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'New server' } });
      fireEvent.change(screen.getByLabelText('SSH Target'), { target: { value: 'new.example' } });
      fireEvent.change(screen.getByLabelText('Default workspace root (optional)'), { target: { value: '/srv/workspaces' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Target' }));
      await screen.findByRole('button', { name: 'Choose location: New server' });
      expect(screen.queryByRole('dialog', { name: 'Manage SSH Targets' })).toBeNull();
      expect(screen.getByLabelText('Remote Directory Path')).toBeTruthy();
    });

    it('allows zero-terminal SSH worktree management and blocks launch actions before creation', async () => {
      setupRemote();
      const source = createWorkspaceFixture({ id: 'alpha-repo', environmentId: 'alpha', workspacePath: '/repo' });
      const worktree = { path: '/remote-task', branch: 'task', isMain: false, isLocked: false, isPrunable: false };
      useWorkspaceStore.setState({ workspaces: [source], activeWorkspaceId: source.id });
      vi.mocked(window.electronAPI.gitListWorktrees).mockResolvedValue({ success: true, worktrees: [worktree] });
      window.electronAPI.gitCreateWorktree = vi.fn();
      window.electronAPI.gitInspectWorktree = vi.fn().mockResolvedValue({ success: true, worktree, hasChanges: false });
      window.electronAPI.gitRemoveWorktree = vi.fn().mockResolvedValue({ success: true, recoveryPath: '/recovery/task' });
      await renderGate({ fullscreen: true });
      await selectRemote(false);
      await openWorktreeOptions();
      await screen.findByText('/remote-task');
      expect(screen.getByText(/Select at least one terminal/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Worktree branch'), { target: { value: 'new-task' } });
      const create = screen.getByRole('button', { name: 'Create and open worktree' });
      const open = screen.getByRole('button', { name: 'Open' });
      expect(create).toBeDisabled();
      expect(open).toBeDisabled();
      fireEvent.click(create);
      fireEvent.click(open);
      expect(window.electronAPI.gitCreateWorktree).not.toHaveBeenCalled();
      expect(mockOnSubmit).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Inspect /remote-task' }));
      await screen.findByText('Checkout is clean.');
      fireEvent.click(screen.getByRole('button', { name: 'Remove /remote-task' }));
      await screen.findByRole('dialog', { name: 'Confirm remote worktree removal' });
      fireEvent.click(screen.getByRole('button', { name: 'Remove this worktree' }));
      await waitFor(() => expect(window.electronAPI.gitRemoveWorktree).toHaveBeenCalledWith('/repo', '/remote-task', 'task', [], source.id));
    });

    it('keeps SSH Worktree entry disabled without an open repository on the target', async () => {
      setupRemote();
      await renderGate({ fullscreen: true });
      await selectRemote(false);
      expect(screen.getByRole('button', { name: 'Worktree options' })).toBeDisabled();
    });

    it('discovers from an open repository on the selected target and opens a checkout in that environment', async () => {
      setupRemote();
      const source = createWorkspaceFixture({ id: 'alpha-repo', environmentId: 'alpha', workspacePath: '/repo' });
      const otherHost = createWorkspaceFixture({ id: 'beta-repo', environmentId: 'beta', workspacePath: '/repo' });
      const local = createWorkspaceFixture({ id: 'local-repo', environmentId: 'local', workspacePath: '/repo' });
      useWorkspaceStore.setState({ workspaces: [source, otherHost, local], activeWorkspaceId: otherHost.id });
      vi.mocked(window.electronAPI.gitListWorktrees).mockResolvedValue({ success: true, worktrees: [{ path: '/remote-task', branch: 'task', isMain: false, isLocked: false, isPrunable: false }] });
      await renderGate();
      await selectRemote();
      fireEvent.click(screen.getByRole('button', { name: 'Worktree options' }));
      await screen.findByText('/remote-task');
      expect(screen.getByLabelText('Open SSH repository')).toHaveValue(source.id);
      expect(screen.getAllByRole('option').filter((option) => option.parentElement?.id === 'remote-worktree-repository')).toHaveLength(1);
      expect(window.electronAPI.gitListWorktrees).toHaveBeenCalledWith('/repo', source.id);
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: '/remote-task', environmentId: 'alpha', environmentLabel: 'Alpha' }));
      expect(screen.getByText('Create and open worktree')).toBeDisabled();
    });



    it('rediscovers harnesses after editing the selected host and blocks launching stale choices while loading', async () => {
      setupRemote();
      window.electronAPI.sshEnvironmentSave = vi.fn().mockImplementation(async (config) => ({ success: true, config }));
      let resolveNew!: (value: { pi: boolean }) => void;
      const newDiscovery = new Promise<{ pi: boolean }>((resolve) => { resolveNew = resolve; });
      vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockResolvedValueOnce({ codex: true }).mockReturnValueOnce(newDiscovery);
      await renderGate();
      await selectRemote();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Add Codex terminal' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: Alpha' }));
      fireEvent.click(screen.getByRole('button', { name: 'Settings for Alpha' }));
      fireEvent.change(screen.getByLabelText('SSH Target'), { target: { value: 'new-alpha.example' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(window.electronAPI.getEnvironmentHarnessOptions).toHaveBeenCalledTimes(2));
      expect(window.electronAPI.getEnvironmentHarnessOptions).toHaveBeenLastCalledWith('alpha');
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull());
      expect(screen.queryByRole('button', { name: 'Add Codex terminal' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeDisabled();
      fireEvent.keyDown(screen.getByLabelText('Remote Directory Path'), { key: 'Enter' });
      expect(mockOnSubmit).not.toHaveBeenCalled();
      await act(async () => resolveNew({ pi: true }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Add Pi terminal' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Add Pi terminal' }));
      fireEvent.change(screen.getByLabelText('Remote Directory Path'), { target: { value: 'project' } });
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'alpha', harness: 'pi' }));
    });

    it('ignores a previous host discovery response after a same-ID target edit', async () => {
      setupRemote();
      window.electronAPI.sshEnvironmentSave = vi.fn().mockImplementation(async (config) => ({ success: true, config }));
      let resolveOld!: (value: { codex: boolean }) => void;
      const oldDiscovery = new Promise<{ codex: boolean }>((resolve) => { resolveOld = resolve; });
      vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockReturnValueOnce(oldDiscovery).mockResolvedValueOnce({ pi: true });
      await renderGate();
      await selectRemote(false);
      await waitFor(() => expect(window.electronAPI.getEnvironmentHarnessOptions).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Choose location: Alpha' }));
      fireEvent.click(screen.getByRole('button', { name: 'Settings for Alpha' }));
      fireEvent.change(screen.getByLabelText('SSH Target'), { target: { value: 'new-alpha.example' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Add Pi terminal' })).toBeEnabled());
      await act(async () => resolveOld({ codex: true }));
      expect(screen.queryByRole('button', { name: 'Add Codex terminal' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Add Pi terminal' })).toBeEnabled();
    });

    it('launches remote harnesses with the host default and never the desktop model', async () => {
      setupRemote();
      vi.mocked(window.electronAPI.getHarnessDefaults).mockResolvedValue({ codex: { model: 'local-only', favorites: ['local-only'], flags: '' } });
      vi.mocked(window.electronAPI.getEnvironmentHarnessModels).mockImplementation(async (_id, harness) => harness === 'codex'
        ? [{ id: 'remote-a', label: 'Remote A' }, { id: 'remote-b', label: 'Remote B' }] : []);
      await renderGate();
      await selectRemote(false);
      await waitFor(() => expect(screen.getByRole('button', { name: 'codex model' })).toHaveTextContent('Use harness default'));
      expect(screen.queryByRole('button', { name: 'pi model' })).toBeNull();
      expect(screen.getAllByText('Host default').length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: 'Add Codex terminal' }));
      fireEvent.change(screen.getByLabelText('Remote Directory Path'), { target: { value: '/srv/app' } });
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({
        terminalLaunches: [{ harness: 'codex', model: undefined }],
      }));
    });

    it('places an explicitly chosen remote model into the launch plan and drops it when the host changes', async () => {
      setupRemote();
      vi.mocked(window.electronAPI.getEnvironmentHarnessModels).mockImplementation(async (id, harness) => harness === 'codex'
        ? [{ id: `${id}-model`, label: `${id} model label` }] : []);
      const user = userEvent.setup();
      await renderGate();
      await selectRemote(false);
      expect(window.electronAPI.getEnvironmentHarnessModels).toHaveBeenCalledWith('alpha', 'codex');
      await user.click(await screen.findByRole('button', { name: 'codex model' }));
      await user.click(await screen.findByText('alpha model label'));
      await waitFor(() => expect(screen.getByRole('button', { name: 'codex model' })).toHaveTextContent('alpha model label'));
      fireEvent.click(screen.getByRole('button', { name: 'Add Codex terminal' }));
      fireEvent.change(screen.getByLabelText('Remote Directory Path'), { target: { value: '/srv/app' } });
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({
        terminalLaunches: [{ harness: 'codex', model: 'alpha-model' }],
      }));

      fireEvent.click(document.querySelector('.gate-target-trigger')!);
      fireEvent.click(await screen.findByRole('button', { name: 'Beta, beta.example' }));
      await waitFor(() => expect(window.electronAPI.getEnvironmentHarnessModels).toHaveBeenCalledWith('beta', 'codex'));
      await waitFor(() => expect(screen.getByRole('button', { name: 'codex model' })).toHaveTextContent('Use harness default'));
      fireEvent.click(screen.getByRole('button', { name: 'Add Codex terminal' }));
      fireEvent.change(screen.getByLabelText('Remote Directory Path'), { target: { value: '/srv/app' } });
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      expect(mockOnSubmit).toHaveBeenLastCalledWith(expect.objectContaining({
        terminalLaunches: [{ harness: 'codex', model: undefined }],
      }));
    });

    it('keeps Host default when remote discovery is empty or fails, and never asks for Hermes', async () => {
      setupRemote();
      window.electronAPI.getEnvironmentHarnessOptions = vi.fn().mockResolvedValue({
        codex: { name: 'Codex', command: 'codex', args: [], icon: 'codex' },
        pi: { name: 'Pi', command: 'pi', args: [], icon: 'pi' },
        hermes: { name: 'Hermes', command: 'hermes', args: [], icon: 'hermes' },
      });
      vi.mocked(window.electronAPI.getEnvironmentHarnessModels).mockImplementation(async (_id, harness) => {
        if (harness === 'pi') throw new Error('ssh down');
        return [];
      });
      await renderGate();
      await selectRemote(false);
      await waitFor(() => expect(window.electronAPI.getEnvironmentHarnessModels).toHaveBeenCalledWith('alpha', 'pi'));
      await waitFor(() => expect(screen.getAllByText('Host default').length).toBeGreaterThan(0));
      expect(screen.queryByRole('button', { name: 'codex model' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'pi model' })).toBeNull();
      expect(vi.mocked(window.electronAPI.getEnvironmentHarnessModels).mock.calls.map((call) => call[1])).not.toContain('hermes');
    });

    it('initializes each target separately and ignores a previous target home request', async () => {
      setupRemote();
      let resolveAlpha!: (value: { homePath: string; initialPath: string }) => void;
      const alphaHome = new Promise<{ homePath: string; initialPath: string }>((resolve) => { resolveAlpha = resolve; });
      vi.mocked(window.electronAPI.sshGetHomeDirectory).mockImplementation((id) => id === 'alpha'
        ? alphaHome
        : Promise.resolve({ homePath: '/home/beta', initialPath: '/home/beta/workspaces' }));
      await renderGate();
      await selectRemote();
      await waitFor(() => expect(window.electronAPI.sshGetHomeDirectory).toHaveBeenCalledWith('alpha'));
      fireEvent.click(document.querySelector('.gate-target-trigger')!);
      fireEvent.click(await screen.findByRole('button', { name: 'Beta, beta.example' }));
      const input = screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement;
      await waitFor(() => expect(input.value).toBe(''));
      await act(async () => resolveAlpha({ homePath: '/home/alpha', initialPath: '/home/alpha/workspaces' }));
      expect(input.value).toBe('');
    });

    it('keeps manual input despite late home results, and launches with the selected harness', async () => {
      setupRemote();
      let resolveHome!: (value: { homePath: string; initialPath: string }) => void;
      const home = new Promise<{ homePath: string; initialPath: string }>((resolve) => { resolveHome = resolve; });
      vi.mocked(window.electronAPI.sshGetHomeDirectory).mockImplementation(() => home);
      await renderGate();
      await selectRemote();
      const input = screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/opt/custom-project' } });
      await act(async () => resolveHome({ homePath: '/home/alpha', initialPath: '/home/alpha/workspaces' }));
      expect(input.value).toBe('/opt/custom-project');
      fireEvent.keyDown(window, { key: 'p' });
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
      await renderGate();
      await selectRemote();
      const input = screen.getByRole('textbox', { name: 'Remote Directory Path' });
      await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '/home/alpha/ol' } });
      await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenCalledWith('alpha', '/home/alpha/'));
      fireEvent.click(document.querySelector('.gate-target-trigger')!);
      fireEvent.click(await screen.findByRole('button', { name: 'Beta, beta.example' }));
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe(''));
      await act(async () => resolveOld({ path: '/home/alpha', parentPath: '/home', directories: [{ name: 'old', path: '/home/alpha/old' }] }));
      expect(screen.queryByText('/home/alpha/old')).toBeNull();
      const betaInput = screen.getByRole('textbox', { name: 'Remote Directory Path' });
      fireEvent.focus(betaInput);
      fireEvent.change(betaInput, { target: { value: '/home/beta/ne' } });
      const suggestion = await screen.findByText('/home/beta/new/');
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
      await renderGate();
      await selectRemote();
      const input = screen.getByRole('textbox', { name: 'Remote Directory Path' });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '/home/alpha/workspaces/' } });
      expect(await screen.findByText('clanker-test/')).toBeTruthy();
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
      await renderGate();
      await selectRemote();
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe(''));
      fireEvent.click(screen.getByRole('button', { name: 'Browse remote directories' }));
      expect(within(screen.getByRole('dialog', { name: 'Browse remote directories' })).getByRole('status')).toHaveTextContent('Loading directories');
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
      await renderGate();
      await selectRemote();
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe(''));
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
      await renderGate();
      await selectRemote();
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe(''));
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
      await renderGate();
      await selectRemote();
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe(''));
      fireEvent.click(screen.getByRole('button', { name: 'Browse remote directories' }));
      await waitFor(() => expect(window.electronAPI.sshListDirectories).toHaveBeenCalledWith('alpha', '/home/alpha/workspaces'));
      fireEvent.click(document.querySelector('.gate-target-trigger')!);
      fireEvent.click(await screen.findByRole('button', { name: 'Beta, beta.example' }));
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe(''));
      await act(async () => resolveAlpha({ path: '/home/alpha/workspaces', parentPath: '/home/alpha', directories: [{ name: 'old', path: '/home/alpha/workspaces/old' }] }));
      expect(screen.queryByText('old')).toBeNull();
      expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe('');
    });

    it('submits New Folder once while the request is pending and restores focus after closing', async () => {
      setupRemote();
      let resolveCreate!: (value: { path: string }) => void;
      vi.mocked(window.electronAPI.sshCreateDirectory).mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
      await renderGate();
      await selectRemote();
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'Remote Directory Path' }) as HTMLInputElement).value).toBe(''));
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
      await renderGate();
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
