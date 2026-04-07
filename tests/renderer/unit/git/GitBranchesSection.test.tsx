// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GitBranchesSection } from '../../../../src/renderer/components/git/GitBranchesSection';
import type { GitBranch } from '../../../../src/renderer/components/git/types';

describe('GitBranchesSection', () => {
  // Mock refs
  const mockInputRef = { current: null } as React.RefObject<HTMLInputElement | null>;
  
  // Mock callbacks
  const mockOnCreateBranch = vi.fn();
  const mockOnDeleteBranch = vi.fn();
  const mockOnSetNewBranchName = vi.fn();
  const mockOnSwitchBranch = vi.fn();
  
  const defaultProps = {
    activeAction: null as string | null,
    branches: [] as GitBranch[],
    createBranchInputRef: mockInputRef,
    currentBranch: 'main' as string | null,
    isBusy: false,
    isLoadingBranches: false,
    newBranchName: '',
    onCreateBranch: mockOnCreateBranch,
    onDeleteBranch: mockOnDeleteBranch,
    onSetNewBranchName: mockOnSetNewBranchName,
    onSwitchBranch: mockOnSwitchBranch,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Create Branch Section
  // =========================================================================
  describe('create branch section', () => {
    it('renders create branch form with input and button', () => {
      render(<GitBranchesSection {...defaultProps} />);
      
      expect(screen.getByPlaceholderText('From main')).toBeTruthy();
      expect(screen.getByRole('button', { name: /create/i })).toBeTruthy();
    });

    it('shows placeholder based on current branch', () => {
      render(<GitBranchesSection {...defaultProps} currentBranch="feature-xyz" />);
      
      expect(screen.getByPlaceholderText('From feature-xyz')).toBeTruthy();
    });

    it('shows generic placeholder when no current branch', () => {
      render(<GitBranchesSection {...defaultProps} currentBranch={null} />);
      
      expect(screen.getByPlaceholderText('Branch name')).toBeTruthy();
    });

    it('disables create button when isBusy is true', () => {
      render(<GitBranchesSection {...defaultProps} isBusy={true} />);
      
      const createButton = screen.getByRole('button', { name: /create/i });
      expect(createButton).toBeDisabled();
    });

    it('disables create button when branch name is empty', () => {
      render(<GitBranchesSection {...defaultProps} newBranchName='' />);
      
      const createButton = screen.getByRole('button', { name: /create/i });
      expect(createButton).toBeDisabled();
    });

    it('disables create button when branch name is only whitespace', () => {
      render(<GitBranchesSection {...defaultProps} newBranchName='   ' />);
      
      const createButton = screen.getByRole('button', { name: /create/i });
      expect(createButton).toBeDisabled();
    });

    it('enables create button when branch name is valid', () => {
      render(<GitBranchesSection {...defaultProps} newBranchName='feature-new' />);
      
      const createButton = screen.getByRole('button', { name: /create/i });
      expect(createButton).not.toBeDisabled();
    });

    it('calls onCreateBranch when form is submitted', () => {
      render(<GitBranchesSection {...defaultProps} newBranchName='feature-test' />);
      
      // Submit the form by clicking the create button (form has onSubmit)
      const createButton = screen.getByRole('button', { name: /create/i });
      fireEvent.click(createButton);
      expect(mockOnCreateBranch).toHaveBeenCalled();
    });

    it('calls onSetNewBranchName when input changes', () => {
      render(<GitBranchesSection {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('From main');
      fireEvent.change(input, { target: { value: 'new-branch' } });
      expect(mockOnSetNewBranchName).toHaveBeenCalledWith('new-branch');
    });

    it('shows loader when creating branch', () => {
      render(<GitBranchesSection {...defaultProps} activeAction='create' isBusy={true} />);
      
      // Should show loader icon inside the button
      expect(document.querySelector('.spin')).toBeTruthy();
    });
  });

  // =========================================================================
  // Branch List Section
  // =========================================================================
  describe('branch list section', () => {
    it('renders branch list header with count', () => {
      render(<GitBranchesSection {...defaultProps} branches={[
        { name: 'main', isCurrent: true },
        { name: 'feature', isCurrent: false },
      ]} />);
      
      expect(screen.getByText('Branches')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy(); // Count badge
    });

    it('shows loading state when isLoadingBranches is true', () => {
      render(<GitBranchesSection {...defaultProps} isLoadingBranches={true} />);
      
      expect(screen.getByText('Loading branches...')).toBeTruthy();
    });

    it('shows empty state when no branches', () => {
      render(<GitBranchesSection {...defaultProps} branches={[]} />);
      
      expect(screen.getByText('No local branches found')).toBeTruthy();
    });

    it('renders list of branches with switch and delete buttons', () => {
      render(<GitBranchesSection {...defaultProps} branches={[
        { name: 'main', isCurrent: true },
        { name: 'feature-test', isCurrent: false },
      ]} />);
      
      expect(screen.getByText('main')).toBeTruthy();
      expect(screen.getByText('feature-test')).toBeTruthy();
      expect(screen.getAllByText('Switch').length).toBe(2);
      expect(screen.getAllByText('Delete').length).toBe(2);
    });

    it('marks current branch with label', () => {
      render(<GitBranchesSection {...defaultProps} branches={[
        { name: 'main', isCurrent: true },
        { name: 'feature', isCurrent: false },
      ]} />);
      
      expect(screen.getByText('Current')).toBeTruthy();
    });

    it('disables switch button for current branch', () => {
      render(<GitBranchesSection {...defaultProps} branches={[
        { name: 'main', isCurrent: true },
      ]} />);
      
      const switchButton = screen.getByRole('button', { name: /switch/i });
      expect(switchButton).toBeDisabled();
    });

    it('disables delete button for current branch', () => {
      render(<GitBranchesSection {...defaultProps} branches={[
        { name: 'main', isCurrent: true },
      ]} />);
      
      const deleteButton = screen.getByRole('button', { name: /delete/i });
      expect(deleteButton).toBeDisabled();
    });

    it('enables switch button for non-current branches', () => {
      render(<GitBranchesSection {...defaultProps} branches={[
        { name: 'main', isCurrent: true },
        { name: 'feature', isCurrent: false },
      ]} />);
      
      const switchButtons = screen.getAllByRole('button', { name: /switch/i });
      expect(switchButtons[1]).not.toBeDisabled(); // feature branch
    });

    it('enables delete button for non-current branches', () => {
      render(<GitBranchesSection {...defaultProps} branches={[
        { name: 'main', isCurrent: true },
        { name: 'feature', isCurrent: false },
      ]} />);
      
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      expect(deleteButtons[1]).not.toBeDisabled(); // feature branch
    });

    it('disables all buttons when isBusy is true', () => {
      render(<GitBranchesSection {...defaultProps} isBusy={true} branches={[
        { name: 'feature', isCurrent: false },
      ]} />);
      
      const switchButton = screen.getByRole('button', { name: /switch/i });
      const deleteButton = screen.getByRole('button', { name: /delete/i });
      expect(switchButton).toBeDisabled();
      expect(deleteButton).toBeDisabled();
    });

    it('calls onSwitchBranch when switch button is clicked', () => {
      render(<GitBranchesSection {...defaultProps} branches={[
        { name: 'feature', isCurrent: false },
      ]} />);
      
      fireEvent.click(screen.getByRole('button', { name: /switch/i }));
      expect(mockOnSwitchBranch).toHaveBeenCalledWith('feature');
    });

    it('calls onDeleteBranch when delete button is clicked', () => {
      render(<GitBranchesSection {...defaultProps} branches={[
        { name: 'feature-old', isCurrent: false },
      ]} />);
      
      fireEvent.click(screen.getByRole('button', { name: /delete/i }));
      expect(mockOnDeleteBranch).toHaveBeenCalledWith('feature-old');
    });

    it('shows loader for switch action in progress', () => {
      render(<GitBranchesSection {...defaultProps} activeAction='switch:feature' branches={[
        { name: 'feature', isCurrent: false },
      ]} />);
      
      // Should show loading state for the switch action
      const buttons = screen.getAllByRole('button', { name: /switch/i });
      expect(buttons[0].querySelector('.spin')).toBeTruthy();
    });

    it('shows loader for delete action in progress', () => {
      render(<GitBranchesSection {...defaultProps} activeAction='delete:feature' branches={[
        { name: 'feature', isCurrent: false },
      ]} />);
      
      const buttons = screen.getAllByRole('button', { name: /delete/i });
      expect(buttons[0].querySelector('.spin')).toBeTruthy();
    });
  });
});
