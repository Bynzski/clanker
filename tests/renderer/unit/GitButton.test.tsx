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
const mockOnGitStatusUpdate = vi.fn();
const mockConfirm = vi.fn();
const mockSetTimeout = vi.fn(((cb: () => void) => { cb(); return 0; }) as unknown as typeof setTimeout);

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
  onGitStatusUpdate: mockOnGitStatusUpdate,
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
    it('returns null when not a git repository', () => {
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
      
      const { container } = render(<GitButton workspacePath="/not-a-repo" />);
      
      act(() => {
        vi.runAllTimers();
      });
      
      expect(container.firstChild).toBeNull();
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

    it('resets to empty state when workspace path is empty', () => {
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
      
      expect(screen.getByRole('button')).toBeTruthy();
      
      rerender(<GitButton workspacePath="" />);
      
      expect(screen.queryByRole('button')).toBeNull();
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
});
