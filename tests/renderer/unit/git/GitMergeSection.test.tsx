// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GitMergeSection } from '../../../../src/renderer/components/git/GitMergeSection';
import type { GitOperationState } from '../../../../src/renderer/components/git/types';

describe('GitMergeSection', () => {
  // Mock callbacks
  const mockOnAbortOperation = vi.fn();
  const mockOnMergeBranch = vi.fn();
  const mockOnSetMergeTargetBranch = vi.fn();
  
  const defaultProps = {
    activeAction: null as string | null,
    availableMergeTargets: [] as string[],
    isBusy: false,
    isLoadingOperation: false,
    mergeTargetBranch: '',
    onAbortOperation: mockOnAbortOperation,
    onMergeBranch: mockOnMergeBranch,
    onSetMergeTargetBranch: mockOnSetMergeTargetBranch,
    operationState: null as GitOperationState | null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Header
  // =========================================================================
  describe('header', () => {
    it('renders merge section header', () => {
      render(<GitMergeSection {...defaultProps} />);
      
      // Header is in git-menu-section-header, button is separate
      expect(screen.getByText('Merge', { selector: '.git-menu-section-header' })).toBeTruthy();
    });

    it('shows branch count when no operation in progress', () => {
      render(<GitMergeSection {...defaultProps} availableMergeTargets={['feature-a', 'feature-b']} />);
      
      expect(screen.getByText('2')).toBeTruthy();
    });

    it('shows "Active" count when merge/rebase is in progress', () => {
      render(<GitMergeSection {...defaultProps} operationState={{
        success: true,
        isRepo: true,
        inProgress: true,
        mode: 'merge',
        conflicts: [],
        message: 'Merging branch feature-a into main',
      }} />);
      
      expect(screen.getByText('Active')).toBeTruthy();
    });
  });

  // =========================================================================
  // Loading State
  // =========================================================================
  describe('loading state', () => {
    it('shows loading message when checking operation state', () => {
      render(<GitMergeSection {...defaultProps} isLoadingOperation={true} />);
      
      expect(screen.getByText('Checking merge state...')).toBeTruthy();
    });
  });

  // =========================================================================
  // Merge Form (no operation in progress)
  // =========================================================================
  describe('merge form', () => {
    it('renders select dropdown for merge target', () => {
      render(<GitMergeSection {...defaultProps} />);
      
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    it('shows "No branches available" option when no targets', () => {
      render(<GitMergeSection {...defaultProps} availableMergeTargets={[]} />);
      
      expect(screen.getByText('No branches available')).toBeTruthy();
    });

    it('renders available branches in dropdown', () => {
      render(<GitMergeSection {...defaultProps} availableMergeTargets={['feature-a', 'feature-b', 'release-1.0']} />);
      
      expect(screen.getByRole('option', { name: 'feature-a' })).toBeTruthy();
      expect(screen.getByRole('option', { name: 'feature-b' })).toBeTruthy();
      expect(screen.getByRole('option', { name: 'release-1.0' })).toBeTruthy();
    });

    it('disables select when isBusy is true', () => {
      render(<GitMergeSection {...defaultProps} isBusy={true} availableMergeTargets={['feature-a']} />);
      
      expect(screen.getByRole('combobox')).toBeDisabled();
    });

    it('disables select when no targets available', () => {
      render(<GitMergeSection {...defaultProps} availableMergeTargets={[]} />);
      
      expect(screen.getByRole('combobox')).toBeDisabled();
    });

    it('renders merge button', () => {
      render(<GitMergeSection {...defaultProps} />);
      
      expect(screen.getByRole('button', { name: /merge/i })).toBeTruthy();
    });

    it('disables merge button when isBusy is true', () => {
      render(<GitMergeSection {...defaultProps} isBusy={true} />);
      
      expect(screen.getByRole('button', { name: /merge/i })).toBeDisabled();
    });

    it('disables merge button when no branch selected', () => {
      render(<GitMergeSection {...defaultProps} mergeTargetBranch='' />);
      
      expect(screen.getByRole('button', { name: /merge/i })).toBeDisabled();
    });

    it('enables merge button when branch is selected', () => {
      render(<GitMergeSection {...defaultProps} mergeTargetBranch='feature-a' />);
      
      expect(screen.getByRole('button', { name: /merge/i })).not.toBeDisabled();
    });

    it('calls onSetMergeTargetBranch when selection changes', () => {
      render(<GitMergeSection {...defaultProps} availableMergeTargets={['feature-a', 'feature-b']} />);
      
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'feature-b' } });
      expect(mockOnSetMergeTargetBranch).toHaveBeenCalledWith('feature-b');
    });

    it('calls onMergeBranch when merge button is clicked', () => {
      render(<GitMergeSection {...defaultProps} mergeTargetBranch='feature-a' />);
      
      fireEvent.click(screen.getByRole('button', { name: /merge/i }));
      expect(mockOnMergeBranch).toHaveBeenCalled();
    });

    it('shows loader when merge is in progress', () => {
      render(<GitMergeSection {...defaultProps} activeAction='merge:feature-a' isBusy={true} mergeTargetBranch='feature-a' />);
      
      expect(document.querySelector('.spin')).toBeTruthy();
    });
  });

  // =========================================================================
  // Operation In Progress State
  // =========================================================================
  describe('operation in progress', () => {
    const baseOperationState: GitOperationState = {
      success: true,
      isRepo: true,
      inProgress: true,
      mode: 'merge',
      conflicts: [],
      message: 'Merging branch feature-a into main',
    };

    it('shows operation status panel when merge is in progress', () => {
      render(<GitMergeSection {...defaultProps} operationState={baseOperationState} />);
      
      expect(screen.getByText('Merging branch feature-a into main')).toBeTruthy();
    });

    it('shows rebase message when in rebase mode', () => {
      render(<GitMergeSection {...defaultProps} operationState={{
        ...baseOperationState,
        mode: 'rebase',
        message: 'Rebasing onto main',
      }} />);
      
      expect(screen.getByText('Rebasing onto main')).toBeTruthy();
    });

    it('shows abort button', () => {
      render(<GitMergeSection {...defaultProps} operationState={baseOperationState} />);
      
      expect(screen.getByRole('button', { name: /abort merge/i })).toBeTruthy();
    });

    it('shows abort rebase button when in rebase mode', () => {
      render(<GitMergeSection {...defaultProps} operationState={{
        ...baseOperationState,
        mode: 'rebase',
        message: 'Rebasing onto main',
      }} />);
      
      expect(screen.getByRole('button', { name: /abort rebase/i })).toBeTruthy();
    });

    it('disables abort button when isBusy is true', () => {
      render(<GitMergeSection {...defaultProps} operationState={baseOperationState} isBusy={true} />);
      
      expect(screen.getByRole('button', { name: /abort merge/i })).toBeDisabled();
    });

    it('calls onAbortOperation when abort is clicked', () => {
      render(<GitMergeSection {...defaultProps} operationState={baseOperationState} />);
      
      fireEvent.click(screen.getByRole('button', { name: /abort merge/i }));
      expect(mockOnAbortOperation).toHaveBeenCalled();
    });

    it('does not render merge form when operation is in progress', () => {
      render(<GitMergeSection {...defaultProps} operationState={baseOperationState} availableMergeTargets={['feature-a']} />);
      
      expect(screen.queryByRole('combobox')).toBeNull();
      // Abort button contains "Merge" text, so check for the form submit button specifically
      const mergeForm = document.querySelector('.git-merge-form');
      expect(mergeForm).toBeNull();
    });
  });

  // =========================================================================
  // Conflicts Display
  // =========================================================================
  describe('conflicts display', () => {
    it('shows conflict list when there are conflicts', () => {
      render(<GitMergeSection {...defaultProps} operationState={{
        success: true,
        isRepo: true,
        inProgress: true,
        mode: 'merge',
        conflicts: ['src/file1.ts', 'src/file2.ts', 'README.md'],
        message: 'Merge conflict in 3 files',
      }} />);
      
      expect(screen.getByText('src/file1.ts')).toBeTruthy();
      expect(screen.getByText('src/file2.ts')).toBeTruthy();
      expect(screen.getByText('README.md')).toBeTruthy();
    });

    it('does not show conflict list when no conflicts', () => {
      render(<GitMergeSection {...defaultProps} operationState={{
        success: true,
        isRepo: true,
        inProgress: true,
        mode: 'merge',
        conflicts: [],
        message: 'Merging branch feature-a into main',
      }} />);
      
      expect(screen.queryByText('git-conflict-file')).toBeNull();
    });

    it('shows single conflict file', () => {
      render(<GitMergeSection {...defaultProps} operationState={{
        success: true,
        isRepo: true,
        inProgress: true,
        mode: 'merge',
        conflicts: ['src/config.json'],
        message: 'Merge conflict in 1 file',
      }} />);
      
      expect(screen.getByText('src/config.json')).toBeTruthy();
    });
  });

  // =========================================================================
  // CSS Classes
  // =========================================================================
  describe('CSS classes', () => {
    it('applies mode class for merge operation', () => {
      render(<GitMergeSection {...defaultProps} operationState={{
        success: true,
        isRepo: true,
        inProgress: true,
        mode: 'merge',
        conflicts: [],
        message: 'Merging',
      }} />);
      
      expect(document.querySelector('.git-operation-status')).toHaveClass('merge');
    });

    it('applies mode class for rebase operation', () => {
      render(<GitMergeSection {...defaultProps} operationState={{
        success: true,
        isRepo: true,
        inProgress: true,
        mode: 'rebase',
        conflicts: [],
        message: 'Rebasing',
      }} />);
      
      expect(document.querySelector('.git-operation-status')).toHaveClass('rebase');
    });
  });
});
