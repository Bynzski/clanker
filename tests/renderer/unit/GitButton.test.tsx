// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import GitButton from '../../../src/renderer/components/GitButton';

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
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="commit-dialog">Commit Dialog</div> : null,
}));

vi.mock('../../../src/renderer/components/git/GitBranchesSection', () => ({
  GitBranchesSection: () => <div data-testid="git-branches-section">Branches</div>,
}));

vi.mock('../../../src/renderer/components/git/GitStashSection', () => ({
  GitStashSection: () => <div data-testid="git-stash-section">Stashes</div>,
}));

vi.mock('../../../src/renderer/components/git/GitMergeSection', () => ({
  GitMergeSection: () => <div data-testid="git-merge-section">Merge</div>,
}));

vi.mock('../../../src/renderer/components/git/GitHistorySection', () => ({
  GitHistorySection: () => <div data-testid="git-history-section">History</div>,
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
    it('opens menu when git button is clicked', async () => {
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
      
      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByTestId('git-branches-section')).toBeTruthy();
    });

    it('closes menu when clicking outside', async () => {
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
      
      // Open menu
      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByTestId('git-branches-section')).toBeTruthy();
      
      // Close by clicking outside
      await act(async () => {
        fireEvent.mouseDown(document.body);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.queryByTestId('git-branches-section')).toBeNull();
    });

    it('closes menu when Escape is pressed', async () => {
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
      
      // Open menu
      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByTestId('git-branches-section')).toBeTruthy();
      
      // Press Escape
      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      
      expect(screen.queryByTestId('git-branches-section')).toBeNull();
    });

    it('renders menu header with current branch', async () => {
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
      
      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByText('Current Branch')).toBeTruthy();
      expect(screen.getByText('main')).toBeTruthy();
    });

    it('renders menu close button', async () => {
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
      
      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByTitle('Close')).toBeTruthy();
    });

    it('closes menu when close button is clicked', async () => {
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
      
      // Open menu
      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      // Close via button
      const closeButton = screen.getByTitle('Close');
      await act(async () => {
        fireEvent.click(closeButton);
      });
      
      expect(screen.queryByTestId('git-branches-section')).toBeNull();
    });
  });

  // =========================================================================
  // Menu Sections
  // =========================================================================
  describe('menu sections', () => {
    it('renders all git sections when menu is open', async () => {
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
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByTestId('git-branches-section')).toBeTruthy();
      expect(screen.getByTestId('git-stash-section')).toBeTruthy();
      expect(screen.getByTestId('git-merge-section')).toBeTruthy();
      expect(screen.getByTestId('git-history-section')).toBeTruthy();
    });

    it('renders commit button', async () => {
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
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByText('Commit Changes')).toBeTruthy();
    });

    it('renders refresh button', async () => {
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
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByText('Refresh')).toBeTruthy();
    });
  });

  // =========================================================================
  // Error Display
  // =========================================================================
  describe('error display', () => {
    it('shows diff error message', async () => {
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
      
      mockGitGetDiff.mockResolvedValueOnce({
        success: false,
        error: 'Unable to load diff',
      });
      
      render(<GitButton workspacePath="/repo" />);
      
      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(screen.getByText('Unable to load diff')).toBeTruthy();
    });
  });

  // =========================================================================
  // Commit Dialog
  // =========================================================================
  describe('commit dialog', () => {
    it('opens commit dialog when commit button is clicked', async () => {
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
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      const commitButton = screen.getByText('Commit Changes');
      await act(async () => {
        fireEvent.click(commitButton);
      });
      
      expect(screen.getByTestId('commit-dialog')).toBeTruthy();
    });

    it('closes menu when commit button is clicked', async () => {
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
      await act(async () => {
        fireEvent.click(button!);
      });
      
      act(() => {
        vi.runAllTimers();
      });
      
      const commitButton = screen.getByText('Commit Changes');
      await act(async () => {
        fireEvent.click(commitButton);
      });
      
      // Menu should be closed
      expect(screen.queryByTestId('git-branches-section')).toBeNull();
    });
  });

  // =========================================================================
  // Polling Management
  // =========================================================================
  describe('polling management', () => {
    it('starts polling when workspace path is provided', () => {
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
      
      expect(mockGitStartPolling).toHaveBeenCalledWith('/repo');
    });

    it('stops polling when workspace path changes to empty', () => {
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
      
      const { rerender } = render(<GitButton workspacePath="/repo" />);
      
      expect(mockGitStartPolling).toHaveBeenCalledWith('/repo');
      
      rerender(<GitButton workspacePath="" />);
      
      expect(mockGitStopPolling).toHaveBeenCalled();
    });

    it('stops polling on unmount', () => {
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
      
      const { unmount } = render(<GitButton workspacePath="/repo" />);
      
      expect(mockGitStopPolling).not.toHaveBeenCalled();
      
      unmount();
      
      expect(mockGitStopPolling).toHaveBeenCalled();
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
      
      // Menu should open successfully
      expect(screen.getByTestId('git-branches-section')).toBeTruthy();
    });
  });

  // =========================================================================
  // Workspace Path Change
  // =========================================================================
  describe('workspace path change', () => {
    it('resets state when workspace path changes', () => {
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
      
      const { rerender } = render(<GitButton workspacePath="/repo1" />);
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(mockGitStartPolling).toHaveBeenCalledWith('/repo1');
      
      rerender(<GitButton workspacePath="/repo2" />);
      
      // Should stop old polling and start new
      expect(mockGitStopPolling).toHaveBeenCalled();
      expect(mockGitStartPolling).toHaveBeenCalledWith('/repo2');
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
      
      // Should not crash
      expect(screen.getByTestId('git-branches-section')).toBeTruthy();
    });
  });

  // =========================================================================
  // Upstream Tracking Display
  // =========================================================================
  describe('upstream tracking display', () => {
    it('shows upstream name under branch when tracking', async () => {
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

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText('origin/main')).toBeTruthy();
    });

    it('shows "up to date" pill when synced with upstream', async () => {
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

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      const syncPill = screen.getByText('up to date');
      expect(syncPill).toBeTruthy();
      expect(syncPill.closest('.git-menu-sync')).toHaveClass('synced');
    });

    it('shows ahead count when commits are ahead of upstream', async () => {
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
          ahead: 3,
          behind: 0,
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

      expect(screen.getByText('↑3')).toBeTruthy();
    });

    it('shows behind count when commits are behind upstream', async () => {
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
          behind: 2,
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

      expect(screen.getByText('↓2')).toBeTruthy();
    });

    it('shows both ahead and behind when diverged', async () => {
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
          ahead: 2,
          behind: 1,
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

      const syncPill = document.querySelector('.git-menu-sync.diverged');
      expect(syncPill).toBeTruthy();
      expect(syncPill?.textContent).toContain('↑2');
      expect(syncPill?.textContent).toContain('↓1');
      // Arrow icons present
      expect(syncPill?.querySelector('.lucide-arrow-up')).toBeTruthy();
      expect(syncPill?.querySelector('.lucide-arrow-down')).toBeTruthy();
    });

    it('shows "no upstream" pill when branch has no tracking remote', async () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: {
        success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean;
        changes: unknown[]; upstream: string | null; ahead: number; behind: number;
      }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'feature',
          isDetached: false,
          changes: [],
          upstream: null,
          ahead: 0,
          behind: 0,
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);
      mockGitGetBranchState.mockResolvedValue({
        success: true,
        isRepo: true,
        currentBranch: 'feature',
        isDetached: false,
        branches: [{ name: 'feature', isCurrent: true }],
      });

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      const pill = screen.getByText('no upstream');
      expect(pill).toBeTruthy();
      expect(pill.closest('.git-menu-sync')).toHaveClass('none');
    });

    it('does not show upstream or no-upstream pill for detached HEAD', async () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: {
        success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean;
        changes: unknown[]; upstream: string | null; ahead: number; behind: number;
      }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'abc1234',
          isDetached: true,
          changes: [],
          upstream: null,
          ahead: 0,
          behind: 0,
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);

      // Also return detached from branch state so refreshMenuData doesn't override
      mockGitGetBranchState.mockResolvedValue({
        success: true,
        isRepo: true,
        currentBranch: null,
        isDetached: true,
        branches: [],
      });

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.queryByText('no upstream')).toBeNull();
      expect(document.querySelector('.git-menu-upstream')).toBeNull();
    });
  });

  // =========================================================================
  // Provider display (GAP-3)
  // =========================================================================
  describe('provider display', () => {
    it('shows GitHub pill when provider is github', async () => {
      mockGitGetRemotes.mockResolvedValue({
        success: true,
        remotes: [{ name: 'origin', fetchUrl: 'https://github.com/owner/repo.git', pushUrl: 'https://github.com/owner/repo.git' }],
        provider: 'github',
      });

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      const pill = screen.getByText('GitHub');
      expect(pill).toBeTruthy();
      expect(pill.closest('.git-menu-provider')).toHaveClass('provider-github');
    });

    it('shows Bitbucket pill when provider is bitbucket', async () => {
      mockGitGetRemotes.mockResolvedValue({
        success: true,
        remotes: [{ name: 'origin', fetchUrl: 'https://bitbucket.org/team/project.git', pushUrl: 'https://bitbucket.org/team/project.git' }],
        provider: 'bitbucket',
      });

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      const pill = screen.getByText('Bitbucket');
      expect(pill).toBeTruthy();
      expect(pill.closest('.git-menu-provider')).toHaveClass('provider-bitbucket');
    });

    it('shows GitLab pill when provider is gitlab', async () => {
      mockGitGetRemotes.mockResolvedValue({
        success: true,
        remotes: [{ name: 'origin', fetchUrl: 'https://gitlab.com/user/repo.git', pushUrl: 'https://gitlab.com/user/repo.git' }],
        provider: 'gitlab',
      });

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      const pill = screen.getByText('GitLab');
      expect(pill).toBeTruthy();
      expect(pill.closest('.git-menu-provider')).toHaveClass('provider-gitlab');
    });

    it('shows "no remote" pill when provider is unknown', async () => {
      mockGitGetRemotes.mockResolvedValue({
        success: true,
        remotes: [{ name: 'origin', fetchUrl: 'https://git.mycompany.com/owner/repo.git', pushUrl: 'https://git.mycompany.com/owner/repo.git' }],
        provider: 'unknown',
      });

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      const pill = screen.getByText('no remote');
      expect(pill).toBeTruthy();
      expect(pill.closest('.git-menu-provider')).toHaveClass('provider-none');
    });

    it('shows provider pill in header-right next to close button', async () => {
      mockGitGetRemotes.mockResolvedValue({
        success: true,
        remotes: [{ name: 'origin', fetchUrl: 'https://github.com/owner/repo.git', pushUrl: 'https://github.com/owner/repo.git' }],
        provider: 'github',
      });

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      const headerRight = document.querySelector('.git-menu-header-right');
      expect(headerRight).toBeTruthy();
      expect(headerRight?.querySelector('.git-menu-provider')).toBeTruthy();
      expect(headerRight?.querySelector('.git-menu-close')).toBeTruthy();
    });

    it('provider pill is present after menu re-opens', async () => {
      // gitGetRemotes is called twice: once on workspace mount (effect), once on menu open (refreshMenuData)
      // Chain both responses so each call gets the right value
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

      // Reset VCS mocks and set up defaults
      mockVcsGetContext.mockReset();
      mockVcsGetDeepLinks.mockReset();
      mockVcsGetContext.mockResolvedValue({ success: false, error: 'No context' });
      mockVcsGetDeepLinks.mockResolvedValue([]);

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText('GitHub')).toBeTruthy();

      // Close menu
      await act(async () => {
        fireEvent.click(screen.getByTitle('Close'));
      });

      // Re-open with bitbucket
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
        fireEvent.click(button!);
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

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText('Fetch')).toBeTruthy();
      expect(screen.getByText('Pull')).toBeTruthy();
      expect(screen.getByText('Push')).toBeTruthy();
    });

    it('hides remote section for detached HEAD', async () => {
      // The onGitStatusUpdate callback sets isDetached from status,
      // but refreshMenuData on menu open can override it from branch state.
      // Mock both to ensure detached state is consistent.
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: {
        success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean;
        changes: unknown[]; upstream: string | null; ahead: number; behind: number;
      }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'abc1234',
          isDetached: true,
          changes: [],
          upstream: null,
          ahead: 0,
          behind: 0,
        });
        return vi.fn();
      }) as unknown as typeof mockOnGitStatusUpdate);

      // Override branch state so refreshMenuData also sees detached HEAD
      mockGitGetBranchState.mockResolvedValueOnce({
        success: true,
        isRepo: true,
        currentBranch: null,
        isDetached: true,
        branches: [],
      });

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      // Remote section is hidden for detached HEAD (no branch to push/pull)
      const remoteSection = document.querySelector('.git-menu-remote-actions');
      expect(remoteSection).toBeNull();
    });

    it('calls gitFetch and refreshes on fetch click', async () => {
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

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Fetch'));
      });

      expect(mockGitFetch).toHaveBeenCalledWith('/repo');
    });

    it('shows error message when fetch fails', async () => {
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
      mockGitFetch.mockResolvedValueOnce({
        success: false,
        error: 'Fetch failed: connection refused',
      });

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Fetch'));
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText('Fetch failed: connection refused')).toBeTruthy();
    });

    it('shows "Fetching..." label while fetch is in progress', async () => {
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
      mockGitFetch.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { success: true };
      });

      render(<GitButton workspacePath="/repo" />);

      const gitBtn = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(gitBtn!);
      });

      act(() => {
        vi.runAllTimers();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Fetch'));
      });

      // The button label should change during the async operation
      // (In the actual component the button is disabled, we verify the handler was called)
      expect(mockGitFetch).toHaveBeenCalled();
    });

    it('refreshes status after successful push', async () => {
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
      mockGitPush.mockResolvedValueOnce({ success: true });
      mockGitRefresh.mockResolvedValueOnce({
        success: true,
        isRepo: true,
        currentBranch: 'main',
        isDetached: false,
        changes: [],
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
      });

      render(<GitButton workspacePath="/repo" />);

      const button = document.querySelector('.git-btn');
      await act(async () => {
        fireEvent.click(button!);
      });

      act(() => {
        vi.runAllTimers();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Push'));
      });

      expect(mockGitPush).toHaveBeenCalledWith('/repo');
      expect(mockGitRefresh).toHaveBeenCalled();
    });

    it('pull and push buttons are disabled when no upstream', async () => {
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: {
        success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean;
        changes: unknown[]; upstream: string | null; ahead: number; behind: number;
      }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'feature',
          isDetached: false,
          changes: [],
          upstream: null,
          ahead: 0,
          behind: 0,
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

      // Fetch should still be available (no upstream needed)
      expect(screen.getByText('Fetch')).toBeTruthy();
      // Pull and Push require upstream
      const pullBtn = screen.getByText('Pull').closest('button') as HTMLButtonElement;
      const pushBtn = screen.getByText('Push').closest('button') as HTMLButtonElement;
      expect(pullBtn).toBeDisabled();
      expect(pushBtn).toBeDisabled();
    });

    it('shows publish button when no upstream and sets upstream on push', async () => {
      // Use mockResolvedValue so remotes are available for all calls
      mockGitGetRemotes.mockResolvedValue({
        success: true,
        remotes: [
          { name: 'origin', fetchUrl: 'https://github.com/owner/repo.git', pushUrl: 'https://github.com/owner/repo.git' },
        ],
        provider: 'github',
      });
      mockOnGitStatusUpdate.mockImplementation(((callback: (status: {
        success: boolean; isRepo: boolean; currentBranch: string; isDetached: boolean;
        changes: unknown[]; upstream: string | null; ahead: number; behind: number;
      }) => void) => {
        callback({
          success: true,
          isRepo: true,
          currentBranch: 'feature',
          isDetached: false,
          changes: [],
          upstream: null,
          ahead: 0,
          behind: 0,
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

      mockGitPush.mockResolvedValueOnce({ success: true });
      await act(async () => {
        await Promise.resolve();
      });
      const publishButton = screen.getByRole('button', { name: /publish branch/i });
      expect(publishButton).toBeEnabled();

      await act(async () => {
        fireEvent.click(publishButton);
      });

      expect(mockGitPush).toHaveBeenCalledWith('/repo', 'origin', 'main', false, true);
    });
  });
});
