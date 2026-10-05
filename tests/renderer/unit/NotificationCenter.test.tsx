import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationCenter, ToastViewport } from '../../../src/renderer/components/NotificationCenter';
import { useNotificationStore, MAX_VISIBLE_TOASTS, TOAST_DURATION_MS } from '../../../src/renderer/store/notificationStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { useAssistantSurfaceStore } from '../../../src/renderer/store/assistantSurfaceStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

const store = () => useNotificationStore.getState();
beforeEach(() => {
  installElectronApiMock();
  useAssistantNavStore.setState({ activeAssistantId: null, openedAssistantIds: [] });
  useAssistantSurfaceStore.setState({ byId: {} });
  useNotificationStore.setState({ notifications: [] });
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
});
afterEach(() => vi.useRealTimers());

describe('notifications', () => {
  it('stacks tones with appropriate live roles and keyboard dismissal', () => {
    render(<ToastViewport />);
    act(() => {
      store().show({ tone: 'warning', message: 'left on disk' });
      store().show({ tone: 'success', message: 'saved' });
      store().show({ tone: 'error', message: 'failed' });
    });
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('saved');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Dismiss notification: left on disk' }), { key: 'Escape' });
    expect(screen.queryByText('left on disk')).toBeNull();
    expect(store().notifications.find((entry) => entry.message === 'left on disk')?.dismissed).toBe(true);
  });

  it('expires routine tones while warning/error persist and dismissed messages remain in history', () => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    act(() => { store().show({ tone: 'info', message: 'routine' }); store().show({ tone: 'warning', message: 'warning' }); store().show({ tone: 'error', message: 'error' }); });
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(screen.queryByText('routine')).toBeNull();
    act(() => { store().show({ tone: 'success', message: 'success' }); });
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByText('success')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(store().notifications).toHaveLength(4);
  });

  it.each(['warning', 'error'] as const)('shows a new %s when three older persistent warnings occupy the toast slots', async (tone) => {
    vi.useFakeTimers();
    render(<><ToastViewport /><NotificationCenter /></>);
    act(() => {
      for (let i = 0; i < MAX_VISIBLE_TOASTS; i++) store().show({ tone: 'warning', message: `older warning ${i}` });
    });
    expect(screen.getAllByRole('alert')).toHaveLength(MAX_VISIBLE_TOASTS);
    act(() => { store().show({ tone, message: 'new urgent outcome' }); });
    expect(screen.getAllByRole('alert').map((card) => card.textContent)).toEqual([
      'older warning 1', 'older warning 2', 'new urgent outcome',
    ]);
    expect(screen.queryByText('older warning 0')).toBeNull();
    expect(screen.getByText('1 more in notification history')).toBeTruthy();
    act(() => vi.advanceTimersByTime(60_000));
    expect(store().notifications).toHaveLength(4);
    expect(store().notifications.every((entry) => !entry.dismissed && !entry.read)).toBe(true);

    // Restore real timers for Radix focus/portal scheduling after proving persistence.
    vi.useRealTimers();
    // Overflow is still available in history, and only explicit dismissal retires a warning.
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 4 unread' }));
    const history = await screen.findByRole('dialog', { name: 'Notification history' });
    for (const message of ['older warning 0', 'older warning 1', 'older warning 2', 'new urgent outcome']) {
      expect(within(history).getByText(message)).toBeTruthy();
    }
    expect(store().notifications.every((entry) => !entry.dismissed)).toBe(true);
    fireEvent.click(within(history).getByRole('button', { name: 'Dismiss notification: older warning 0' }));
    expect(store().notifications.filter((entry) => !entry.dismissed)).toHaveLength(3);
    expect(store().notifications).toHaveLength(4);
    expect(within(history).getByText('older warning 0')).toBeTruthy();
  });

  it.each(['before', 'after'] as const)('archives a routine burst raised %s persistent warnings without losing pending warnings', (order) => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    const warnings = () => { for (let i = 0; i < MAX_VISIBLE_TOASTS; i++) store().show({ tone: 'warning', message: `warning ${i}` }); };
    const routines = () => { for (let i = 0; i < 10; i++) store().show({ tone: 'success', message: `routine ${i}` }); };
    act(() => {
      if (order === 'before') { routines(); warnings(); } else { warnings(); routines(); }
    });
    if (order === 'before') {
      expect(screen.getAllByRole('alert')).toHaveLength(MAX_VISIBLE_TOASTS);
    } else {
      expect(screen.getAllByRole('status').map((card) => card.textContent)).toEqual(['routine 7', 'routine 8', 'routine 9']);
      expect(screen.queryByRole('alert')).toBeNull();
    }
    expect(screen.getByText('10 more in notification history')).toBeTruthy();
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(store().notifications.filter((entry) => !entry.dismissed)).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(store().notifications).toHaveLength(13);
    expect(store().notifications.every((entry) => !entry.read)).toBe(true);
    expect(screen.getAllByRole('alert')).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(screen.queryByText('10 more in notification history')).toBeNull();
  });

  it('renews a deduplicated toast without letting its previous timer dismiss it', () => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    act(() => { store().show({ tone: 'info', message: 'first', dedupeKey: 'same' }); });
    act(() => vi.advanceTimersByTime(5_000));
    act(() => { store().show({ tone: 'info', message: 'updated', dedupeKey: 'same' }); });
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('updated')).toBeTruthy();
    expect(screen.queryByText('first')).toBeNull();
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.queryByText('updated')).toBeNull();
  });

  it('gives a deduped replacement a fresh visible lifetime after its original was pushed into the queue', () => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    act(() => { store().show({ tone: 'info', message: 'first', dedupeKey: 'same' }); });
    act(() => {
      for (let i = 0; i < MAX_VISIBLE_TOASTS; i++) store().show({ tone: 'warning', message: `warning ${i}` });
    });
    expect(screen.queryByText('first')).toBeNull();
    act(() => vi.advanceTimersByTime(5_000));
    act(() => { store().show({ tone: 'info', message: 'updated', dedupeKey: 'same' }); });
    expect(screen.getByRole('status')).toHaveTextContent('updated');
    act(() => vi.advanceTimersByTime(2_000)); // past the old queued notice's deadline
    expect(screen.getByRole('status')).toHaveTextContent('updated');
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.queryByRole('status')).toBeNull();
    expect(store().notifications).toHaveLength(4);
    expect(store().notifications.find((entry) => entry.message === 'updated')).toMatchObject({ dismissed: true, read: false });
    expect(store().notifications.filter((entry) => !entry.dismissed)).toHaveLength(MAX_VISIBLE_TOASTS);
  });

  it('pauses expiry on hover and keyboard focus, then resumes the remaining time', () => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    act(() => { store().show({ tone: 'info', message: 'read me' }); });
    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(10_000));
    fireEvent.focus(screen.getByRole('button', { name: 'Dismiss notification: read me' }));
    fireEvent.mouseLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('read me')).toBeTruthy();
    fireEvent.blur(screen.getByRole('button', { name: 'Dismiss notification: read me' }));
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.queryByText('read me')).toBeNull();
  });

  it('opens recent history, marks it read, and only clears dismissed messages', async () => {
    const warning = store().show({ tone: 'warning', message: 'retained', workspaceId: 'closed', workspaceName: 'Old project' });
    store().dismiss(store().show({ tone: 'info', message: 'past' }));
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    const history = await screen.findByRole('dialog', { name: 'Notification history' });
    expect(within(history).getByText('past')).toBeTruthy();
    expect(within(history).getByText('Old project')).toBeTruthy();
    expect(store().notifications.every((entry) => entry.read)).toBe(true);
    fireEvent.click(within(history).getByRole('button', { name: 'Clear dismissed' }));
    expect(store().notifications).toMatchObject([{ id: warning, dismissed: false }]);
    fireEvent.keyDown(history, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the existing overlay lease while history is open, and releases it on close', async () => {
    const ws = createWorkspaceFixture({ id: 'ws', browserVisible: true });
    useWorkspaceStore.setState({ workspaces: [ws], activeWorkspaceId: ws.id });
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    const history = await screen.findByRole('dialog');
    expect(useWorkspaceStore.getState().workspaces[0].browserOverlayCount).toBe(1);
    fireEvent.keyDown(history, { key: 'Escape' });
    expect(useWorkspaceStore.getState().workspaces[0].browserOverlayCount).toBe(0);
  });

  it('defers to history without hiding a workspace Browser, keeping missed outcomes unread', () => {
    vi.useFakeTimers();
    const ws = createWorkspaceFixture({ id: 'ws', browserVisible: true });
    useWorkspaceStore.setState({ workspaces: [ws], activeWorkspaceId: ws.id });
    render(<><ToastViewport /><NotificationCenter /></>);
    act(() => {
      store().show({ tone: 'warning', message: 'kept checkout' });
      store().show({ tone: 'info', message: 'moved conversation' });
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeTruthy();
    expect(useWorkspaceStore.getState().workspaces[0].browserOverlayCount ?? 0).toBe(0);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(store().notifications.find((entry) => entry.message === 'moved conversation')).toMatchObject({ dismissed: true, read: false });
    act(() => useWorkspaceStore.setState({ workspaces: [{ ...ws, browserVisible: false }] }));
    expect(screen.getByRole('alert')).toHaveTextContent('kept checkout');
  });

  it('follows the active destination instead of a parked workspace Browser', () => {
    const ws = createWorkspaceFixture({ id: 'parked', browserVisible: true });
    useWorkspaceStore.setState({ workspaces: [ws], activeWorkspaceId: ws.id });
    useAssistantNavStore.setState({ activeAssistantId: 'hermes:fred', openedAssistantIds: ['hermes:fred'] });
    store().show({ tone: 'warning', message: 'retained' });
    render(<ToastViewport />);
    expect(screen.getByRole('alert')).toHaveTextContent('retained');
    act(() => useAssistantSurfaceStore.getState().setBrowserVisible('hermes:fred', true));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useAssistantSurfaceStore.getState().byId['hermes:fred'].browserOverlayCount).toBe(0);
    act(() => useAssistantNavStore.getState().clearActive());
    expect(screen.queryByRole('alert')).toBeNull(); // the workspace Browser now owns the app
    act(() => useWorkspaceStore.setState({ workspaces: [{ ...ws, browserVisible: false }] }));
    expect(screen.getByRole('alert')).toHaveTextContent('retained');
  });

  it('suppresses the active Assistant Browser while history is open', async () => {
    useAssistantNavStore.setState({ activeAssistantId: 'hermes:fred', openedAssistantIds: ['hermes:fred'] });
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    const history = await screen.findByRole('dialog');
    expect(useAssistantSurfaceStore.getState().byId['hermes:fred'].browserOverlayCount).toBe(1);
    fireEvent.keyDown(history, { key: 'Escape' });
    expect(useAssistantSurfaceStore.getState().byId['hermes:fred'].browserOverlayCount).toBe(0);
  });

  it('runs a successful action and leaves the notice available for explicit dismissal', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    store().show({ tone: 'warning', message: 'checkout kept', actions: [{ label: 'Copy path', run }] });
    render(<ToastViewport />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy path' })); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Copy path' })).toBeEnabled();
    expect(store().notifications[0].dismissed).toBe(false);
  });

  it('runs an optional action once while pending, reports failure, and allows retry', async () => {
    let reject: (error: Error) => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    store().show({ tone: 'warning', message: 'needs action', actions: [{ label: 'Retry', run }] });
    render(<ToastViewport />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    await act(async () => reject(new Error('private diagnostic')));
    expect(screen.getByText('Could not complete the action. Try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('private diagnostic')).toBeNull();
  });
});
