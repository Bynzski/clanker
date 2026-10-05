import { beforeEach, describe, expect, it } from 'vitest';
import { NOTIFICATION_HISTORY_LIMIT, useNotificationStore } from '../../../src/renderer/store/notificationStore';

const store = () => useNotificationStore.getState();
beforeEach(() => useNotificationStore.setState({ notifications: [] }));

describe('notification store', () => {
  it('deduplicates pending events within their workspace and tone, renewing their identity', () => {
    const first = store().show({ tone: 'warning', message: 'first', dedupeKey: 'cleanup', workspaceId: 'a' });
    const next = store().show({ tone: 'warning', message: 'updated', dedupeKey: 'cleanup', workspaceId: 'a' });
    store().dismiss(first); // a timer or action from the old toast cannot dismiss its replacement
    expect(store().notifications).toMatchObject([{ id: next, message: 'updated', dismissed: false }]);
    store().show({ tone: 'warning', message: 'other workspace', dedupeKey: 'cleanup', workspaceId: 'b' });
    store().show({ tone: 'success', message: 'success', dedupeKey: 'cleanup', workspaceId: 'a' });
    expect(store().notifications).toHaveLength(3);
    expect(store().notifications.find((entry) => entry.id === next)?.dismissed).toBe(false);
  });

  it('keeps dismissed history and raises a fresh event when its key recurs', () => {
    const input = { tone: 'info' as const, message: 'saved', dedupeKey: 'save' };
    store().dismiss(store().show(input));
    store().show(input);
    expect(store().notifications.map((entry) => entry.dismissed)).toEqual([false, true]);
  });

  it('bounds dismissed history without evicting pending warnings', () => {
    const warning = store().show({ tone: 'warning', message: 'keep me' });
    for (let i = 0; i < NOTIFICATION_HISTORY_LIMIT + 20; i++) {
      store().dismiss(store().show({ tone: 'success', message: `saved ${i}` }));
    }
    expect(store().notifications).toHaveLength(NOTIFICATION_HISTORY_LIMIT + 1);
    expect(store().notifications.find((entry) => entry.id === warning)).toMatchObject({ dismissed: false });
    store().clearHistory();
    expect(store().notifications).toMatchObject([{ id: warning }]);
  });

  it('archives routine outcomes as unread and never expires a persistent warning', () => {
    const info = store().show({ tone: 'info', message: 'background outcome' });
    const warning = store().show({ tone: 'warning', message: 'needs attention' });
    store().expire(info);
    store().expire(warning);
    expect(store().notifications.find((entry) => entry.id === info)).toMatchObject({ dismissed: true, read: false });
    expect(store().notifications.find((entry) => entry.id === warning)).toMatchObject({ dismissed: false, read: false });
  });

  it('reading history does not dismiss pending warnings', () => {
    store().show({ tone: 'error', message: 'failed' });
    store().markAllRead();
    expect(store().notifications[0]).toMatchObject({ read: true, dismissed: false });
  });
});
