// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { installElectronApiMock } from '../../setup/electron';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import ConfirmCloseDialog from '../../../src/renderer/components/ConfirmCloseDialog';

describe('ConfirmCloseDialog', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Test Title',
    message: 'Test message content',
    options: [
      { label: 'Save', variant: 'primary' as const, action: vi.fn() },
      { label: "Don't Save", variant: 'danger' as const, action: vi.fn() },
    ],
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    installElectronApiMock();
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, browserOverlayCount: 0 });
  });

  it('renders dialog when isOpen is true', () => {
    render(<ConfirmCloseDialog {...defaultProps} />);
    expect(screen.getByRole('alertdialog', { name: 'Test Title' })).toHaveAccessibleDescription('Test message content');
    expect(screen.getByText('Test message content')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<ConfirmCloseDialog {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Test Title')).not.toBeInTheDocument();
  });

  it('renders title and message', () => {
    render(<ConfirmCloseDialog {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Test Title' })).toBeInTheDocument();
    expect(screen.getByText('Test message content')).toBeInTheDocument();
  });

  it('renders all option buttons', () => {
    render(<ConfirmCloseDialog {...defaultProps} />);
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText("Don't Save")).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onCancel when Escape is pressed', () => {
    render(<ConfirmCloseDialog {...defaultProps} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when overlay is clicked', () => {
    render(<ConfirmCloseDialog {...defaultProps} />);
    const overlay = document.querySelector('.confirm-close-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls the correct action when an option button is clicked', () => {
    const saveAction = vi.fn();
    const dontSaveAction = vi.fn();
    render(
      <ConfirmCloseDialog
        {...defaultProps}
        options={[
          { label: 'Save', variant: 'primary', action: saveAction },
          { label: "Don't Save", variant: 'danger', action: dontSaveAction },
        ]}
      />
    );

    fireEvent.click(screen.getByText('Save'));
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(dontSaveAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Don't Save"));
    expect(dontSaveAction).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel button is clicked', () => {
    render(<ConfirmCloseDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });
  it('focuses Cancel and restores the origin after controlled cancellation', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Close file</button>
        <ConfirmCloseDialog {...defaultProps} isOpen={open} onCancel={() => setOpen(false)} />
      </>;
    }
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByText('Close file'));
    expect(screen.getByText('Cancel')).toHaveFocus();
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(1);
    await user.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.getByText('Close file')).toHaveFocus());
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(0);
  });

  it('does not cancel from inside content or after confirming', () => {
    render(<ConfirmCloseDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Test message content'));
    fireEvent.click(screen.getByText("Don't Save"));
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
    expect(defaultProps.options[1].action).toHaveBeenCalledTimes(1);
  });

  it('releases suppression on close and unmount, preserving another owner', () => {
    useWorkspaceStore.getState().pushBrowserOverlay();
    const { rerender, unmount } = render(<ConfirmCloseDialog {...defaultProps} />);
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(2);
    rerender(<ConfirmCloseDialog {...defaultProps} isOpen={false} />);
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(1);
    rerender(<ConfirmCloseDialog {...defaultProps} />);
    unmount();
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(1);
  });

});
