// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitRemoveRemoteDialog } from '../../../../src/renderer/components/git/GitRemoveRemoteDialog';
import { installElectronApiMock } from '../../../setup/electron';

describe('GitRemoveRemoteDialog', () => {
  beforeEach(() => {
    installElectronApiMock();
  });

  const remote = {
    name: 'origin',
    fetchUrl: 'https://github.com/test/repo.git',
    pushUrl: 'git@github.com:test/repo.git',
  };

  it('renders remote details including push url and handles cancel and remove', () => {
    const onCancel = vi.fn();
    const onConfirmRemove = vi.fn();

    render(
      <GitRemoveRemoteDialog
        remote={remote}
        isBusy={false}
        onCancel={onCancel}
        onConfirmRemove={onConfirmRemove}
        workspaceId="ws"
      />
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText("Remove remote 'origin'?", { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText(/Fetch URL: https:\/\/github\.com\/test\/repo\.git/)).toBeInTheDocument();
    expect(screen.getByText(/Push URL: git@github\.com:test\/repo\.git/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirmRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove remote' }));
    expect(onConfirmRemove).toHaveBeenCalledOnce();
  });

  it('disables buttons when isBusy is true', () => {
    const onCancel = vi.fn();
    const onConfirmRemove = vi.fn();

    render(
      <GitRemoveRemoteDialog
        remote={remote}
        isBusy={true}
        onCancel={onCancel}
        onConfirmRemove={onConfirmRemove}
        workspaceId="ws"
      />
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove remote' })).toBeDisabled();
  });
});
