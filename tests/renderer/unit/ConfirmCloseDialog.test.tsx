// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  });

  it('renders dialog when isOpen is true', () => {
    render(<ConfirmCloseDialog {...defaultProps} />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
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
    if (overlay) {
      fireEvent.click(overlay);
    }
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
});
