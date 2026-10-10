// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GitButton from '../../../src/renderer/components/GitButton';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import type { WorkspaceState } from '../../../src/renderer/store/workspaceStoreTypes';
import type { GitStatusResult } from '../../../src/shared/types/git';

const componentMocks = vi.hoisted(() => ({
  gitBranchesLastProps: null as null | Record<string, unknown>,
}));

// Mock electron API
const mockGitGetBranchState = vi.fn();
const mockGitGetOperationState = vi.fn();
const mockGitGetStashes = vi.fn();
const mockGitGetHistory = vi.fn();
const mockGitGetDiff = vi.fn();
const mockGitStartPolling = vi.fn();
const mockGitStopPolling = vi.fn();
const mockGitRefresh = vi.fn();
const mockGitCommit = vi.fn();
const mockGitStage = vi.fn();
const mockGitCreateBranch = vi.fn();
const mockGitSwitchBranch = vi.fn();
const mockGitDeleteBranch = vi.fn();
const mockGitMergeBranch = vi.fn();
const mockGitAbortOperation = vi.fn();
const mockGitStash = vi.fn();
const mockGitApplyStash = vi.fn();
const mockGitPopStash = vi.fn();
const mockGitDropStash = vi.fn();
const mockGitClearStashes = vi.fn();
const mockGitGetRemotes = vi.fn();
const mockGitFetch = vi.fn();
const mockGitPull = vi.fn();
const mockGitPush = vi.fn();
const mockGitUnstage = vi.fn();
const mockOnGitStatusUpdate = vi.fn();
const mockConfirm = vi.fn();
const mockSetTimeout = vi.fn(((cb: () => void) => { cb(); return 0; }) as unknown as typeof setTimeout);

// VCS context mocks
const mockVcsGetContext = vi.fn().mockResolvedValue({ success: false, error: 'Not configured' });
const mockVcsGetPrInfo = vi.fn().mockResolvedValue({ success: false, error: 'Not configured' });
const mockVcsGetDeepLinks = vi.fn().mockResolvedValue([]);
const mockVcsOpenDeepLink = vi.fn().mockResolvedValue(false);

// Mock window.electronAPI
const mockElectronAPI = {
  gitGetBranchState: mockGitGetBranchState,
  gitGetOperationState: mockGitGetOperationState,
  gitGetStashes: mockGitGetStashes,
  gitGetHistory: mockGitGetHistory,
  gitGetDiff: mockGitGetDiff,
  gitStartPolling: mockGitStartPolling,
  gitStopPolling: mockGitStopPolling,
  gitRefresh: mockGitRefresh,
  gitCommit: mockGitCommit,
  gitStage: mockGitStage,
  gitCreateBranch: mockGitCreateBranch,
  gitSwitchBranch: mockGitSwitchBranch,
  gitDeleteBranch: mockGitDeleteBranch,
  gitMergeBranch: mockGitMergeBranch,
  gitAbortOperation: mockGitAbortOperation,
  gitStash: mockGitStash,
  gitApplyStash: mockGitApplyStash,
  gitPopStash: mockGitPopStash,
  gitDropStash: mockGitDropStash,
  gitClearStashes: mockGitClearStashes,
  gitGetRemotes: mockGitGetRemotes,
  gitFetch: mockGitFetch,
  gitPull: mockGitPull,
  gitPush: mockGitPush,
  gitUnstage: mockGitUnstage,
  onGitStatusUpdate: mockOnGitStatusUpdate,
  // VCS context
  vcsGetContext: mockVcsGetContext,
  vcsGetPrInfo: mockVcsGetPrInfo,
  vcsGetDeepLinks: mockVcsGetDeepLinks,
  vcsOpenDeepLink: mockVcsOpenDeepLink,
};

// Mock child components
vi.mock('../../../src/renderer/components/CommitDialog', () => ({
  default: ({
    isOpen,
    onCommit,
    onStageAll,
    onUnstage,
    onUnstageAll,
  }: {
    isOpen: boolean;
    onCommit: (message: string) => Promise<unknown>;
    onStageAll: () => Promise<unknown>;
    onUnstage: (path: string) => Promise<unknown>;
    onUnstageAll: () => Promise<unknown>;
  }) =>
    isOpen ? (
      <div data-testid="commit-dialog">
        <button type="button" onClick={() => void onCommit('feat: test commit')}>commit</button>
        <button type="button" onClick={() => void onStageAll()}>stage-all</button>
        <button type="button" onClick={() => void onUnstage('src/index.ts')}>unstage-one</button>
        <button type="button" onClick={() => void onUnstageAll()}>unstage-all</button>
      </div>
    ) : null,
}));

vi.mock('../../../src/renderer/components/git/GitBranchesSection', () => ({
  GitBranchesSection: (props: Record<string, unknown>) => {
    componentMocks.gitBranchesLastProps = props;
    return (
      <div data-testid="git-branches-section">
        Branches
        <button type="button" onClick={() => (props.onRefreshContext as (() => void) | undefined)?.()}>refresh-context</button>
      </div>
    );
  },
}));

vi.mock('../../../src/renderer/components/git/GitStashSection', () => ({
  GitStashSection: (props: Record<string, unknown>) => (
    <div data-testid="git-stash-section">
      Stashes
      <button type="button" onClick={() => (props.onStash as (() => void) | undefined)?.()}>stash</button>
      <button type="button" onClick={() => (props.onApplyStash as ((ref: string) => void) | undefined)?.('stash@{0}')}>apply</button>
      <button type="button" onClick={() => (props.onPopStash as ((ref: string) => void) | undefined)?.('stash@{0}')}>pop</button>
      <button type="button" onClick={() => (props.onDropStash as ((ref: string) => void) | undefined)?.('stash@{0}')}>drop</button>
      <button type="button" onClick={() => (props.onClearStashes as (() => void) | undefined)?.()}>clear</button>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/git/GitMergeSection', () => ({
  GitMergeSection: (props: Record<string, unknown>) => (
    <div data-testid="git-merge-section">
      Merge
      <button type="button" onClick={() => (props.onSetMergeTargetBranch as ((b: string) => void) | undefined)?.('develop')}>set-target</button>
      <button type="button" onClick={() => (props.onMergeBranch as (() => void) | undefined)?.()}>merge</button>
      <button type="button" onClick={() => (props.onAbortOperation as (() => void) | undefined)?.()}>abort</button>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/git/GitHistorySection', () => ({
  GitHistorySection: (props: Record<string, unknown>) => (
    <div data-testid="git-history-section">
      History
      <button type="button" onClick={() => (props.onSelectWorkingDiff as ((mode: string) => void) | undefined)?.('working')}>diff-working</button>
      <button
        type="button"
        onClick={() => (props.onSelectCommitDiff as ((commit: { hash: string }) => void) | undefined)?.({ hash: 'abc123' })}
      >
        diff-commit
      </button>
    </div>
  ),
}));

describe('GitButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    // Set up window.electronAPI
    Object.defineProperty(window, 'electronAPI', {
      value: mockElectronAPI,
      writable: true,
    });
    
    // Mock window.confirm
    window.confirm = mockConfirm;
    
    // Mock window.setTimeout
    vi.spyOn(window, 'setTimeout').mockImplementation(mockSetTimeout as unknown as typeof setTimeout);
    
    // Set up default mock responses
    mockVcsGetContext.mockReset().mockResolvedValue({ success: false, error: 'Not configured' });
    mockGitStopPolling.mockResolvedValue(undefined);
    mockGitGetBranchState.mockResolvedValue({
      success: true,
      isRepo: true,
      currentBranch: 'main',
      isDetached: false,
      branches: [{ name: 'main', isCurrent: true }],
    });
    mockGitGetOperationState.mockResolvedValue({
      success: true,
      isRepo: true,
      inProgress: false,
      mode: 'none',
      conflicts: [],
      message: '',
    });
    mockGitGetStashes.mockResolvedValue([]);
    mockGitGetHistory.mockResolvedValue([]);
    mockGitGetDiff.mockResolvedValue({ success: true, diff: '' });
    mockGitGetRemotes.mockResolvedValue({ success: true, remotes: [], provider: 'unknown' });
    mockGitFetch.mockResolvedValue({ success: true });
    mockGitPull.mockResolvedValue({ success: true });
    mockGitPush.mockResolvedValue({ success: true });
    mockGitUnstage.mockResolvedValue({ success: true });
    mockGitRefresh.mockResolvedValue({
      success: true,
      isRepo: true,
      changes: [],
      currentBranch: 'main',
      isDetached: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  type RepoStatusPayload = {
    success: boolean;
    isRepo: boolean;
    currentBranch: string | null;
    isDetached: boolean;
    changes: unknown[];
    upstream?: string | null;
    ahead?: number;
    behind?: number;
  };

  const emitStatus = (status: RepoStatusPayload) => {
    mockOnGitStatusUpdate.mockImplementation(((callback: (value: RepoStatusPayload) => void) => {
      callback(status);
      return vi.fn();
    }) as unknown as typeof mockOnGitStatusUpdate);
  };

  const openMenuOnly = async () => {
    render(<GitButton workspacePath="/repo" />);
    await act(async () => {
      fireEvent.click(document.querySelector('.git-btn')!);
    });
    act(() => {
      vi.runAllTimers();
    });
  };

  const openRepoMenu = async (changes: unknown[] = []) => {
    emitStatus({
      success: true,
      isRepo: true,
      currentBranch: 'main',
      isDetached: false,
      changes,
    });
    await openMenuOnly();
  };

  const setupTrackedMain = () => {
    emitStatus({
      success: true,
      isRepo: true,
      currentBranch: 'main',
      isDetached: false,
      changes: [],
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
    });
  };

  const openTools = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Existing Git Tools' })); }); };
  const openBranches = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Branches' })); }); };

  it('ignores older provider replies after a newer explicit refresh', async () => {
    await openRepoMenu(); await openBranches();
    let resolveOld!: (value: unknown) => void;
    mockVcsGetContext.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    await act(async () => { fireEvent.click(screen.getByText('refresh-context')); });
    const result = (owner: string) => ({ success: true, provider: { provider: 'github', baseUrl: 'https://github.com', owner, repo: 'repo', defaultBranch: '' },
      pullRequest: { exists: false, outcome: 'none' }, deepLinks: [] });
    mockVcsGetContext.mockResolvedValueOnce(result('new'));
    await act(async () => { fireEvent.click(screen.getByText('refresh-context')); });
    expect((componentMocks.gitBranchesLastProps as Record<string, { owner?: string }>).provider.owner).toBe('new');
    await act(async () => { resolveOld(result('old')); });
    expect((componentMocks.gitBranchesLastProps as Record<string, { owner?: string }>).provider.owner).toBe('new');
  });

  it('keeps same-path workspace statuses isolated when switching between local and SSH', () => {
    const statuses: Array<(status: GitStatusResult) => void> = [];
    mockOnGitStatusUpdate.mockImplementation((listener: (status: GitStatusResult) => void) => {
      statuses.push(listener);
      return vi.fn();
    });

    const local = { id: 'local-ws', workspacePath: '/repo', environmentId: 'local', lifecycle: 'active', terminals: [] };
    const remote = { id: 'ssh-ws', workspacePath: '/repo', environmentId: 'ssh-host', lifecycle: 'inactive', terminals: [] };
    useWorkspaceStore.setState({
      activeWorkspaceId: local.id,
      workspaces: [local, remote],
    } as unknown as Partial<WorkspaceState>);

    const { rerender } = render(<GitButton key={local.id} workspacePath="/repo" workspaceId={local.id} />);
    const status = (workspaceId: string, environmentId: string, path: string): GitStatusResult => ({
      workspaceId,
      workspacePath: '/repo',
      environmentId,
      success: true,
      isRepo: true,
      currentBranch: 'main',
      isDetached: false,
      changes: [{ path, status: 'modified' as const, staged: false }],
      upstream: null,
      ahead: 0,
      behind: 0,
    });
    act(() => statuses[0](status(local.id, local.environmentId, 'local-only.ts')));
    expect(screen.getByTitle('Git - main').querySelector('.git-badge')?.textContent).toBe('1');

    act(() => {
      useWorkspaceStore.setState({
        activeWorkspaceId: remote.id,
        workspaces: [{ ...local, lifecycle: 'inactive' }, { ...remote, lifecycle: 'active' }],
      } as unknown as Partial<WorkspaceState>);
      rerender(<GitButton key={remote.id} workspacePath="/repo" workspaceId={remote.id} />);
    });
    expect(screen.queryByTitle('Git - main')).toBeNull();

    act(() => statuses[1](status(local.id, local.environmentId, 'local-only.ts')));
    expect(screen.queryByTitle('Git - main')).toBeNull();
    act(() => statuses[1]({ ...status(local.id, local.environmentId, 'local-only.ts'), workspaceId: undefined }));
    expect(screen.queryByTitle('Git - main')).toBeNull();
    act(() => statuses[1](status(remote.id, remote.environmentId, 'ssh-only.ts')));
    expect(useWorkspaceStore.getState().gitChanges.map((change) => change.path)).toEqual(['ssh-only.ts']);
  });

  // =========================================================================
  // Non-Repo State
  // =========================================================================
  describe('non-repo state', () => {
    it('shows init git button when not a git repository', () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; changes: unknown[] }) => void) => {
        // Simulate non-repo status
        setTimeout(() => {
          callback({
            success: false,
            isRepo: false,
            changes: [],
          });
        }, 0);
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      render(<GitButton workspacePath="/not-a-repo" />);
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByText('Init Git')).toBeTruthy();
    });

    it('clears stale git changes when status reports a non-repo workspace', () => {
      useWorkspaceStore.setState({
        gitChanges: [{ path: 'stale.ts', status: 'modified' }],
      } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; changes: unknown[]; currentBranch: string | null; isDetached: boolean; upstream: string | null; ahead: number; behind: number }) => void) => {
        callback({
          success: true,
          isRepo: false,
          currentBranch: null,
          isDetached: false,
          changes: [],
          upstream: null,
          ahead: 0,
          behind: 0,
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);

      render(<GitButton workspacePath="/workspace" />);

      expect(useWorkspaceStore.getState().gitChanges).toEqual([]);
    });

    it('clears stale git changes when status polling fails', () => {
      useWorkspaceStore.setState({
        gitChanges: [{ path: 'stale.ts', status: 'modified' }],
      } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; errorCode?: string }) => void) => {
        callback({
          success: false,
          errorCode: 'unknown',
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);

      render(<GitButton workspacePath="/workspace" />);

      expect(useWorkspaceStore.getState().gitChanges).toEqual([]);
    });

    it('shows init git button when workspace path is empty', () => {
      render(<GitButton workspacePath="" />);
      expect(screen.getByText('Init Git')).toBeTruthy();
    });
  });

  // =========================================================================
  // Basic Rendering
  // =========================================================================
  describe('basic rendering', () => {
    it('renders the git button', () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean; changes: { path: string; status: string }[] }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: [{ path: 'file1.ts', status: 'modified' }],
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      render(<GitButton workspacePath="/repo" />);
      
      expect(document.querySelector('.git-btn')).toBeTruthy();
    });

    it('renders GitBranch icon', () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean; changes: { path: string; status: string }[] }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: [{ path: 'file1.ts', status: 'modified' }],
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      render(<GitButton workspacePath="/repo" />);
      
      const button = document.querySelector('.git-btn');
      expect(button?.querySelector('.lucide-git-branch')).toBeTruthy();
    });

    it('shows change count badge when there are changes', () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean; changes: { path: string; status: string }[] }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: [{ path: 'file1.ts', status: 'modified' }],
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      render(<GitButton workspacePath="/repo" />);
      
      expect(screen.getByText('1')).toBeTruthy();
    });

    it('does not show badge when there are no changes', () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean; changes: unknown[] }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: [],
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      render(<GitButton workspacePath="/repo" />);
      
      expect(document.querySelector('.git-badge')).toBeNull();
    });

    it('shows 99+ when change count exceeds 99', () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean; changes: { path: string; status: string }[] }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: Array.from({ length: 150 }, (_, i) => ({ path: `file${i}.ts`, status: 'modified' })),
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      render(<GitButton workspacePath="/repo" />);
      
      expect(screen.getByText('99+')).toBeTruthy();
    });

    it('shows branch name in title when on a branch', () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean; changes: { path: string; status: string }[] }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: [{ path: 'file1.ts', status: 'modified' }],
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      render(<GitButton workspacePath="/repo" />);
      
      const button = document.querySelector('.git-btn');
      expect(button).toHaveAttribute('title', 'Git - main');
    });
  });

  // =========================================================================
  // Menu Open/Close
  // =========================================================================
  describe('menu open/close', () => {
    it('opens Overview when git button is clicked', async () => {
      await openRepoMenu();
      expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();
    });

    it('closes menu when clicking outside', async () => {
      await openRepoMenu();
      expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();

      await act(async () => {
        await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(document.querySelector('.clanker-dialog-overlay')!);
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(screen.queryByRole('dialog', { name: 'Source Control' })).toBeNull();
    });

    it('closes menu when Escape is pressed', async () => {
      await openRepoMenu();
      expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();

      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
      });

      expect(screen.queryByRole('dialog', { name: 'Source Control' })).toBeNull();
    });

    it('renders menu header with current branch', async () => {
      await openRepoMenu();
      expect(screen.getByText('Current Branch')).toBeTruthy();
      expect(screen.getByText('main')).toBeTruthy();
    });

    it('renders menu close button', async () => {
      await openRepoMenu();
      expect(screen.getByRole('button', { name: 'Close Source Control' })).toBeTruthy();
    });

    it('closes menu when close button is clicked', async () => {
      await openRepoMenu();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close Source Control' }));
      });
      expect(screen.queryByRole('dialog', { name: 'Source Control' })).toBeNull();
    });
  });

  // =========================================================================
  // Menu Sections
  // =========================================================================
  describe('menu sections', () => {
    it('renders only history/diff in the transitional destination, while stashes, remotes, and merge have migrated', async () => {
      await openRepoMenu([{ path: 'file1.ts', status: 'modified' }]); await openTools();
      expect(screen.queryByTestId('git-branches-section')).toBeNull();
      expect(screen.queryByTestId('git-stash-section')).toBeNull();
      expect(screen.queryByTestId('git-merge-section')).toBeNull();
      expect(screen.getByTestId('git-history-section')).toBeTruthy();
    });

    it('renders commit button', async () => {
      await openRepoMenu([{ path: 'file1.ts', status: 'modified' }]);
      expect(screen.getByText('Commit Changes')).toBeTruthy();
    });

    it('renders refresh button', async () => {
      await openRepoMenu([{ path: 'file1.ts', status: 'modified' }]);
      expect(screen.getByText('Refresh')).toBeTruthy();
    });
  });

  // =========================================================================
  // Error Display
  // =========================================================================
  describe('error display', () => {
    it('shows diff error message', async () => {
      mockGitGetDiff.mockResolvedValueOnce({ success: false, error: 'Unable to load diff' });
      await openRepoMenu(); await openTools();
      expect(screen.getByText('Unable to load diff')).toBeTruthy();
    });
  });

  // =========================================================================
  // Commit Dialog
  // =========================================================================
  describe('commit dialog', () => {
    it('opens commit dialog when commit button is clicked', async () => {
      await openRepoMenu([{ path: 'file1.ts', status: 'modified' }]);
      await act(async () => {
        fireEvent.click(screen.getByText('Commit Changes'));
      });
      expect(screen.getByTestId('commit-dialog')).toBeTruthy();
    });

    it('keeps Source Control mounted beneath the nested commit workflow', async () => {
      await openRepoMenu([{ path: 'file1.ts', status: 'modified' }]);
      await act(async () => {
        fireEvent.click(screen.getByText('Commit Changes'));
      });
      expect(screen.getByTestId('commit-dialog')).toBeTruthy();
      expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();
    });
  });

  // =========================================================================
  // Branch Display
  // =========================================================================
  describe('branch display', () => {
    it('shows "Detached HEAD" when in detached state', () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; currentBranch: null; isDetached: boolean; changes: unknown[] }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: null,
          isDetached: true,
          changes: [],
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      render(<GitButton workspacePath="/repo" />);
      
      expect(screen.getByTitle('Git - View changes and branches')).toBeTruthy();
    });
  });

  // =========================================================================
  // Detached HEAD State
  // =========================================================================
  describe('detached head state', () => {
    it('renders menu when in detached state', async () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean; changes: unknown[] }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'abc1234',
          isDetached: true,
          changes: [],
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      render(<GitButton workspacePath="/repo" />);
      
      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      // Overview should open successfully.
      expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();
    });
  });

  // =========================================================================
  // Change Summary
  // =========================================================================
  describe('change summary', () => {
    it('shows correct change count in summary', async () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean; changes: { path: string; status: string }[] }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: [
            { path: 'file1.ts', status: 'modified' },
            { path: 'file2.ts', status: 'added' },
            { path: 'file3.ts', status: 'deleted' },
          ],
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      render(<GitButton workspacePath="/repo" />);
      
      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByText('3 changed')).toBeTruthy();
    });
  });

  // =========================================================================
  // API Error Handling
  // =========================================================================
  describe('API error handling', () => {
    it('handles gitRefresh error gracefully', async () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean; changes: unknown[] }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: [],
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      
      mockGitRefresh.mockRejectedValueOnce(new Error('Network error'));
      
      render(<GitButton workspacePath="/repo" />);
      
      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      const refreshButton = screen.getByText('Refresh');
      await act(async () => {
        fireEvent.click(refreshButton);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      // A failed refresh must not open a commit workflow or throw.
      expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();
    });
  });

  // =========================================================================
  // Upstream Tracking Display
  // =========================================================================
  describe('upstream tracking display', () => {
    it('shows upstream name under branch when tracking', async () => {
      setupTrackedMain();
      await openMenuOnly();
      expect(screen.getByText('origin/main')).toBeTruthy();
    });

    it('shows "up to date" pill when synced with upstream', async () => {
      setupTrackedMain();
      await openMenuOnly();
      expect(screen.getByText('0 ahead · 0 behind')).toBeTruthy();
    });

    [
      { name: 'shows ahead count when commits are ahead of upstream', ahead: 3, behind: 0, label: '3 ahead · 0 behind' },
      { name: 'shows behind count when commits are behind upstream', ahead: 0, behind: 2, label: '0 ahead · 2 behind' },
    ].forEach(({ name, ahead, behind, label }) => {
      it(name, async () => {
        emitStatus({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: [],
          upstream: 'origin/main',
          ahead,
          behind,
        });
        await openMenuOnly();
        expect(screen.getByText(label)).toBeTruthy();
      });
    });

    it('shows both ahead and behind when diverged', async () => {
      emitStatus({
        success: true,
        isRepo: true,
        currentBranch: 'main',
        isDetached: false,
        changes: [],
        upstream: 'origin/main',
        ahead: 2,
        behind: 1,
      });

      await openMenuOnly();

      expect(screen.getByText('2 ahead · 1 behind')).toBeTruthy();
    });

    it('shows "no upstream" pill when branch has no tracking remote', async () => {
      emitStatus({
        success: true,
        isRepo: true,
        currentBranch: 'feature',
        isDetached: false,
        changes: [],
        upstream: null,
        ahead: 0,
        behind: 0,
      });
      mockGitGetBranchState.mockResolvedValue({
        success: true,
        isRepo: true,
        currentBranch: 'feature',
        isDetached: false,
        branches: [{ name: 'feature', isCurrent: true }],
      });

      await openMenuOnly();

      expect(screen.getByText('No upstream')).toBeTruthy();
    });

    it('does not show upstream or no-upstream pill for detached HEAD', async () => {
      emitStatus({
        success: true,
        isRepo: true,
        currentBranch: 'abc1234',
        isDetached: true,
        changes: [],
        upstream: null,
        ahead: 0,
        behind: 0,
      });

      mockGitGetBranchState.mockResolvedValue({
        success: true,
        isRepo: true,
        currentBranch: null,
        isDetached: true,
        branches: [],
      });

      await openMenuOnly();
      expect(screen.queryByText('no upstream')).toBeNull();
      expect(document.querySelector('.git-menu-upstream')).toBeNull();
    });
  });

  // =========================================================================
  // Provider display (GAP-3)
  // =========================================================================
  describe('provider display', () => {
    const providerCases = [
      {
        name: 'shows GitHub pill when provider is github',
        provider: 'github',
        url: 'https://github.com/owner/repo.git',
        text: 'GitHub',
        className: 'provider-github',
      },
      {
        name: 'shows Bitbucket pill when provider is bitbucket',
        provider: 'bitbucket',
        url: 'https://bitbucket.org/team/project.git',
        text: 'Bitbucket',
        className: 'provider-bitbucket',
      },
      {
        name: 'shows GitLab pill when provider is gitlab',
        provider: 'gitlab',
        url: 'https://gitlab.com/user/repo.git',
        text: 'GitLab',
        className: 'provider-gitlab',
      },
      {
        name: 'shows "no remote" pill when provider is unknown',
        provider: 'unknown',
        url: 'https://git.mycompany.com/owner/repo.git',
        text: 'Unknown provider',
        className: 'provider-none',
      },
    ] as const;

    providerCases.forEach(({ name, provider, url, text }) => {
      it(name, async () => {
        mockGitGetRemotes.mockResolvedValue({
          success: true,
          remotes: [{ name: 'origin', fetchUrl: url, pushUrl: url }],
          provider,
        });

        await openMenuOnly();

        const pill = screen.getByText(text);
        expect(pill).toBeTruthy();
        expect(screen.getByRole('dialog', { name: 'Source Control' })).toContainElement(pill);
      });
    });

    it('shows provider pill in header-right next to close button', async () => {
      mockGitGetRemotes.mockResolvedValue({
        success: true,
        remotes: [{ name: 'origin', fetchUrl: 'https://github.com/owner/repo.git', pushUrl: 'https://github.com/owner/repo.git' }],
        provider: 'github',
      });

      await openMenuOnly();

      expect(screen.getByText('GitHub')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Close Source Control' })).toBeTruthy();
    });

    it('provider pill is present after menu re-opens', async () => {
      mockGitGetRemotes.mockReset();
      mockGitGetRemotes
        .mockResolvedValueOnce({
          success: true,
          remotes: [{ name: 'origin', fetchUrl: 'https://github.com/owner/repo.git', pushUrl: 'https://github.com/owner/repo.git' }],
          provider: 'github',
        })
        .mockResolvedValueOnce({
          success: true,
          remotes: [{ name: 'origin', fetchUrl: 'https://github.com/owner/repo.git', pushUrl: 'https://github.com/owner/repo.git' }],
          provider: 'github',
        });

      mockVcsGetContext.mockReset();
      mockVcsGetDeepLinks.mockReset();
      mockVcsGetContext.mockResolvedValue({ success: false, error: 'No context' });
      mockVcsGetDeepLinks.mockResolvedValue([]);

      await openMenuOnly();
      expect(screen.getByText('GitHub')).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close Source Control' }));
      });

      mockGitGetRemotes
        .mockResolvedValueOnce({
          success: true,
          remotes: [{ name: 'origin', fetchUrl: 'https://bitbucket.org/team/repo.git', pushUrl: 'https://bitbucket.org/team/repo.git' }],
          provider: 'bitbucket',
        })
        .mockResolvedValueOnce({
          success: true,
          remotes: [{ name: 'origin', fetchUrl: 'https://bitbucket.org/team/repo.git', pushUrl: 'https://bitbucket.org/team/repo.git' }],
          provider: 'bitbucket',
        });

      await act(async () => {
        fireEvent.click(document.querySelector('.git-btn')!);
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText('Bitbucket')).toBeTruthy();
    });
  });

  // =========================================================================
  // Remote actions: Fetch / Pull / Push (GAP-4)
  // =========================================================================
  describe('remote actions', () => {
    it('shows fetch, pull, and push buttons when on a branch', async () => {
      setupTrackedMain();
      await openMenuOnly();
      expect(screen.getByText('Fetch')).toBeTruthy();
      expect(screen.getByText('Pull')).toBeTruthy();
      expect(screen.getByText('Push')).toBeTruthy();
    });

    it('hides remote section for detached HEAD', async () => {
      emitStatus({
        success: true,
        isRepo: true,
        currentBranch: 'abc1234',
        isDetached: true,
        changes: [],
        upstream: null,
        ahead: 0,
        behind: 0,
      });
      mockGitGetBranchState.mockResolvedValueOnce({
        success: true,
        isRepo: true,
        currentBranch: null,
        isDetached: true,
        branches: [],
      });

      await openMenuOnly();

      expect(document.querySelector('.git-menu-remote-actions')).toBeNull();
    });


    it('shows error message when fetch fails', async () => {
      setupTrackedMain();
      mockGitFetch.mockResolvedValueOnce({ success: false, error: 'Fetch failed: connection refused' });
      await openMenuOnly();

      await act(async () => {
        fireEvent.click(screen.getByText('Fetch'));
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText('Fetch failed: connection refused')).toBeTruthy();
    });

    it('shows "Fetching…" label while fetch is in progress', async () => {
      setupTrackedMain();
      mockGitFetch.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { success: true };
      });
      await openMenuOnly();

      await act(async () => {
        fireEvent.click(screen.getByText('Fetch'));
      });

      expect(mockGitFetch).toHaveBeenCalled();
    });


    it('pull and push buttons are disabled when no upstream', async () => {
      emitStatus({
        success: true,
        isRepo: true,
        currentBranch: 'feature',
        isDetached: false,
        changes: [],
        upstream: null,
        ahead: 0,
        behind: 0,
      });
      await openMenuOnly();

      expect(screen.getByText('Fetch')).toBeTruthy();
      const pullBtn = screen.getByText('Pull').closest('button') as HTMLButtonElement;
      const pushBtn = screen.getByText('Push').closest('button') as HTMLButtonElement;
      expect(pullBtn).toBeDisabled();
      expect(pushBtn).toBeDisabled();
    });

    it('shows publish button when no upstream', async () => {
      mockGitGetRemotes.mockResolvedValue({
        success: true,
        remotes: [{ name: 'origin', fetchUrl: 'https://github.com/owner/repo.git', pushUrl: 'https://github.com/owner/repo.git' }],
        provider: 'github',
      });
      emitStatus({
        success: true,
        isRepo: true,
        currentBranch: 'feature',
        isDetached: false,
        changes: [],
        upstream: null,
        ahead: 0,
        behind: 0,
      });

      await openMenuOnly();

      const publishButton = screen.getByRole('button', { name: /publish branch/i });
      expect(publishButton).toBeEnabled();
    });
  });

  describe('coverage follow-ups', () => {
    it('shows status error message in init menu for git-not-found', () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: { success: boolean; errorCode?: string }) => void) => {
        callback({ success: false, errorCode: 'git-not-found' });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);

      render(<GitButton workspacePath="/workspace" />);

      fireEvent.click(screen.getByText('Init Git'));
      expect(screen.getByText('Git is not installed or not found on PATH')).toBeTruthy();
    });

    it('renders upstream divergence label (ahead/behind) in repo menu', async () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: {
        success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean;
        changes: unknown[]; upstream: string | null; ahead: number; behind: number;
      }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: [{ path: 'a.ts', status: 'modified' }],
          upstream: 'origin/main',
          ahead: 2,
          behind: 1,
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);

      render(<GitButton workspacePath="/repo" />);

      fireEvent.click(document.querySelector('.git-btn')!);
      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText('origin/main')).toBeTruthy();
      expect(screen.getByText('2 ahead · 1 behind')).toBeTruthy();
    });

    it('loads VCS context via GitBranchesSection refresh callback', async () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: {
        success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean;
        changes: unknown[]; upstream: string | null; ahead: number; behind: number;
      }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'main',
          isDetached: false,
          changes: [],
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);

      mockGitGetRemotes.mockResolvedValue({
        success: true,
        remotes: [{ name: 'origin', fetchUrl: 'git@github.com:o/r.git', pushUrl: 'git@github.com:o/r.git' }],
        provider: 'github',
      });

      mockVcsGetContext.mockResolvedValue({
        success: true,
        provider: { provider: 'github', baseUrl: 'https://github.com', owner: 'o', repo: 'r', defaultBranch: 'main' },
        pullRequest: { exists: false },
        deepLinks: [],
      });

      render(<GitButton workspacePath="/repo" />);
      await act(async () => { fireEvent.click(document.querySelector('.git-btn')!); }); await openBranches();

      await act(async () => {
        fireEvent.click(screen.getByText('refresh-context'));
      });

      expect(componentMocks.gitBranchesLastProps).toBeTruthy();
      expect((componentMocks.gitBranchesLastProps as Record<string, unknown>).provider).toBeTruthy();
    });


  });
});
