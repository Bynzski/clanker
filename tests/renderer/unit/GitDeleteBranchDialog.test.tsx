// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GitDeleteBranchDialog } from '../../../src/renderer/components/git/GitDeleteBranchDialog';

describe('GitDeleteBranchDialog', () => {
  it('renders normal delete confirmation and triggers confirm on click', () => {
    const onCancel = vi.fn();
    const onConfirmDelete = vi.fn();
    render(
      <GitDeleteBranchDialog
        currentBranch="main"
        deleteDialog={{ branch: 'feature/login', stage: 'confirm' }}
        isBusy={false}
        onCancel={onCancel}
        onConfirmDelete={onConfirmDelete}
      />
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getAllByText('Delete branch')).toHaveLength(2);
    expect(screen.getByText('feature/login')).toBeInTheDocument();

    const deleteBtn = screen.getByRole('button', { name: 'Delete branch' });
    expect(deleteBtn).toHaveAttribute('data-variant', 'primary');
    fireEvent.click(deleteBtn);
    expect(onConfirmDelete).toHaveBeenCalledWith(false);
  });

  it('renders force delete stage with danger button, warning copy, and details', () => {
    const onCancel = vi.fn();
    const onConfirmDelete = vi.fn();
    render(
      <GitDeleteBranchDialog
        currentBranch="main"
        deleteDialog={{
          branch: 'feature/unmerged',
          stage: 'force',
          detail: 'error: The branch is not fully merged.',
        }}
        isBusy={false}
        onCancel={onCancel}
        onConfirmDelete={onConfirmDelete}
      />
    );

    expect(screen.getByText('Force delete branch')).toBeInTheDocument();
    expect(screen.getByText(/not merged into main/)).toBeInTheDocument();
    expect(screen.getByText('error: The branch is not fully merged.')).toBeInTheDocument();

    const forceBtn = screen.getByRole('button', { name: 'Force Delete' });
    expect(forceBtn).toHaveAttribute('data-variant', 'danger');
    fireEvent.click(forceBtn);
    expect(onConfirmDelete).toHaveBeenCalledWith(true);
  });

  it('handles Cancel button click', () => {
    const onCancel = vi.fn();
    render(
      <GitDeleteBranchDialog
        currentBranch="main"
        deleteDialog={{ branch: 'feature/login', stage: 'confirm' }}
        isBusy={false}
        onCancel={onCancel}
        onConfirmDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('handles Escape key dismissal when not busy', () => {
    const onCancel = vi.fn();
    render(
      <GitDeleteBranchDialog
        currentBranch="main"
        deleteDialog={{ branch: 'feature/login', stage: 'confirm' }}
        isBusy={false}
        onCancel={onCancel}
        onConfirmDelete={vi.fn()}
      />
    );

    const dialog = screen.getByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('prevents Escape and disables actions while busy', () => {
    const onCancel = vi.fn();
    const onConfirmDelete = vi.fn();
    render(
      <GitDeleteBranchDialog
        currentBranch="main"
        deleteDialog={{ branch: 'feature/login', stage: 'confirm' }}
        isBusy={true}
        onCancel={onCancel}
        onConfirmDelete={onConfirmDelete}
      />
    );

    const deleteBtn = screen.getByRole('button', { name: /Delete branch/ });
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    expect(deleteBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();

    const dialog = screen.getByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
