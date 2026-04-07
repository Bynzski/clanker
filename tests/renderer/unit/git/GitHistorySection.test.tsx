// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GitHistorySection } from '../../../../src/renderer/components/git/GitHistorySection';
import type { DiffMode, GitDiffResult, GitHistoryEntry } from '../../../../src/renderer/components/git/types';

describe('GitHistorySection', () => {
  // Mock callbacks
  const mockOnSelectCommitDiff = vi.fn();
  const mockOnSelectWorkingDiff = vi.fn();
  
  const defaultProps = {
    diffResult: null as GitDiffResult | null,
    history: [] as GitHistoryEntry[],
    isBusy: false,
    isLoadingDiff: false,
    isLoadingHistory: false,
    onSelectCommitDiff: mockOnSelectCommitDiff,
    onSelectWorkingDiff: mockOnSelectWorkingDiff,
    selectedCommit: null as GitHistoryEntry | null,
    selectedDiffMode: 'working' as DiffMode,
    selectedDiffRef: null as string | null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Header
  // =========================================================================
  describe('header', () => {
    it('renders history section header with count', () => {
      render(<GitHistorySection {...defaultProps} history={[]} />);
      
      expect(screen.getByText('History')).toBeTruthy();
      expect(screen.getByText('0')).toBeTruthy();
    });

    it('updates count when history changes', () => {
      const { rerender } = render(<GitHistorySection {...defaultProps} history={[]} />);
      expect(screen.getByText('0')).toBeTruthy();
      
      rerender(<GitHistorySection {...defaultProps} history={[
        { hash: 'abc123', shortHash: 'abc123', author: 'Test', date: '2 hours ago', subject: 'Initial commit' },
      ]} />);
      expect(screen.getByText('1')).toBeTruthy();
    });
  });

  // =========================================================================
  // Toolbar (Diff Mode Toggles)
  // =========================================================================
  describe('toolbar', () => {
    it('renders Working Tree and Staged toggle buttons', () => {
      render(<GitHistorySection {...defaultProps} />);
      
      expect(screen.getByRole('button', { name: /working tree/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /staged/i })).toBeTruthy();
    });

    it('marks Working Tree as active when selected', () => {
      render(<GitHistorySection {...defaultProps} selectedDiffMode='working' />);
      
      expect(screen.getByRole('button', { name: /working tree/i })).toHaveClass('active');
      expect(screen.getByRole('button', { name: /staged/i })).not.toHaveClass('active');
    });

    it('marks Staged as active when selected', () => {
      render(<GitHistorySection {...defaultProps} selectedDiffMode='staged' />);
      
      expect(screen.getByRole('button', { name: /working tree/i })).not.toHaveClass('active');
      expect(screen.getByRole('button', { name: /staged/i })).toHaveClass('active');
    });

    it('disables toggle buttons when isBusy is true', () => {
      render(<GitHistorySection {...defaultProps} isBusy={true} />);
      
      expect(screen.getByRole('button', { name: /working tree/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /staged/i })).toBeDisabled();
    });

    it('calls onSelectWorkingDiff when Working Tree is clicked', () => {
      render(<GitHistorySection {...defaultProps} selectedDiffMode='staged' />);
      
      fireEvent.click(screen.getByRole('button', { name: /working tree/i }));
      expect(mockOnSelectWorkingDiff).toHaveBeenCalledWith('working');
    });

    it('calls onSelectWorkingDiff with staged when Staged is clicked', () => {
      render(<GitHistorySection {...defaultProps} selectedDiffMode='working' />);
      
      fireEvent.click(screen.getByRole('button', { name: /staged/i }));
      expect(mockOnSelectWorkingDiff).toHaveBeenCalledWith('staged');
    });
  });

  // =========================================================================
  // Loading & Empty States
  // =========================================================================
  describe('loading and empty states', () => {
    it('shows loading state when isLoadingHistory is true', () => {
      render(<GitHistorySection {...defaultProps} isLoadingHistory={true} />);
      
      expect(screen.getByText('Loading history...')).toBeTruthy();
    });

    it('shows "No commits found" when history is empty', () => {
      render(<GitHistorySection {...defaultProps} history={[]} />);
      
      expect(screen.getByText('No commits found')).toBeTruthy();
    });

    it('does not show history list when loading or empty', () => {
      render(<GitHistorySection {...defaultProps} isLoadingHistory={true} history={[
        { hash: 'abc123', shortHash: 'abc123', author: 'Test', date: 'now', subject: 'Test' },
      ]} />);
      
      expect(screen.queryByText('abc123')).toBeNull();
    });
  });

  // =========================================================================
  // History List
  // =========================================================================
  describe('history list', () => {
    const mockHistoryEntry: GitHistoryEntry = {
      hash: 'abc123def456789',
      shortHash: 'abc123d',
      author: 'John Doe',
      date: '2 hours ago',
      subject: 'Add new feature implementation',
    };

    it('renders history entries with hash, author, and subject', () => {
      render(<GitHistorySection {...defaultProps} history={[mockHistoryEntry]} />);
      
      expect(screen.getByText('abc123d')).toBeTruthy();
      expect(screen.getByText('Add new feature implementation')).toBeTruthy();
      expect(screen.getByText('John Doe')).toBeTruthy();
      expect(screen.getByText('2 hours ago')).toBeTruthy();
    });

    it('renders multiple history entries', () => {
      const history: GitHistoryEntry[] = [
        { hash: 'aaa111', shortHash: 'aaa111', author: 'Dev1', date: '1h ago', subject: 'First commit' },
        { hash: 'bbb222', shortHash: 'bbb222', author: 'Dev2', date: '2h ago', subject: 'Second commit' },
        { hash: 'ccc333', shortHash: 'ccc333', author: 'Dev1', date: '3h ago', subject: 'Third commit' },
      ];
      
      render(<GitHistorySection {...defaultProps} history={history} />);
      
      expect(screen.getByText('aaa111')).toBeTruthy();
      expect(screen.getByText('bbb222')).toBeTruthy();
      expect(screen.getByText('ccc333')).toBeTruthy();
    });

    it('calls onSelectCommitDiff when commit is clicked', () => {
      render(<GitHistorySection {...defaultProps} history={[mockHistoryEntry]} />);
      
      fireEvent.click(screen.getByText('abc123d'));
      expect(mockOnSelectCommitDiff).toHaveBeenCalledWith(mockHistoryEntry);
    });

    it('disables commit buttons when isBusy is true', () => {
      render(<GitHistorySection {...defaultProps} history={[mockHistoryEntry]} isBusy={true} />);
      
      expect(screen.getByText('abc123d').closest('button')).toBeDisabled();
    });

    it('marks selected commit as active', () => {
      render(<GitHistorySection {...defaultProps} 
        history={[mockHistoryEntry]} 
        selectedDiffMode='commit' 
        selectedDiffRef='abc123def456789' 
      />);
      
      expect(screen.getByText('abc123d').closest('.git-history-item')).toHaveClass('active');
    });

    it('does not mark unselected commits as active', () => {
      const history: GitHistoryEntry[] = [
        mockHistoryEntry,
        { hash: 'bbb222', shortHash: 'bbb222', author: 'Dev', date: 'now', subject: 'Other' },
      ];
      
      render(<GitHistorySection {...defaultProps} 
        history={history} 
        selectedDiffMode='commit' 
        selectedDiffRef='bbb222' 
      />);
      
      expect(screen.getByText('abc123d').closest('.git-history-item')).not.toHaveClass('active');
      expect(screen.getByText('bbb222').closest('.git-history-item')).toHaveClass('active');
    });
  });

  // =========================================================================
  // Diff Panel
  // =========================================================================
  describe('diff panel', () => {
    it('renders diff panel with header', () => {
      render(<GitHistorySection {...defaultProps} />);
      
      expect(screen.getByText('Diff')).toBeTruthy();
      expect(document.querySelector('.git-diff-output')).toBeTruthy();
    });

    it('shows "No diff to display" when no diff result', () => {
      render(<GitHistorySection {...defaultProps} diffResult={null} />);
      
      expect(screen.getByText('No diff to display')).toBeTruthy();
    });

    it('displays diff output when available', () => {
      const diffResult: GitDiffResult = {
        success: true,
        output: '+ added line\n- removed line',
        title: 'Changes',
      };
      
      render(<GitHistorySection {...defaultProps} diffResult={diffResult} />);
      
      // Diff output is in pre element, check via querySelector
      const diffOutput = document.querySelector('.git-diff-output');
      expect(diffOutput?.textContent).toContain('+ added line');
      expect(diffOutput?.textContent).toContain('- removed line');
    });

    it('shows diff title when available', () => {
      const diffResult: GitDiffResult = {
        success: true,
        output: 'some diff',
        title: 'src/file.ts - 3 changes',
      };
      
      render(<GitHistorySection {...defaultProps} diffResult={diffResult} />);
      
      expect(screen.getByText('src/file.ts - 3 changes')).toBeTruthy();
    });

    it('shows commit hash subtitle when commit is selected', () => {
      const selectedCommit: GitHistoryEntry = {
        hash: 'abc123def456789',
        shortHash: 'abc123d',
        author: 'Test',
        date: 'now',
        subject: 'Test commit',
      };
      
      const diffResult: GitDiffResult = {
        success: true,
        output: 'diff content',
        title: 'Changes',
      };
      
      render(<GitHistorySection {...defaultProps} 
        diffResult={diffResult} 
        selectedCommit={selectedCommit} 
      />);
      
      expect(screen.getByText('abc123d')).toBeTruthy();
    });

    it('shows loader when isLoadingDiff is true', () => {
      render(<GitHistorySection {...defaultProps} isLoadingDiff={true} />);
      
      expect(document.querySelector('.spin')).toBeTruthy();
    });

    it('renders diff output in pre element', () => {
      const diffResult: GitDiffResult = {
        success: true,
        output: 'diff content here',
        title: 'Diff',
      };
      
      render(<GitHistorySection {...defaultProps} diffResult={diffResult} />);
      
      const preElement = document.querySelector('.git-diff-output');
      expect(preElement).toBeTruthy();
    });
  });

  // =========================================================================
  // Integration Scenarios
  // =========================================================================
  describe('integration scenarios', () => {
    it('switches from working tree diff to staged diff', () => {
      const diffResult: GitDiffResult = {
        success: true,
        output: 'working diff',
        title: 'Working Tree Diff',
      };
      
      const { rerender } = render(<GitHistorySection 
        {...defaultProps} 
        diffResult={diffResult}
        selectedDiffMode='working'
      />);
      
      // Check diff title in the header
      expect(screen.getByText('Working Tree Diff', { selector: '.git-diff-title' })).toBeTruthy();
      
      const stagedDiffResult: GitDiffResult = {
        ...diffResult,
        output: 'staged diff',
        title: 'Staged Changes',
      };
      
      rerender(<GitHistorySection 
        {...defaultProps} 
        diffResult={stagedDiffResult}
        selectedDiffMode='staged'
      />);
      
      expect(screen.getByText('Staged Changes')).toBeTruthy();
    });

    it('shows commit diff when commit is selected', () => {
      const selectedCommit: GitHistoryEntry = {
        hash: 'abc123',
        shortHash: 'abc123',
        author: 'Test',
        date: 'now',
        subject: 'Test',
      };
      
      const diffResult: GitDiffResult = {
        success: true,
        output: 'commit diff content',
        title: 'Commit',
      };
      
      render(<GitHistorySection 
        {...defaultProps} 
        diffResult={diffResult}
        selectedCommit={selectedCommit}
        selectedDiffMode='commit'
        selectedDiffRef='abc123'
      />);
      
      expect(screen.getByText('abc123')).toBeTruthy(); // Subtitle
      expect(screen.getByText('commit diff content')).toBeTruthy();
    });
  });
});
