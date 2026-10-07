import { normalizeWorkspacePath, workspaceIdentityKey } from '../../shared/workspaceIdentity';
import { isValidWorkspaceEnvironmentId } from '../../shared/sshValidation';
import type { WorkspaceLocation } from '../../shared/types/environments';
import type { WorkspaceTab } from '../store/workspaceTypes';

export const OPEN_WORKSPACES_STORAGE_KEY = 'clanker-grid:open-workspaces:v1';
export interface PersistedOpenWorkspaceState {
  version: 1;
  workspaces: WorkspaceLocation[];
  activeWorkspace?: WorkspaceLocation;
}
function identity(value: unknown): WorkspaceLocation | undefined {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.environmentId !== 'string' || !isValidWorkspaceEnvironmentId(record.environmentId)
    || typeof record.path !== 'string' || /[\0\r\n]/.test(record.path)) return;
  const path = normalizeWorkspacePath(record.path);
  if (!(path.startsWith('/') || (record.environmentId === 'local' && /^[A-Za-z]:\//.test(path)))) return;
  return { environmentId: record.environmentId.trim(), path };
}
export function parseOpenWorkspaceState(value: unknown, onInvalid?: () => void): PersistedOpenWorkspaceState {
  const empty: PersistedOpenWorkspaceState = { version: 1, workspaces: [] };
  if (!value || typeof value !== 'object') { if (value !== null) onInvalid?.(); return empty; }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.workspaces)) { onInvalid?.(); return empty; }
  const seen = new Set<string>();
  const workspaces: WorkspaceLocation[] = [];
  for (const entry of record.workspaces) {
    const location = identity(entry);
    if (!location) { onInvalid?.(); continue; }
    const key = workspaceIdentityKey(location);
    if (seen.has(key)) continue;
    seen.add(key); workspaces.push(location);
  }
  const activeWorkspace = identity(record.activeWorkspace);
  return { version: 1, workspaces, ...(activeWorkspace ? { activeWorkspace } : {}) };
}
export function readOpenWorkspaceState(onInvalid?: () => void): PersistedOpenWorkspaceState {
  try {
    return parseOpenWorkspaceState(JSON.parse(window.localStorage.getItem(OPEN_WORKSPACES_STORAGE_KEY) || 'null'), onInvalid);
  } catch { onInvalid?.(); return { version: 1, workspaces: [] }; }
}
export function persistOpenWorkspaces(workspaces: WorkspaceTab[], activeWorkspaceId: string | null): void {
  try {
    const location = (workspace: WorkspaceTab) => ({ environmentId: workspace.environmentId || 'local', path: workspace.workspacePath });
    const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
    const state = parseOpenWorkspaceState({ version: 1, workspaces: workspaces.map(location), activeWorkspace: active && location(active) });
    window.localStorage.setItem(OPEN_WORKSPACES_STORAGE_KEY, JSON.stringify(state));
  } catch { /* Storage is a preference, never a prerequisite for operating. */ }
}
