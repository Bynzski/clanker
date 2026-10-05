import { useEffect, useRef, useState } from 'react';
import { Bell, CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useNotificationStore, isPersistentNotification, MAX_VISIBLE_TOASTS, TOAST_DURATION_MS } from '../store/notificationStore';
import type { AppNotification } from '../store/notificationStore';
import { useActiveDestination } from '../lib/activeDestination';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAssistantSurfaceStore } from '../store/assistantSurfaceStore';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import './NotificationCenter.css';

const TONE_ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };

function NotificationCard({ notification, history = false }: { notification: AppNotification; history?: boolean }) {
  const dismiss = useNotificationStore((state) => state.dismiss);
  const expire = useNotificationStore((state) => state.expire);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [actionError, setActionError] = useState(false);
  const remaining = useRef(TOAST_DURATION_MS);
  const paused = hovered || focused || running !== null;
  useEffect(() => {
    if (history || paused || isPersistentNotification(notification.tone)) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => expire(notification.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [expire, history, notification.id, notification.tone, paused]);

  const Icon = TONE_ICONS[notification.tone];
  return (
    <article className={`notification-card notification-${notification.tone}`}
      role={history ? undefined : isPersistentNotification(notification.tone) ? 'alert' : 'status'}
      aria-atomic={history ? undefined : true}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onKeyDown={(event) => {
        if (!history && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(notification.id); }
      }}>
      <Icon size={14} className="notification-tone-icon" aria-hidden="true" />
      <div className="notification-body">
        {notification.workspaceId && <div className="notification-workspace">{notification.workspaceName ?? notification.workspaceId}</div>}
        <p className="notification-message">{notification.message}</p>
        {history && <time className="notification-time" dateTime={new Date(notification.createdAt).toISOString()}>
          {new Date(notification.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </time>}
        {notification.actions && notification.actions.length > 0 && <div className="notification-actions">
          {notification.actions.map((action, index) => <Button key={index} size="xs" disabled={running !== null} onClick={async () => {
            setRunning(index);
            setActionError(false);
            try { await action.run(); } catch { setActionError(true); } finally { setRunning(null); }
          }}>{running === index ? 'Working…' : action.label}</Button>)}
        </div>}
        {actionError && <p className="notification-action-error" role="alert">Could not complete the action. Try again.</p>}
      </div>
      {!notification.dismissed && <IconButton variant="ghost" size="xs" aria-label={`Dismiss notification: ${notification.message}`}
        title="Dismiss notification" onClick={() => dismiss(notification.id)}><X size={12} aria-hidden="true" /></IconButton>}
    </article>
  );
}

/** Floating renderer overlay. Native Browser destinations defer to the always-available history. */
export function ToastViewport() {
  const destination = useActiveDestination();
  const workspaceBrowserVisible = useWorkspaceStore((state) => destination.kind === 'workspace'
    && state.workspaces.some((workspace) => workspace.id === destination.workspaceId && workspace.browserVisible));
  const assistantBrowserVisible = useAssistantSurfaceStore((state) => destination.kind === 'assistant'
    && state.byId[destination.assistantId]?.browserVisible === true);
  // A WebContentsView is composited above renderer HTML regardless of z-index. Do not hide or
  // resize a live Browser just to show a toast; the bell/history retains these notifications.
  const deferToHistory = workspaceBrowserVisible || assistantBrowserVisible;
  const notifications = useNotificationStore((state) => state.notifications);
  const pending = notifications.filter((entry) => !entry.dismissed).reverse();
  const visible = pending.slice(0, MAX_VISIBLE_TOASTS);
  // Routine messages queued behind persistent warnings still expire into readable history.
  // Otherwise an unattended warning stack could accumulate an unbounded routine queue.
  useEffect(() => {
    const queued = notifications.filter((entry) => !entry.dismissed).reverse().slice(deferToHistory ? 0 : MAX_VISIBLE_TOASTS)
      .filter((entry) => !isPersistentNotification(entry.tone));
    if (queued.length === 0) return;
    const deadline = queued.reduce((earliest, entry) => Math.min(earliest, entry.createdAt + TOAST_DURATION_MS), Infinity);
    const timer = setTimeout(() => {
      const now = Date.now();
      for (const entry of queued) {
        if (entry.createdAt + TOAST_DURATION_MS <= now) useNotificationStore.getState().expire(entry.id);
      }
    }, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [notifications, deferToHistory]);
  if (deferToHistory || visible.length === 0) return null;
  return <section className="toast-viewport" aria-label="Notifications">
    <div className="toast-stack">
      {visible.map((notification) => <NotificationCard key={notification.id} notification={notification} />)}
      {pending.length > visible.length && <span className="notification-overflow">{pending.length - visible.length} more in notification history</span>}
    </div>
  </section>;
}

function NotificationHistory() {
  const notifications = useNotificationStore((state) => state.notifications);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const clearHistory = useNotificationStore((state) => state.clearHistory);
  useEffect(() => { markAllRead(); }, [notifications, markAllRead]);
  return <>
    <div className="notification-history-header">
      <h2>Notifications</h2>
      <Button variant="ghost" size="xs" disabled={!notifications.some((entry) => entry.dismissed)} onClick={clearHistory}>Clear dismissed</Button>
    </div>
    {notifications.length === 0 ? <p className="notification-empty">No recent notifications</p> :
      <div className="notification-history-list">{notifications.map((notification) =>
        <NotificationCard key={notification.id} notification={notification} history />)}</div>}
  </>;
}

/** Always available, including with no workspace or while an Assistant owns the app shell. */
export function NotificationCenter() {
  const notifications = useNotificationStore((state) => state.notifications);
  const unread = notifications.filter((entry) => !entry.read).length;
  const warning = notifications.some((entry) => !entry.read && isPersistentNotification(entry.tone));
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="xs" className={`notification-trigger${warning ? ' notification-trigger-warning' : ''}`}
      aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} title="Notification history">
      <Bell size={12} aria-hidden="true" />{unread > 0 && <span>{unread}</span>}
    </Button></PopoverTrigger>
    <PopoverContent side="top" align="end" className="notification-history" aria-label="Notification history">
      <NotificationHistory />
    </PopoverContent>
  </Popover>;
}
