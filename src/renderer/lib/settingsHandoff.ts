/** Usage hands account management to the app-owned Settings destination; there is no second Settings model. */
type ManageAccounts = (harnessId: string, intent: 'manage' | 'add') => void;

let handler: ManageAccounts | null = null;

export function registerManageAccountsHandler(next: ManageAccounts): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export function openAccountSettings(harnessId: string, intent: 'manage' | 'add'): boolean {
  if (!handler) return false;
  handler(harnessId, intent);
  return true;
}

/** Settings saved a harness preference the Usage widget depends on ("Show in Usage"); it re-reads. */
const listeners = new Set<() => void>();

export function onUsagePreferenceSaved(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyUsagePreferenceSaved(): void {
  listeners.forEach((listener) => listener());
}
