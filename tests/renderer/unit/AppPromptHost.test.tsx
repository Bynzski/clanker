import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppPromptHost from '../../../src/renderer/components/AppPromptHost';
import { requestAppPrompt, showAppError, useAppPromptStore } from '../../../src/renderer/lib/appPrompt';
import { installElectronApiMock } from '../../setup/electron';

beforeEach(() => { installElectronApiMock(); useAppPromptStore.setState({ queue: [] }); });
describe('shared application prompts', () => {
  it('focuses the safe action, ignores backdrop, cancels on Enter/Escape and returns focus', async () => {
    const user = userEvent.setup();
    render(<><button>Origin</button><AppPromptHost /></>);
    screen.getByText('Origin').focus();
    let result!: Promise<boolean>;
    act(() => { result = requestAppPrompt({ title: 'Delete file?', description: 'This cannot be undone.', confirmLabel: 'Delete' }); });
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription('This cannot be undone.');
    expect(screen.getByText('Cancel')).toHaveFocus();
    await user.click(document.querySelector('.clanker-dialog-overlay')!);
    expect(screen.getByRole('alertdialog')).toBeVisible();
    screen.getByText('Cancel').focus(); await user.keyboard('{Enter}');
    expect(await result).toBe(false);
    await waitFor(() => expect(screen.getByText('Origin')).toHaveFocus());
    act(() => { result = requestAppPrompt({ title: 'Delete file?', description: 'Cannot undo', confirmLabel: 'Delete' }); });
    await user.keyboard('{Escape}'); expect(await result).toBe(false);
  });
  it('presents queued errors and confirms only an explicit action', async () => {
    const user = userEvent.setup(); render(<AppPromptHost />);
    let result!: Promise<boolean>;
    act(() => { showAppError('Permission denied'); result = requestAppPrompt({ title: 'Delete recipe?', description: 'Cannot undo', confirmLabel: 'Delete recipe' }); });
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Permission denied');
    await user.click(screen.getByText('OK'));
    expect(screen.getByText('Cancel')).toHaveFocus();
    await user.click(screen.getByText('Delete recipe')); expect(await result).toBe(true);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('subscribes before readiness, reports choices by request id, and handles main cancellation', async () => {
    const user = userEvent.setup(); let receive!: (id: string | null) => void;
    const unsubscribe = vi.fn();
    installElectronApiMock({ onAppCloseRequest: vi.fn((callback) => { receive = callback; return unsubscribe; }) });
    const { unmount } = render(<AppPromptHost />);
    expect(window.electronAPI.appCloseReady).toHaveBeenCalledWith(true);
    act(() => receive('first'));
    expect(screen.getByText('Keep Clanker Open')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(window.electronAPI.respondAppClose).toHaveBeenLastCalledWith('first', false);
    act(() => receive('second')); act(() => receive(null));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => receive('third')); await user.click(screen.getByText('Close Anyway'));
    expect(window.electronAPI.respondAppClose).toHaveBeenLastCalledWith('third', true);
    unmount(); expect(unsubscribe).toHaveBeenCalledOnce();
    expect(window.electronAPI.appCloseReady).toHaveBeenLastCalledWith(false);
  });
});
