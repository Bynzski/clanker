// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitAbortOperationDialog } from '../../../../src/renderer/components/git/GitAbortOperationDialog';
import { installElectronApiMock } from '../../../setup/electron';

describe('GitAbortOperationDialog', () => {
  beforeEach(() => {
    installElectronApiMock();
  });

  it('renders mode and conflict details and handles cancel and abort', () => {
    const onCancel = vi.fn();
    const onConfirmAbort = vi.fn();

    render(
      <GitAbortOperationDialog
        mode="merge"
        conflicts={['file1.ts', 'file2.ts']}
        isBusy={false}
        onCancel={onCancel}
        onConfirmAbort={onConfirmAbort}
        workspaceId="ws"
      />
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Abort merge?')).toBeInTheDocument();
    expect(screen.getByText(/Unresolved conflicts in 2 files/)).toBeInTheDocument();
    expect(screen.getByText('file1.ts')).toBeInTheDocument();
    expect(screen.getByText('file2.ts')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirmAbort).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Abort merge' }));
    expect(onConfirmAbort).toHaveBeenCalledOnce();
  });

  it('renders rebase mode correctly', () => {
    const onCancel = vi.fn();
    const onConfirmAbort = vi.fn();

    render(
      <GitAbortOperationDialog
        mode="rebase"
        conflicts={[]}
        isBusy={false}
        onCancel={onCancel}
        onConfirmAbort={onConfirmAbort}
        workspaceId="ws"
      />
    );

    expect(screen.getByText('Abort rebase?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abort rebase' })).toBeInTheDocument();
  });

  it('disables buttons when isBusy is true', () => {
    const onCancel = vi.fn();
    const onConfirmAbort = vi.fn();

    render(
      <GitAbortOperationDialog
        mode="merge"
        conflicts={[]}
        isBusy={true}
        onCancel={onCancel}
        onConfirmAbort={onConfirmAbort}
        workspaceId="ws"
      />
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Abort merge' })).toBeDisabled();
  });
});
