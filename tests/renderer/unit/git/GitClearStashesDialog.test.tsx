// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitClearStashesDialog } from '../../../../src/renderer/components/git/GitClearStashesDialog';
import { installElectronApiMock } from '../../../setup/electron';

describe('GitClearStashesDialog', () => {
  beforeEach(() => {
    installElectronApiMock();
  });

  it('renders count and handles cancel and clear', () => {
    const onCancel = vi.fn();
    const onConfirmClear = vi.fn();

    render(
      <GitClearStashesDialog
        stashCount={3}
        isBusy={false}
        onCancel={onCancel}
        onConfirmClear={onConfirmClear}
        workspaceId="ws"
      />
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Clear all stashes?')).toBeInTheDocument();
    expect(screen.getByText(/delete all 3 saved stashes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirmClear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all stashes' }));
    expect(onConfirmClear).toHaveBeenCalledOnce();
  });

  it('disables buttons when isBusy is true', () => {
    const onCancel = vi.fn();
    const onConfirmClear = vi.fn();

    render(
      <GitClearStashesDialog
        stashCount={1}
        isBusy={true}
        onCancel={onCancel}
        onConfirmClear={onConfirmClear}
        workspaceId="ws"
      />
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear all stashes' })).toBeDisabled();
  });
});
