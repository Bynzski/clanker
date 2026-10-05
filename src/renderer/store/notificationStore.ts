import { create } from 'zustand';

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';
export interface NotificationAction {
  label: string;
  /** Renderer-owned action; IPC payloads must never supply executable callbacks. */
  run: () => void | Promise<void>;
}
export interface NotificationInput {
  message: string;
  tone: NotificationTone;
  workspaceId?: string;
  /** Captured when raised, so closing a workspace does not erase its identity. */
  workspaceName?: string;
  dedupeKey?: string;
  actions?: readonly NotificationAction[];
}
export interface AppNotification extends NotificationInput {
  id: number;
  createdAt: number;
  dismissed: boolean;
  read: boolean;
}
interface NotificationState {
  notifications: AppNotification[];
  show: (input: NotificationInput) => number;
  dismiss: (id: number) => void;
  /** Routine timeout: archive without claiming that the user read the message. */
  expire: (id: number) => void;
  markAllRead: () => void;
  clearHistory: () => void;
}

export const NOTIFICATION_HISTORY_LIMIT = 100;
export const TOAST_DURATION_MS = 6_000;
export const MAX_VISIBLE_TOASTS = 3;
export const isPersistentNotification = (tone: NotificationTone): boolean => tone === 'warning' || tone === 'error';
let nextId = 1;

/** Keep recent dismissed items. Pending warnings are never evicted by later routine outcomes. */
function retainHistory(notifications: AppNotification[]): AppNotification[] {
  let dismissed = 0;
  return notifications.filter((entry) => !entry.dismissed || ++dismissed <= NOTIFICATION_HISTORY_LIMIT);
}

/** App-wide, in-memory presentation state. No process, checkout or filesystem authority. */
export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  show: (input) => {
    const id = nextId++;
    set((state) => ({ notifications: retainHistory([
      { ...input, id, createdAt: Date.now(), dismissed: false, read: false },
      ...state.notifications.filter((entry) => !(input.dedupeKey !== undefined && !entry.dismissed
        && entry.dedupeKey === input.dedupeKey && entry.workspaceId === input.workspaceId && entry.tone === input.tone)),
    ]) }));
    return id;
  },
  dismiss: (id) => set((state) => ({ notifications: retainHistory(state.notifications.map((entry) =>
    entry.id === id ? { ...entry, dismissed: true, read: true } : entry)) })),
  expire: (id) => set((state) => ({ notifications: retainHistory(state.notifications.map((entry) =>
    entry.id === id && !isPersistentNotification(entry.tone) ? { ...entry, dismissed: true } : entry)) })),
  markAllRead: () => set((state) => state.notifications.every((entry) => entry.read) ? state : ({
    notifications: state.notifications.map((entry) => entry.read ? entry : { ...entry, read: true }),
  })),
  clearHistory: () => set((state) => ({ notifications: state.notifications.filter((entry) => !entry.dismissed) })),
}));
