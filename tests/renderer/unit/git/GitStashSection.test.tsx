// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GitStashSection } from '../../../../src/renderer/components/git/GitStashSection';
import type { GitStashEntry } from '../../../../src/renderer/components/git/types';

describe('GitStashSection', () => {
  // Mock callbacks
  const mockOnApplyStash = vi.fn();
  const mockOnClearStashes = vi.fn();
  const mockOnDropStash = vi.fn();
  const mockOnPopStash = vi.fn();
  const mockOnSetIncludeUntracked = vi.fn();
  const mockOnSetStashMessage = vi.fn();
  const mockOnStash = vi.fn();
  
  const defaultProps = {
    activeAction: null as string | null,
    includeUntracked: true,
    isBusy: false,
    isLoadingStashes: false,
    onApplyStash: mockOnApplyStash,
    onClearStashes: mockOnClearStashes,
    onDropStash: mockOnDropStash,
    onPopStash: mockOnPopStash,
    onSetIncludeUntracked: mockOnSetIncludeUntracked,
    onSetStashMessage: mockOnSetStashMessage,
    onStash: mockOnStash,
    stashMessage: '',
    stashes: [] as GitStashEntry[],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Stash Form Section
  // =========================================================================
  describe('stash form', () => {
    it('renders stash section with header and count', () => {
      render(<GitStashSection {...defaultProps} stashes={[]} />);
      
      // Header is in git-menu-section-header, button is separate
      expect(screen.getByText('Stash', { selector: '.git-menu-section-header' })).toBeTruthy();
      expect(screen.getByText('0')).toBeTruthy(); // Count badge
    });

    it('renders message input', () => {
      render(<GitStashSection {...defaultProps} />);
      
      expect(screen.getByPlaceholderText('Optional stash message')).toBeTruthy();
    });

    it('renders untracked checkbox', () => {
      render(<GitStashSection {...defaultProps} />);
      
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeTruthy();
      expect(checkbox).toBeChecked();
    });

    it('renders stash button', () => {
      render(<GitStashSection {...defaultProps} />);
      
      expect(screen.getByRole('button', { name: /stash/i })).toBeTruthy();
    });

    it('disables stash button when isBusy is true', () => {
      render(<GitStashSection {...defaultProps} isBusy={true} />);
      
      expect(screen.getByRole('button', { name: /stash/i })).toBeDisabled();
    });

    it('disables input when isBusy is true', () => {
      render(<GitStashSection {...defaultProps} isBusy={true} />);
      
      const input = screen.getByPlaceholderText('Optional stash message');
      expect(input).toBeDisabled();
    });

    it('disables checkbox when isBusy is true', () => {
      render(<GitStashSection {...defaultProps} isBusy={true} />);
      
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeDisabled();
    });

    it('calls onSetStashMessage when message input changes', () => {
      render(<GitStashSection {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('Optional stash message');
      fireEvent.change(input, { target: { value: 'WIP: feature work' } });
      expect(mockOnSetStashMessage).toHaveBeenCalledWith('WIP: feature work');
    });

    it('calls onSetIncludeUntracked when checkbox changes', () => {
      render(<GitStashSection {...defaultProps} />);
      
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      expect(mockOnSetIncludeUntracked).toHaveBeenCalledWith(false);
    });

    it('calls onStash when stash button is clicked', () => {
      render(<GitStashSection {...defaultProps} />);
      
      fireEvent.click(screen.getByRole('button', { name: /stash/i }));
      expect(mockOnStash).toHaveBeenCalled();
    });

    it('shows loader when stash action is in progress', () => {
      render(<GitStashSection {...defaultProps} activeAction='stash' isBusy={true} />);
      
      expect(document.querySelector('.spin')).toBeTruthy();
    });
  });

  // =========================================================================
  // Stash Toolbar
  // =========================================================================
  describe('stash toolbar', () => {
    it('shows "No stashes found" when stash list is empty', () => {
      render(<GitStashSection {...defaultProps} stashes={[]} />);
      
      expect(screen.getByText('No stashes found')).toBeTruthy();
    });

    it('shows "Available stashes" when stashes exist', () => {
      render(<GitStashSection {...defaultProps} stashes={[
        { hash: 'abc123', ref: 'stash@{0}', message: 'WIP on main: abc123' },
      ]} />);
      
      expect(screen.getByText('Available stashes')).toBeTruthy();
    });

    it('shows Clear All button when stashes exist', () => {
      render(<GitStashSection {...defaultProps} stashes={[
        { hash: 'abc123', ref: 'stash@{0}', message: 'WIP on main: abc123' },
      ]} />);
      
      expect(screen.getByRole('button', { name: /clear all/i })).toBeTruthy();
    });

    it('hides Clear All button when no stashes', () => {
      render(<GitStashSection {...defaultProps} stashes={[]} />);
      
      expect(screen.queryByRole('button', { name: /clear all/i })).toBeNull();
    });

    it('disables Clear All button when isBusy is true', () => {
      render(<GitStashSection {...defaultProps} isBusy={true} stashes={[
        { hash: 'abc123', ref: 'stash@{0}', message: 'WIP on main: abc123' },
      ]} />);
      
      expect(screen.getByRole('button', { name: /clear all/i })).toBeDisabled();
    });

    it('calls onClearStashes when Clear All is clicked', () => {
      render(<GitStashSection {...defaultProps} stashes={[
        { hash: 'abc123', ref: 'stash@{0}', message: 'WIP on main: abc123' },
      ]} />);
      
      fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
      expect(mockOnClearStashes).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Loading & Empty States
  // =========================================================================
  describe('loading and empty states', () => {
    it('shows loading state when isLoadingStashes is true', () => {
      render(<GitStashSection {...defaultProps} isLoadingStashes={true} />);
      
      expect(screen.getByText('Loading stashes...')).toBeTruthy();
    });

    it('shows "Nothing stashed yet" when no stashes', () => {
      render(<GitStashSection {...defaultProps} stashes={[]} />);
      
      expect(screen.getByText('Nothing stashed yet')).toBeTruthy();
    });

    it('does not show stash list when empty', () => {
      render(<GitStashSection {...defaultProps} stashes={[]} />);
      
      expect(screen.queryByText(/stash@/)).toBeNull();
    });
  });

  // =========================================================================
  // Stash List
  // =========================================================================
  describe('stash list', () => {
    const mockStash: GitStashEntry = {
      hash: 'abc123def456',
      ref: 'stash@{0}',
      message: 'WIP on main: abc123 initial commit',
    };

    it('renders stash list with stash entries', () => {
      render(<GitStashSection {...defaultProps} stashes={[mockStash]} />);
      
      expect(screen.getByText('stash@{0}')).toBeTruthy();
      expect(screen.getByText('WIP on main: abc123 initial commit')).toBeTruthy();
    });

    it('renders Apply, Pop, and Drop buttons for each stash', () => {
      render(<GitStashSection {...defaultProps} stashes={[mockStash]} />);
      
      expect(screen.getAllByRole('button', { name: /apply/i }).length).toBe(1);
      expect(screen.getAllByRole('button', { name: /pop/i }).length).toBe(1);
      expect(screen.getAllByRole('button', { name: /drop/i }).length).toBe(1);
    });

    it('disables action buttons when isBusy is true', () => {
      render(<GitStashSection {...defaultProps} isBusy={true} stashes={[mockStash]} />);
      
      expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /pop/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /drop/i })).toBeDisabled();
    });

    it('calls onApplyStash with stash ref when Apply is clicked', () => {
      render(<GitStashSection {...defaultProps} stashes={[mockStash]} />);
      
      fireEvent.click(screen.getByRole('button', { name: /apply/i }));
      expect(mockOnApplyStash).toHaveBeenCalledWith('stash@{0}');
    });

    it('calls onPopStash with stash ref when Pop is clicked', () => {
      render(<GitStashSection {...defaultProps} stashes={[mockStash]} />);
      
      fireEvent.click(screen.getByRole('button', { name: /pop/i }));
      expect(mockOnPopStash).toHaveBeenCalledWith('stash@{0}');
    });

    it('calls onDropStash with stash ref when Drop is clicked', () => {
      render(<GitStashSection {...defaultProps} stashes={[mockStash]} />);
      
      fireEvent.click(screen.getByRole('button', { name: /drop/i }));
      expect(mockOnDropStash).toHaveBeenCalledWith('stash@{0}');
    });

    it('renders multiple stash entries', () => {
      const stashes: GitStashEntry[] = [
        { hash: 'aaa111', ref: 'stash@{0}', message: 'First stash' },
        { hash: 'bbb222', ref: 'stash@{1}', message: 'Second stash' },
        { hash: 'ccc333', ref: 'stash@{2}', message: 'Third stash' },
      ];
      
      render(<GitStashSection {...defaultProps} stashes={stashes} />);
      
      expect(screen.getByText('stash@{0}')).toBeTruthy();
      expect(screen.getByText('stash@{1}')).toBeTruthy();
      expect(screen.getByText('stash@{2}')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: /apply/i }).length).toBe(3);
    });

    it('updates count badge when stashes change', () => {
      const { rerender } = render(<GitStashSection {...defaultProps} stashes={[]} />);
      expect(screen.getByText('0')).toBeTruthy();
      
      rerender(<GitStashSection {...defaultProps} stashes={[mockStash]} />);
      expect(screen.getByText('1')).toBeTruthy();
    });
  });
});
