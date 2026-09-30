import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WindowControls from '../../../src/renderer/components/WindowControls';
import { installElectronApiMock } from '../../setup/electron';

beforeEach(() => { installElectronApiMock(); });

describe('WindowControls', () => {
  it('queries the window state and exposes named native buttons with matching titles', async () => {
    await act(async () => { render(<WindowControls />); });
    expect(window.electronAPI.isMaximizedWindow).toHaveBeenCalledExactlyOnceWith();
    for (const name of ['Minimize window', 'Maximize window', 'Close window']) {
      const button = screen.getByRole('button', { name });
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('title', name);
    }
  });

  it('initializes the Restore label when the window is maximized', async () => {
    vi.mocked(window.electronAPI.isMaximizedWindow).mockResolvedValue(true);
    render(<WindowControls />);
    expect(await screen.findByRole('button', { name: 'Restore window' })).toHaveAttribute('title', 'Restore window');
    expect(screen.queryByRole('button', { name: 'Maximize window' })).not.toBeInTheDocument();
  });

  it('falls back safely when initial lookup rejects', async () => {
    vi.mocked(window.electronAPI.isMaximizedWindow).mockRejectedValue(new Error('Window unavailable'));
    await act(async () => { render(<WindowControls />); });
    expect(screen.getByRole('button', { name: 'Maximize window' })).toBeEnabled();
  });

  it('invokes minimize and close independently', async () => {
    const user = userEvent.setup();
    render(<WindowControls />);
    await user.click(screen.getByRole('button', { name: 'Minimize window' }));
    expect(window.electronAPI.minimizeWindow).toHaveBeenCalledExactlyOnceWith();
    expect(window.electronAPI.closeWindow).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close window' }));
    expect(window.electronAPI.closeWindow).toHaveBeenCalledExactlyOnceWith();
  });

  it('toggles Maximize to Restore and back after successful IPC calls', async () => {
    const user = userEvent.setup();
    render(<WindowControls />);
    await user.click(screen.getByRole('button', { name: 'Maximize window' }));
    expect(window.electronAPI.toggleMaximizeWindow).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByRole('button', { name: 'Restore window' })).toHaveAttribute('title', 'Restore window');
    await user.click(screen.getByRole('button', { name: 'Restore window' }));
    expect(window.electronAPI.toggleMaximizeWindow).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Maximize window' })).toHaveAttribute('title', 'Maximize window');
  });

  it('does not update the label or leave an unhandled rejection when toggle fails', async () => {
    const user = userEvent.setup();
    const error = new Error('Cannot maximize');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(window.electronAPI.toggleMaximizeWindow).mockRejectedValueOnce(error);
    render(<WindowControls />);
    await user.click(screen.getByRole('button', { name: 'Maximize window' }));
    expect(log).toHaveBeenCalledWith('Failed to toggle window maximization:', error);
    expect(screen.getByRole('button', { name: 'Maximize window' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Maximize window' }));
    expect(screen.getByRole('button', { name: 'Restore window' })).toBeInTheDocument();
  });

  it('supports Tab, Enter and Space through native keyboard activation', async () => {
    const user = userEvent.setup();
    render(<WindowControls />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Minimize window' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(window.electronAPI.minimizeWindow).toHaveBeenCalledOnce();
    await user.tab();
    await user.keyboard(' ');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore window' })).toHaveFocus());
    expect(window.electronAPI.toggleMaximizeWindow).toHaveBeenCalledOnce();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close window' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(window.electronAPI.closeWindow).toHaveBeenCalledOnce();
  });

  it('retains each titlebar context through class extensions', () => {
    const { container } = render(<WindowControls className="context-controls" buttonClassName="context-button" closeClassName="context-close" />);
    expect(container.firstElementChild).toHaveClass('window-controls', 'context-controls');
    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('window-controls-button', 'context-button');
    expect(screen.getByRole('button', { name: 'Close window' })).toHaveClass('window-controls-close', 'context-close');
  });
});
