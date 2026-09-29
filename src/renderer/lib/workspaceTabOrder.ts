import { workspaceIdentityKey } from '../../shared/workspaceIdentity';
import type { WorkspaceTab } from '../store/workspaceTypes';

const STORAGE_KEY = 'clanker-grid:workspace-tab-order:v1';
const MAX_SAVED_WORKSPACES = 200;
type WorkspaceIdentity = Pick<WorkspaceTab, 'workspacePath' | 'environmentId'>;

function orderKey(workspace: WorkspaceIdentity): string {
  return workspaceIdentityKey({ path: workspace.workspacePath, environmentId: workspace.environmentId });
}

function readOrder(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((entry): entry is string => typeof entry === 'string'))]
      .slice(0, MAX_SAVED_WORKSPACES);
  } catch {
    return [];
  }
}

/** Keep a reopened workspace in the user's last chosen tab order. */
export function insertWorkspaceInSavedOrder(workspaces: WorkspaceTab[], workspace: WorkspaceTab): WorkspaceTab[] {
  const order = readOrder();
  const rank = order.indexOf(orderKey(workspace));
  if (rank < 0) return [...workspaces, workspace];
  const insertionIndex = workspaces.findIndex((entry) => {
    const entryRank = order.indexOf(orderKey(entry));
    return entryRank < 0 || entryRank > rank;
  });
  const next = [...workspaces];
  next.splice(insertionIndex < 0 ? next.length : insertionIndex, 0, workspace);
  return next;
}

/** Persist only identities, retaining closed workspaces in their saved positions. */
export function persistWorkspaceTabOrder(workspaces: WorkspaceTab[]): void {
  if (typeof window === 'undefined') return;
  try {
    const openKeys = workspaces.map(orderKey);
    const previousOrder = readOrder();
    const openSet = new Set(openKeys);
    const savedSet = new Set(previousOrder);
    const reorderedSavedOpen = openKeys.filter((key) => savedSet.has(key));
    let openIndex = 0;
    const merged = previousOrder.map((key) => openSet.has(key) ? reorderedSavedOpen[openIndex++] : key);

    // New workspaces have no saved slot. Insert each beside its open neighbors.
    for (let index = 0; index < openKeys.length; index++) {
      const key = openKeys[index];
      if (savedSet.has(key)) continue;
      const previousOpen = openKeys.slice(0, index).reverse().find((candidate) => merged.includes(candidate));
      const nextOpen = openKeys.slice(index + 1).find((candidate) => merged.includes(candidate));
      const insertionIndex = previousOpen
        ? merged.indexOf(previousOpen) + 1
        : nextOpen ? merged.indexOf(nextOpen) : merged.length;
      merged.splice(insertionIndex, 0, key);
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.slice(0, MAX_SAVED_WORKSPACES)));
  } catch {
    // Storage failure must not prevent tab reordering.
  }
}
