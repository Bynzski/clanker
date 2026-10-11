// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitDropStashDialog } from '../../../../src/renderer/components/git/GitDropStashDialog';
import { installElectronApiMock } from '../../../setup/electron';

describe('GitDropStashDialog', () => {
  beforeEach(() => {
    installElectronApiMock();
  });

  const stash = { ref: 'stash@{0}', hash: 'abc1234567', message: 'WIP on test' };

  it('renders stash details and handles cancel and drop', () => {
    const onCancel = vi.fn();
    const onConfirmDrop = vi.fn();

    render(
      <GitDropStashDialog
        stash={stash}
        isBusy={false}
        onCancel={onCancel}
        onConfirmDrop={onConfirmDrop}
        workspaceId="ws"
      />
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/Drop stash@\{0\}\?/)).toBeInTheDocument();
    expect(screen.getByText('WIP on test')).toBeInTheDocument();
    expect(screen.getByText(/\(abc1234\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirmDrop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Drop stash' }));
    expect(onConfirmDrop).toHaveBeenCalledOnce();
  });

  it('disables buttons when isBusy is true', () => {
    const onCancel = vi.fn();
    const onConfirmDrop = vi.fn();

    render(
      <GitDropStashDialog
        stash={stash}
        isBusy={true}
        onCancel={onCancel}
        onConfirmDrop={onConfirmDrop}
        workspaceId="ws"
      />
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Drop stash' })).toBeDisabled();
  });
});
